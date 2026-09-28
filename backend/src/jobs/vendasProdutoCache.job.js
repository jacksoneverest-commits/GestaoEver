// Job de agregação diária de vendas por produto (PLAN.md, Task 7.4).
//
// Popula, com upsert, as duas tabelas da migration 004 (Task 7.3):
//   vendas_produto_dia_cache  uma linha por (dia, produto): quantidade, faturamento, custo_total,
//                             itens_sem_custo. Lida por ranking.service.js (crescimento/queda) e
//                             por rankingEspeciais.service.js (/novos), sem tocar em
//                             vendacupom/vendaitem. Mais a LINHA SENTINELA (dia, produto = 0), abaixo.
//   primeira_venda_produto    uma linha por produto: dia da primeira venda válida.
// Escreve no banco do ERP: só executar com confirmação do usuário.
//
// Uso (a partir de backend/):  npm run job:cache-produtos [-- --desde AAAA-MM-DD]
//
// FONTE DOS DADOS
//   Vendas válidas do projeto: JOIN_VENDA_VALIDA + WHERE_VENDA_VALIDA (flagvc.Venda = 1 e
//   vendacupom.Status = 0). NÃO usa o filtro flag/formapag do ERP. Itens: vendaitem.qt (quantidade),
//   vendaitem.vtotal (valor do item) e vendaitem.pcusto (custo unitário gravado na venda).
//
// LINHA SENTINELA = MARCADOR DE "DIA COMPLETO" (revisão da Fase 7)
//   Para CADA dia processado (com ou sem vendas) o job grava por ÚLTIMO a linha (dia, produto = 0) com
//   quantidade 0, faturamento 0, custo_total NULL e itens_sem_custo 0, e atualizado_em =
//   CURRENT_TIMESTAMP. Um dia só conta como coberto/"fechado" (cacheProduto.js) se a sentinela existe com
//   atualizado_em >= início do dia seguinte, isto é, foi gravada DEPOIS de o dia terminar. Job
//   interrompido entre lotes deixa o dia sem sentinela nova => não coberto; hoje nunca é fechado.
//   Isso torna o cache por produto autossuficiente (sem depender de vendas_periodo_cache / job 5.5) e
//   resolve "dia sem vendas não tem linha" (feriado ganha a sentinela, então não vira 503 permanente).
//   SUPOSIÇÃO: vendaitem.produto é INT e o id 0 não existe no ERP. Por isso o job DESCARTA qualquer
//   linha agregada com produto <= 0 (ela colidiria com a sentinela) e todo leitor de
//   vendas_produto_dia_cache filtra `produto > 0` (ou faz INNER JOIN com produto e quantidade > 0).
//   LIMITAÇÃO: reprocessar um dia já fechado (janela de 7 dias) sobrescreve as linhas de produto antes
//   da sentinela; se cair no meio, a sentinela antiga permanece (dado misto antigo/novo, mas nunca
//   vazio) até o próximo run. Corrida de meia-noite: se a agregação de um dia lê antes de 00:00 e a
//   sentinela é gravada depois de 00:00, o dia pode ficar "fechado" com dados parciais; a janela de
//   recálculo dos 7 dias seguintes corrige.
//
// ORDEM DE ESCRITA (por trecho de até DIAS_POR_CONSULTA dias)
//   1) primeira_venda_produto (LEAST, idempotente); 2) linhas de produto em lotes; 3) sentinelas dos
//   dias do trecho. Assim a sentinela de um dia é sempre posterior a todas as linhas do próprio dia.
//
// ARREDONDAMENTO: quantidade, faturamento e custo_total são arredondados a 4 casas (as colunas são
//   DECIMAL(19,4)) antes de gravar. faturamento/custo vão como string decimal formatada ("0.0000"),
//   nunca String(1e-7) em notação científica; quantidade vai como número já arredondado.
//
// CUSTO PARCIAL (decisão do usuário)
//   custo_total     = SUM(qt * pcusto) somente dos itens que TÊM pcusto (NULL só se nenhum item do
//                     dia/produto tem custo — comportamento natural do SUM).
//   itens_sem_custo = SUM(pcusto IS NULL).
//   pcusto = 0 é custo válido (não conta como "sem custo").
//   Regra de leitura: itens_sem_custo > 0 => custo, lucro e margem desconhecidos.
//
// CANCELAMENTOS POSTERIORES (o usuário da aplicação NÃO tem DELETE)
//   Um cupom pode ser cancelado depois de agregado. Ao recalcular um dia, além das linhas com
//   venda válida, o job lê as linhas já gravadas naquele intervalo com quantidade/faturamento
//   diferentes de zero e, para as que deixaram de ter venda válida, SOBRESCREVE a linha com
//   quantidade = 0, faturamento = 0, custo_total = NULL, itens_sem_custo = 0. Leitores tratam
//   linha zerada como "sem venda". A sentinela (produto 0) nunca entra nesse conjunto. `atualizado_em = CURRENT_TIMESTAMP` é setado explicitamente no
//   ON DUPLICATE KEY UPDATE (a coluna não tem ON UPDATE automático).
//
// PRIMEIRA VENDA (primeira_venda_produto)
//   Por trecho processado, o menor dia com quantidade > 0 de cada produto é gravado com
//   primeira_venda = LEAST(primeira_venda, VALUES(primeira_venda)).
//   LIMITAÇÃO: LEAST nunca "avança" a data. Se a venda mais antiga de um produto for cancelada
//   depois, primeira_venda continua apontando para esse dia (a linha diária do dia fica zerada, e
//   /novos ignora produtos com quantidade 0 no período, mas o produto NÃO reaparece como novo no
//   dia da sua primeira venda ainda válida). Correção, se isso importar: recomputar
//   primeira_venda = MIN(dia) de vendas_produto_dia_cache WHERE quantidade > 0 GROUP BY produto —
//   exige o cache diário cobrindo o histórico inteiro (rodar com --desde da data mais antiga).
//   PREENCHIMENTO INICIAL: para primeira_venda_produto ficar correta o job precisa varrer TODO o
//   histórico (--desde da data da primeira venda do ERP). É uma varredura pesada de
//   vendacupom/vendaitem: rodar fora do horário de uso. Rodar só com um --desde recente marcaria
//   como "novo" qualquer produto antigo que ainda não estava na tabela.
//
// DIAS PROCESSADOS (mesma política do job de vendas, Task 5.5)
//   1. JANELA DE RECÁLCULO — sempre os últimos 7 dias terminando em `ate` (hoje por padrão).
//   2. PREENCHIMENTO (só com `desde`) — no trecho [desde, início da janela - 1], os dias ainda não
//      "fechados": sem sentinela, ou com sentinela gravada antes do fim do próprio dia (possivelmente
//      parcial). Dia fechado = sentinela (produto = 0) com atualizado_em >= início do dia seguinte.
//      Dias sem vendas também recebem sentinela, então deixam de ser reprocessados a cada `--desde`.
//   3. HOJE é recalculado a cada execução (parcial até o fim do expediente; nunca "fechado").
//   4. Nunca grava dias futuros.
//   Para o cache cobrir "ontem" o job precisa rodar ao menos uma vez depois da meia-noite.
//
// JANELAS: o intervalo é dividido em trechos contíguos de no máximo DIAS_POR_CONSULTA (7) dias —
// mais curto que o job de vendas (31) porque aqui a agregação é por item (vendaitem), bem mais
// volumosa, e precisa caber no timeout. Cada trecho = 1 SELECT agregado + 1 SELECT das linhas já
// gravadas + upserts em lotes de LINHAS_POR_INSERT linhas (o MariaDB limita a 65535 placeholders
// por statement preparado; 500 linhas x 6 colunas = 3000).
//
// "Hoje" é o dia do calendário LOCAL do servidor (dia de negócio do ERP, Brasil); as datas
// enviadas ao banco seguem as regras de queryFilters (ISO, tratadas como UTC).
const path = require('path');
const { getPool } = require('../db/connection');
const { buildPeriodFilter, ErroValidacao } = require('../shared/queryFilters');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../shared/timeoutConsulta');
const {
  somarDias,
  hojeLocalIso,
  validarDia,
  listarDias,
  agruparEmTrechos,
  lerArgumentosDesde,
} = require('./jobsComum');

