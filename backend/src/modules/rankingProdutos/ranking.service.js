// Ranking de produtos (Task 7.1 do PLAN.md).
//
// Schema real do ERP usado aqui (mesmo de vendasDepartamento.service.js):
//   vendacupom.idcupom = vendaitem.idcupom; vendaitem.produto = produto.idProduto
//   vendaitem.vtotal = valor total do item; vendaitem.qt = quantidade vendida
//
// Critérios:
//   vendas       -> ordena por quantidade vendida (SUM(vendaitem.qt)) decrescente
//   faturamento  -> ordena por faturamento (SUM(vendaitem.vtotal)) decrescente
//   margem       -> ordena por LUCRO em R$ (padrão) ou por margemPercentual, decrescente
//                   (query param opcional ordenarPor=lucro|margemPercentual, whitelist fixa).
//                   Custo = CMV = vendaitem.pcusto (custo gravado no item na hora da venda;
//                   decisão do usuário, fórmulas do relatório de rentabilidade do ERP):
//                     custoTotal       = SUM(vendaitem.qt * vendaitem.pcusto)
//                     lucro            = SUM(vendaitem.vtotal) - custoTotal
//                     margemPercentual = lucro * 100 / SUM(vendaitem.vtotal)  (0 se faturamento 0)
//                   pcusto NULL segue o ERP (sem COALESCE) e é SINALIZADO: se ALGUM item do
//                   produto no período tem pcusto NULL, semCusto = true e custoTotal, lucro e
//                   margemPercentual = null (margem ausente é melhor que margem inflada).
//                   pcusto = 0 NÃO é tratado como nulo. Produtos semCusto vão para o FINAL da
//                   ordenação (não somem da lista, mas não poluem o topo): ORDER BY
//                   MAX(vendaitem.pcusto IS NULL), <lucro|margemPercentual> DESC, produto.idProduto.
//                   ATENÇÃO (MariaDB, ER_ILLEGAL_REFERENCE): alias de agregação só pode aparecer
//                   SOZINHO no ORDER BY, nunca dentro de expressão (ex: `(lucro IS NULL)`).
//                   ordenarPor só se aplica a margem; nos outros critérios é IGNORADO (mesmo
//                   inválido) — o mais simples e coerente: o param não faz sentido fora de margem.
//                   Agrupa só por produto (o ERP agrupa também por pcusto; aqui não, para não
//                   duplicar o produto). Outros métodos de custo estão fora de escopo.
//   crescimento  -> compara o período com o período ANTERIOR de mesma duração (o intervalo imediatamente
//   queda           anterior a `inicio`, calculado como em vendas.service.js) lendo SÓ o cache diário por
//                   produto (vendas_produto_dia_cache, Task 7.4) — nunca vendaitem/vendacupom.
//                   MÉTRICA (o SPEC.md pede "produtos com maior crescimento/queda" sem definir a métrica;
//                   escolha documentada): VARIAÇÃO DE FATURAMENTO em R$ =
//                     faturamentoAtual - faturamentoAnterior   (SUM(faturamento) de cada período)
//                   crescimento: só produtos com variação > 0, ordenados por variação DESC;
//                   queda:       só produtos com variação < 0, ordenados por variação ASC (maior queda 1º).
//                   Cada item traz faturamentoAtual, faturamentoAnterior, variacao (R$) e
//                   variacaoPercentual (variacao / faturamentoAnterior * 100; null se anterior = 0).
//                   Em R$ (e não em %) para que um produto de R$ 2 -> R$ 6 não supere um de
//                   R$ 10.000 -> R$ 12.000; o percentual segue disponível para exibição.
//                   Linhas zeradas do cache (cupom cancelado depois) somam 0: "sem venda".
//                   DIA FECHADO: o cache só é confiável para dias já encerrados (hoje nunca é fechado).
//                   O `fim` é limitado a ONTEM; a resposta devolve `inicio`/`fim` EFETIVOS e `fimSolicitado`,
//                   e o período anterior tem a duração do período efetivo. Se `inicio` for posterior a
//                   ontem (nenhum dia fechado), responde ErroValidacao (400).
//                   COBERTURA: se o cache não cobrir (sentinela fechada) todos os dias do período efetivo e
//                   do anterior, responde ErroCacheIncompleto (503) em vez de resultado parcial (ver
//                   cacheProduto.js). A sentinela (produto 0) é ignorada (`produto > 0`).

