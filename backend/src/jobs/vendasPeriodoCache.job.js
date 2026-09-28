// Job de agregação diária de vendas (PLAN.md, Task 5.5).
//
// Popula `vendas_periodo_cache` com UMA linha por dia (periodo_inicio = periodo_fim = dia),
// que `vendas.service.js` soma para montar o `comparativoPeriodoAnterior` sem tocar em
// vendacupom/vendaitem. Escreve no banco do ERP: só executar com confirmação do usuário.
//
// Uso (a partir de backend/):  npm run job:cache-vendas [-- --desde AAAA-MM-DD]
//
// Comportamento (padrão de dias):
//   1. JANELA DE RECÁLCULO — sempre recalcula os últimos 7 dias terminando em `ate`
//      (`ate` = hoje por padrão; ou seja, hoje-6 .. hoje). Cupons podem ser cancelados
//      depois de emitidos, então dias recentes nunca são considerados "fechados".
//   2. PREENCHIMENTO (só com `desde`) — no trecho [desde, início da janela - 1], processa
//      os dias que ainda NÃO estão fechados no cache: sem linha, ou com linha gravada no
//      próprio dia que ela cobre (`atualizado_em` anterior ao fim do dia => possivelmente
//      parcial). Dias com linha gravada depois do fim do próprio dia são preservados.
//      `desde` só estende o intervalo para trás; nunca reduz a janela de recálculo.
//   3. HOJE — não é tratado como dia fechado: é recalculado a cada execução (o total do dia
//      é parcial até o fim do expediente). Rode o job ao menos 1x por semana; com `--desde`
//      qualquer dia gravado parcialmente e nunca refeito é corrigido.
//   4. Dia sem vendas válidas grava 0/0, para o cache "cobrir" o dia (o comparativo só é
//      calculado se todos os dias do período anterior tiverem linha).
//   5. Nunca grava dias futuros (`ate` > hoje é erro de validação).
//
// Janelas: o intervalo processado é dividido em trechos contíguos de no máximo
// DIAS_POR_CONSULTA (31) dias — bem abaixo do limite de 366 dias do buildPeriodFilter e
// curto o bastante para a agregação (index range em vendacupom.data) caber no timeout.
// Cada trecho = 1 SELECT agrupado por dia + 1 INSERT multi-linha com upsert.
//
// "Hoje" é o dia do calendário LOCAL do servidor (o dia de negócio do ERP, Brasil); as
// datas enviadas ao banco seguem as regras de queryFilters (ISO, tratadas como UTC).
const path = require('path');
const { getPool } = require('../db/connection');
const { buildPeriodFilter, ErroValidacao } = require('../shared/queryFilters');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../shared/timeoutConsulta');

const DIAS_JANELA_RECALCULO = 7;
const DIAS_POR_CONSULTA = 31;
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const USO = 'Uso: npm run job:cache-vendas [-- --desde AAAA-MM-DD]';

class ErroJobCacheVendas extends Error {
  constructor() {
    super('Erro interno ao atualizar o cache de vendas.');
    this.name = 'ErroJobCacheVendas';
  }
}

function paraMs(dataIso) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

function paraIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function somarDias(dataIso, dias) {
  return paraIso(paraMs(dataIso) + dias * UM_DIA_MS);
}

// Dia do calendário local do servidor, em ISO.
function hojeLocalIso(agora = new Date()) {
  const dois = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

// Valida formato e calendário reutilizando o buildPeriodFilter (fonte única da regra de data).
function validarDia(valor, rotulo) {
  try {
    buildPeriodFilter(valor, valor);
  } catch (erro) {
    if (erro instanceof ErroValidacao) {
      throw new ErroValidacao(erro.message.replace(/^Data (inicial|final)/, rotulo));
    }
    throw erro;
  }
}

// Lista os dias ISO de [inicio, fim], inclusivo.
function listarDias(inicio, fim) {
  const dias = [];
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
    dias.push(dia);
  }
  return dias;
}

