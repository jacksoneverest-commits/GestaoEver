const { getPool } = require('../../db/connection');
const { buildPeriodFilter } = require('../../shared/queryFilters');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');

// Schema do ERP usado aqui (verificado em modo somente leitura):
//   vendacupom.valortotal  DECIMAL(19,4) — valor já líquido (nunca reaplicar desconto/imposto)
//   vendacupom.idcupom     VARCHAR(20)   — chave única do cupom (índice `idcupom`)
//   vendaitem.idcupom      VARCHAR(20)   — 1 linha por item vendido (índice `ncupom`)
//   vendacupom.data        DATETIME      — coluna do filtro de período (indexada)

class ErroInternoVendas extends Error {
  constructor() {
    super('Erro interno ao consultar vendas.');
    this.name = 'ErroInternoVendas';
  }
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

function arredondar(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

// Datas ISO 'YYYY-MM-DD' já validadas; toda a aritmética é em UTC, sem depender do fuso.
function paraMs(dataIso) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

function paraIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Período imediatamente anterior a `inicio`, com a mesma duração em dias.
function calcularPeriodoAnterior(inicio, fim) {
  const inicioMs = paraMs(inicio);
  const dias = Math.round((paraMs(fim) - inicioMs) / UM_DIA_MS) + 1;
  return { inicio: paraIso(inicioMs - dias * UM_DIA_MS), fim: paraIso(inicioMs - UM_DIA_MS) };
}

// Consulta 1: faturamento e quantidade de cupons válidos (só vendacupom + flagvc).
function consultarCupons(pool, periodo) {
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT COALESCE(SUM(vendacupom.valortotal), 0) AS faturamento, COUNT(*) AS quantidadeCupons
       FROM vendacupom
       ${JOIN_VENDA_VALIDA}
      WHERE ${periodo.clause} AND ${WHERE_VENDA_VALIDA}`,
    },
    periodo.params
  );
}

// Consulta 2: itens vendidos. Separada da 1 para o join com vendaitem não multiplicar
// valortotal; o join só alcança os cupons válidos do período (filtro por vendacupom.data).
function consultarItens(pool, periodo) {
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT COUNT(*) AS totalItens
       FROM vendacupom
       ${JOIN_VENDA_VALIDA}
       INNER JOIN vendaitem ON vendaitem.idcupom = vendacupom.idcupom
      WHERE ${periodo.clause} AND ${WHERE_VENDA_VALIDA}`,
    },
    periodo.params
  );
}

// Consulta 3: comparativo. Lê SOMENTE a tabela de cache (nunca vendacupom/vendaitem para
// períodos anteriores). O cache tem uma linha por dia (periodo_inicio = periodo_fim = dia,
// chave única uq_vendas_periodo), populada por jobs/vendasPeriodoCache.job.js. Traz as
// linhas diárias do período anterior (no máximo 366); a soma e a checagem de cobertura
// ficam em montarComparativo.
function consultarCache(pool, anterior) {
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT DATE_FORMAT(periodo_inicio, '%Y-%m-%d') AS dia, faturamento_total, quantidade_cupons
       FROM vendas_periodo_cache
      WHERE periodo_inicio = periodo_fim AND periodo_inicio >= ? AND periodo_inicio <= ?
      ORDER BY periodo_inicio`,
    },
    [anterior.inicio, anterior.fim]
  );
}

function contarDias(periodo) {
  return Math.round((paraMs(periodo.fim) - paraMs(periodo.inicio)) / UM_DIA_MS) + 1;
}

// Soma as linhas diárias do período anterior. Retorna null se o cache não cobrir todos os
// dias do período (um total parcial seria um comparativo enganoso).
function montarComparativo(linhasCache, anterior, faturamentoAtual) {
  const porDia = new Map();
  for (const linha of linhasCache || []) {
    porDia.set(linha.dia, linha);
  }
  if (porDia.size < contarDias(anterior)) {
    return null;
  }
  let faturamentoAnterior = 0;
  let quantidadeCupons = 0;
  for (const linha of porDia.values()) {
    faturamentoAnterior += Number(linha.faturamento_total) || 0;
    quantidadeCupons += Number(linha.quantidade_cupons) || 0;
  }
  return {
    periodoInicio: anterior.inicio,
    periodoFim: anterior.fim,
    faturamento: arredondar(faturamentoAnterior),
    quantidadeCupons,
    variacaoPercentual:
      faturamentoAnterior === 0
        ? null
        : arredondar(((faturamentoAtual - faturamentoAnterior) / faturamentoAnterior) * 100),
  };
}

// inicio/fim: ISO 'YYYY-MM-DD'. Lança ErroValidacao (datas inválidas) ou ErroInternoVendas
// (falha de banco; detalhes só no log interno, sem SQL nem mensagem do driver).
async function obterFaturamento(inicio, fim) {
  const periodo = buildPeriodFilter(inicio, fim);
  const anterior = calcularPeriodoAnterior(inicio, fim);

  try {
    const pool = getPool();
    const [[linhasCupons], [linhasItens], [linhasCache]] = await Promise.all([
      consultarCupons(pool, periodo),
      consultarItens(pool, periodo),
      consultarCache(pool, anterior),
    ]);

    const faturamentoBruto = Number(linhasCupons[0].faturamento) || 0;
    const quantidadeCupons = Number(linhasCupons[0].quantidadeCupons) || 0;
    const totalItens = Number((linhasItens[0] || {}).totalItens) || 0;

    return {
      faturamento: arredondar(faturamentoBruto),
      ticketMedio: quantidadeCupons > 0 ? arredondar(faturamentoBruto / quantidadeCupons) : 0,
      quantidadeCupons,
      itensPorCompra: quantidadeCupons > 0 ? arredondar(totalItens / quantidadeCupons) : 0,
      comparativoPeriodoAnterior: montarComparativo(linhasCache, anterior, faturamentoBruto),
    };
  } catch (erro) {
    console.error(`[vendas] Falha ao consultar faturamento (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`);
    throw new ErroInternoVendas();
  }
}

module.exports = { obterFaturamento, calcularPeriodoAnterior, ErroInternoVendas };
