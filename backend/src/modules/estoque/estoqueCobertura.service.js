// Estoque Inteligente — cobertura em dias e produtos parados com valor parado (Task 13.2 do PLAN.md).
// (/vencimento NÃO faz parte desta fase: decisão do usuário, sem rota.)
//
// Schema real do ERP (o mesmo já verificado em rankingEspeciais.service.js):
//   vendas_produto_dia_cache (dia, produto, quantidade, ...): cache por dia e produto das vendas VÁLIDAS
//   (Task 7.3/7.4; a linha produto = 0 é a sentinela de dia completo e é ignorada)
//   produto.qtestoque (estoque atual, DOUBLE; pode ser NEGATIVO ou NULL)   produto.precocusto (custo unitário)
//   produto.descricao, produto.situacao ('B' = bloqueado), produto.grupo / setor / familia
// produto.Estoque é a flag S/N (controla estoque) — NÃO é quantidade; só entra no filtro que exclui 'N'.
//
// REGRAS (decisões do usuário, PLAN.md Fase 13):
//   - PRODUTOS BLOQUEADOS (situacao = 'B') ficam fora de tudo: lista, contagem e soma
//     (COALESCE(produto.situacao, '') <> 'B', o mesmo critério de curvaAbc.service.js).
//   - PRODUTOS QUE NÃO CONTROLAM ESTOQUE (produto.Estoque = 'N') também ficam fora de tudo, inclusive do
//     valorTotalParado (COALESCE(produto.Estoque, 'S') <> 'N', robusto a NULL).
//   - Quantidade vendida = SUM(quantidade) por produto no período, lida do CACHE vendas_produto_dia_cache (Task 13.3),
//     com produto > 0. O cache só tem vendas válidas: estas rotas NÃO tocam vendaitem, vendacupom nem flagvc (a
//     agregação transacional de 12 meses estourava o timeout na primeira consulta).
//   - DEVOLUÇÕES/CANCELAMENTOS: a subconsulta `vendidos` tem HAVING SUM(quantidade) > 0. Um produto cuja venda líquida
//     no período é <= 0 (devolveu mais do que vendeu, ou cupom cancelado depois, que fica com quantidade 0) NÃO conta
//     como "com venda": não aparece em /cobertura (evita divisão por zero/média negativa) e pode aparecer em
//     /parados. É o mesmo critério de /demanda-baixo-estoque.
//   - DIA FECHADO: o `fim` é limitado a ONTEM (resolverPeriodoFechado); o mesmo fim efetivo vale para o filtro de
//     período e para o divisor de dias. A resposta traz `fim` efetivo e `fimSolicitado`; `inicio` a partir de
//     hoje -> ErroValidacao (400).
//   - COBERTURA DO CACHE: antes de consultar, verificarCobertura exige a sentinela fechada de todos os dias do período
//     efetivo; se faltar algum, sobe ErroCacheIncompleto (503 { erro } com o comando do job), sem resultado parcial.
//
// COBERTURA: produtos COM venda válida no período. cobertura (dias) = qtestoque / (quantidadeVendida / dias)
//   = qtestoque * dias / quantidadeVendida; estoque <= 0 (ou NULL) tem cobertura 0. dias = dias inclusivos entre
//   inicio e fim EFETIVO. Ordem: menor cobertura, quantidadeVendida desc, id. totalItens = todos os produtos com
//   venda do filtro (consulta de contagem separada, sem LIMIT).
//
// PARADOS: produto com qtestoque > 0 e NENHUMA venda válida no período. O filtro de venda válida e de período
//   fica DENTRO da subconsulta `vendidos`, que entra no LEFT JOIN; o parado é o que não achou par
//   (vendidos.produto IS NULL). Com o filtro no WHERE externo o LEFT JOIN viraria INNER JOIN e nada apareceria.
//   custoUnitario = COALESCE(produto.precocusto, 0) (única base de custo); valorParado = qtestoque * custoUnitario.
//   Ordem: valorParado desc, id. `totalItens` e `valorTotalParado` cobrem TODOS os parados do filtro (não só a
//   página), por uma consulta separada (o MariaDB 10.1 não tem window functions).
//
// SQL em dois níveis (candidatos -> ORDER BY): a ordenação usa só colunas simples da tabela derivada, nunca alias de
// agregação dentro de expressão (MariaDB 10.1.41: ER_ILLEGAL_REFERENCE).
// Listas são sempre limitadas por `limite` (padrão 50, máx. 500).

