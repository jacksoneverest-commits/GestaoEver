// Margem por produto, grupo, setor ou família (Task 11.1 do PLAN.md).
//
// Decisão do usuário (Fase 11, PLAN.md): a leitura vem do CACHE `vendas_produto_dia_cache`
// (Task 7.3/7.4), NUNCA de `vendaitem`/`vendacupom`/`flagvc` (a agregação transacional de um
// período longo estourava o timeout — o mesmo motivo da Task 13.3). Colunas usadas (migration
// 004): `faturamento` (SUM(vendaitem.vtotal) por dia/produto), `custo_total` (CMV, soma só dos
// itens do dia/produto que TÊM `pcusto`; NULL só se nenhum item do dia/produto tem custo) e
// `itens_sem_custo` (quantos itens não têm custo). O cache só contém vendas válidas (o job
// aplica JOIN_VENDA_VALIDA/WHERE_VENDA_VALIDA), então esta rota não toca flagvc/status.
//
// CRITÉRIO DE MARGEM (decisão do usuário, "como a Curva ABC" — ver curvaAbc.service.js):
//   custoTotal = soma de custo_total do cache (tratado como 0 quando NULL); semCusto = true se
//   SUM(itens_sem_custo) > 0 para a linha (produto, ou soma dos produtos do grupo/setor/família).
//   lucro = faturamento - custoTotal; margemPercentual = lucro * 100 / faturamento (0 quando
//   faturamento é 0). Diferente do Ranking de Produtos: os valores NUNCA são anulados por
//   `semCusto` — a flag só sinaliza que o custo pode estar incompleto.
//
// DIMENSÃO (mesmo padrão de curvaAbc.service.js): produto -> produto.idProduto/descricao;
// grupo/setor/familia -> LEFT JOIN produto -> LEFT JOIN <tabela> ON <tabela>.<chave> =
// produto.<coluna>, agrupando por COALESCE(produto.<coluna>, 0) (id 0 = "Sem grupo"/"Sem
// setor"/"Sem família", igual à Curva ABC). Sem `id`: uma linha por item da dimensão; com `id`:
// as linhas são os PRODUTOS daquele item (produto.<coluna> = id, ou produto.idProduto = id
// quando o agrupador já é produto).
//
// DIA FECHADO / COBERTURA DO CACHE: mesmo padrão de estoque/`crescimento`/`queda`
// (`resolverPeriodoFechado` limita o `fim` a ontem; `verificarCobertura` garante que todos os
// dias fechados do período efetivo estão no cache ANTES de qualquer consulta de dados — sobe
// ErroCacheIncompleto, 503, sem resultado parcial).
//
// ORDENAÇÃO E LIMITE: como em curvaAbc.service.js, a consulta SQL não tem ORDER BY nem LIMIT (o
// MariaDB 10.1 rejeita alias de agregação dentro de expressão no ORDER BY — ER_ILLEGAL_REFERENCE
// — e a ordenação aqui é por uma coluna DERIVADA, lucro/margemPercentual, calculada em JS).
// Ordenação e corte pelo `limite` são feitos em JS, depois de buscar TODAS as linhas do filtro
// (agrupador + id); `resumo` e `totalItens` são calculados sobre esse universo inteiro, antes do
// corte.

