// Apoio às leituras do cache de vendas por produto (Task 7.4): "dia fechado", cobertura e guarda do /novos.
//
// LINHA SENTINELA (ver cabeçalho de jobs/vendasProdutoCache.job.js): para cada dia processado o job grava
// por último a linha (dia, produto = 0), com atualizado_em = CURRENT_TIMESTAMP. Este módulo trata o dia como
// COBERTO ("fechado") somente se essa sentinela existe com atualizado_em >= INÍCIO DO DIA SEGUINTE, isto é,
// foi gravada depois que o dia terminou. Consequências:
//   - o cache por produto é autossuficiente (não depende mais de vendas_periodo_cache / job 5.5);
//   - dia sem vendas (feriado) também tem sentinela, então não vira erro permanente;
//   - job interrompido entre lotes deixa o dia sem sentinela nova => o dia não conta como coberto;
//   - HOJE nunca é dia fechado: as leituras limitam o `fim` a ONTEM (resolverPeriodoFechado).
// Todo leitor de vendas_produto_dia_cache que não seja esta verificação filtra `produto > 0`.
//
// "Hoje" = dia do calendário LOCAL do servidor (dia de negócio do ERP, Brasil), o mesmo critério do job
// (hojeLocalIso). Usar o dia UTC daria "hoje" adiantado entre 21h e 24h no Brasil (UTC-3) e faria todo
// pedido até o dia corrente falhar com 503 nessas horas. Ontem é calculado com aritmética UTC sobre a data ISO.
//
// Se algum dia dos períodos pedidos não for coberto, a leitura responde erro claro (503) em vez de
// resultado parcial.
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { buildPeriodFilter, ErroValidacao } = require('../../shared/queryFilters');
const { listarDias, somarDias, hojeLocalIso } = require('../../jobs/jobsComum');

const COMANDO_JOB = 'npm run job:cache-produtos';

// 503: o cache é uma dependência do servidor que ainda não está pronta para o período pedido (o cliente
// não pode corrigir a requisição; a atualização do cache resolve). Fora do conjunto 400/401/500 das
// convenções, mas segue o formato { erro }.
class ErroCacheIncompleto extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroCacheIncompleto';
    this.status = 503;
  }
}

function montarFiltros(periodos, coluna) {
  const filtros = periodos.map((periodo) => buildPeriodFilter(periodo.inicio, periodo.fim, coluna));
  return {
    clause: filtros.map((filtro) => `(${filtro.clause})`).join(' OR '),
    params: filtros.flatMap((filtro) => filtro.params),
  };
}

// Valida o período pedido e o limita ao último dia fechado (ontem). Retorna
// { inicio, fim, fimSolicitado }, onde `fim` é o fim EFETIVO (min(fim, ontem)).
// Lança ErroValidacao (400) para período inválido ou se nenhum dia do intervalo está fechado
// (inicio >= hoje). `agora` existe para testes.
function resolverPeriodoFechado(inicio, fim, agora = new Date()) {
  buildPeriodFilter(inicio, fim); // formato, ordem e limite de 366 dias
  const ontem = somarDias(hojeLocalIso(agora), -1);
  if (inicio > ontem) {
    throw new ErroValidacao(
      `Nenhum dia fechado no intervalo pedido: o cache por produto só tem dias já encerrados (até ${ontem}). ` +
        `Informe um período que comece em ${ontem} ou antes.`
    );
  }
  return { inicio, fim: fim > ontem ? ontem : fim, fimSolicitado: fim };
}

