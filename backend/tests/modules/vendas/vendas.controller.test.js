jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { buildPeriodFilter } = require('../../../src/shared/queryFilters');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../../src/shared/vendaValida');
const vendasRoutes = require('../../../src/modules/vendas/vendas.routes');
const { calcularPeriodoAnterior } = require('../../../src/modules/vendas/vendas.service');

const INICIO = '2026-09-01';
const FIM = '2026-09-07';
const PERIODO = buildPeriodFilter(INICIO, FIM);

// Simula o pool: cada consulta é reconhecida pelo SQL e devolve as linhas configuradas.
// O resultado de cada consulta pode ser sobrescrito por teste.
function montarExecute({ cupons, itens, cache } = {}) {
  return jest.fn(async ({ sql }) => {
    if (sql.includes('vendas_periodo_cache')) return [cache || [], []];
    if (sql.includes('vendaitem')) return [itens || [{ totalItens: 0 }], []];
    return [cupons || [{ faturamento: '0.0000', quantidadeCupons: 0 }], []];
  });
}

// Linhas diárias do cache (periodo_inicio = periodo_fim = dia) entre dois dias ISO inclusivos.
function linhasCacheDiarias(inicio, fim, { faturamento = '100.0000', cupons = 1 } = {}) {
  const linhas = [];
  for (let ms = Date.parse(inicio); ms <= Date.parse(fim); ms += 24 * 60 * 60 * 1000) {
    linhas.push({ dia: new Date(ms).toISOString().slice(0, 10), faturamento_total: faturamento, quantidade_cupons: cupons });
  }
  return linhas;
}

function sqlsPorTabela(execute) {
  const chamadas = execute.mock.calls;
  return {
    cupons: chamadas.find(([{ sql }]) => !sql.includes('vendaitem') && !sql.includes('vendas_periodo_cache')),
    itens: chamadas.find(([{ sql }]) => sql.includes('vendaitem')),
    cache: chamadas.find(([{ sql }]) => sql.includes('vendas_periodo_cache')),
  };
}