const DIAS_JANELA_RECALCULO = 7;
const DIAS_POR_CONSULTA = 7;
const LINHAS_POR_INSERT = 500;
const USO = 'Uso: npm run job:cache-produtos [-- --desde AAAA-MM-DD]';

class ErroJobCacheProdutos extends Error {
  constructor() {
    super('Erro interno ao atualizar o cache de vendas por produto.');
    this.name = 'ErroJobCacheProdutos';
  }
}

function dividirEmLotes(itens, tamanho) {
  const lotes = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    lotes.push(itens.slice(i, i + tamanho));
  }
  return lotes;
}

// Dias de [inicio, fim] já "fechados" no cache: sentinela (produto = 0) gravada depois do fim do próprio dia.
function consultarDiasFechados(pool, inicio, fim) {
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT DATE_FORMAT(dia, '%Y-%m-%d') AS dia
       FROM vendas_produto_dia_cache
      WHERE dia >= ? AND dia <= ?
        AND produto = 0
        AND atualizado_em >= DATE_ADD(dia, INTERVAL 1 DAY)`,
    },
    [inicio, fim]
  );
}

// Quantidade, faturamento e custo por dia e produto das vendas válidas do trecho (uma query agrupada).
// Agrupa pela expressão do dia (não pelo DATETIME) para nunca gerar duas linhas do mesmo (dia, produto)
// no mesmo upsert, o que o ON DUPLICATE KEY sobrescreveria em vez de somar.
// STRAIGHT_JOIN: o período em vendacupom (índice em `data`) conduz a consulta.
function agregarPorDiaProduto(pool, inicio, fim) {
  const periodo = buildPeriodFilter(inicio, fim);
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT STRAIGHT_JOIN DATE_FORMAT(vendacupom.data, '%Y-%m-%d') AS dia,
              vendaitem.produto AS produto,
              SUM(vendaitem.qt) AS quantidade,
              SUM(vendaitem.vtotal) AS faturamento,
              SUM(vendaitem.qt * vendaitem.pcusto) AS custoTotal,
              SUM(vendaitem.pcusto IS NULL) AS itensSemCusto
       FROM vendacupom
       ${JOIN_VENDA_VALIDA}
       INNER JOIN vendaitem ON vendaitem.idcupom = vendacupom.idcupom
      WHERE ${periodo.clause} AND ${WHERE_VENDA_VALIDA}
      GROUP BY DATE_FORMAT(vendacupom.data, '%Y-%m-%d'), vendaitem.produto`,
    },
    periodo.params
  );
}

