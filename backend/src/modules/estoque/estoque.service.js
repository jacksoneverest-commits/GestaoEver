// Níveis de estoque (Task 13.1 do PLAN.md): ruptura, próximo da ruptura e excesso.
//
// Schema real do ERP (mesmo de rankingEspeciais.service.js):
//   estoque atual = produto.qtestoque (DOUBLE; pode ser NEGATIVO ou NULL -> NULL tratado como 0),
//   mínimo = produto.qtminima, máximo = produto.qtmaxima. produto.Estoque é a flag S/N (controla estoque): NÃO é
//   quantidade; só entra no filtro que exclui 'N' (ver abaixo).
//   Venda = quantidade vendida por produto no período, somada do CACHE vendas_produto_dia_cache (Task 13.3):
//   SUM(quantidade) com produto > 0 (ignora a sentinela) e HAVING SUM(quantidade) > 0. O cache só tem vendas
//   válidas, então esta rota NÃO toca vendaitem, vendacupom nem flagvc (a agregação transacional de 12 meses
//   estourava o timeout na primeira consulta).
//
// PRODUTOS BLOQUEADOS (produto.situacao = 'B') e produtos que NÃO CONTROLAM ESTOQUE (produto.Estoque = 'N') ficam fora
//   de TUDO: da lista e das contagens do `resumo` (os dois filtros estão na base compartilhada pelas duas consultas).
//
// CLASSIFICAÇÕES (decisão do usuário; não são mutuamente exclusivas: um produto acima do máximo com giro alto
// pode ser "excesso" e "próximo da ruptura" ao mesmo tempo, então cada lista usa a sua condição):
//   ruptura          = venda > 0 no período E qtestoque <= 0 (produto sem venda no período NÃO entra)
//   proximo_ruptura  = venda > 0 E qtestoque > 0 E (qtestoque <= qtminima OU cobertura < COBERTURA_MINIMA_DIAS)
//   excesso          = qtmaxima > 0 E qtestoque > qtmaxima (com ou sem venda)
//   cobertura (dias) = qtestoque ÷ (venda ÷ dias); qtestoque <= 0 => 0; sem venda => NULL.
//
// DIA FECHADO: o `fim` é limitado a ONTEM (resolverPeriodoFechado); o mesmo fim efetivo vale para o filtro de
// período e para o divisor `dias`. `inicio` a partir de hoje -> ErroValidacao (400).
// COBERTURA DO CACHE: antes de consultar, verificarCobertura exige a sentinela fechada de todos os dias do período
// efetivo; se faltar algum, sobe ErroCacheIncompleto (503 { erro } com o comando do job), sem resultado parcial.
//
// SQL em três níveis (padrão de obterProdutosDemandaBaixoEstoque): `vendidos` (agrega a venda por produto)
// -> `candidatos` (junta o produto, LEFT JOIN para o excesso enxergar produtos sem venda, e calcula a cobertura)
// -> filtro/ordenação/contagem por colunas SIMPLES da tabela derivada (MariaDB 10.1: nada de alias de agregação
// dentro de expressão no ORDER BY/HAVING, ER_ILLEGAL_REFERENCE).
// A lista e o `resumo` são duas consultas em paralelo sobre a mesma base; totalItens = resumo[classificação].