const { getPool } = require('../../db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { buildDepartmentFilter, ErroValidacao } = require('../../shared/queryFilters');
const { verificarCobertura, resolverPeriodoFechado, ErroCacheIncompleto } = require('../rankingProdutos/cacheProduto');

const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 1000;
const NOME_SEM_DESCRICAO = 'Sem descrição';
const ORDENAR_POR_PADRAO = 'faturamento';
const ORDENAR_POR_VALIDOS = Object.freeze(['faturamento', 'lucro', 'margemPercentual']);

// Whitelist: agrupador -> definição fixa. Nunca interpolar o agrupador recebido (mesmo padrão de
// curvaAbc.service.js). `nivelFiltro`: nível aceito por buildDepartmentFilter, quando o agrupador
// é uma dimensão de departamento; `rotulo`: nome do item órfão ("Sem <rotulo>").
const DIMENSOES = Object.freeze({
  produto: Object.freeze({ tipo: 'produto', colunaProduto: 'idProduto', nivelFiltro: null }),
  grupo: Object.freeze({
    tipo: 'departamento', colunaProduto: 'grupo', tabela: 'grupo', chave: 'idGrupo', descricao: 'Descricao',
    nivelFiltro: 'grupo', rotulo: 'grupo',
  }),
  setor: Object.freeze({
    tipo: 'departamento', colunaProduto: 'setor', tabela: 'setor', chave: 'idSetor', descricao: 'Descricao',
    nivelFiltro: 'setor', rotulo: 'setor',
  }),
  familia: Object.freeze({
    tipo: 'departamento', colunaProduto: 'familia', tabela: 'familia', chave: 'idFamilia', descricao: 'Descricao',
    nivelFiltro: 'familia', rotulo: 'família',
  }),
});
const AGRUPADORES_VALIDOS = Object.freeze(Object.keys(DIMENSOES));

class ErroInternoMargem extends Error {
  constructor() {
    super('Erro interno ao consultar a margem.');
    this.name = 'ErroInternoMargem';
  }
}

function arredondar(valor, casas) {
  const fator = 10 ** casas;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round((numero + Number.EPSILON) * fator) / fator : 0;
}

function validarAgrupador(agrupador) {
  if (typeof agrupador !== 'string' || !Object.prototype.hasOwnProperty.call(DIMENSOES, agrupador)) {
    throw new ErroValidacao(`Agrupador inválido: use ${AGRUPADORES_VALIDOS.join(', ')}.`);
  }
  return agrupador;
}

// id opcional: inteiro positivo; devolve o número ou null.
function validarId(id) {
  if (id === undefined || id === null || id === '') return null;
  const numero = typeof id === 'number' ? id : /^\d+$/.test(String(id)) ? Number(id) : NaN;
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new ErroValidacao('Identificador inválido: informe um número inteiro positivo.');
  }
  return numero;
}

