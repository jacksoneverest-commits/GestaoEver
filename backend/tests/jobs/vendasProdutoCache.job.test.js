jest.mock('../../src/db/connection', () => ({ getPool: jest.fn() }));

const { buildPeriodFilter, ErroValidacao } = require('../../src/shared/queryFilters');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../src/shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../../src/shared/timeoutConsulta');
const {
  atualizarCacheProdutos,
  lerArgumentos,
  executarCli,
  DIAS_JANELA_RECALCULO,
  DIAS_POR_CONSULTA,
  LINHAS_POR_INSERT,
} = require('../../src/jobs/vendasProdutoCache.job');

const HOJE = '2026-09-24';
// janela padrão de recálculo: 7 dias terminando em hoje
const JANELA_INICIO = '2026-09-18';

const INSERT_DIA = 'INSERT INTO vendas_produto_dia_cache';
const INSERT_PRIMEIRA = 'INSERT INTO primeira_venda_produto';

function somarDias(dataIso, dias) {
  const [a, m, d] = dataIso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Simula o pool. Cada consulta é reconhecida pelo SQL:
//  - INSERT ... vendas_produto_dia_cache   -> gravação diária (upsert)
//  - INSERT ... primeira_venda_produto     -> gravação da primeira venda (upsert)
//  - FROM vendacupom                       -> agregação por dia/produto (só o que cai no período parametrizado)
//  - SELECT ... vendas_produto_dia_cache com `atualizado_em >=` -> dias já fechados
//  - SELECT ... vendas_produto_dia_cache (demais)               -> linhas já gravadas e não zeradas
function montarPool({ agregados = [], fechados = [], existentes = [] } = {}) {
  const dentro = (dia, params) => dia >= params[0].slice(0, 10) && dia < params[1].slice(0, 10);
  const execute = jest.fn(async ({ sql }, params) => {
    if (sql.includes(INSERT_DIA)) return [{ affectedRows: params.length / 6 }, undefined];
    if (sql.includes(INSERT_PRIMEIRA)) return [{ affectedRows: params.length / 2 }, undefined];
    if (sql.includes('FROM vendacupom')) return [agregados.filter((l) => dentro(l.dia, params)), []];
    if (sql.includes('FROM vendas_produto_dia_cache') && sql.includes('atualizado_em >=')) {
      return [fechados.map((dia) => ({ dia })), []];
    }
    if (sql.includes('FROM vendas_produto_dia_cache')) return [existentes.filter((l) => dentro(l.dia, params)), []];
    throw new Error(`SQL inesperado: ${sql}`);
  });
  return { execute };
}

const chamadas = (pool, trecho) => pool.execute.mock.calls.filter(([{ sql }]) => sql.includes(trecho));

// Achata os pares de params de um INSERT diário em objetos { dia, produto, quantidade, faturamento, custoTotal, itensSemCusto }.
function linhasDoInsert(params) {
  const linhas = [];
  for (let i = 0; i < params.length; i += 6) {
    linhas.push({
      dia: params[i],
      produto: params[i + 1],
      quantidade: params[i + 2],
      faturamento: params[i + 3],
      custoTotal: params[i + 4],
      itensSemCusto: params[i + 5],
    });
  }
  return linhas;
}

// Linhas de produto gravadas (exclui a linha sentinela, produto = 0).
function linhasGravadas(pool) {
  return chamadas(pool, INSERT_DIA).flatMap(([, params]) => linhasDoInsert(params)).filter((l) => l.produto !== 0);
}

// Linhas sentinela gravadas (dia, produto = 0): marcador de "dia completo".
function sentinelasGravadas(pool) {
  return chamadas(pool, INSERT_DIA).flatMap(([, params]) => linhasDoInsert(params)).filter((l) => l.produto === 0);
}

// INSERTs diários que carregam linhas de produto (exclui os que só têm sentinela).
function insertsDeProdutos(pool) {
  return chamadas(pool, INSERT_DIA).filter(([, params]) => linhasDoInsert(params).some((l) => l.produto !== 0));
}

// Ordem em que os INSERTs foram executados: 'primeira' | 'produtos' | 'sentinela'.
function sequenciaDeInserts(pool) {
  return pool.execute.mock.calls
    .filter(([{ sql }]) => sql.includes('INSERT INTO'))
    .map(([{ sql }, params]) => {
      if (sql.includes(INSERT_PRIMEIRA)) return 'primeira';
      return linhasDoInsert(params).every((l) => l.produto === 0) ? 'sentinela' : 'produtos';
    });
}

function primeirasVendasGravadas(pool) {
  const linhas = [];
  for (const [, params] of chamadas(pool, INSERT_PRIMEIRA)) {
    for (let i = 0; i < params.length; i += 2) {
      linhas.push({ produto: params[i], primeiraVenda: params[i + 1] });
    }
  }
  return linhas;
}

describe('jobs/vendasProdutoCache atualizarCacheProdutos', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // Teste crítico 1 (PLAN.md, Task 7.4)
  it('grava, por dia e produto, quantidade/faturamento/custo apenas das vendas válidas, com período parametrizado', async () => {
    const pool = montarPool({
      agregados: [
        { dia: '2026-09-20', produto: 101, quantidade: 12.5, faturamento: '150.5000', custoTotal: '100.0000', itensSemCusto: 0 },
        { dia: '2026-09-20', produto: 102, quantidade: 3, faturamento: '30.0000', custoTotal: '21.0000', itensSemCusto: 0 },
        { dia: '2026-09-23', produto: 101, quantidade: 1, faturamento: '12.0000', custoTotal: '8.0000', itensSemCusto: 0 },
      ],
    });

    const resumo = await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const agregacoes = chamadas(pool, 'FROM vendacupom');
    expect(agregacoes).toHaveLength(1);
    const [{ sql }, params] = agregacoes[0];
    const periodo = buildPeriodFilter(JANELA_INICIO, HOJE);
    // itens (vendaitem), não valortotal do cupom; custo gravado no item
    expect(sql).toContain('SUM(vendaitem.qt)');
    expect(sql).toContain('SUM(vendaitem.vtotal)');
    expect(sql).toMatch(/SUM\(\s*vendaitem\.qt\s*\*\s*vendaitem\.pcusto\s*\)/);
    expect(sql).toMatch(/vendaitem\.pcusto IS NULL/);
    expect(sql).not.toMatch(/valortotal/i);
    // regra de venda válida do projeto + período parametrizado
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(sql).toContain(periodo.clause);
    expect(sql).toMatch(/GROUP BY[^]*vendaitem\.produto/);
    expect(params).toEqual(periodo.params);
    expect(sql).not.toContain(JANELA_INICIO); // datas nunca concatenadas no SQL

    const gravadas = linhasGravadas(pool);
    expect(gravadas).toEqual([
      { dia: '2026-09-20', produto: 101, quantidade: 12.5, faturamento: '150.5000', custoTotal: '100.0000', itensSemCusto: 0 },
      { dia: '2026-09-20', produto: 102, quantidade: 3, faturamento: '30.0000', custoTotal: '21.0000', itensSemCusto: 0 },
      { dia: '2026-09-23', produto: 101, quantidade: 1, faturamento: '12.0000', custoTotal: '8.0000', itensSemCusto: 0 },
    ]);
    expect(resumo.linhasGravadas).toBe(3);
    expect(resumo.diasProcessados).toBe(DIAS_JANELA_RECALCULO);
  });

  // Teste crítico 2 (PLAN.md, Task 7.4)
  it('rodar o job duas vezes para o mesmo dia atualiza a linha existente (upsert), sem duplicar', async () => {
    const pool = montarPool({
      agregados: [{ dia: '2026-09-24', produto: 101, quantidade: 2, faturamento: '10.0000', custoTotal: '6.0000', itensSemCusto: 0 }],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);
    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    // por execução: 1 INSERT de produtos + 1 da sentinela; todos são upsert
    const todos = chamadas(pool, INSERT_DIA);
    expect(todos).toHaveLength(4);
    for (const [{ sql }] of todos) {
      expect(sql).toContain('ON DUPLICATE KEY UPDATE');
      expect(sql).toContain('quantidade = VALUES(quantidade)');
      expect(sql).toContain('faturamento = VALUES(faturamento)');
      expect(sql).toContain('custo_total = VALUES(custo_total)');
      expect(sql).toContain('itens_sem_custo = VALUES(itens_sem_custo)');
      expect(sql).toContain('atualizado_em = CURRENT_TIMESTAMP');
      expect(sql).not.toContain('2026-09-24');
    }
    // as duas execuções miram exatamente as mesmas chaves (dia, produto), inclusive as da sentinela
    const produtos = insertsDeProdutos(pool);
    expect(produtos).toHaveLength(2);
    expect(produtos[1][1]).toEqual(produtos[0][1]);
    const sentinelas = sentinelasGravadas(pool);
    expect(sentinelas).toHaveLength(2 * DIAS_JANELA_RECALCULO);
    expect(sentinelas.slice(DIAS_JANELA_RECALCULO)).toEqual(sentinelas.slice(0, DIAS_JANELA_RECALCULO));
  });

  it('custo parcial: mantém o custo dos itens com pcusto e itens_sem_custo; pcusto = 0 não conta como sem custo', async () => {
    const pool = montarPool({
      agregados: [
        { dia: '2026-09-24', produto: 1, quantidade: 5, faturamento: '50.0000', custoTotal: '20.0000', itensSemCusto: 2 },
        { dia: '2026-09-24', produto: 2, quantidade: 4, faturamento: '40.0000', custoTotal: null, itensSemCusto: 3 },
        { dia: '2026-09-24', produto: 3, quantidade: 4, faturamento: '40.0000', custoTotal: '0.0000', itensSemCusto: 0 },
      ],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const [{ sql }] = chamadas(pool, 'FROM vendacupom')[0];
    expect(sql).not.toMatch(/COALESCE\(\s*vendaitem\.pcusto/i);
    expect(sql).not.toMatch(/pcusto\s*=\s*0/);
    const porProduto = Object.fromEntries(linhasGravadas(pool).map((l) => [l.produto, l]));
    expect(porProduto[1]).toMatchObject({ custoTotal: '20.0000', itensSemCusto: 2 });
    expect(porProduto[2]).toMatchObject({ custoTotal: null, itensSemCusto: 3 });
    expect(porProduto[3]).toMatchObject({ custoTotal: '0.0000', itensSemCusto: 0 });
  });

  it('nunca envia undefined ao banco (custo ausente vira null)', async () => {
    const pool = montarPool({
      agregados: [{ dia: '2026-09-24', produto: 1, quantidade: 5, faturamento: '50.0000', itensSemCusto: 1 }],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    for (const [, params] of pool.execute.mock.calls) {
      expect(params).not.toContain(undefined);
    }
    expect(linhasGravadas(pool)[0].custoTotal).toBeNull();
  });

  it('cupom cancelado depois de agregado: a linha antiga é sobrescrita com quantidade/faturamento 0 (sem DELETE)', async () => {
    const pool = montarPool({
      // produto 7 tinha venda no dia 20 e agora não tem mais nenhuma venda válida; produto 8 continua vendendo
      existentes: [
        { dia: '2026-09-20', produto: 7 },
        { dia: '2026-09-20', produto: 8 },
      ],
      agregados: [{ dia: '2026-09-20', produto: 8, quantidade: 1, faturamento: '9.0000', custoTotal: '5.0000', itensSemCusto: 0 }],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const [[{ sql: sqlExistentes }, paramsExistentes]] = chamadas(pool, 'FROM vendas_produto_dia_cache');
    const periodo = buildPeriodFilter(JANELA_INICIO, HOJE, 'vendas_produto_dia_cache.dia');
    expect(sqlExistentes).toContain(periodo.clause);
    expect(paramsExistentes).toEqual(periodo.params);
    const gravadas = linhasGravadas(pool);
    expect(gravadas.find((l) => l.produto === 7)).toEqual({
      dia: '2026-09-20',
      produto: 7,
      quantidade: 0,
      faturamento: '0.0000',
      custoTotal: null,
      itensSemCusto: 0,
    });
    expect(gravadas.find((l) => l.produto === 8)).toMatchObject({ quantidade: 1, faturamento: '9.0000' });
    expect(gravadas).toHaveLength(2);
    for (const [{ sql }] of pool.execute.mock.calls) {
      expect(sql).not.toMatch(/\bDELETE\b/i);
    }
  });

  it('mantém a primeira venda por produto com upsert LEAST(primeira_venda, VALUES(primeira_venda)), usando o menor dia com quantidade > 0', async () => {
    const pool = montarPool({
      agregados: [
        { dia: '2026-09-22', produto: 101, quantidade: 1, faturamento: '10.0000', custoTotal: '5.0000', itensSemCusto: 0 },
        { dia: '2026-09-19', produto: 101, quantidade: 2, faturamento: '20.0000', custoTotal: '10.0000', itensSemCusto: 0 },
        { dia: '2026-09-21', produto: 102, quantidade: 4, faturamento: '40.0000', custoTotal: '20.0000', itensSemCusto: 0 },
        { dia: '2026-09-20', produto: 103, quantidade: 0, faturamento: '0.0000', custoTotal: null, itensSemCusto: 0 },
      ],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const inserts = chamadas(pool, INSERT_PRIMEIRA);
    expect(inserts).toHaveLength(1);
    const [{ sql }] = inserts[0];
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('primeira_venda = LEAST(primeira_venda, VALUES(primeira_venda))');
    expect(sql).toContain('atualizado_em = CURRENT_TIMESTAMP');
    expect(primeirasVendasGravadas(pool)).toEqual([
      { produto: 101, primeiraVenda: '2026-09-19' },
      { produto: 102, primeiraVenda: '2026-09-21' },
    ]);
  });

  it('sem vendas no intervalo não grava linha de produto nem primeira venda: só as sentinelas dos dias processados', async () => {
    const pool = montarPool({ agregados: [] });

    const resumo = await atualizarCacheProdutos({ hoje: HOJE }, pool);

    expect(linhasGravadas(pool)).toHaveLength(0);
    expect(chamadas(pool, INSERT_PRIMEIRA)).toHaveLength(0);
    expect(sentinelasGravadas(pool)).toHaveLength(DIAS_JANELA_RECALCULO);
    expect(resumo.linhasGravadas).toBe(0);
  });

  it('divide os upserts em lotes de no máximo LINHAS_POR_INSERT linhas (limite de placeholders do MariaDB)', async () => {
    const quantidadeProdutos = LINHAS_POR_INSERT * 2 + 1;
    const agregados = Array.from({ length: quantidadeProdutos }, (_, i) => ({
      dia: '2026-09-24',
      produto: i + 1,
      quantidade: 1,
      faturamento: '1.0000',
      custoTotal: '0.5000',
      itensSemCusto: 0,
    }));
    const pool = montarPool({ agregados });

    const resumo = await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const inserts = insertsDeProdutos(pool);
    expect(inserts).toHaveLength(3);
    for (const [, params] of inserts) {
      expect(params.length / 6).toBeLessThanOrEqual(LINHAS_POR_INSERT);
      expect(params.length).toBeLessThan(65535);
    }
    expect(linhasGravadas(pool)).toHaveLength(quantidadeProdutos);
    expect(new Set(linhasGravadas(pool).map((l) => l.produto)).size).toBe(quantidadeProdutos);
    expect(resumo.linhasGravadas).toBe(quantidadeProdutos);
    expect(chamadas(pool, INSERT_PRIMEIRA)).toHaveLength(3);
  });

  it('com desde, preenche dias ainda não fechados (além de recalcular a janela recente) e só consulta o trecho anterior à janela', async () => {
    // dias 01..15 fechados no cache, exceto 05 e 10; 16 e 17 sem linha. Janela recente: 18..24.
    const fechados = [];
    for (let d = 1; d <= 15; d += 1) {
      if (d !== 5 && d !== 10) fechados.push(`2026-09-${String(d).padStart(2, '0')}`);
    }
    const pool = montarPool({
      fechados,
      agregados: [
        { dia: '2026-09-05', produto: 1, quantidade: 1, faturamento: '1.0000', custoTotal: '1.0000', itensSemCusto: 0 },
        { dia: '2026-09-16', produto: 2, quantidade: 1, faturamento: '1.0000', custoTotal: '1.0000', itensSemCusto: 0 },
      ],
    });

    const resumo = await atualizarCacheProdutos({ desde: '2026-09-01', hoje: HOJE }, pool);

    const [[{ sql: sqlFechados }, paramsFechados]] = chamadas(pool, 'atualizado_em >=');
    // "dia fechado" = sentinela (dia, produto = 0) gravada depois do fim do próprio dia
    expect(sqlFechados).toContain('atualizado_em >= DATE_ADD(');
    expect(sqlFechados).toMatch(/produto = 0/);
    expect(sqlFechados).not.toContain('quantidade > 0');
    expect(paramsFechados).toEqual(['2026-09-01', '2026-09-17']);

    expect(resumo).toMatchObject({ diasRecalculados: 7, diasPreenchidos: 4, diasProcessados: 11 });
    // 05 e 10 isolados + o trecho contíguo 16..24 (9 dias) = 3 agregações (DIAS_POR_CONSULTA >= 9)
    const trechos = chamadas(pool, 'FROM vendacupom').map(([, params]) => params);
    const cobertos = new Set();
    for (const [inicio, fimExclusivo] of trechos) {
      for (let dia = inicio.slice(0, 10); dia < fimExclusivo.slice(0, 10); dia = somarDias(dia, 1)) cobertos.add(dia);
    }
    expect([...cobertos].sort()).toEqual([
      '2026-09-05',
      '2026-09-10',
      ...Array.from({ length: 9 }, (_, i) => somarDias('2026-09-16', i)),
    ]);
  });

  it('desde muito antigo é processado em janelas de no máximo DIAS_POR_CONSULTA dias, respeitando o limite do buildPeriodFilter', async () => {
    const pool = montarPool({ fechados: [] });

    const resumo = await atualizarCacheProdutos({ desde: '2025-01-01', hoje: HOJE }, pool);

    // 2025-01-01..2026-09-24 = 632 dias
    expect(resumo.diasProcessados).toBe(632);
    const agregacoes = chamadas(pool, 'FROM vendacupom');
    expect(agregacoes.length).toBe(Math.ceil(632 / DIAS_POR_CONSULTA));
    for (const [, params] of agregacoes) {
      const dias = (Date.parse(params[1].slice(0, 10)) - Date.parse(params[0].slice(0, 10))) / 86400000;
      expect(dias).toBeLessThanOrEqual(DIAS_POR_CONSULTA);
      expect(dias).toBeLessThanOrEqual(366);
    }
  });

  // Linha sentinela (revisão da Fase 7): marcador de "dia completo" do cache por produto.
  it('grava uma sentinela (dia, produto 0, quantidade 0, faturamento 0, custo NULL) para CADA dia processado, com ou sem vendas', async () => {
    const pool = montarPool({
      agregados: [{ dia: '2026-09-20', produto: 101, quantidade: 1, faturamento: '10.0000', custoTotal: '5.0000', itensSemCusto: 0 }],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const diasDaJanela = Array.from({ length: DIAS_JANELA_RECALCULO }, (_, i) => somarDias(JANELA_INICIO, i));
    expect(sentinelasGravadas(pool)).toEqual(
      diasDaJanela.map((dia) => ({ dia, produto: 0, quantidade: 0, faturamento: '0.0000', custoTotal: null, itensSemCusto: 0 }))
    );
  });

  it('a sentinela é o ÚLTIMO INSERT do trecho: depois da primeira venda e de todos os lotes de produtos', async () => {
    const quantidadeProdutos = LINHAS_POR_INSERT + 1; // 2 lotes de produtos
    const agregados = Array.from({ length: quantidadeProdutos }, (_, i) => ({
      dia: '2026-09-20',
      produto: i + 1,
      quantidade: 1,
      faturamento: '1.0000',
      custoTotal: '0.5000',
      itensSemCusto: 0,
    }));
    const pool = montarPool({ agregados });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const sequencia = sequenciaDeInserts(pool);
    expect(sequencia[0]).toBe('primeira');
    expect(sequencia[sequencia.length - 1]).toBe('sentinela');
    expect(sequencia.filter((tipo) => tipo === 'sentinela')).toHaveLength(1);
    // primeiras vendas antes de qualquer linha de produto; nenhuma sentinela antes do último lote de produtos
    const ultimoProdutos = sequencia.lastIndexOf('produtos');
    const ultimaPrimeira = sequencia.lastIndexOf('primeira');
    expect(ultimaPrimeira).toBeLessThan(sequencia.indexOf('produtos'));
    expect(sequencia.indexOf('sentinela')).toBeGreaterThan(ultimoProdutos);
  });

  it('com vários trechos, cada trecho termina na sua sentinela antes de o trecho seguinte gravar produtos', async () => {
    const pool = montarPool({
      fechados: [],
      agregados: [
        { dia: '2026-09-01', produto: 1, quantidade: 1, faturamento: '1.0000', custoTotal: '1.0000', itensSemCusto: 0 },
        { dia: '2026-09-20', produto: 2, quantidade: 1, faturamento: '1.0000', custoTotal: '1.0000', itensSemCusto: 0 },
      ],
    });

    await atualizarCacheProdutos({ desde: '2026-09-01', hoje: HOJE }, pool);

    const sequencia = sequenciaDeInserts(pool);
    // 2026-09-01..09-24 = 24 dias em trechos de 7 -> 4 trechos, cada um com uma única sentinela ao final
    expect(sequencia.filter((tipo) => tipo === 'sentinela')).toHaveLength(Math.ceil(24 / DIAS_POR_CONSULTA));
    for (let i = 0; i < sequencia.length; i += 1) {
      if (sequencia[i] === 'produtos') {
        expect(['produtos', 'sentinela']).toContain(sequencia[i + 1]);
      }
      if (sequencia[i] === 'sentinela' && i + 1 < sequencia.length) {
        // o trecho seguinte começa pela primeira venda (ou, sem vendas, direto pela sua sentinela)
        expect(sequencia[i + 1]).not.toBe('produtos');
      }
    }
    expect(sequencia[sequencia.length - 1]).toBe('sentinela');
  });

  it('job interrompido entre lotes de produtos não grava a sentinela do trecho (o dia continua "não coberto")', async () => {
    const agregados = Array.from({ length: LINHAS_POR_INSERT + 1 }, (_, i) => ({
      dia: '2026-09-20',
      produto: i + 1,
      quantidade: 1,
      faturamento: '1.0000',
      custoTotal: '0.5000',
      itensSemCusto: 0,
    }));
    const pool = montarPool({ agregados });
    const base = pool.execute.getMockImplementation();
    let lotesDeProdutos = 0;
    pool.execute.mockImplementation(async (opcoes, params) => {
      if (opcoes.sql.includes(INSERT_DIA) && linhasDoInsert(params).some((l) => l.produto !== 0)) {
        lotesDeProdutos += 1;
        if (lotesDeProdutos === 2) throw Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
      }
      return base(opcoes, params);
    });

    await expect(atualizarCacheProdutos({ hoje: HOJE }, pool)).rejects.toThrow();

    expect(sentinelasGravadas(pool)).toHaveLength(0);
  });

  it('ignora produto <= 0 vindo da agregação (o id 0 é reservado à sentinela) e nunca o grava como produto', async () => {
    const pool = montarPool({
      agregados: [
        { dia: '2026-09-20', produto: 0, quantidade: 4, faturamento: '40.0000', custoTotal: '20.0000', itensSemCusto: 0 },
        { dia: '2026-09-20', produto: 101, quantidade: 1, faturamento: '10.0000', custoTotal: '5.0000', itensSemCusto: 0 },
      ],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    expect(linhasGravadas(pool).map((l) => l.produto)).toEqual([101]);
    expect(primeirasVendasGravadas(pool)).toEqual([{ produto: 101, primeiraVenda: '2026-09-20' }]);
    // a única linha com produto 0 do dia é a sentinela (zerada)
    const sentinelaDia20 = sentinelasGravadas(pool).filter((l) => l.dia === '2026-09-20');
    expect(sentinelaDia20).toEqual([{ dia: '2026-09-20', produto: 0, quantidade: 0, faturamento: '0.0000', custoTotal: null, itensSemCusto: 0 }]);
  });

  it('a consulta das linhas já gravadas (candidatas a zerar) ignora explicitamente a sentinela (produto > 0)', async () => {
    const pool = montarPool();

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const [[{ sql }]] = chamadas(pool, 'FROM vendas_produto_dia_cache').filter(([{ sql: s }]) => !s.includes('atualizado_em >='));
    expect(sql).toMatch(/vendas_produto_dia_cache\.produto > 0/);
  });

  // Arredondamento (revisão da Fase 7): decimais enviados com 4 casas, nunca em notação científica.
  it('custo minúsculo (1e-7) é gravado como decimal formatado "0.0000", nunca em notação científica', async () => {
    const pool = montarPool({
      agregados: [
        { dia: '2026-09-24', produto: 1, quantidade: 1e-7, faturamento: 1e-7, custoTotal: 1e-7, itensSemCusto: 0 },
        { dia: '2026-09-24', produto: 2, quantidade: 3, faturamento: '30.0000', custoTotal: '1e-7', itensSemCusto: 0 },
      ],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const [um, dois] = linhasGravadas(pool);
    expect(um.custoTotal).toBe('0.0000');
    expect(um.faturamento).toBe('0.0000');
    expect(dois.custoTotal).toBe('0.0000');
    for (const [, params] of chamadas(pool, INSERT_DIA)) {
      for (const valor of params) {
        expect(String(valor)).not.toMatch(/e[-+]?\d/i);
      }
    }
  });

  it('resíduo de ponto flutuante é arredondado a 4 casas antes de gravar (custo, faturamento e quantidade)', async () => {
    const pool = montarPool({
      agregados: [
        { dia: '2026-09-24', produto: 1, quantidade: 0.1 + 0.2, faturamento: 100.00000000001, custoTotal: 0.1 + 0.2, itensSemCusto: 0 },
        { dia: '2026-09-24', produto: 2, quantidade: 2.00004999, faturamento: '10.00006', custoTotal: 19.999999999999996, itensSemCusto: 0 },
      ],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const [um, dois] = linhasGravadas(pool);
    expect(um).toMatchObject({ quantidade: 0.3, faturamento: '100.0000', custoTotal: '0.3000' });
    expect(dois).toMatchObject({ quantidade: 2, faturamento: '10.0001', custoTotal: '20.0000' });
  });

  it('custo ausente continua null (não vira "0.0000") e custo negativo minúsculo não gera "-0.0000"', async () => {
    const pool = montarPool({
      agregados: [
        { dia: '2026-09-24', produto: 1, quantidade: 1, faturamento: '1.0000', custoTotal: null, itensSemCusto: 1 },
        { dia: '2026-09-24', produto: 2, quantidade: 1, faturamento: '1.0000', custoTotal: -1e-9, itensSemCusto: 0 },
      ],
    });

    await atualizarCacheProdutos({ hoje: HOJE }, pool);

    const [um, dois] = linhasGravadas(pool);
    expect(um.custoTotal).toBeNull();
    expect(dois.custoTotal).toBe('0.0000');
  });

  it('valida desde/ate antes de tocar o banco (formato, ordem e data futura)', async () => {
    const pool = montarPool();

    await expect(atualizarCacheProdutos({ desde: '01/09/2026', hoje: HOJE }, pool)).rejects.toBeInstanceOf(ErroValidacao);
    await expect(atualizarCacheProdutos({ desde: '2026-09-10', ate: '2026-09-01', hoje: HOJE }, pool)).rejects.toBeInstanceOf(
      ErroValidacao
    );
    await expect(atualizarCacheProdutos({ ate: '2026-09-25', hoje: HOJE }, pool)).rejects.toThrow(/futura|hoje/i);
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it('todas as consultas usam TIMEOUT_CONSULTA_MS e valores parametrizados', async () => {
    const pool = montarPool({
      agregados: [{ dia: '2026-09-24', produto: 1, quantidade: 1, faturamento: '1.0000', custoTotal: '1.0000', itensSemCusto: 0 }],
    });

    await atualizarCacheProdutos({ desde: '2026-09-01', hoje: HOJE }, pool);

    expect(pool.execute).toHaveBeenCalled();
    for (const [opcoes, valores] of pool.execute.mock.calls) {
      expect(opcoes.timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(typeof opcoes.sql).toBe('string');
      expect(Array.isArray(valores)).toBe(true);
    }
  });

  it('falha do banco vira erro genérico, sem vazar SQL/mensagem do driver, e o log traz só o code', async () => {
    const erroBruto = Object.assign(new Error('Access denied SELECT segredo FROM vendacupom'), {
      code: 'ER_ACCESS_DENIED_ERROR',
    });
    const pool = { execute: jest.fn().mockRejectedValue(erroBruto) };

    const erro = await atualizarCacheProdutos({ hoje: HOJE }, pool).catch((e) => e);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).not.toMatch(/segredo|vendacupom|Access denied/);
    const log = JSON.stringify(errorSpy.mock.calls);
    expect(log).toContain('ER_ACCESS_DENIED_ERROR');
    expect(log).not.toMatch(/segredo|vendacupom|Access denied/);
  });
});

describe('jobs/vendasProdutoCache CLI', () => {
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('lerArgumentos aceita --desde AAAA-MM-DD (com espaço ou =) e rejeita argumentos desconhecidos', () => {
    expect(lerArgumentos([])).toEqual({});
    expect(lerArgumentos(['--desde', '2026-09-01'])).toEqual({ desde: '2026-09-01' });
    expect(lerArgumentos(['--desde=2026-09-01'])).toEqual({ desde: '2026-09-01' });
    expect(() => lerArgumentos(['--desde'])).toThrow(/desde/);
    expect(() => lerArgumentos(['--foo'])).toThrow(/--foo/);
  });

  it('executarCli devolve 0 e fecha o pool em caso de sucesso', async () => {
    const pool = { ...montarPool(), end: jest.fn().mockResolvedValue() };

    const codigo = await executarCli([], { obterPool: () => pool, hoje: HOJE });

    expect(codigo).toBe(0);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalled();
  });

  it('executarCli devolve código != 0 com mensagem clara e fecha o pool em caso de erro', async () => {
    const pool = { ...montarPool(), end: jest.fn().mockResolvedValue() };

    const codigoArgumento = await executarCli(['--desde', 'ontem'], { obterPool: () => pool, hoje: HOJE });
    const falhaBanco = {
      execute: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
      end: jest.fn().mockResolvedValue(),
    };
    const codigoBanco = await executarCli([], { obterPool: () => falhaBanco, hoje: HOJE });

    expect(codigoArgumento).not.toBe(0);
    expect(codigoBanco).not.toBe(0);
    expect(falhaBanco.end).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