// periodos: [{ inicio, fim }] (ISO, já validados e limitados a dias fechados). Lança ErroCacheIncompleto se
// algum dia não tiver a sentinela fechada; erros de banco sobem crus para o service tratar (try/catch dele).
async function verificarCobertura(pool, periodos) {
  const filtros = montarFiltros(periodos, 'vendas_produto_dia_cache.dia');

  const [linhas] = await pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT DATE_FORMAT(vendas_produto_dia_cache.dia, '%Y-%m-%d') AS dia
       FROM vendas_produto_dia_cache
      WHERE vendas_produto_dia_cache.produto = 0
        AND vendas_produto_dia_cache.atualizado_em >= DATE_ADD(vendas_produto_dia_cache.dia, INTERVAL 1 DAY)
        AND (${filtros.clause})`,
    },
    filtros.params
  );

  const cobertos = new Set((Array.isArray(linhas) ? linhas : []).map((linha) => linha.dia));
  const faltantes = periodos
    .flatMap((periodo) => listarDias(periodo.inicio, periodo.fim))
    .filter((dia) => !cobertos.has(dia))
    .sort();
  if (faltantes.length > 0) {
    const inicio = periodos.map((periodo) => periodo.inicio).sort()[0];
    const fim = periodos.map((periodo) => periodo.fim).sort().slice(-1)[0];
    throw new ErroCacheIncompleto(
      `O cache de vendas por produto ainda não cobre todo o intervalo necessário (${inicio} a ${fim}): ` +
        `faltam ${faltantes.length} dia(s), o primeiro é ${faltantes[0]}. ` +
        `Peça a quem administra o servidor para rodar: ${COMANDO_JOB} -- --desde ${faltantes[0]}`
    );
  }
}

// Quantidade vendida por produto no período, somada do cache diário (Task 13.3): usada pelas rotas de estoque
// (niveis, cobertura, parados) e por /demanda-baixo-estoque no lugar da agregação de vendaitem/vendacupom.
// O cache já contém só vendas válidas (o job aplica JOIN/WHERE_VENDA_VALIDA), e cupom cancelado depois fica com
// quantidade 0, então não há flagvc/status aqui. `produto > 0` ignora a sentinela de dia completo (produto = 0);
// HAVING SUM(quantidade) > 0 mantém a semântica de "produto com venda líquida no período".
// Retorna { sql, params }: `sql` é uma consulta (para usar como tabela derivada) com as colunas
// `produto` e `quantidadeVendida`; `params` = [inicio, fim] (datas ISO do período EFETIVO, já validadas por
// resolverPeriodoFechado/buildPeriodFilter; `dia` é DATE, então o intervalo inclusivo é `>= ? AND <= ?`).
// A verificação de cobertura (verificarCobertura) deve ser feita ANTES, pelo service.
function montarQuantidadeVendidaDoCache(inicio, fim) {
  return {
    sql: `SELECT produto, SUM(quantidade) AS quantidadeVendida
    FROM vendas_produto_dia_cache
    WHERE dia >= ? AND dia <= ? AND produto > 0
    GROUP BY produto
    HAVING SUM(quantidade) > 0`,
    params: [inicio, fim],
  };
}

// Guarda do /novos: primeira_venda_produto só é confiável se o preenchimento inicial do job varreu o
// histórico até o `inicio` do período. Como não há coluna/tabela de "histórico preenchido desde" (decisão do
// usuário: sem migration 005), a checagem é barata e só no cache: MIN(primeira_venda) precisa existir e ser
// <= inicio efetivo; senão, o histórico anterior a `inicio` não foi carregado e produtos antigos apareceriam
// como "novos".
// LIMITAÇÕES (documentadas, não detectáveis sem uma nova tabela):
//   - Falso 503: se `inicio` é anterior à primeira venda do ERP inteiro, MIN(primeira_venda) > inicio mesmo
//     com o preenchimento completo.
//   - Falso OK: um preenchimento que começou em X <= inicio mas depois da primeira venda real do ERP passa na
//     guarda (MIN <= inicio), e produtos vendidos só antes de X e de novo depois de `inicio` aparecem como
//     novos. Por isso o job deve ser rodado com --desde = data da primeira venda do ERP.
async function verificarHistoricoPrimeiraVenda(pool, inicio) {
  const [linhas] = await pool.execute(
    {
      timeout: TIMEOUT_CONSULTA_MS,
      sql: `SELECT DATE_FORMAT(MIN(primeira_venda_produto.primeira_venda), '%Y-%m-%d') AS primeiraVendaMinima
       FROM primeira_venda_produto`,
    },
    []
  );
  const registro = Array.isArray(linhas) ? linhas[0] : undefined;
  const minima = registro && registro.primeiraVendaMinima ? registro.primeiraVendaMinima : null;
  if (minima === null || minima > inicio) {
    throw new ErroCacheIncompleto(
      'O histórico de primeira venda por produto ainda não foi preenchido até o início do período ' +
        `(${inicio}): ${minima === null ? 'a tabela está vazia' : `a primeira venda registrada é ${minima}`}. ` +
        `Peça a quem administra o servidor para rodar: ${COMANDO_JOB} -- --desde AAAA-MM-DD, ` +
        'usando a data da primeira venda do ERP (varredura pesada: fora do horário de uso).'
    );
  }
}

module.exports = {
  verificarCobertura,
  verificarHistoricoPrimeiraVenda,
  resolverPeriodoFechado,
  montarQuantidadeVendidaDoCache,
  ErroCacheIncompleto,
};