describe('GET /api/vendas/faturamento', () => {
  let app;
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app = express();
    app.use(express.json());
    app.use('/api/vendas', vendasRoutes);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    getPool.mockReset();
  });

  it('para um período com vendas válidas, o faturamento é a soma de vendacupom.valortotal', async () => {
    const execute = montarExecute({
      cupons: [{ faturamento: '1500.5000', quantidadeCupons: 3 }],
      itens: [{ totalItens: 7 }],
    });
    getPool.mockReturnValue({ execute });

    const res = await request(app).get('/api/vendas/faturamento').query({ inicio: INICIO, fim: FIM });

    expect(res.status).toBe(200);
    expect(res.body.faturamento).toBe(1500.5);
    expect(res.body.quantidadeCupons).toBe(3);
    expect(res.body.ticketMedio).toBe(500.17);
    expect(res.body.itensPorCompra).toBe(2.33);

    const { cupons } = sqlsPorTabela(execute);
    const [{ sql }, params] = cupons;
    expect(sql).toContain('SUM(vendacupom.valortotal)');
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(sql).toContain(PERIODO.clause);
    expect(params).toEqual(PERIODO.params);
    // datas nunca concatenadas no SQL
    expect(sql).not.toContain(INICIO);
  });

  it('vendas canceladas (Status = 5) ou com flagvc.Venda diferente de 1 ficam fora do faturamento, do ticket médio e dos itens', async () => {
    const execute = montarExecute({
      cupons: [{ faturamento: '200.0000', quantidadeCupons: 2 }],
      itens: [{ totalItens: 5 }],
    });
    getPool.mockReturnValue({ execute });

    const res = await request(app).get('/api/vendas/faturamento').query({ inicio: INICIO, fim: FIM });

    expect(res.status).toBe(200);
    expect(res.body.ticketMedio).toBe(100);
    const { cupons, itens } = sqlsPorTabela(execute);
    for (const [{ sql }, params] of [cupons, itens]) {
      // a regra de venda válida vem só dos fragmentos compartilhados
      expect(sql).toContain(JOIN_VENDA_VALIDA);
      expect(sql).toContain(WHERE_VENDA_VALIDA);
      expect(sql).toContain('flagvc.Venda = 1');
      expect(sql).toContain('vendacupom.Status = 0');
      expect(sql).toContain(PERIODO.clause);
      expect(params).toEqual(PERIODO.params);
    }
  });

  it('período sem vendas retorna ticketMedio e itensPorCompra 0, sem divisão por zero', async () => {
    getPool.mockReturnValue({
      execute: montarExecute({
        cupons: [{ faturamento: null, quantidadeCupons: 0 }],
        itens: [{ totalItens: 0 }],
      }),
    });

    const res = await request(app).get('/api/vendas/faturamento').query({ inicio: INICIO, fim: FIM });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      faturamento: 0,
      ticketMedio: 0,
      quantidadeCupons: 0,
      itensPorCompra: 0,
      comparativoPeriodoAnterior: null,
    });
  });

  it('comparativo soma as linhas diárias do cache do período anterior de mesma duração e calcula a variação percentual', async () => {
    const cache = linhasCacheDiarias('2026-08-25', '2026-08-31', { faturamento: '142.8571', cupons: 1 });
    // 7 dias: 6 x 142.8571 + 1 x 142.8574 = 1000.0000 (soma das linhas diárias, não uma linha do período)
    cache[6] = { ...cache[6], faturamento_total: '142.8574', quantidade_cupons: 3 };
    const execute = montarExecute({
      cupons: [{ faturamento: '1500.0000', quantidadeCupons: 10 }],
      itens: [{ totalItens: 20 }],
      cache,
    });
    getPool.mockReturnValue({ execute });

    const res = await request(app).get('/api/vendas/faturamento').query({ inicio: INICIO, fim: FIM });

    expect(res.status).toBe(200);
    // 2026-09-01..2026-09-07 (7 dias) -> anterior 2026-08-25..2026-08-31
    expect(res.body.comparativoPeriodoAnterior).toEqual({
      periodoInicio: '2026-08-25',
      periodoFim: '2026-08-31',
      faturamento: 1000,
      quantidadeCupons: 9,
      variacaoPercentual: 50,
    });
    const [{ sql }, params] = sqlsPorTabela(execute).cache;
    // só linhas diárias (periodo_inicio = periodo_fim) dentro do período anterior
    expect(sql).toContain('periodo_inicio = periodo_fim');
    expect(sql).not.toMatch(/vendacupom|vendaitem/);
    expect(params).toEqual(['2026-08-25', '2026-08-31']);
  });

  it('comparativo é null quando o cache não tem o período anterior, e a consulta nunca toca vendacupom/vendaitem para ele', async () => {
    const execute = montarExecute({ cache: [] });
    getPool.mockReturnValue({ execute });

    const res = await request(app).get('/api/vendas/faturamento').query({ inicio: INICIO, fim: FIM });

    expect(res.status).toBe(200);
    expect(res.body.comparativoPeriodoAnterior).toBeNull();
    const [{ sql }] = sqlsPorTabela(execute).cache;
    expect(sql).not.toMatch(/vendacupom|vendaitem/);
  });

  it('comparativo é null quando falta algum dia do período anterior no cache (cobertura incompleta)', async () => {
    const cache = linhasCacheDiarias('2026-08-25', '2026-08-31');
    cache.splice(3, 1); // remove 2026-08-28: 6 de 7 dias
    getPool.mockReturnValue({
      execute: montarExecute({
        cupons: [{ faturamento: '1500.0000', quantidadeCupons: 10 }],
        itens: [{ totalItens: 20 }],
        cache,
      }),
    });

    const res = await request(app).get('/api/vendas/faturamento').query({ inicio: INICIO, fim: FIM });

    expect(res.status).toBe(200);
    expect(res.body.comparativoPeriodoAnterior).toBeNull();
    // o restante da resposta segue normal
    expect(res.body.faturamento).toBe(1500);
  });

  it('variacaoPercentual é null quando o faturamento anterior no cache é 0', async () => {
    getPool.mockReturnValue({
      execute: montarExecute({
        cupons: [{ faturamento: '100.0000', quantidadeCupons: 1 }],
        itens: [{ totalItens: 1 }],
        cache: linhasCacheDiarias('2026-08-25', '2026-08-31', { faturamento: '0.0000', cupons: 0 }),
      }),
    });

    const res = await request(app).get('/api/vendas/faturamento').query({ inicio: INICIO, fim: FIM });

    expect(res.status).toBe(200);
    expect(res.body.comparativoPeriodoAnterior).toEqual({
      periodoInicio: '2026-08-25',
      periodoFim: '2026-08-31',
      faturamento: 0,
      quantidadeCupons: 0,
      variacaoPercentual: null,
    });
  });

  it('retorna 400 { erro } para datas ausentes, inválidas ou invertidas, sem consultar o banco', async () => {
    const execute = montarExecute();
    getPool.mockReturnValue({ execute });

    const semDatas = await request(app).get('/api/vendas/faturamento');
    const formato = await request(app).get('/api/vendas/faturamento').query({ inicio: '01/09/2026', fim: FIM });
    const invertido = await request(app).get('/api/vendas/faturamento').query({ inicio: FIM, fim: INICIO });
    const arrayMalicioso = await request(app).get('/api/vendas/faturamento?inicio=a&inicio=b&fim=2026-09-07');

    for (const res of [semDatas, formato, invertido, arrayMalicioso]) {
      expect(res.status).toBe(400);
      expect(typeof res.body.erro).toBe('string');
      expect(Object.keys(res.body)).toEqual(['erro']);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('retorna 500 genérico, sem vazar o erro do banco, quando a consulta falha', async () => {
    const erroBruto = new Error("Access denied for user 'root'@'localhost' SELECT senha-super-secreta FROM vendacupom");
    erroBruto.code = 'ER_ACCESS_DENIED_ERROR';
    getPool.mockReturnValue({ execute: jest.fn().mockRejectedValue(erroBruto) });

    const res = await request(app).get('/api/vendas/faturamento').query({ inicio: INICIO, fim: FIM });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(res.text).not.toMatch(/senha-super-secreta|vendacupom|Access denied/);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('senha-super-secreta');
  });
});

describe('vendas.service calcularPeriodoAnterior', () => {
  it('retorna o período imediatamente anterior, de mesma duração, cruzando mês e ano bissexto, em UTC', () => {
    expect(calcularPeriodoAnterior('2026-09-01', '2026-09-07')).toEqual({
      inicio: '2026-08-25',
      fim: '2026-08-31',
    });
    // um único dia
    expect(calcularPeriodoAnterior('2026-03-01', '2026-03-01')).toEqual({
      inicio: '2026-02-28',
      fim: '2026-02-28',
    });
    // cruza virada de ano e 29/02 de ano bissexto
    expect(calcularPeriodoAnterior('2025-01-01', '2025-01-31')).toEqual({
      inicio: '2024-12-01',
      fim: '2024-12-31',
    });
    expect(calcularPeriodoAnterior('2024-03-01', '2024-03-02')).toEqual({
      inicio: '2024-02-28',
      fim: '2024-02-29',
    });
  });
});