const { getPool } = require('../../db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { buildDepartmentFilter, ErroValidacao } = require('../../shared/queryFilters');
const {
  verificarCobertura,
  resolverPeriodoFechado,
  montarQuantidadeVendidaDoCache,
  ErroCacheIncompleto,
} = require('../rankingProdutos/cacheProduto');

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;
const NOME_SEM_DESCRICAO = 'Sem descrição';
// Limiar de cobertura (dias) abaixo do qual um produto com venda é considerado próximo da ruptura.
const COBERTURA_MINIMA_DIAS = 7;
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const CLASSIFICACAO_PADRAO = 'ruptura';
// Produto bloqueado nunca entra (situacao NULL conta como não bloqueado).
const FILTRO_NAO_BLOQUEADO = "COALESCE(produto.situacao, '') <> 'B'";
// Produto que não controla estoque (produto.Estoque = 'N') nunca entra (Estoque NULL conta como controla).
const FILTRO_CONTROLA_ESTOQUE = "COALESCE(produto.Estoque, 'S') <> 'N'";

// Whitelist fixa: classificação recebida -> { chave do resumo, condição e ordenação fixas }. Nunca interpolar o input.
// `parametros` = quantos placeholders (`?`) a condição carrega (o limiar de cobertura).
const CLASSIFICACOES = Object.freeze({
  ruptura: Object.freeze({
    chaveResumo: 'ruptura',
    condicao: 'candidatos.quantidadeVendida > 0 AND candidatos.estoqueAtual <= 0',
    parametros: [],
    ordenacao: 'candidatos.quantidadeVendida DESC, candidatos.id',
  }),
  proximo_ruptura: Object.freeze({
    chaveResumo: 'proximoRuptura',
    condicao:
      'candidatos.quantidadeVendida > 0 AND candidatos.estoqueAtual > 0 AND ' +
      '(candidatos.estoqueAtual <= candidatos.estoqueMinimo OR candidatos.coberturaDias < ?)',
    parametros: [COBERTURA_MINIMA_DIAS],
    ordenacao: 'candidatos.coberturaDias, candidatos.quantidadeVendida DESC, candidatos.id',
  }),
  excesso: Object.freeze({
    chaveResumo: 'excesso',
    condicao: 'candidatos.estoqueMaximo > 0 AND candidatos.estoqueAtual > candidatos.estoqueMaximo',
    parametros: [],
    ordenacao: 'candidatos.excesso DESC, candidatos.id',
  }),
});

class ErroInternoEstoque extends Error {
  constructor() {
    super('Erro interno ao consultar os níveis de estoque.');
    this.name = 'ErroInternoEstoque';
  }
}

function arredondar(valor, casas) {
  const fator = 10 ** casas;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round((numero + Number.EPSILON) * fator) / fator : 0;
}

// null/undefined continuam null; o resto vira número.
function numeroOuNulo(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

function nomeDoProduto(nome) {
  return typeof nome === 'string' && nome.trim() ? nome : NOME_SEM_DESCRICAO;
}

function validarLimite(limite) {
  if (limite === undefined || limite === null || limite === '') return LIMITE_PADRAO;
  const numero = typeof limite === 'number' ? limite : /^\d+$/.test(String(limite)) ? Number(limite) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > LIMITE_MAXIMO) {
    throw new ErroValidacao(`Limite inválido: informe um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
  }
  return numero;
}

function validarClassificacao(classificacao) {
  if (classificacao === undefined || classificacao === null || classificacao === '') return CLASSIFICACAO_PADRAO;
  if (typeof classificacao !== 'string' || !Object.prototype.hasOwnProperty.call(CLASSIFICACOES, classificacao)) {
    throw new ErroValidacao(`Classificação inválida: use ${Object.keys(CLASSIFICACOES).join(', ')}.`);
  }
  return classificacao;
}

// Departamento é opcional; se `nivel` ou `id` vier, os dois precisam ser válidos.
function lerDepartamento(nivel, id) {
  const semNivel = nivel === undefined || nivel === null || nivel === '';
  const semId = id === undefined || id === null || id === '';
  if (semNivel && semId) return null;
  return buildDepartmentFilter({ nivel, id });
}

// Dias inclusivos entre inicio e fim (ISO já validados por buildPeriodFilter, máx. 366).
function contarDiasDoPeriodo(inicio, fim) {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / UM_DIA_MS) + 1;
}

// Base compartilhada (níveis 1 e 2). Placeholders, em ordem: dias (cobertura) -> período -> departamento.
// `vendidos` (cache) só traz produtos com venda líquida > 0; o LEFT JOIN mantém os sem venda (necessários ao excesso).
// `periodo` = { sql, params } da quantidade vendida no cache (params: datas ISO inicio e fim).
function montarBase({ periodo, departamento }) {
  const filtroDepartamento = departamento ? ` AND ${departamento.clause}` : '';
  return `SELECT produto.idProduto AS id,
    COALESCE(produto.descricao, '${NOME_SEM_DESCRICAO}') AS nome,
    COALESCE(produto.qtestoque, 0) AS estoqueAtual,
    produto.qtminima AS estoqueMinimo,
    produto.qtmaxima AS estoqueMaximo,
    COALESCE(vendidos.quantidadeVendida, 0) AS quantidadeVendida,
    IF(COALESCE(vendidos.quantidadeVendida, 0) > 0, IF(COALESCE(produto.qtestoque, 0) <= 0, 0, COALESCE(produto.qtestoque, 0) * ? / vendidos.quantidadeVendida), NULL) AS coberturaDias,
    COALESCE(produto.qtestoque, 0) - COALESCE(produto.qtmaxima, 0) AS excesso
  FROM produto
  LEFT JOIN (
    ${periodo.sql}
  ) AS vendidos ON vendidos.produto = produto.idProduto
  WHERE ${FILTRO_NAO_BLOQUEADO} AND ${FILTRO_CONTROLA_ESTOQUE}${filtroDepartamento}`;
}

function paramsDaBase({ periodo, departamento, dias }) {
  return [dias, ...periodo.params, ...(departamento ? departamento.params : [])];
}

// Placeholders: dias -> período -> departamento -> (limiar da classificação) -> limite.
function montarSqlLista(filtros, classificacao) {
  const { condicao, parametros, ordenacao } = CLASSIFICACOES[classificacao];
  const sql = `SELECT candidatos.id AS id, candidatos.nome AS nome, candidatos.estoqueAtual AS estoqueAtual,
  candidatos.estoqueMinimo AS estoqueMinimo, candidatos.estoqueMaximo AS estoqueMaximo,
  candidatos.quantidadeVendida AS quantidadeVendida, candidatos.coberturaDias AS coberturaDias
FROM (
  ${montarBase(filtros)}
) AS candidatos
WHERE ${condicao}
ORDER BY ${ordenacao}
LIMIT ?`;
  return { sql, params: [...paramsDaBase(filtros), ...parametros, filtros.limite] };
}

// Placeholders: limiares das condições (ficam no SELECT externo, antes da subconsulta) -> dias -> período -> departamento.
function montarSqlResumo(filtros) {
  const classificacoes = Object.values(CLASSIFICACOES);
  const contagens = classificacoes
    .map(({ chaveResumo, condicao }) => `SUM(CASE WHEN ${condicao} THEN 1 ELSE 0 END) AS ${chaveResumo}`)
    .join(',\n  ');
  const sql = `SELECT ${contagens}
FROM (
  ${montarBase(filtros)}
) AS candidatos`;
  return { sql, params: [...classificacoes.flatMap(({ parametros }) => parametros), ...paramsDaBase(filtros)] };
}

async function executar(consulta) {
  const [linhas] = await getPool().execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
  return Array.isArray(linhas) ? linhas : [];
}

// Retorna { inicio, fim (efetivo), fimSolicitado, classificacao, limite, totalItens, resumo, itens }.
// Lança ErroValidacao (400; inclusive `inicio` a partir de hoje), ErroCacheIncompleto (503) ou ErroInternoEstoque (banco).
async function obterNiveisEstoque({ inicio, fim, nivel, id, classificacao, limite } = {}) {
  const classificacaoEscolhida = validarClassificacao(classificacao);
  const limiteEscolhido = validarLimite(limite);
  const departamento = lerDepartamento(nivel, id);
  const periodoFechado = resolverPeriodoFechado(inicio, fim);
  const periodo = montarQuantidadeVendidaDoCache(periodoFechado.inicio, periodoFechado.fim);
  const dias = contarDiasDoPeriodo(periodoFechado.inicio, periodoFechado.fim);
  const filtros = { periodo, departamento, dias, limite: limiteEscolhido };

  let linhas;
  let resumoBruto;
  try {
    // Cache incompleto -> 503 antes de qualquer consulta de dados (erro de banco cai no catch e vira 500 genérico).
    await verificarCobertura(getPool(), [{ inicio: periodoFechado.inicio, fim: periodoFechado.fim }]);
    [linhas, [resumoBruto]] = await Promise.all([
      executar(montarSqlLista(filtros, classificacaoEscolhida)),
      executar(montarSqlResumo(filtros)),
    ]);
  } catch (erro) {
    if (erro instanceof ErroCacheIncompleto) throw erro;
    console.error(
      `[estoque] Falha ao consultar os níveis de estoque (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoEstoque();
  }

  const bruto = resumoBruto || {};
  const resumo = {
    ruptura: Number(bruto.ruptura) || 0,
    proximoRuptura: Number(bruto.proximoRuptura) || 0,
    excesso: Number(bruto.excesso) || 0,
  };

  return {
    inicio: periodoFechado.inicio,
    fim: periodoFechado.fim,
    fimSolicitado: periodoFechado.fimSolicitado,
    classificacao: classificacaoEscolhida,
    limite: limiteEscolhido,
    totalItens: resumo[CLASSIFICACOES[classificacaoEscolhida].chaveResumo],
    resumo,
    itens: linhas.map((linha) => {
      // A média usa a quantidade sem arredondar; só a quantidade exibida sai com 3 casas (sem ruído de ponto flutuante).
      const quantidadeVendida = Number(linha.quantidadeVendida) || 0;
      const cobertura = numeroOuNulo(linha.coberturaDias);
      return {
        id: Number(linha.id),
        nome: nomeDoProduto(linha.nome),
        estoqueAtual: Number(linha.estoqueAtual) || 0,
        estoqueMinimo: numeroOuNulo(linha.estoqueMinimo),
        estoqueMaximo: numeroOuNulo(linha.estoqueMaximo),
        quantidadeVendida: arredondar(quantidadeVendida, 3),
        mediaDiaria: arredondar(quantidadeVendida / dias, 2),
        coberturaDias: cobertura === null ? null : arredondar(cobertura, 2),
        classificacao: classificacaoEscolhida,
      };
    }),
  };
}

module.exports = {
  obterNiveisEstoque,
  COBERTURA_MINIMA_DIAS,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  ErroInternoEstoque,
  ErroCacheIncompleto,
};
