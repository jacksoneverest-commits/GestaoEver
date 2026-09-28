// Rankings "especiais" de produtos (Task 7.2 do PLAN.md): parados, novos e alta demanda/baixo estoque.
//
// Schema real do ERP usado aqui (o mesmo já verificado em vendasDepartamento.service.js):
//   vendacupom.idcupom = vendaitem.idcupom        vendaitem.produto = produto.idProduto
//   vendaitem.qt (quantidade, DOUBLE)             vendaitem.vtotal (valor do item, DECIMAL)
//   produto.descricao, produto.grupo / setor / familia
// Só vendas válidas contam (JOIN_VENDA_VALIDA + WHERE_VENDA_VALIDA de shared/vendaValida.js).
//
// PARADOS: produto sem NENHUMA venda válida no período. O filtro de venda válida e de período
//   fica DENTRO da subconsulta `vendidos`, que entra no LEFT JOIN; o produto "parado" é o que
//   não achou par (vendidos.produto IS NULL). Se o filtro estivesse no WHERE externo o LEFT JOIN
//   viraria INNER JOIN e nenhum produto parado apareceria.
//
// NOVOS (Task 7.4): produto cuja primeira venda válida caiu dentro do período. Lê SÓ o cache:
//   primeira_venda_produto (primeira venda válida por produto, mantida por jobs/vendasProdutoCache.job.js)
//   filtrada por primeira_venda dentro do período, e vendas_produto_dia_cache para somar a
//   quantidade/faturamento do período. Não consulta vendaitem/vendacupom (o antigo NOT EXISTS sobre o
//   histórico foi removido). Produtos cuja quantidade no período é 0 (primeira venda cancelada depois)
//   ficam de fora; a sentinela do cache diário (produto 0) é ignorada (`produto > 0`).
//   DIA FECHADO: o `fim` é limitado a ONTEM (hoje nunca é dia fechado); a resposta traz `fim` efetivo e
//   `fimSolicitado`. `inicio` posterior a ontem -> ErroValidacao (400).
//   GUARDA DO HISTÓRICO (503): MIN(primeira_venda) de primeira_venda_produto precisa existir e ser <= `inicio`
//   efetivo; senão o preenchimento do histórico de primeira venda (job com --desde da primeira venda do ERP)
//   não chegou até o período e produtos antigos apareceriam como "novos". Consulta barata só no cache, sem
//   migration nova. Limitação de borda (período que começa antes da primeira venda do ERP inteiro => falso 503;
//   preenchimento parcial que começa após a primeira venda real mas <= inicio => falso OK): ver
//   cacheProduto.verificarHistoricoPrimeiraVenda.
//   COBERTURA: se o cache diário não tiver a sentinela fechada de todos os dias do período efetivo, responde
//   ErroCacheIncompleto (503) em vez de lista/somas parciais (ver cacheProduto.js).
//   LIMITAÇÃO: primeira_venda_produto usa LEAST (não "avança" se a venda mais antiga for cancelada);
//   detalhes no cabeçalho do job.
//
// DEMANDA-BAIXO-ESTOQUE (Task 7.2; decisão do usuário, schema confirmado no banco de dev):
//   estoque atual = produto.qtestoque (DOUBLE; pode ser NEGATIVO ou NULL), mínimo = produto.qtminima,
//   máximo = produto.qtmaxima. produto.Estoque é só a flag S/N — NÃO é quantidade e não é usada aqui.
//   Alta demanda = quantidade vendida > 0 no período, SOMADA DO CACHE vendas_produto_dia_cache (Task 13.3):
//   SUM(quantidade) com produto > 0 (ignora a sentinela) e HAVING SUM(quantidade) > 0. O cache só tem vendas
//   válidas, então esta rota NÃO toca vendaitem, vendacupom nem flagvc (a agregação transacional de 12 meses
//   estourava o timeout na primeira consulta).
//   Baixo estoque = qtestoque <= qtminima OU cobertura < COBERTURA_MINIMA_DIAS, onde
//     cobertura (dias) = qtestoque / (quantidadeVendida / diasDoPeríodo) = qtestoque * dias / quantidadeVendida;
//     estoque <= 0 (ou NULL) tem cobertura 0. diasDoPeríodo = dias inclusivos entre inicio e fim EFETIVO.
//   DIA FECHADO: o `fim` é limitado a ONTEM (resolverPeriodoFechado, como /novos); o mesmo fim efetivo vale para o
//   filtro de período e para o divisor. A resposta traz `fim` efetivo e `fimSolicitado`; `inicio` a partir de hoje
//   -> ErroValidacao (400).
//   COBERTURA DO CACHE: antes de consultar, verificarCobertura exige a sentinela fechada de todos os dias do período
//   efetivo; se faltar algum, sobe ErroCacheIncompleto (503 { erro } com o comando do job), sem resultado parcial.
//   SEM filtro de Estoque = 'S' e SEM filtro de situacao (decisão do usuário).
//   SQL em três níveis: `vendidos` (agrega a venda por produto) -> `candidatos` (junta o produto e calcula a
//   cobertura) -> filtro/ordenação por colunas da tabela derivada. Assim o WHERE e o ORDER BY usam só colunas
//   simples, nunca alias de agregação dentro de expressão (MariaDB 10.1: ER_ILLEGAL_REFERENCE).
//   Ordem: cobertura ASC (mais urgente primeiro), quantidadeVendida DESC, id. `motivo` é derivado no service.
//
// Listas de produtos parados/novos/demanda-baixo-estoque são sempre limitadas por `limite` (padrão 50, máx. 500).

