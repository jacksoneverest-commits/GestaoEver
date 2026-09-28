const { getPool } = require('../../db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');

// Vendas agregadas por dimensão (hora, dia da semana, forma de pagamento).
// Recebem `periodo` = { clause, params } já montado por buildPeriodFilter no controller.
//
// Schema real do MariaDB do ERP (verificado em modo somente leitura):
//   vendacupom.data       DATETIME  — só o dia (00:00:00); indexada (idx_vc_data_status_fp_flag_cupom).
//   vendacupom.hora       VARCHAR(8) — 'HH:MM:SS' (24h, zero à esquerda).
//   vendacupom.formapag   INT       -> formapag.idFormaPag (formapag.Descricao = nome exibido).
//   vendacupom.valortotal DECIMAL(19,4) — já é valor líquido (não reaplicar desconto/imposto).
// O SQL só faz o agrupamento; o preenchimento de buckets vazios e o arredondamento
// (2 casas) ficam aqui, no service.

const NOME_FORMA_NAO_INFORMADA = 'Não informada';

const NOMES_DIAS_SEMANA = Object.freeze([
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]);

// Hora válida = 'HH:MM...' com HH em 00-23. Linhas com hora vazia/nula/malformada
// caem no grupo NULL, que é descartado do resultado (não pertencem a nenhum bucket
// de 0-23h). Elas continuam contadas em /faturamento; só não aparecem neste gráfico.
const EXPRESSAO_HORA = `CASE WHEN vendacupom.hora REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]'
       THEN CAST(SUBSTRING(vendacupom.hora, 1, 2) AS UNSIGNED) END`;

function arredondarMoeda(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : 0;
}

function numeroInteiro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

// Executa a consulta tratando erro explicitamente: detalhes do banco só no log
// interno (sem SQL, sem parâmetros); quem chama recebe um erro genérico.
async function executarConsulta(rotulo, sql, params) {
  try {
    const [linhas] = await getPool().execute({ sql, timeout: TIMEOUT_CONSULTA_MS }, params);
    return linhas;
  } catch (erro) {
    console.error(`[vendas] Falha na consulta ${rotulo} (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`);
    throw new ErroConsultaVendas();
  }
}

class ErroConsultaVendas extends Error {
  constructor() {
    super('Erro ao consultar vendas.');
    this.name = 'ErroConsultaVendas';
  }
}

// Monta um vetor com `tamanho` buckets, preenchendo com 0 os que não vieram do banco.
function preencherBuckets(linhas, campoIndice, tamanho, montarBucket) {
  const porIndice = new Map();
  for (const linha of linhas) {
    const indice = linha[campoIndice];
    if (indice === null || indice === undefined) continue;
    const posicao = Number(indice);
    if (Number.isInteger(posicao) && posicao >= 0 && posicao < tamanho) {
      porIndice.set(posicao, linha);
    }
  }
  return Array.from({ length: tamanho }, (_, indice) => {
    const linha = porIndice.get(indice);
    return montarBucket(indice, {
      faturamento: linha ? arredondarMoeda(linha.faturamento) : 0,
      quantidadeCupons: linha ? numeroInteiro(linha.quantidadeCupons) : 0,
    });
  });
}

async function obterVendasPorHora(periodo) {
  const linhas = await executarConsulta(
    'por-hora',
    `SELECT ${EXPRESSAO_HORA} AS horaDia,
            SUM(vendacupom.valortotal) AS faturamento,
            COUNT(*) AS quantidadeCupons
       FROM vendacupom
       ${JOIN_VENDA_VALIDA}
      WHERE ${WHERE_VENDA_VALIDA} AND ${periodo.clause}
      GROUP BY horaDia`,
    periodo.params
  );
  return preencherBuckets(linhas, 'horaDia', 24, (hora, valores) => ({ hora, ...valores }));
}

async function obterVendasPorDiaSemana(periodo) {
  // DAYOFWEEK: 1=domingo..7=sábado, independente de lc_time_names; -1 => 0=domingo..6=sábado.
  const linhas = await executarConsulta(
    'por-dia-semana',
    `SELECT DAYOFWEEK(vendacupom.data) - 1 AS diaSemana,
            SUM(vendacupom.valortotal) AS faturamento,
            COUNT(*) AS quantidadeCupons
       FROM vendacupom
       ${JOIN_VENDA_VALIDA}
      WHERE ${WHERE_VENDA_VALIDA} AND ${periodo.clause}
      GROUP BY diaSemana`,
    periodo.params
  );
  return preencherBuckets(linhas, 'diaSemana', 7, (diaSemana, valores) => ({
    diaSemana,
    nome: NOMES_DIAS_SEMANA[diaSemana],
    ...valores,
  }));
}

async function obterVendasPorFormaPagamento(periodo) {
  // LEFT JOIN + GROUP BY formapag.idFormaPag: cupons cuja forma não existe em
  // formapag (ou é nula/0) caem num único grupo de id NULL, sem perder faturamento.
  const linhas = await executarConsulta(
    'por-forma-pagamento',
    `SELECT formapag.idFormaPag AS formaPagamentoId,
            MAX(formapag.Descricao) AS nome,
            SUM(vendacupom.valortotal) AS faturamento,
            COUNT(*) AS quantidadeCupons
       FROM vendacupom
       ${JOIN_VENDA_VALIDA}
       LEFT JOIN formapag ON formapag.idFormaPag = vendacupom.formapag
      WHERE ${WHERE_VENDA_VALIDA} AND ${periodo.clause}
      GROUP BY formapag.idFormaPag`,
    periodo.params
  );
  return linhas
    .map((linha) => {
      const nome = typeof linha.nome === 'string' ? linha.nome.trim() : '';
      return {
        formaPagamentoId:
          linha.formaPagamentoId === null || linha.formaPagamentoId === undefined
            ? null
            : Number(linha.formaPagamentoId),
        nome: nome || NOME_FORMA_NAO_INFORMADA,
        faturamento: arredondarMoeda(linha.faturamento),
        quantidadeCupons: numeroInteiro(linha.quantidadeCupons),
      };
    })
    .sort((a, b) => b.faturamento - a.faturamento || a.nome.localeCompare(b.nome, 'pt-BR'));
}

module.exports = {
  obterVendasPorHora,
  obterVendasPorDiaSemana,
  obterVendasPorFormaPagamento,
  ErroConsultaVendas,
  NOMES_DIAS_SEMANA,
};