const { getPool } = require('../../db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { buildPeriodFilter, buildDepartmentFilter, ErroValidacao } = require('../../shared/queryFilters');
const { calcularPeriodoAnterior } = require('../vendas/vendas.service');
const { verificarCobertura, resolverPeriodoFechado, ErroCacheIncompleto } = require('./cacheProduto');

const LIMITE_PADRAO = 10;
const LIMITE_MAXIMO = 100;

// Whitelist: criterio -> fragmento ORDER BY fixo (nunca interpolar o criterio recebido).
// `null` = critério com consulta própria (margem: ORDENACAO_MARGEM; crescimento/queda: VARIACAO_POR_CRITERIO).
const ORDENACAO_POR_CRITERIO = Object.freeze({
  vendas: 'quantidade DESC, produto.idProduto',
  faturamento: 'faturamento DESC, produto.idProduto',
  margem: null, // definido por ORDENACAO_MARGEM (depende de ordenarPor)
  crescimento: null, // definido por VARIACAO_POR_CRITERIO
  queda: null,
});
const CRITERIOS_VALIDOS = Object.freeze(Object.keys(ORDENACAO_POR_CRITERIO));

// Whitelist de crescimento/queda -> filtro e ORDER BY fixos sobre a variação de faturamento em R$.
const VARIACAO_SQL = '(agregados.faturamentoAtual - agregados.faturamentoAnterior)';
const VARIACAO_POR_CRITERIO = Object.freeze({
  crescimento: Object.freeze({ filtro: `${VARIACAO_SQL} > 0`, ordem: 'variacao DESC, agregados.id' }),
  queda: Object.freeze({ filtro: `${VARIACAO_SQL} < 0`, ordem: 'variacao ASC, agregados.id' }),
});

// Colunas extras do critério margem. Sem COALESCE em pcusto (segue o ERP): se ALGUM item do produto
// tem pcusto NULL, semCusto = 1 e custoTotal/lucro/margemPercentual saem NULL do SQL.
// NULLIF: faturamento 0 não divide por zero (COALESCE -> 0).
const SEM_CUSTO = 'MAX(vendaitem.pcusto IS NULL)';
const CUSTO_SOMA = 'SUM(vendaitem.qt * vendaitem.pcusto)';
const LUCRO_SOMA = `(SUM(vendaitem.vtotal) - ${CUSTO_SOMA})`;
const COLUNAS_MARGEM = `,
  ${SEM_CUSTO} AS semCusto,
  IF(${SEM_CUSTO} = 1, NULL, ${CUSTO_SOMA}) AS custoTotal,
  IF(${SEM_CUSTO} = 1, NULL, ${LUCRO_SOMA}) AS lucro,
  IF(${SEM_CUSTO} = 1, NULL, COALESCE(${LUCRO_SOMA} * 100 / NULLIF(SUM(vendaitem.vtotal), 0), 0)) AS margemPercentual`;

// Whitelist de ordenarPor (só criterio=margem) -> ORDER BY fixo. Produtos semCusto ao final:
// MAX(pcusto IS NULL) = 0 vem primeiro, 1 vai ao fim (lucro/margemPercentual são NULL exatamente
// quando semCusto = 1). No MariaDB um alias de agregação só é aceito SOZINHO no ORDER BY
// (ER_ILLEGAL_REFERENCE em expressão como `(lucro IS NULL)`), por isso o agregado explícito.
const ORDENAR_POR_PADRAO = 'lucro';
const ORDENACAO_MARGEM = Object.freeze({
  lucro: `${SEM_CUSTO}, lucro DESC, produto.idProduto`,
  margemPercentual: `${SEM_CUSTO}, margemPercentual DESC, produto.idProduto`,
});

class ErroInternoRanking extends Error {
  constructor() {
    super('Erro interno ao consultar o ranking de produtos.');
    this.name = 'ErroInternoRanking';
  }
}

function arredondar(valor, casas) {
  const fator = 10 ** casas;
  return Math.round((Number(valor) + Number.EPSILON) * fator) / fator;
}

function validarCriterio(criterio) {
  if (typeof criterio !== 'string' || !Object.prototype.hasOwnProperty.call(ORDENACAO_POR_CRITERIO, criterio)) {
    throw new ErroValidacao('Critério inválido: use vendas, faturamento, margem, crescimento ou queda.');
  }
  return criterio;
}

function validarOrdenarPor(ordenarPor) {
  if (ordenarPor === undefined) return ORDENAR_POR_PADRAO;
  if (typeof ordenarPor !== 'string' || !Object.prototype.hasOwnProperty.call(ORDENACAO_MARGEM, ordenarPor)) {
    throw new ErroValidacao('ordenarPor inválido: use lucro ou margemPercentual.');
  }
  return ordenarPor;
}

function validarLimite(limite) {
  if (limite === undefined || limite === null || limite === '') return LIMITE_PADRAO;
  const numero = typeof limite === 'number' ? limite : /^\d+$/.test(String(limite)) ? Number(limite) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > LIMITE_MAXIMO) {
    throw new ErroValidacao(`Limite inválido: informe um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
  }
  return numero;
}

// STRAIGHT_JOIN: o período em vendacupom (índice em `data`) conduz a consulta
// (mesma razão documentada em vendasDepartamento.service.js).
function montarSql(criterio, periodo, departamento, limite, ordenarPor) {
  const filtroDepartamento = departamento ? ` AND ${departamento.clause}` : '';
  const colunasMargem = criterio === 'margem' ? COLUNAS_MARGEM : '';
  const sql = `SELECT STRAIGHT_JOIN produto.idProduto AS id,
  COALESCE(produto.descricao, 'Sem descrição') AS nome,
  SUM(vendaitem.qt) AS quantidade,
  SUM(vendaitem.vtotal) AS faturamento${colunasMargem}
FROM vendacupom
${JOIN_VENDA_VALIDA}
INNER JOIN vendaitem ON vendaitem.idcupom = vendacupom.idcupom
INNER JOIN produto ON produto.idProduto = vendaitem.produto
WHERE ${WHERE_VENDA_VALIDA} AND ${periodo.clause}${filtroDepartamento}
GROUP BY produto.idProduto, produto.descricao
ORDER BY ${criterio === 'margem' ? ORDENACAO_MARGEM[ordenarPor] : ORDENACAO_POR_CRITERIO[criterio]}
LIMIT ?`;
  const params = [...periodo.params, ...(departamento ? departamento.params : []), limite];
  return { sql, params };
}

// crescimento/queda: SQL sobre o cache diário. A subconsulta `agregados` soma, por produto, o faturamento
// do período atual e do anterior (a janela do WHERE é a união dos dois; cada SUM(IF(...)) separa o seu
// período com a mesma cláusula do buildPeriodFilter). O filtro (> 0 / < 0) e o ORDER BY vêm da whitelist
// VARIACAO_POR_CRITERIO; período, departamento e limite são sempre parâmetros `?`.
// Ordem dos placeholders: SELECT (atual, anterior) -> WHERE (atual, anterior) -> departamento -> limite.
function montarSqlVariacao(criterio, atual, anterior, departamento, limite) {
  const cache = 'vendas_produto_dia_cache';
  const filtroDepartamento = departamento ? ` AND ${departamento.clause}` : '';
  const { filtro, ordem } = VARIACAO_POR_CRITERIO[criterio];
  const sql = `SELECT agregados.id AS id,
  agregados.nome AS nome,
  agregados.faturamentoAtual AS faturamentoAtual,
  agregados.faturamentoAnterior AS faturamentoAnterior,
  ${VARIACAO_SQL} AS variacao
FROM (
  SELECT produto.idProduto AS id,
    COALESCE(produto.descricao, 'Sem descrição') AS nome,
    SUM(IF(${atual.clause}, ${cache}.faturamento, 0)) AS faturamentoAtual,
    SUM(IF(${anterior.clause}, ${cache}.faturamento, 0)) AS faturamentoAnterior
  FROM ${cache}
  INNER JOIN produto ON produto.idProduto = ${cache}.produto
  WHERE ${cache}.produto > 0 AND ((${atual.clause}) OR (${anterior.clause}))${filtroDepartamento}
  GROUP BY produto.idProduto, produto.descricao
) AS agregados
WHERE ${filtro}
ORDER BY ${ordem}
LIMIT ?`;
  const params = [
    ...atual.params,
    ...anterior.params,
    ...atual.params,
    ...anterior.params,
    ...(departamento ? departamento.params : []),
    limite,
  ];
  return { sql, params };
}

// Ranking de crescimento/queda (ver cabeçalho). Retorna
// { criterio, limite, inicio, fim (efetivo), fimSolicitado, periodoAnterior: { inicio, fim },
//   itens: [{ posicao, id, nome, faturamentoAtual, faturamentoAnterior, variacao, variacaoPercentual }] }.
async function obterRankingVariacao({ criterio, limite, inicio: inicioSolicitado, fim: fimSolicitado, departamento }) {
  const { inicio, fim } = resolverPeriodoFechado(inicioSolicitado, fimSolicitado);
  const anterior = calcularPeriodoAnterior(inicio, fim);
  const filtroAtual = buildPeriodFilter(inicio, fim, 'vendas_produto_dia_cache.dia');
  const filtroAnterior = buildPeriodFilter(anterior.inicio, anterior.fim, 'vendas_produto_dia_cache.dia');
  const consulta = montarSqlVariacao(criterio, filtroAtual, filtroAnterior, departamento, limite);

  try {
    const pool = getPool();
    // Sem cobertura completa do período e do anterior não há resultado parcial: erro claro (503).
    await verificarCobertura(pool, [{ inicio, fim }, anterior]);
    const [linhas] = await pool.execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
    const registros = Array.isArray(linhas) ? linhas : [];
    const itens = registros.map((linha, indice) => {
      const faturamentoAtual = Number(linha.faturamentoAtual) || 0;
      const faturamentoAnterior = Number(linha.faturamentoAnterior) || 0;
      const variacao = faturamentoAtual - faturamentoAnterior;
      return {
        posicao: indice + 1,
        id: Number(linha.id),
        nome: linha.nome,
        faturamentoAtual: arredondar(faturamentoAtual, 2),
        faturamentoAnterior: arredondar(faturamentoAnterior, 2),
        variacao: arredondar(variacao, 2),
        variacaoPercentual: faturamentoAnterior === 0 ? null : arredondar((variacao / faturamentoAnterior) * 100, 2),
      };
    });
    return { criterio, limite, inicio, fim, fimSolicitado, periodoAnterior: anterior, itens };
  } catch (erro) {
    if (erro instanceof ErroCacheIncompleto) throw erro;
    console.error(
      `[rankingProdutos] Falha ao consultar o ranking (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoRanking();
  }
}

// Retorna { criterio, limite, itens: [{ posicao, id, nome, quantidade, faturamento }] }
// (para criterio=margem cada item traz também custoTotal, lucro, margemPercentual e semCusto;
// com semCusto=true os três primeiros são null; para crescimento/queda ver obterRankingVariacao).
// `nivel` + `id` (opcionais, juntos) restringem o ranking a um grupo/setor/família.
// Lança ErroValidacao (400) para entrada inválida (inclusive inicio sem nenhum dia fechado em
// crescimento/queda), ErroCacheIncompleto (503) quando o cache não cobre o período (crescimento/queda); falhas de banco viram ErroInternoRanking.
async function obterRanking({ criterio, limite, inicio, fim, nivel, id, ordenarPor } = {}) {
  validarCriterio(criterio);
  const limiteValido = validarLimite(limite);
  // ordenarPor só vale para margem; nos demais critérios é ignorado.
  const ordenarPorValido = criterio === 'margem' ? validarOrdenarPor(ordenarPor) : null;
  const periodo = buildPeriodFilter(inicio, fim);
  const temDepartamento = (nivel !== undefined && nivel !== '') || (id !== undefined && id !== '');
  const departamento = temDepartamento ? buildDepartmentFilter({ nivel, id }) : null;

  if (Object.prototype.hasOwnProperty.call(VARIACAO_POR_CRITERIO, criterio)) {
    return obterRankingVariacao({ criterio, limite: limiteValido, inicio, fim, departamento });
  }

  const consulta = montarSql(criterio, periodo, departamento, limiteValido, ordenarPorValido);

  try {
    const [linhas] = await getPool().execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
    const registros = Array.isArray(linhas) ? linhas : [];
    const itens = registros.map((linha, indice) => {
      const item = {
        posicao: indice + 1,
        id: Number(linha.id),
        nome: linha.nome,
        quantidade: arredondar(linha.quantidade, 3),
        faturamento: arredondar(linha.faturamento, 2),
      };
      if (criterio === 'margem') {
        const semCusto = Number(linha.semCusto) > 0;
        item.custoTotal = semCusto ? null : arredondar(linha.custoTotal, 2);
        item.lucro = semCusto ? null : arredondar(linha.lucro, 2);
        // faturamento zero (NULLIF -> NULL) vira 0; só semCusto deixa a margem null
        item.margemPercentual =
          semCusto ? null : linha.margemPercentual === null || linha.margemPercentual === undefined
            ? 0
            : arredondar(linha.margemPercentual, 2);
        item.semCusto = semCusto;
      }
      return item;
    });
    return { criterio, limite: limiteValido, itens };
  } catch (erro) {
    console.error(
      `[rankingProdutos] Falha ao consultar o ranking (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoRanking();
  }
}

module.exports = {
  obterRanking,
  CRITERIOS_VALIDOS,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  ErroCacheIncompleto,
  ErroInternoRanking,
};