// Linhas já gravadas no trecho que ainda contam como venda (não zeradas): candidatas a serem zeradas
// se o cupom foi cancelado depois.
function consultarLinhasNaoZeradas(pool, inicio, fim) {
  const periodo = buildPeriodFilter(inicio, fim, 'vendas_produto_dia_cache.dia');
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT DATE_FORMAT(vendas_produto_dia_cache.dia, '%Y-%m-%d') AS dia,
              vendas_produto_dia_cache.produto AS produto
       FROM vendas_produto_dia_cache
      WHERE ${periodo.clause}
        AND vendas_produto_dia_cache.produto > 0
        AND (vendas_produto_dia_cache.quantidade <> 0 OR vendas_produto_dia_cache.faturamento <> 0)`,
    },
    periodo.params
  );
}

// Upsert por lote. A chave primária (dia, produto) faz o segundo run atualizar a linha em vez de duplicar.
function gravarLinhasDiarias(pool, linhas) {
  const valores = linhas.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
  const params = [];
  for (const { dia, produto, quantidade, faturamento, custoTotal, itensSemCusto } of linhas) {
    params.push(dia, produto, quantidade, faturamento, custoTotal, itensSemCusto);
  }
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `INSERT INTO vendas_produto_dia_cache (dia, produto, quantidade, faturamento, custo_total, itens_sem_custo)
       VALUES ${valores}
       ON DUPLICATE KEY UPDATE
         quantidade = VALUES(quantidade),
         faturamento = VALUES(faturamento),
         custo_total = VALUES(custo_total),
         itens_sem_custo = VALUES(itens_sem_custo),
         atualizado_em = CURRENT_TIMESTAMP`,
    },
    params
  );
}

// Upsert por lote de primeira venda. LEAST mantém sempre a data mais antiga já conhecida.
function gravarPrimeirasVendas(pool, linhas) {
  const valores = linhas.map(() => '(?, ?)').join(', ');
  const params = [];
  for (const { produto, primeiraVenda } of linhas) {
    params.push(produto, primeiraVenda);
  }
  return pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `INSERT INTO primeira_venda_produto (produto, primeira_venda)
       VALUES ${valores}
       ON DUPLICATE KEY UPDATE
         primeira_venda = LEAST(primeira_venda, VALUES(primeira_venda)),
         atualizado_em = CURRENT_TIMESTAMP`,
    },
    params
  );
}

// Arredonda a 4 casas (DECIMAL(19,4)) e devolve string decimal formatada, nunca em notação científica
// (String(1e-7) === '1e-7'). Valor ausente/não numérico -> null. Evita '-0.0000'.
function formatarDecimal4(valor) {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  const texto = (Math.round(numero * 1e4) / 1e4).toFixed(4);
  return texto === '-0.0000' ? '0.0000' : texto;
}

// Quantidade como número já arredondado a 4 casas (0 se ausente/inválida).
function arredondarQuantidade(valor) {
  const texto = formatarDecimal4(valor);
  return texto === null ? 0 : Number(texto);
}

// Converte uma linha do SELECT agregado no formato gravado. Nunca devolve undefined (o mysql2 rejeita
// parâmetros undefined); custo ausente vira null.
function normalizarLinha(linha) {
  return {
    dia: linha.dia,
    produto: Number(linha.produto),
    quantidade: arredondarQuantidade(linha.quantidade),
    faturamento: formatarDecimal4(linha.faturamento) || '0.0000',
    custoTotal: formatarDecimal4(linha.custoTotal),
    itensSemCusto: Number(linha.itensSemCusto) || 0,
  };
}

function linhaZerada(dia, produto) {
  return { dia, produto, quantidade: 0, faturamento: '0.0000', custoTotal: null, itensSemCusto: 0 };
}

// Sentinela (dia, produto = 0): marcador de "dia completo". Ver cabeçalho.
const PRODUTO_SENTINELA = 0;

// Processa um trecho: agrega, zera o que foi cancelado e grava, NESTA ORDEM: primeira venda, linhas de
// produto e, por último, a sentinela de cada dia do trecho (marcador de "dia completo").
// Retorna { linhasGravadas, produtosPrimeiraVenda, sentinelasGravadas }.
async function processarTrecho(pool, trecho) {
  const [linhasAgregadas] = await agregarPorDiaProduto(pool, trecho.inicio, trecho.fim);
  const [linhasExistentes] = await consultarLinhasNaoZeradas(pool, trecho.inicio, trecho.fim);

  // produto <= 0 (ou nulo) é descartado: o id 0 é reservado à sentinela (ver cabeçalho).
  const linhas = linhasAgregadas
    .filter((linha) => linha.produto != null && Number(linha.produto) > PRODUTO_SENTINELA)
    .map(normalizarLinha);
  const chaves = new Set(linhas.map((linha) => `${linha.dia}|${linha.produto}`));
  for (const existente of linhasExistentes) {
    const produto = Number(existente.produto);
    if (produto > PRODUTO_SENTINELA && !chaves.has(`${existente.dia}|${produto}`)) {
      linhas.push(linhaZerada(existente.dia, produto));
    }
  }

  // 1) Primeira venda (LEAST, idempotente): menor dia com venda (quantidade > 0) de cada produto no trecho.
  const primeiraPorProduto = new Map();
  for (const linha of linhas) {
    if (linha.quantidade > 0) {
      const atual = primeiraPorProduto.get(linha.produto);
      if (atual === undefined || linha.dia < atual) {
        primeiraPorProduto.set(linha.produto, linha.dia);
      }
    }
  }
  const primeirasVendas = [...primeiraPorProduto].map(([produto, primeiraVenda]) => ({ produto, primeiraVenda }));
  for (const lote of dividirEmLotes(primeirasVendas, LINHAS_POR_INSERT)) {
    await gravarPrimeirasVendas(pool, lote);
  }

  // 2) Linhas de produto.
  for (const lote of dividirEmLotes(linhas, LINHAS_POR_INSERT)) {
    await gravarLinhasDiarias(pool, lote);
  }

  // 3) Sentinelas, por último: só existem se todo o trecho foi gravado.
  const sentinelas = listarDias(trecho.inicio, trecho.fim).map((dia) => linhaZerada(dia, PRODUTO_SENTINELA));
  await gravarLinhasDiarias(pool, sentinelas);

  return {
    linhasGravadas: linhas.length,
    produtosPrimeiraVenda: primeirasVendas.length,
    sentinelasGravadas: sentinelas.length,
  };
}

// desde/ate: ISO 'YYYY-MM-DD' opcionais (ate padrão = hoje). `hoje` existe para os testes.
// Retorna { periodoInicio, periodoFim, diasRecalculados, diasPreenchidos, diasProcessados,
//           linhasGravadas, produtosPrimeiraVenda }.
// Lança ErroValidacao (entrada inválida) ou ErroJobCacheProdutos (falha de banco; o detalhe vai só
// como `code` para o log, sem SQL nem mensagem do driver).
async function atualizarCacheProdutos({ desde, ate, hoje = hojeLocalIso() } = {}, pool = getPool()) {
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
    let linhasGravadas = 0;
    let produtosPrimeiraVenda = 0;
    for (const trecho of agruparEmTrechos(diasProcessar, DIAS_POR_CONSULTA)) {
      const resultado = await processarTrecho(pool, trecho);
      linhasGravadas += resultado.linhasGravadas;
      produtosPrimeiraVenda += resultado.produtosPrimeiraVenda;
    }

    return {
      periodoInicio: diasProcessar[0],
      periodoFim: fim,
      diasRecalculados: diasJanela.length,
      diasPreenchidos: diasPreencher.length,
      diasProcessados: diasProcessar.length,
      linhasGravadas,
      produtosPrimeiraVenda,
    };
  } catch (erro) {
    console.error(
      `[produtos-cache] Falha ao atualizar o cache de vendas por produto (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroJobCacheProdutos();
  }
}