const { getPool } = require('../../db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { buildPeriodFilter, buildDepartmentFilter, ErroValidacao } = require('../../shared/queryFilters');
const {
  verificarCobertura,
  resolverPeriodoFechado,
  montarQuantidadeVendidaDoCache,
  ErroCacheIncompleto,
} = require('../rankingProdutos/cacheProduto');

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;
const NOME_SEM_DESCRICAO = 'Sem descrição';
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const SITUACAO_NAO_BLOQUEADO_SQL = "COALESCE(produto.situacao, '') <> 'B'";
// Produto que não controla estoque (produto.Estoque = 'N') nunca entra (Estoque NULL conta como controla).
const CONTROLA_ESTOQUE_SQL = "COALESCE(produto.Estoque, 'S') <> 'N'";

class ErroInternoEstoqueCobertura extends Error {
  constructor() {
    super('Erro interno ao consultar o estoque.');
    this.name = 'ErroInternoEstoqueCobertura';
  }
}

function arredondar(valor, casas) {
  const fator = 10 ** casas;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round((numero + Number.EPSILON) * fator) / fator : 0;
}

function validarLimite(limite) {
  if (limite === undefined || limite === null || limite === '') return LIMITE_PADRAO;
  const numero = typeof limite === 'number' ? limite : /^\d+$/.test(String(limite)) ? Number(limite) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > LIMITE_MAXIMO) {
    throw new ErroValidacao(`Limite inválido: informe um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
  }
  return numero;
}

// Departamento é opcional; se `nivel` ou `id` vier, os dois precisam ser válidos.
function lerDepartamento(nivel, id) {
  const semNivel = nivel === undefined || nivel === null || nivel === '';
  const semId = id === undefined || id === null || id === '';
  if (semNivel && semId) return null;
  return buildDepartmentFilter({ nivel, id });
}

// Valida tudo antes de qualquer consulta e resolve o período fechado (fim efetivo).
function normalizarFiltros({ inicio, fim, limite, nivel, id } = {}) {
  buildPeriodFilter(inicio, fim);
  const limiteValido = validarLimite(limite);
  const departamento = lerDepartamento(nivel, id);
  const periodoFechado = resolverPeriodoFechado(inicio, fim);
  return {
    ...periodoFechado,
    periodo: montarQuantidadeVendidaDoCache(periodoFechado.inicio, periodoFechado.fim),
    limite: limiteValido,
    departamento,
    dias: contarDiasDoPeriodo(periodoFechado.inicio, periodoFechado.fim),
  };
}

// Dias inclusivos entre inicio e fim (ISO já validados por buildPeriodFilter, máx. 366).
function contarDiasDoPeriodo(inicio, fim) {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / UM_DIA_MS) + 1;
}

// Condições sobre `produto` (bloqueado e controla-estoque sempre primeiro; usadas em lista, total e soma de parados) e seus parâmetros (departamento).
function montarCondicoesProduto(departamento, extras = []) {
  const condicoes = [SITUACAO_NAO_BLOQUEADO_SQL, CONTROLA_ESTOQUE_SQL, ...extras];
  if (departamento) condicoes.push(departamento.clause);
  return condicoes.join(' AND ');
}

// `periodo` = { sql, params } da quantidade vendida no cache (params: datas ISO inicio e fim).
// Ordem dos placeholders: dias do período (cobertura) -> período do cache -> departamento -> limite.
function montarSqlCobertura({ periodo, limite, departamento, dias }) {
  const sql = `SELECT candidatos.id AS id, candidatos.nome AS nome, candidatos.estoqueAtual AS estoqueAtual,
  candidatos.quantidadeVendida AS quantidadeVendida, candidatos.coberturaDias AS coberturaDias
FROM (
  SELECT produto.idProduto AS id,
    COALESCE(produto.descricao, '${NOME_SEM_DESCRICAO}') AS nome,
    produto.qtestoque AS estoqueAtual,
    vendidos.quantidadeVendida AS quantidadeVendida,
    IF(COALESCE(produto.qtestoque, 0) <= 0, 0, produto.qtestoque * ? / vendidos.quantidadeVendida) AS coberturaDias
  FROM (
  ${periodo.sql}
  ) AS vendidos
  INNER JOIN produto ON produto.idProduto = vendidos.produto
  WHERE ${montarCondicoesProduto(departamento)}
) AS candidatos
ORDER BY candidatos.coberturaDias, candidatos.quantidadeVendida DESC, candidatos.id
LIMIT ?`;
  return { sql, params: [dias, ...periodo.params, ...(departamento ? departamento.params : []), limite] };
}

// Total de produtos com venda do filtro (sem LIMIT).
function montarSqlTotalCobertura({ periodo, departamento }) {
  const sql = `SELECT COUNT(*) AS totalItens
FROM (
  ${periodo.sql}
) AS vendidos
INNER JOIN produto ON produto.idProduto = vendidos.produto
WHERE ${montarCondicoesProduto(departamento)}`;
  return { sql, params: [...periodo.params, ...(departamento ? departamento.params : [])] };
}

// Parado = sem par em `vendidos` (LEFT JOIN ... IS NULL) e com estoque positivo.
function montarCorpoParados({ periodo, departamento }) {
  return `FROM produto
LEFT JOIN (
  ${periodo.sql}
) AS vendidos ON vendidos.produto = produto.idProduto
WHERE ${montarCondicoesProduto(departamento, ['produto.qtestoque > 0', 'vendidos.produto IS NULL'])}`;
}

// Ordem dos placeholders: período do cache (subconsulta do LEFT JOIN) -> departamento -> limite.
function montarSqlParados(filtros) {
  const { periodo, departamento, limite } = filtros;
  const sql = `SELECT candidatos.id AS id, candidatos.nome AS nome, candidatos.estoqueAtual AS estoqueAtual,
  candidatos.custoUnitario AS custoUnitario, candidatos.valorParado AS valorParado
FROM (
  SELECT produto.idProduto AS id,
    COALESCE(produto.descricao, '${NOME_SEM_DESCRICAO}') AS nome,
    produto.qtestoque AS estoqueAtual,
    COALESCE(produto.precocusto, 0) AS custoUnitario,
    produto.qtestoque * COALESCE(produto.precocusto, 0) AS valorParado
  ${montarCorpoParados(filtros)}
) AS candidatos
ORDER BY candidatos.valorParado DESC, candidatos.id
LIMIT ?`;
  return { sql, params: [...periodo.params, ...(departamento ? departamento.params : []), limite] };
}

// Soma de TODOS os parados do filtro (sem LIMIT): quantidade e valor total.
function montarSqlTotalParados(filtros) {
  const { periodo, departamento } = filtros;
  const sql = `SELECT COUNT(*) AS totalItens,
  SUM(produto.qtestoque * COALESCE(produto.precocusto, 0)) AS valorTotalParado
${montarCorpoParados(filtros)}`;
  return { sql, params: [...periodo.params, ...(departamento ? departamento.params : [])] };
}

async function executar(rotulo, consulta) {
  try {
    const [linhas] = await getPool().execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
    return Array.isArray(linhas) ? linhas : [];
  } catch (erro) {
    console.error(
      `[estoque] Falha ao consultar ${rotulo} (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoEstoqueCobertura();
  }
}

// Garante que o cache cobre todos os dias fechados do período efetivo ANTES de qualquer consulta de dados:
// ErroCacheIncompleto (503) sobe como está; erro de banco vira o erro interno genérico (logando só o código).
async function garantirCacheCoberto(filtros) {
  try {
    await verificarCobertura(getPool(), [{ inicio: filtros.inicio, fim: filtros.fim }]);
  } catch (erro) {
    if (erro instanceof ErroCacheIncompleto) throw erro;
    console.error(
      `[estoque] Falha ao verificar o cache de vendas por produto (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoEstoqueCobertura();
  }
}

function nomeDoProduto(nome) {
  return typeof nome === 'string' && nome.trim() ? nome : NOME_SEM_DESCRICAO;
}

// null/undefined continuam null (estoque ausente); o resto vira número.
function numeroOuNulo(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

// Retorna { inicio, fim (efetivo), fimSolicitado, limite, totalItens,
//           itens: [{ id, nome, estoqueAtual, quantidadeVendida, mediaDiaria, coberturaDias }] }.
// Lança ErroValidacao (400; inclusive `inicio` a partir de hoje), ErroCacheIncompleto (503) ou
// ErroInternoEstoqueCobertura (banco).
async function obterCobertura(entrada = {}) {
  const filtros = normalizarFiltros(entrada);
  await garantirCacheCoberto(filtros);
  const [linhas, totais] = await Promise.all([
    executar('a cobertura de estoque', montarSqlCobertura(filtros)),
    executar('o total da cobertura de estoque', montarSqlTotalCobertura(filtros)),
  ]);
  return {
    inicio: filtros.inicio,
    fim: filtros.fim,
    fimSolicitado: filtros.fimSolicitado,
    limite: filtros.limite,
    totalItens: Number(totais[0] && totais[0].totalItens) || 0,
    itens: linhas.map((linha) => {
      const quantidadeVendida = Number(linha.quantidadeVendida) || 0;
      return {
        id: Number(linha.id),
        nome: nomeDoProduto(linha.nome),
        estoqueAtual: numeroOuNulo(linha.estoqueAtual),
        quantidadeVendida: arredondar(quantidadeVendida, 3),
        mediaDiaria: arredondar(quantidadeVendida / filtros.dias, 2),
        coberturaDias: arredondar(linha.coberturaDias, 2),
      };
    }),
  };
}

// Retorna { inicio, fim (efetivo), fimSolicitado, limite, totalItens, valorTotalParado,
//           itens: [{ id, nome, estoqueAtual, custoUnitario, valorParado }] } ordenados por valorParado desc.
// Lança ErroValidacao (400), ErroCacheIncompleto (503) ou ErroInternoEstoqueCobertura (banco).
async function obterProdutosParados(entrada = {}) {
  const filtros = normalizarFiltros(entrada);
  await garantirCacheCoberto(filtros);
  const [linhas, totais] = await Promise.all([
    executar('os produtos parados', montarSqlParados(filtros)),
    executar('o total dos produtos parados', montarSqlTotalParados(filtros)),
  ]);
  const total = totais[0] || {};
  return {
    inicio: filtros.inicio,
    fim: filtros.fim,
    fimSolicitado: filtros.fimSolicitado,
    limite: filtros.limite,
    totalItens: Number(total.totalItens) || 0,
    valorTotalParado: arredondar(total.valorTotalParado, 2),
    itens: linhas.map((linha) => ({
      id: Number(linha.id),
      nome: nomeDoProduto(linha.nome),
      estoqueAtual: Number(linha.estoqueAtual) || 0,
      custoUnitario: arredondar(linha.custoUnitario, 4),
      valorParado: arredondar(linha.valorParado, 2),
    })),
  };
}

module.exports = {
  obterCobertura,
  obterProdutosParados,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  ErroInternoEstoqueCobertura,
  ErroCacheIncompleto,
};