const { getPool } = require('../../db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { buildPeriodFilter, buildDepartmentFilter, ErroValidacao } = require('../../shared/queryFilters');
const {
  verificarCobertura,
  verificarHistoricoPrimeiraVenda,
  resolverPeriodoFechado,
  montarQuantidadeVendidaDoCache,
  ErroCacheIncompleto,
} = require('./cacheProduto');

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;
const NOME_SEM_DESCRICAO = 'Sem descrição';
// Limiar de cobertura (dias) abaixo do qual um produto de alta demanda é considerado com baixo estoque.
const COBERTURA_MINIMA_DIAS = 7;
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const MOTIVO_ABAIXO_MINIMO = 'abaixo_minimo';
const MOTIVO_COBERTURA_BAIXA = 'cobertura_baixa';
const MOTIVO_AMBOS = 'abaixo_minimo_e_cobertura_baixa';

class ErroInternoRankingEspeciais extends Error {
  constructor() {
    super('Erro interno ao consultar o ranking de produtos.');
    this.name = 'ErroInternoRankingEspeciais';
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

function normalizarFiltros({ inicio, fim, limite, nivel, id } = {}) {
  return {
    inicio,
    fim,
    periodo: buildPeriodFilter(inicio, fim),
    limite: validarLimite(limite),
    departamento: lerDepartamento(nivel, id),
  };
}

// Vendas válidas do período, agrupadas por produto (conduzido por vendacupom.data).
function montarVendidosNoPeriodo(colunasExtras, periodo, having = '') {
  return `SELECT STRAIGHT_JOIN vendaitem.produto AS produto${colunasExtras}
    FROM vendacupom
    ${JOIN_VENDA_VALIDA}
    INNER JOIN vendaitem ON vendaitem.idcupom = vendacupom.idcupom
    WHERE ${WHERE_VENDA_VALIDA} AND ${periodo.clause}
    GROUP BY vendaitem.produto${having}`;
}

function montarSqlParados({ periodo, limite, departamento }) {
  const filtroDepartamento = departamento ? ` AND ${departamento.clause}` : '';
  const sql = `SELECT produto.idProduto AS id, produto.descricao AS nome
FROM produto
LEFT JOIN (
  ${montarVendidosNoPeriodo('', periodo)}
) AS vendidos ON vendidos.produto = produto.idProduto
WHERE vendidos.produto IS NULL${filtroDepartamento}
ORDER BY produto.descricao, produto.idProduto
LIMIT ?`;
  return { sql, params: [...periodo.params, ...(departamento ? departamento.params : []), limite] };
}

// Ordem dos placeholders: período (junção com o cache diário) -> período (primeira_venda) -> departamento -> limite.
// O ORDER BY usa aliases sem colisão com colunas do cache (faturamento/quantidade existem lá).
function montarSqlNovos(filtros) {
  const { limite, departamento } = filtros;
  const cache = 'vendas_produto_dia_cache';
  const periodoDias = buildPeriodFilter(filtros.inicio, filtros.fim, `${cache}.dia`);
  const periodoPrimeira = buildPeriodFilter(filtros.inicio, filtros.fim, 'primeira_venda_produto.primeira_venda');
  const filtroDepartamento = departamento ? ` AND ${departamento.clause}` : '';
  const sql = `SELECT produto.idProduto AS id, produto.descricao AS nome,
  DATE_FORMAT(primeira_venda_produto.primeira_venda, '%Y-%m-%d') AS primeiraVenda,
  SUM(${cache}.quantidade) AS quantidadePeriodo,
  SUM(${cache}.faturamento) AS faturamentoPeriodo
FROM primeira_venda_produto
INNER JOIN produto ON produto.idProduto = primeira_venda_produto.produto
INNER JOIN ${cache} ON ${cache}.produto = primeira_venda_produto.produto AND ${cache}.produto > 0 AND ${periodoDias.clause}
WHERE ${periodoPrimeira.clause}${filtroDepartamento}
GROUP BY produto.idProduto, produto.descricao, primeira_venda_produto.primeira_venda
HAVING SUM(${cache}.quantidade) > 0
ORDER BY faturamentoPeriodo DESC, produto.idProduto
LIMIT ?`;
  return {
    sql,
    params: [...periodoDias.params, ...periodoPrimeira.params, ...(departamento ? departamento.params : []), limite],
  };
}

// Dias inclusivos entre inicio e fim (ISO já validados por buildPeriodFilter, máx. 366).
function contarDiasDoPeriodo(inicio, fim) {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / UM_DIA_MS) + 1;
}

// `periodo` = { sql, params } da quantidade vendida no cache (params: datas ISO inicio e fim).
// Ordem dos placeholders: dias do período (cobertura) -> período do cache -> departamento -> limiar -> limite.
function montarSqlDemandaBaixoEstoque({ periodo, limite, departamento, dias }) {
  const filtroDepartamento = departamento ? `\n  WHERE ${departamento.clause}` : '';
  const vendidos = periodo.sql;
  const sql = `SELECT candidatos.id AS id, candidatos.nome AS nome, candidatos.quantidadeVendida AS quantidadeVendida,
  candidatos.estoqueAtual AS estoqueAtual, candidatos.estoqueMinimo AS estoqueMinimo,
  candidatos.estoqueMaximo AS estoqueMaximo, candidatos.coberturaDias AS coberturaDias
FROM (
  SELECT produto.idProduto AS id,
    COALESCE(produto.descricao, 'Sem descrição') AS nome,
    vendidos.quantidadeVendida AS quantidadeVendida,
    produto.qtestoque AS estoqueAtual,
    produto.qtminima AS estoqueMinimo,
    produto.qtmaxima AS estoqueMaximo,
    IF(COALESCE(produto.qtestoque, 0) <= 0, 0, produto.qtestoque * ? / vendidos.quantidadeVendida) AS coberturaDias
  FROM (
  ${vendidos}
  ) AS vendidos
  INNER JOIN produto ON produto.idProduto = vendidos.produto${filtroDepartamento}
) AS candidatos
WHERE candidatos.estoqueAtual <= candidatos.estoqueMinimo OR candidatos.coberturaDias < ?
ORDER BY candidatos.coberturaDias, candidatos.quantidadeVendida DESC, candidatos.id
LIMIT ?`;
  return {
    sql,
    params: [dias, ...periodo.params, ...(departamento ? departamento.params : []), COBERTURA_MINIMA_DIAS, limite],
  };
}

async function executar(rotulo, consulta) {
  try {
    const [linhas] = await getPool().execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
    return Array.isArray(linhas) ? linhas : [];
  } catch (erro) {
    console.error(
      `[rankingProdutos] Falha ao consultar produtos ${rotulo} (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoRankingEspeciais();
  }
}

function nomeDoProduto(nome) {
  return typeof nome === 'string' && nome.trim() ? nome : NOME_SEM_DESCRICAO;
}

// Retorna { inicio, fim, limite, itens: [{ id, nome }] }.
async function obterProdutosParados(entrada = {}) {
  const filtros = normalizarFiltros(entrada);
  const linhas = await executar('parados', montarSqlParados(filtros));
  return {
    inicio: entrada.inicio,
    fim: entrada.fim,
    limite: filtros.limite,
    itens: linhas.map((linha) => ({ id: Number(linha.id), nome: nomeDoProduto(linha.nome) })),
  };
}

function motivoDoBaixoEstoque(estoqueAtual, estoqueMinimo, coberturaDias) {
  const abaixoMinimo = estoqueAtual !== null && estoqueMinimo !== null && estoqueAtual <= estoqueMinimo;
  const coberturaBaixa = coberturaDias < COBERTURA_MINIMA_DIAS;
  if (abaixoMinimo && coberturaBaixa) return MOTIVO_AMBOS;
  return abaixoMinimo ? MOTIVO_ABAIXO_MINIMO : MOTIVO_COBERTURA_BAIXA;
}

// null/undefined continuam null (estoque ausente); o resto vira número.
function numeroOuNulo(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

// Retorna { inicio, fim (efetivo), fimSolicitado, limite, itens: [{ id, nome, quantidadeVendida, mediaDiaria,
//           estoqueAtual, estoqueMinimo, estoqueMaximo, coberturaDias, motivo }] } ordenados pela menor cobertura.
// O `fim` é limitado a ONTEM (dia fechado): o filtro de período do SQL e o divisor `dias` usam o fim efetivo,
// senão vendas só até hoje seriam divididas pelos dias do período inteiro (média subestimada, cobertura inflada).
// Lança ErroValidacao (400; inclusive `inicio` a partir de hoje), ErroCacheIncompleto (503) ou
// ErroInternoRankingEspeciais (banco).
async function obterProdutosDemandaBaixoEstoque(entrada = {}) {
  const filtros = normalizarFiltros(entrada);
  const { inicio, fim, fimSolicitado } = resolverPeriodoFechado(filtros.inicio, filtros.fim);
  const periodo = montarQuantidadeVendidaDoCache(inicio, fim);
  const dias = contarDiasDoPeriodo(inicio, fim);
  // Cache incompleto -> 503 antes de qualquer consulta de dados (erro de banco vira o erro interno genérico).
  try {
    await verificarCobertura(getPool(), [{ inicio, fim }]);
  } catch (erro) {
    if (erro instanceof ErroCacheIncompleto) throw erro;
    console.error(
      `[rankingProdutos] Falha ao verificar o cache de vendas por produto (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoRankingEspeciais();
  }
  const linhas = await executar(
    'com alta demanda e baixo estoque',
    montarSqlDemandaBaixoEstoque({ ...filtros, periodo, dias })
  );
  return {
    inicio,
    fim,
    fimSolicitado,
    limite: filtros.limite,
    itens: linhas.map((linha) => {
      const quantidadeVendida = Number(linha.quantidadeVendida) || 0;
      const estoqueAtual = numeroOuNulo(linha.estoqueAtual);
      const estoqueMinimo = numeroOuNulo(linha.estoqueMinimo);
      const coberturaDias = Number(linha.coberturaDias) || 0;
      return {
        id: Number(linha.id),
        nome: nomeDoProduto(linha.nome),
        // só a quantidade exibida é arredondada (3 casas); a média usa o valor sem arredondar
        quantidadeVendida: arredondar(quantidadeVendida, 3),
        mediaDiaria: arredondar(quantidadeVendida / dias, 2),
        estoqueAtual,
        estoqueMinimo,
        estoqueMaximo: numeroOuNulo(linha.estoqueMaximo),
        coberturaDias: arredondar(coberturaDias, 2),
        motivo: motivoDoBaixoEstoque(estoqueAtual, estoqueMinimo, coberturaDias),
      };
    }),
  };
}

// Retorna { inicio, fim (efetivo), fimSolicitado, limite,
//           itens: [{ id, nome, primeiraVenda, quantidade, faturamento }] }.
// Lança ErroValidacao (400), ErroCacheIncompleto (503) ou ErroInternoRankingEspeciais (banco).
async function obterProdutosNovos(entrada = {}) {
  const filtros = normalizarFiltros(entrada);
  const { inicio, fim, fimSolicitado } = resolverPeriodoFechado(filtros.inicio, filtros.fim);
  const consulta = montarSqlNovos({ ...filtros, inicio, fim });
  let linhas;
  try {
    const pool = getPool();
    // Guarda barata do histórico de primeira venda, depois cobertura de dias fechados; só então a lista.
    await verificarHistoricoPrimeiraVenda(pool, inicio);
    await verificarCobertura(pool, [{ inicio, fim }]);
    [linhas] = await pool.execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
  } catch (erro) {
    if (erro instanceof ErroCacheIncompleto) throw erro;
    console.error(
      `[rankingProdutos] Falha ao consultar produtos novos (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoRankingEspeciais();
  }
  const registros = Array.isArray(linhas) ? linhas : [];
  return {
    inicio,
    fim,
    fimSolicitado,
    limite: filtros.limite,
    itens: registros.map((linha) => ({
      id: Number(linha.id),
      nome: nomeDoProduto(linha.nome),
      primeiraVenda: linha.primeiraVenda,
      quantidade: arredondar(linha.quantidadePeriodo, 3),
      faturamento: arredondar(linha.faturamentoPeriodo, 2),
    })),
  };
}

module.exports = {
  obterProdutosParados,
  obterProdutosNovos,
  obterProdutosDemandaBaixoEstoque,
  COBERTURA_MINIMA_DIAS,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  ErroCacheIncompleto,
  ErroInternoRankingEspeciais,
};