// --- CLI ---------------------------------------------------------------------------------

function lerArgumentos(argv) {
  return lerArgumentosDesde(argv, USO);
}

const ERROS_COM_MENSAGEM_SEGURA = ['ErroValidacao', 'ErroJobCacheProdutos', 'ErroConexaoBanco'];

// Executa o job como CLI: retorna o exit code (0 = sucesso) e sempre fecha o pool.
async function executarCli(argv, { obterPool = getPool, hoje } = {}) {
  let pool;
  try {
    const opcoes = lerArgumentos(argv);
    pool = obterPool();
    const resumo = await atualizarCacheProdutos({ ...opcoes, hoje }, pool);
    console.log(
      `Cache de vendas por produto atualizado: ${resumo.linhasGravadas} linha(s) gravada(s) em ` +
        `${resumo.diasProcessados} dia(s) (${resumo.diasRecalculados} recalculado(s) na janela recente, ` +
        `${resumo.diasPreenchidos} preenchido(s)), de ${resumo.periodoInicio} a ${resumo.periodoFim}; ` +
        `${resumo.produtosPrimeiraVenda} produto(s) com primeira venda verificada.`
    );
    return 0;
  } catch (erro) {
    const seguro = erro && ERROS_COM_MENSAGEM_SEGURA.includes(erro.name);
    console.error(seguro ? erro.message : 'Falha inesperada ao atualizar o cache de vendas por produto.');
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
  atualizarCacheProdutos,
  lerArgumentos,
  executarCli,
  ErroJobCacheProdutos,
  DIAS_JANELA_RECALCULO,
  DIAS_POR_CONSULTA,
  LINHAS_POR_INSERT,
};