function validarLimite(limite) {
  if (limite === undefined || limite === null || limite === '') return LIMITE_PADRAO;
  const numero = typeof limite === 'number' ? limite : /^\d+$/.test(String(limite)) ? Number(limite) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > LIMITE_MAXIMO) {
    throw new ErroValidacao(`Limite inválido: informe um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
  }
  return numero;
}

function validarOrdenarPor(ordenarPor) {
  if (ordenarPor === undefined || ordenarPor === null || ordenarPor === '') return ORDENAR_POR_PADRAO;
  if (typeof ordenarPor !== 'string' || !ORDENAR_POR_VALIDOS.includes(ordenarPor)) {
    throw new ErroValidacao(`Ordenação inválida: use ${ORDENAR_POR_VALIDOS.join(', ')}.`);
  }
  return ordenarPor;
}

// Como as linhas são formadas: 'produto' (dimensão produto, ou qualquer dimensão com id) ou
// 'departamento' (uma linha por grupo/setor/família).
function tipoDasLinhas(dimensao, id) {
  if (dimensao.tipo === 'produto' || id !== null) return 'produto';
  return 'departamento';
}

// Filtro do `id` (sem id: null). Grupo/setor/família usam buildDepartmentFilter; produto, a
// coluna idProduto direto.
function montarFiltroId(dimensao, id) {
  if (id === null) return null;
  if (dimensao.nivelFiltro) return buildDepartmentFilter({ nivel: dimensao.nivelFiltro, id });
  return { clause: `produto.${dimensao.colunaProduto} = ?`, params: [id] };
}

// Agregação por produto no cache (período EFETIVO, já validado por resolverPeriodoFechado):
// soma faturamento/custo_total/itens_sem_custo por produto, ignorando a sentinela (produto > 0);
// HAVING mantém só produtos com faturamento ou quantidade líquida > 0 no período (mesmo critério
// de montarQuantidadeVendidaDoCache, em cacheProduto.js).
function montarSqlAgregacaoPorProduto() {
  return `SELECT produto,
    SUM(faturamento) AS faturamento,
    SUM(custo_total) AS custoTotal,
    SUM(itens_sem_custo) AS itensSemCusto
  FROM vendas_produto_dia_cache
  WHERE dia >= ? AND dia <= ? AND produto > 0
  GROUP BY produto
  HAVING SUM(faturamento) > 0 OR SUM(quantidade) > 0`;
}

// Consulta final: agregação por produto (acima) -> LEFT JOIN produto (nome) [-> LEFT JOIN
// <tabela da dimensão>, quando as linhas são por departamento]. Sem ORDER BY/LIMIT (ver
// cabeçalho). Placeholders: período do cache -> filtro do id (só quando as linhas são por produto).
function montarSqlMargem(dimensao, tipoLinha, periodoFechado, filtro) {
  const agregacao = montarSqlAgregacaoPorProduto();
  const periodoParams = [periodoFechado.inicio, periodoFechado.fim];

  if (tipoLinha === 'produto') {
    const clausulaFiltro = filtro ? `\nWHERE ${filtro.clause}` : '';
    const sql = `SELECT agregado.produto AS id,
    COALESCE(produto.descricao, '${NOME_SEM_DESCRICAO}') AS nome,
    agregado.faturamento AS faturamento,
    agregado.custoTotal AS custoTotal,
    agregado.itensSemCusto AS itensSemCusto
  FROM (
  ${agregacao}
  ) AS agregado
  LEFT JOIN produto ON produto.idProduto = agregado.produto${clausulaFiltro}`;
    return { sql, params: [...periodoParams, ...(filtro ? filtro.params : [])] };
  }

  const chave = `COALESCE(produto.${dimensao.colunaProduto}, 0)`;
  const sql = `SELECT ${chave} AS id,
    MAX(${dimensao.tabela}.${dimensao.descricao}) AS nome,
    SUM(agregado.faturamento) AS faturamento,
    SUM(agregado.custoTotal) AS custoTotal,
    SUM(agregado.itensSemCusto) AS itensSemCusto
  FROM (
  ${agregacao}
  ) AS agregado
  LEFT JOIN produto ON produto.idProduto = agregado.produto
  LEFT JOIN ${dimensao.tabela} ON ${dimensao.tabela}.${dimensao.chave} = produto.${dimensao.colunaProduto}
  GROUP BY ${chave}`;
  return { sql, params: periodoParams };
}

async function executar(pool, consulta) {
  const [linhas] = await pool.execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
  return Array.isArray(linhas) ? linhas : [];
}

function nomeDaLinha(tipoLinha, dimensao, nome) {
  if (typeof nome === 'string' && nome.trim()) return nome;
  return tipoLinha === 'produto' ? NOME_SEM_DESCRICAO : `Sem ${dimensao.rotulo}`;
}

// Calcula as métricas de uma linha crua do banco. custoTotal NULL -> 0 (mas semCusto continua
// sinalizando); os valores nunca são anulados por semCusto (decisão do usuário, diferente do
// Ranking de Produtos).
function calcularMetricas(linha, tipoLinha, dimensao) {
  const faturamento = Number(linha.faturamento) || 0;
  const custoTotal =
    linha.custoTotal === null || linha.custoTotal === undefined ? 0 : Number(linha.custoTotal) || 0;
  const semCusto = Number(linha.itensSemCusto) > 0;
  const lucro = faturamento - custoTotal;
  const margemPercentual = faturamento > 0 ? (lucro * 100) / faturamento : 0;
  return {
    id: Number(linha.id) || 0,
    nome: nomeDaLinha(tipoLinha, dimensao, linha.nome),
    faturamento,
    custoTotal,
    lucro,
    margemPercentual,
    semCusto,
  };
}

// Ordena decrescente pela métrica escolhida, desempatando por id crescente.
function ordenarLinhas(linhas, ordenarPor) {
  return [...linhas].sort((a, b) => b[ordenarPor] - a[ordenarPor] || a.id - b.id);
}

// Margem bruta agregada de TODO o filtro (todas as linhas que casam agrupador+id, sem o corte do
// `limite`): soma simples de faturamento/custoTotal, lucro derivado da soma, e semCusto = true se
// QUALQUER linha do filtro tiver semCusto.
function calcularResumo(linhas) {
  const faturamento = linhas.reduce((soma, linha) => soma + linha.faturamento, 0);
  const custoTotal = linhas.reduce((soma, linha) => soma + linha.custoTotal, 0);
  const lucro = faturamento - custoTotal;
  const margemPercentual = faturamento > 0 ? (lucro * 100) / faturamento : 0;
  return {
    faturamento: arredondar(faturamento, 2),
    custoTotal: arredondar(custoTotal, 2),
    lucro: arredondar(lucro, 2),
    margemPercentual: arredondar(margemPercentual, 2),
    semCusto: linhas.some((linha) => linha.semCusto),
  };
}

function formatarItem(linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    faturamento: arredondar(linha.faturamento, 2),
    custoTotal: arredondar(linha.custoTotal, 2),
    lucro: arredondar(linha.lucro, 2),
    margemPercentual: arredondar(linha.margemPercentual, 2),
    semCusto: linha.semCusto,
  };
}

// Retorna { inicio, fim (efetivo), fimSolicitado, agrupador, id?, ordenarPor, limite, totalItens,
//   resumo: { faturamento, custoTotal, lucro, margemPercentual, semCusto },
//   itens: [{ id, nome, faturamento, custoTotal, lucro, margemPercentual, semCusto }] }.
// Lança ErroValidacao (400; inclusive `inicio` posterior a ontem), ErroCacheIncompleto (503) ou
// ErroInternoMargem (banco).
async function obterMargem({ inicio, fim, agrupador, id, ordenarPor, limite } = {}) {
  const agrupadorValido = validarAgrupador(agrupador);
  const idNumerico = validarId(id);
  const ordenarPorEscolhido = validarOrdenarPor(ordenarPor);
  const limiteEscolhido = validarLimite(limite);
  const periodoFechado = resolverPeriodoFechado(inicio, fim);

  const dimensao = DIMENSOES[agrupadorValido];
  const tipoLinha = tipoDasLinhas(dimensao, idNumerico);
  const filtro = montarFiltroId(dimensao, idNumerico);
  const consulta = montarSqlMargem(dimensao, tipoLinha, periodoFechado, filtro);

  let linhasBrutas;
  try {
    const pool = getPool();
    // Cache incompleto -> 503 antes de qualquer consulta de dados (erro de banco cai no catch e vira 500 genérico).
    await verificarCobertura(pool, [{ inicio: periodoFechado.inicio, fim: periodoFechado.fim }]);
    linhasBrutas = await executar(pool, consulta);
  } catch (erro) {
    if (erro instanceof ErroCacheIncompleto) throw erro;
    console.error(
      `[rentabilidade] Falha ao consultar a margem (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoMargem();
  }

  const linhas = linhasBrutas.map((linha) => calcularMetricas(linha, tipoLinha, dimensao));
  const ordenadas = ordenarLinhas(linhas, ordenarPorEscolhido);
  const resumo = calcularResumo(ordenadas);
  const itens = ordenadas.slice(0, limiteEscolhido).map(formatarItem);

  const resposta = {
    inicio: periodoFechado.inicio,
    fim: periodoFechado.fim,
    fimSolicitado: periodoFechado.fimSolicitado,
    agrupador: agrupadorValido,
  };
  if (idNumerico !== null) resposta.id = idNumerico;
  return {
    ...resposta,
    ordenarPor: ordenarPorEscolhido,
    limite: limiteEscolhido,
    totalItens: ordenadas.length,
    resumo,
    itens,
  };
}

module.exports = {
  obterMargem,
  AGRUPADORES_VALIDOS,
  ORDENAR_POR_VALIDOS,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  ErroInternoMargem,
  ErroCacheIncompleto,
};