// Agrupa dias ordenados em trechos contíguos com no máximo `maximo` dias.
function agruparEmTrechos(diasOrdenados, maximo) {
  const trechos = [];
  let atual = null;
  for (const dia of diasOrdenados) {
    if (atual && dia === somarDias(atual.fim, 1) && atual.dias < maximo) {
      atual.fim = dia;
      atual.dias += 1;
    } else {
      atual = { inicio: dia, fim: dia, dias: 1 };
      trechos.push(atual);
    }
  }
  return trechos;
}

// Dias de [inicio, fim] já "fechados" no cache: linha diária gravada depois do fim do dia e com
// vendas (dias 0/0 são sempre recalculados: o ERP pode sincronizar vendas atrasadas).
function consultarDiasFechados(pool, inicio, fim) {
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT DATE_FORMAT(periodo_inicio, '%Y-%m-%d') AS dia
       FROM vendas_periodo_cache
      WHERE periodo_inicio = periodo_fim
        AND periodo_inicio >= ? AND periodo_inicio <= ?
        AND atualizado_em >= DATE_ADD(periodo_inicio, INTERVAL 1 DAY)
        AND quantidade_cupons > 0`,
    },
    [inicio, fim]
  );
}

// Faturamento e cupons das vendas válidas de cada dia do trecho (uma query agrupada).
// vendacupom.valortotal já é líquido: nunca reaplicar desconto/imposto.
function agregarPorDia(pool, inicio, fim) {
  const periodo = buildPeriodFilter(inicio, fim);
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT DATE_FORMAT(vendacupom.data, '%Y-%m-%d') AS dia,
              SUM(vendacupom.valortotal) AS faturamento, COUNT(*) AS quantidadeCupons
       FROM vendacupom
       ${JOIN_VENDA_VALIDA}
      WHERE ${periodo.clause} AND ${WHERE_VENDA_VALIDA}
      GROUP BY dia`,
    },
    periodo.params
  );
}

// Upsert multi-linha (uma linha por dia). A chave única uq_vendas_periodo
// (periodo_inicio, periodo_fim) faz o segundo run atualizar a linha em vez de duplicar.
function gravarDias(pool, linhas) {
  const valores = linhas.map(() => '(?, ?, ?, ?)').join(', ');
  const params = [];
  for (const { dia, faturamento, quantidadeCupons } of linhas) {
    params.push(dia, dia, faturamento, quantidadeCupons);
  }
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `INSERT INTO vendas_periodo_cache (periodo_inicio, periodo_fim, faturamento_total, quantidade_cupons)
       VALUES ${valores}
       ON DUPLICATE KEY UPDATE
         faturamento_total = VALUES(faturamento_total),
         quantidade_cupons = VALUES(quantidade_cupons),
         atualizado_em = CURRENT_TIMESTAMP`,
    },
    params
  );
}

