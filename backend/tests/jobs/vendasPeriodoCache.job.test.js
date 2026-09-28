jest.mock('../../src/db/connection', () => ({ getPool: jest.fn() }));

const { buildPeriodFilter, ErroValidacao } = require('../../src/shared/queryFilters');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../src/shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../../src/shared/timeoutConsulta');
const {
  atualizarCacheVendas,
  lerArgumentos,
  executarCli,
  DIAS_JANELA_RECALCULO,
  DIAS_POR_CONSULTA,
} = require('../../src/jobs/vendasPeriodoCache.job');

const HOJE = '2026-09-24';
// janela padrão de recálculo: 7 dias terminando em hoje
const JANELA_INICIO = '2026-09-18';

function somarDias(dataIso, dias) {
  const [a, m, d] = dataIso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Simula o pool. Cada consulta é reconhecida pelo SQL:
//  - INSERT ... vendas_periodo_cache   -> gravação (upsert)
//  - FROM vendacupom                   -> agregação por dia (devolve só os dias dentro do período parametrizado)
//  - SELECT ... vendas_periodo_cache   -> dias já fechados no cache
function montarPool({ agregados = [], fechados = [] } = {}) {
  const execute = jest.fn(async ({ sql }, params) => {
    if (sql.includes('INSERT INTO vendas_periodo_cache')) return [{ affectedRows: params.length / 4 }, undefined];
    if (sql.includes('FROM vendacupom')) {
      const [inicio, fimExclusivo] = [params[0].slice(0, 10), params[1].slice(0, 10)];
      return [agregados.filter((l) => l.dia >= inicio && l.dia < fimExclusivo), []];
    }
    if (sql.includes('FROM vendas_periodo_cache')) return [fechados.map((dia) => ({ dia })), []];
    throw new Error(`SQL inesperado: ${sql}`);
  });
  return { execute };
}

const chamadas = (pool, trecho) => pool.execute.mock.calls.filter(([{ sql }]) => sql.includes(trecho));

// Achata todos os upserts em [{ dia, faturamento, cupons }].
function linhasGravadas(pool) {
  const linhas = [];
  for (const [, params] of chamadas(pool, 'INSERT INTO vendas_periodo_cache')) {
    for (let i = 0; i < params.length; i += 4) {
      expect(params[i]).toBe(params[i + 1]); // periodo_inicio = periodo_fim = dia
      linhas.push({ dia: params[i], faturamento: params[i + 2], cupons: params[i + 3] });
    }
  }
  return linhas;
}

describe('jobs/vendasPeriodoCache atualizarCacheVendas', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('grava, por dia, faturamento e cupons apenas das vendas válidas, com período parametrizado', async () => {
    const pool = montarPool({
      agregados: [
        { dia: '2026-09-20', faturamento: '1500.5000', quantidadeCupons: 3 },
        { dia: '2026-09-23', faturamento: '200.0000', quantidadeCupons: 2 },
      ],
    });

    const resumo = await atualizarCacheVendas({ hoje: HOJE }, pool);

    const agregacoes = chamadas(pool, 'FROM vendacupom');
    expect(agregacoes).toHaveLength(1);
    const [{ sql }, params] = agregacoes[0];
    const periodo = buildPeriodFilter(JANELA_INICIO, HOJE);
    expect(sql).toContain('SUM(vendacupom.valortotal)');
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(sql).toContain(periodo.clause);
    expect(sql).toMatch(/GROUP BY/);
    expect(params).toEqual(periodo.params);
    expect(sql).not.toContain(JANELA_INICIO); // datas nunca concatenadas no SQL

    const gravadas = linhasGravadas(pool);
    expect(gravadas.find((l) => l.dia === '2026-09-20')).toEqual({
      dia: '2026-09-20',
      faturamento: '1500.5000',
      cupons: 3,
    });
    expect(gravadas.find((l) => l.dia === '2026-09-23')).toEqual({
      dia: '2026-09-23',
      faturamento: '200.0000',
      cupons: 2,
    });
    expect(resumo.diasGravados).toBe(7);
  });

  it('rodar o job duas vezes para o mesmo dia atualiza a linha existente em vez de duplicar (upsert)', async () => {
    const pool = montarPool({ agregados: [{ dia: '2026-09-24', faturamento: '10.0000', quantidadeCupons: 1 }] });

    await atualizarCacheVendas({ hoje: HOJE }, pool);
    await atualizarCacheVendas({ hoje: HOJE }, pool);

    const inserts = chamadas(pool, 'INSERT INTO vendas_periodo_cache');
    expect(inserts).toHaveLength(2);
    for (const [{ sql }] of inserts) {
      expect(sql).toContain('ON DUPLICATE KEY UPDATE');
      expect(sql).toContain('faturamento_total = VALUES(faturamento_total)');
      expect(sql).toContain('quantidade_cupons = VALUES(quantidade_cupons)');
      expect(sql).toContain('atualizado_em = CURRENT_TIMESTAMP');
      expect(sql).not.toContain('2026-09-24');
    }
    // as duas execuções miram exatamente as mesmas chaves (periodo_inicio, periodo_fim)
    expect(inserts[1][1]).toEqual(inserts[0][1]);
  });

  it('dia sem vendas grava 0/0 para o cache cobrir o dia', async () => {
    const pool = montarPool({ agregados: [] });

    await atualizarCacheVendas({ hoje: HOJE }, pool);

    const gravadas = linhasGravadas(pool);
    expect(gravadas.map((l) => l.dia)).toEqual(
      Array.from({ length: DIAS_JANELA_RECALCULO }, (_, i) => somarDias(JANELA_INICIO, i))
    );
    for (const linha of gravadas) {
      expect(Number(linha.faturamento)).toBe(0);
      expect(linha.cupons).toBe(0);
    }
  });

  it('com desde, preenche dias sem linha (ou ainda não fechados) além de recalcular a janela recente', async () => {
    // dias 01..15 fechados no cache, exceto 05 e 10; 16 e 17 sem linha. Janela recente: 18..24.
    const fechados = [];
    for (let d = 1; d <= 15; d += 1) {
      if (d !== 5 && d !== 10) fechados.push(`2026-09-${String(d).padStart(2, '0')}`);
    }
    const pool = montarPool({ fechados });

    const resumo = await atualizarCacheVendas({ desde: '2026-09-01', hoje: HOJE }, pool);

    const [[{ sql: sqlFechados }, paramsFechados]] = chamadas(pool, 'FROM vendas_periodo_cache');
    expect(sqlFechados).toContain('periodo_inicio = periodo_fim');
    expect(sqlFechados).toContain('atualizado_em >=');
    // só o trecho anterior à janela de recálculo (18..24) é consultado
    expect(paramsFechados).toEqual(['2026-09-01', '2026-09-17']);

    expect(linhasGravadas(pool).map((l) => l.dia)).toEqual([
      '2026-09-05',
      '2026-09-10',
      '2026-09-16',
      '2026-09-17',
      ...Array.from({ length: 7 }, (_, i) => somarDias(JANELA_INICIO, i)),
    ]);
    expect(resumo).toMatchObject({ diasRecalculados: 7, diasPreenchidos: 4, diasGravados: 11 });
    // 05 e 10 isolados + o trecho contíguo 16..24
    expect(chamadas(pool, 'FROM vendacupom')).toHaveLength(3);
  });

  it('dias zerados no cache nunca contam como fechados (o ERP pode sincronizar vendas depois)', async () => {
    const pool = montarPool({ fechados: [] });

    await atualizarCacheVendas({ desde: '2026-09-01', hoje: HOJE }, pool);

    const [[{ sql: sqlFechados }]] = chamadas(pool, 'FROM vendas_periodo_cache');
    expect(sqlFechados).toContain('quantidade_cupons > 0');
  });

  it('desde muito antigo é processado em janelas de no máximo DIAS_POR_CONSULTA dias, respeitando o limite do buildPeriodFilter', async () => {
    const pool = montarPool({ fechados: [] });

    const resumo = await atualizarCacheVendas({ desde: '2025-01-01', hoje: HOJE }, pool);

    // 2025-01-01..2026-09-24 = 632 dias
    expect(resumo.diasGravados).toBe(632);
    const agregacoes = chamadas(pool, 'FROM vendacupom');
    expect(agregacoes.length).toBe(Math.ceil(632 / DIAS_POR_CONSULTA));
    for (const [, params] of agregacoes) {
      const dias = (Date.parse(params[1].slice(0, 10)) - Date.parse(params[0].slice(0, 10))) / 86400000;
      expect(dias).toBeLessThanOrEqual(DIAS_POR_CONSULTA);
      expect(dias).toBeLessThanOrEqual(366);
    }
    const dias = linhasGravadas(pool).map((l) => l.dia);
    expect(new Set(dias).size).toBe(632); // sem repetir dia
  });

  it('valida desde/ate antes de tocar o banco (formato, ordem e data futura)', async () => {
    const pool = montarPool();

    await expect(atualizarCacheVendas({ desde: '01/09/2026', hoje: HOJE }, pool)).rejects.toBeInstanceOf(ErroValidacao);
    await expect(atualizarCacheVendas({ desde: '2026-09-10', ate: '2026-09-01', hoje: HOJE }, pool)).rejects.toBeInstanceOf(
      ErroValidacao
    );
    await expect(atualizarCacheVendas({ ate: '2026-09-25', hoje: HOJE }, pool)).rejects.toThrow(/futura|hoje/i);
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it('todas as consultas usam TIMEOUT_CONSULTA_MS e valores parametrizados', async () => {
    const pool = montarPool();

    await atualizarCacheVendas({ desde: '2026-09-01', hoje: HOJE }, pool);

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

    const erro = await atualizarCacheVendas({ hoje: HOJE }, pool).catch((e) => e);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).not.toMatch(/segredo|vendacupom|Access denied/);
    const log = JSON.stringify(errorSpy.mock.calls);
    expect(log).toContain('ER_ACCESS_DENIED_ERROR');
    expect(log).not.toMatch(/segredo|vendacupom|Access denied/);
  });
});

describe('jobs/vendasPeriodoCache CLI', () => {
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
