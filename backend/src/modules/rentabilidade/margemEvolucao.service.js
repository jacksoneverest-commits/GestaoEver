// Rentabilidade — evolução da margem ao longo do tempo e produtos abaixo da margem mínima (Task 11.2 do PLAN.md).
//
// Decisão do usuário (PLAN.md, cabeçalho da Fase 11, 2026-09-27): as duas rotas leem SOMENTE
// `vendas_produto_dia_cache` (nunca `vendaitem`/`vendacupom`/`flagvc`), com `resolverPeriodoFechado`
// (fim limitado a ontem) e `verificarCobertura` (503 quando o cache não cobre o período), no mesmo
// padrão da Fase 13 (ver estoqueCobertura.service.js). Critério de margem: como a Curva ABC (Task 9.1)
// — soma o lucro só dos itens com custo e sinaliza `semCusto`, sem NUNCA anular faturamento/custo/lucro.
//
// Schema do cache (migration 004; ver cabeçalho de jobs/vendasProdutoCache.job.js):
//   vendas_produto_dia_cache (dia, produto, quantidade, faturamento, custo_total, itens_sem_custo)
//   custo_total    = SUM(qt * pcusto) só dos itens COM custo; NULL somente se NENHUM item do dia/produto
//                    tem custo (mesma regra usada aqui: SUM(custo_total) de várias linhas só é NULL se
//                    TODAS forem NULL — semântica SQL natural, sem precisar de COALESCE por linha).
//   itens_sem_custo = quantos itens não têm custo; usado para `semCusto` (SUM(itens_sem_custo) > 0).
//   produto = 0 é a linha SENTINELA de "dia completo" (ver cacheProduto.js) — sempre filtrada (produto > 0).
//
// lucro = faturamento - COALESCE(custoTotal, 0); margemPercentual = lucro*100/faturamento (0 se faturamento 0).
// NUNCA anular faturamento/custoTotal/lucro quando semCusto = true: só sinaliza que o custo é parcial.
//
// /evolucao (GET /api/rentabilidade/evolucao?inicio&fim[&nivel&id])
//   Agrupa por mês calendário (DATE_FORMAT(dia, '%Y-%m')), somando faturamento/custo_total/itens_sem_custo
//   de todos os produtos (ou só do departamento filtrado, via INNER JOIN produto quando nivel/id vêm).
//   DECISÃO (documentada aqui, conforme pedido): a resposta traz um item por MÊS CALENDÁRIO que tem
//   interseção com [inicio, fim efetivo] — nunca "pula" um mês por falta de linha no cache. Um mês sem
//   nenhuma venda no cache aparece com faturamento 0, custoTotal null (não há dado — diferente de "custo
//   zero conhecido"), lucro 0, margemPercentual 0, semCusto false. Se o período pedido cobre só parte de
//   um mês (ex.: começa dia 15), esse mês soma exatamente os dados existentes no intervalo pedido — sem
//   inventar o restante do mês. A ordem cronológica é garantida pelo próprio serviço (não confia só no
//   ORDER BY do SQL): os meses são listados em JS a partir de inicio/fim e casados com o que veio do banco.
//
// /abaixo-minimo (GET /api/rentabilidade/abaixo-minimo?inicio&fim&minimo=N[&nivel&id][&limite])
//   Agrega por PRODUTO (agrupador fixo; esta rota nunca aceita `agrupador`), com LEFT JOIN produto (para
//   o nome, e para o filtro de departamento quando informado) — mesmo padrão de margem.service.js e
//   curvaAbc.service.js: um produto removido do cadastro (migration 004) continua com faturamento/custo
//   no cache e aparece na lista com "Sem descrição", em vez de sumir. DECISÃO: só entram produtos com
//   faturamento > 0 no período (HAVING no SQL) — produto sem nenhuma venda no período teria
//   margemPercentual 0 pela regra acima, o que poluiria a lista com "não vendeu" em vez de "vendeu com
//   margem baixa" (SPEC.md: "produtos que vendem muito e dão pouco lucro"). Filtra margemPercentual <
//   minimo, ordena ascendente (pior primeiro; desempate por id) e só então aplica `limite`; `totalItens`
//   é a contagem ANTES do limite. `minimo` é digitado pelo usuário na hora (obrigatório, sem default).
//
// SQL: sem ORDER BY nem LIMIT no banco para /abaixo-minimo (ordenação/filtro por margemPercentual é
// calculada em JS, pois depende de uma divisão entre duas somas — o mesmo motivo pelo qual curvaAbc.service.js
// classifica em JS). Toda consulta é parametrizada; nenhum valor de entrada é concatenado na string SQL.
const { getPool } = require('../../db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { buildDepartmentFilter, ErroValidacao } = require('../../shared/queryFilters');
const { verificarCobertura, resolverPeriodoFechado, ErroCacheIncompleto } = require('../rankingProdutos/cacheProduto');

const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 1000;
const MINIMO_MINIMO = -1000;
const MINIMO_MAXIMO = 1000;
const NOME_SEM_DESCRICAO = 'Sem descrição';

class ErroInternoMargemEvolucao extends Error {
  constructor() {
    super('Erro interno ao consultar a rentabilidade.');
    this.name = 'ErroInternoMargemEvolucao';
  }
}

function arredondar(valor, casas) {
  const fator = 10 ** casas;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round((numero + Number.EPSILON) * fator) / fator : 0;
}

function nomeDoProduto(nome) {
  return typeof nome === 'string' && nome.trim() ? nome : NOME_SEM_DESCRICAO;
}

// Departamento é opcional; se `nivel` ou `id` vier, os dois precisam ser válidos (buildDepartmentFilter).
function lerDepartamento(nivel, id) {
  const semNivel = nivel === undefined || nivel === null || nivel === '';
  const semId = id === undefined || id === null || id === '';
  if (semNivel && semId) return null;
  return buildDepartmentFilter({ nivel, id });
}

function validarLimite(limite) {
  if (limite === undefined || limite === null || limite === '') return LIMITE_PADRAO;
  const numero = typeof limite === 'number' ? limite : /^\d+$/.test(String(limite)) ? Number(limite) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > LIMITE_MAXIMO) {
    throw new ErroValidacao(`Limite inválido: informe um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
  }
  return numero;
}

// `minimo` é obrigatório (o usuário digita na hora); aceita casas decimais e valores negativos.
function validarMinimo(minimo) {
  const vazio = minimo === undefined || minimo === null || (typeof minimo === 'string' && minimo.trim() === '');
  if (vazio) {
    throw new ErroValidacao('Informe o parâmetro minimo (número, ex.: 20 ou 20.5).');
  }
  const numero = typeof minimo === 'number' ? minimo : Number(minimo);
  if (!Number.isFinite(numero) || numero < MINIMO_MINIMO || numero > MINIMO_MAXIMO) {
    throw new ErroValidacao(`minimo inválido: informe um número entre ${MINIMO_MINIMO} e ${MINIMO_MAXIMO}.`);
  }
  return numero;
}

// Valida departamento e resolve o período fechado (fim efetivo, ontem no máximo). Nenhuma consulta ao
// banco acontece aqui — tudo síncrono, para as validações responderem 400 sem tocar no pool.
function normalizarComum({ inicio, fim, nivel, id } = {}) {
  const departamento = lerDepartamento(nivel, id);
  return { ...resolverPeriodoFechado(inicio, fim), departamento };
}

// Meses calendário (AAAA-MM) de [inicio, fim], ISO 'YYYY-MM-DD', inclusive nas duas pontas.
function listarMeses(inicioIso, fimIso) {
  const [anoIni, mesIni] = inicioIso.split('-').map(Number);
  const [anoFim, mesFim] = fimIso.split('-').map(Number);
  const meses = [];
  let ano = anoIni;
  let mes = mesIni;
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    meses.push(`${ano}-${String(mes).padStart(2, '0')}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

// custoTotal: null só quando não há dado nenhum (sem linha) OU o banco devolveu NULL (nenhum item com
// custo). Nos dois casos o valor "não é conhecido", nunca 0 fingido.
function custoOuNulo(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

// lucro/margemPercentual a partir de faturamento e custoTotal (custo ausente conta como 0 na subtração,
// mas o custoTotal exposto na resposta continua null — nunca "anulado").
function calcularMargem(faturamento, custoTotal) {
  const lucro = faturamento - (custoTotal === null ? 0 : custoTotal);
  const margemPercentual = faturamento > 0 ? (lucro * 100) / faturamento : 0;
  return { lucro, margemPercentual };
}

async function executar(rotulo, consulta) {
  try {
    const [linhas] = await getPool().execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
    return Array.isArray(linhas) ? linhas : [];
  } catch (erro) {
    console.error(
      `[rentabilidade] Falha ao consultar ${rotulo} (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoMargemEvolucao();
  }
}

// Garante que o cache por produto cobre todos os dias fechados do período efetivo ANTES de qualquer
// consulta de dados. ErroCacheIncompleto (503) sobe como está (não é logado como erro inesperado);
// qualquer outra falha do banco vira o erro interno genérico, logando só o código.
async function garantirCacheCoberto(inicio, fim) {
  try {
    await verificarCobertura(getPool(), [{ inicio, fim }]);
  } catch (erro) {
    if (erro instanceof ErroCacheIncompleto) throw erro;
    console.error(
      `[rentabilidade] Falha ao verificar o cache de vendas por produto (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoMargemEvolucao();
  }
}

// Placeholders: dia >= ? AND dia <= ? -> departamento (quando houver).
function montarSqlEvolucao({ inicio, fim, departamento }) {
  const joinProduto = departamento
    ? '\nINNER JOIN produto ON produto.idProduto = vendas_produto_dia_cache.produto'
    : '';
  const filtroDepartamento = departamento ? ` AND ${departamento.clause}` : '';
  const sql = `SELECT DATE_FORMAT(vendas_produto_dia_cache.dia, '%Y-%m') AS periodo,
  SUM(vendas_produto_dia_cache.faturamento) AS faturamento,
  SUM(vendas_produto_dia_cache.custo_total) AS custoTotal,
  SUM(vendas_produto_dia_cache.itens_sem_custo) AS itensSemCusto
FROM vendas_produto_dia_cache${joinProduto}
WHERE vendas_produto_dia_cache.dia >= ? AND vendas_produto_dia_cache.dia <= ?
  AND vendas_produto_dia_cache.produto > 0${filtroDepartamento}
GROUP BY periodo
ORDER BY periodo`;
  return { sql, params: [inicio, fim, ...(departamento ? departamento.params : [])] };
}

// Placeholders: dia >= ? AND dia <= ? -> departamento (quando houver). Agrupador é sempre produto.
function montarSqlAbaixoMinimo({ inicio, fim, departamento }) {
  const filtroDepartamento = departamento ? ` AND ${departamento.clause}` : '';
  const sql = `SELECT vendas_produto_dia_cache.produto AS id,
  MAX(produto.descricao) AS nome,
  SUM(vendas_produto_dia_cache.faturamento) AS faturamento,
  SUM(vendas_produto_dia_cache.custo_total) AS custoTotal,
  SUM(vendas_produto_dia_cache.itens_sem_custo) AS itensSemCusto
FROM vendas_produto_dia_cache
LEFT JOIN produto ON produto.idProduto = vendas_produto_dia_cache.produto
WHERE vendas_produto_dia_cache.dia >= ? AND vendas_produto_dia_cache.dia <= ?
  AND vendas_produto_dia_cache.produto > 0${filtroDepartamento}
GROUP BY vendas_produto_dia_cache.produto
HAVING SUM(vendas_produto_dia_cache.faturamento) > 0`;
  return { sql, params: [inicio, fim, ...(departamento ? departamento.params : [])] };
}

// Retorna { inicio, fim (efetivo), fimSolicitado, itens: [{ periodo, faturamento, custoTotal, lucro,
//           margemPercentual, semCusto }] }, um item por mês calendário do intervalo, em ordem cronológica.
// Lança ErroValidacao (400), ErroCacheIncompleto (503) ou ErroInternoMargemEvolucao (banco).
async function obterEvolucaoMargem(entrada = {}) {
  const { inicio, fim, fimSolicitado, departamento } = normalizarComum(entrada);
  await garantirCacheCoberto(inicio, fim);

  const linhas = await executar('a evolução da margem', montarSqlEvolucao({ inicio, fim, departamento }));
  const porMes = new Map(linhas.map((linha) => [linha.periodo, linha]));

  const itens = listarMeses(inicio, fim).map((periodo) => {
    const linha = porMes.get(periodo);
    const faturamento = linha ? Number(linha.faturamento) || 0 : 0;
    const custoTotal = linha ? custoOuNulo(linha.custoTotal) : null;
    const itensSemCusto = linha ? Number(linha.itensSemCusto) || 0 : 0;
    const { lucro, margemPercentual } = calcularMargem(faturamento, custoTotal);
    return {
      periodo,
      faturamento: arredondar(faturamento, 2),
      custoTotal: custoTotal === null ? null : arredondar(custoTotal, 2),
      lucro: arredondar(lucro, 2),
      margemPercentual: arredondar(margemPercentual, 2),
      semCusto: itensSemCusto > 0,
    };
  });

  return { inicio, fim, fimSolicitado, itens };
}

// Retorna { inicio, fim (efetivo), fimSolicitado, minimo, limite, totalItens,
//           itens: [{ id, nome, faturamento, custoTotal, lucro, margemPercentual, semCusto }] },
// só produtos com margemPercentual < minimo, ordenados ascendente (pior primeiro; desempate id).
// Lança ErroValidacao (400; inclusive minimo/limite ausentes ou inválidos), ErroCacheIncompleto (503)
// ou ErroInternoMargemEvolucao (banco).
async function obterProdutosAbaixoMinimo(entrada = {}) {
  const { inicio, fim, fimSolicitado, departamento } = normalizarComum(entrada);
  const minimo = validarMinimo(entrada.minimo);
  const limite = validarLimite(entrada.limite);
  await garantirCacheCoberto(inicio, fim);

  const linhas = await executar(
    'produtos abaixo da margem mínima',
    montarSqlAbaixoMinimo({ inicio, fim, departamento })
  );

  const calculados = linhas.map((linha) => {
    const faturamento = Number(linha.faturamento) || 0;
    const custoTotal = custoOuNulo(linha.custoTotal);
    const itensSemCusto = Number(linha.itensSemCusto) || 0;
    const { lucro, margemPercentual } = calcularMargem(faturamento, custoTotal);
    return {
      id: Number(linha.id),
      nome: nomeDoProduto(linha.nome),
      faturamento,
      custoTotal,
      lucro,
      margemPercentual,
      semCusto: itensSemCusto > 0,
    };
  });

  const filtrados = calculados
    .filter((item) => item.margemPercentual < minimo)
    .sort((a, b) => a.margemPercentual - b.margemPercentual || a.id - b.id);

  const itens = filtrados.slice(0, limite).map((item) => ({
    id: item.id,
    nome: item.nome,
    faturamento: arredondar(item.faturamento, 2),
    custoTotal: item.custoTotal === null ? null : arredondar(item.custoTotal, 2),
    lucro: arredondar(item.lucro, 2),
    margemPercentual: arredondar(item.margemPercentual, 2),
    semCusto: item.semCusto,
  }));

  return { inicio, fim, fimSolicitado, minimo, limite, totalItens: filtrados.length, itens };
}

module.exports = {
  obterEvolucaoMargem,
  obterProdutosAbaixoMinimo,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  ErroInternoMargemEvolucao,
};