// desde/ate: ISO 'YYYY-MM-DD' opcionais (ate padrão = hoje). `hoje` existe para os testes.
// Retorna { periodoInicio, periodoFim, diasRecalculados, diasPreenchidos, diasGravados }.
// Lança ErroValidacao (entrada inválida) ou ErroJobCacheVendas (falha de banco; o detalhe
// vai só como `code` para o log, sem SQL nem mensagem do driver).
async function atualizarCacheVendas({ desde, ate, hoje = hojeLocalIso() } = {}, pool = getPool()) {
  const fim = ate === undefined ? hoje : ate;
  validarDia(fim, 'Data final (ate)');
  if (fim > hoje) {
    throw new ErroValidacao(`A data final (ate) não pode ser futura: hoje é ${hoje}.`);
  }
  if (desde !== undefined) {
    validarDia(desde, 'Data inicial (desde)');
    if (desde > fim) {
      throw new ErroValidacao('A data inicial (desde) não pode ser posterior à data final.');
    }
  }

  const inicioJanela = somarDias(fim, -(DIAS_JANELA_RECALCULO - 1));
  const diasJanela = listarDias(inicioJanela, fim);

  try {
    let diasPreencher = [];
    if (desde !== undefined && desde < inicioJanela) {
      const fimPreenchimento = somarDias(inicioJanela, -1);
      const [linhasFechadas] = await consultarDiasFechados(pool, desde, fimPreenchimento);
      const fechados = new Set(linhasFechadas.map((linha) => linha.dia));
      diasPreencher = listarDias(desde, fimPreenchimento).filter((dia) => !fechados.has(dia));
    }

    const diasProcessar = [...diasPreencher, ...diasJanela];
    let diasGravados = 0;
    for (const trecho of agruparEmTrechos(diasProcessar, DIAS_POR_CONSULTA)) {
      const [linhasAgregadas] = await agregarPorDia(pool, trecho.inicio, trecho.fim);
      const porDia = new Map(linhasAgregadas.map((linha) => [linha.dia, linha]));
      const linhas = listarDias(trecho.inicio, trecho.fim).map((dia) => {
        const agregado = porDia.get(dia);
        return {
          dia,
          faturamento: agregado && agregado.faturamento != null ? String(agregado.faturamento) : '0.0000',
          quantidadeCupons: agregado ? Number(agregado.quantidadeCupons) || 0 : 0,
        };
      });
      await gravarDias(pool, linhas);
      diasGravados += linhas.length;
    }

    return {
      periodoInicio: diasProcessar[0],
      periodoFim: fim,
      diasRecalculados: diasJanela.length,
      diasPreenchidos: diasPreencher.length,
      diasGravados,
    };
  } catch (erro) {
    console.error(`[vendas-cache] Falha ao atualizar o cache de vendas (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`);
    throw new ErroJobCacheVendas();
  }
}

// --- CLI ---------------------------------------------------------------------------------

// Aceita apenas `--desde AAAA-MM-DD` / `--desde=AAAA-MM-DD`. O formato da data é validado
// por atualizarCacheVendas.
function lerArgumentos(argv) {
  const opcoes = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--desde') {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith('--')) {
        throw new ErroValidacao(`O argumento --desde exige uma data AAAA-MM-DD. ${USO}`);
      }
      opcoes.desde = valor;
      i += 1;
    } else if (arg.startsWith('--desde=')) {
      opcoes.desde = arg.slice('--desde='.length);
    } else {
      throw new ErroValidacao(`Argumento desconhecido: ${arg}. ${USO}`);
    }
  }
  return opcoes;
}

const ERROS_COM_MENSAGEM_SEGURA = ['ErroValidacao', 'ErroJobCacheVendas', 'ErroConexaoBanco'];

// Executa o job como CLI: retorna o exit code (0 = sucesso) e sempre fecha o pool.
async function executarCli(argv, { obterPool = getPool, hoje } = {}) {
  let pool;
  try {
    const opcoes = lerArgumentos(argv);
    pool = obterPool();
    const resumo = await atualizarCacheVendas({ ...opcoes, hoje }, pool);
    console.log(
      `Cache de vendas atualizado: ${resumo.diasGravados} dia(s) gravado(s) ` +
        `(${resumo.diasRecalculados} recalculado(s) na janela recente, ${resumo.diasPreenchidos} preenchido(s)), ` +
        `de ${resumo.periodoInicio} a ${resumo.periodoFim}.`
    );
    return 0;
  } catch (erro) {
    const seguro = erro && ERROS_COM_MENSAGEM_SEGURA.includes(erro.name);
    console.error(seguro ? erro.message : 'Falha inesperada ao atualizar o cache de vendas.');
    return 1;
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch (erro) {
        // fechar o pool é melhor-esforço; o resultado do job já foi decidido
      }
    }
  }
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  process.exitCode = await executarCli(process.argv.slice(2));
}

if (require.main === module) {
  main();
}

module.exports = {
  atualizarCacheVendas,
  lerArgumentos,
  executarCli,
  ErroJobCacheVendas,
  DIAS_JANELA_RECALCULO,
  DIAS_POR_CONSULTA,
};
