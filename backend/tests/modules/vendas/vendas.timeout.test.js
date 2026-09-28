jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../../src/shared/timeoutConsulta');
const vendasRoutes = require('../../../src/modules/vendas/vendas.routes');
const vendasDimensaoRouter = require('../../../src/modules/vendas/vendasDimensao.routes');
const vendasDepartamentoRouter = require('../../../src/modules/vendas/vendasDepartamento.routes');

const PERIODO = { inicio: '2026-09-01', fim: '2026-09-07' };

function montarApp() {
  const app = express();
  app.use('/api/vendas', vendasRoutes);
  app.use('/api/vendas', vendasDimensaoRouter);
  app.use('/api/vendas', vendasDepartamentoRouter);
  return app;
}

describe('vendas — timeout das consultas ao banco', () => {
  let execute;
  let errorSpy;
  let app;

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue([[{ faturamento: '0', quantidadeCupons: 0, totalItens: 0 }], []]);
    getPool.mockReturnValue({ execute });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app = montarApp();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    getPool.mockReset();
  });

  it('todas as consultas de vendas são executadas com o timeout configurado e mantêm os valores parametrizados', async () => {
    expect(TIMEOUT_CONSULTA_MS).toBe(30000);

    await request(app).get('/api/vendas/faturamento').query(PERIODO);
    await request(app).get('/api/vendas/por-hora').query(PERIODO);
    await request(app).get('/api/vendas/por-dia-semana').query(PERIODO);
    await request(app).get('/api/vendas/por-forma-pagamento').query(PERIODO);
    await request(app).get('/api/vendas/por-departamento').query({ ...PERIODO, nivel: 'grupo' });
    await request(app).get('/api/vendas/por-departamento').query({ ...PERIODO, nivel: 'grupo', id: '2' });

    // faturamento (3) + 3 dimensões (3) + departamento sem id (1) + com id (2)
    expect(execute).toHaveBeenCalledTimes(9);
    for (const [opcoes, valores] of execute.mock.calls) {
      expect(typeof opcoes).toBe('object');
      expect(typeof opcoes.sql).toBe('string');
      expect(opcoes.timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(Array.isArray(valores)).toBe(true);
    }
  });

  it('timeout do driver vira 500 genérico, sem vazar detalhes, e o log traz só o code', async () => {
    const erroTimeout = Object.assign(new Error('Query inactivity timeout SELECT segredo FROM vendacupom'), {
      code: 'PROTOCOL_SEQUENCE_TIMEOUT',
    });
    execute.mockRejectedValue(erroTimeout);

    const rotas = [
      ['/api/vendas/faturamento', PERIODO],
      ['/api/vendas/por-hora', PERIODO],
      ['/api/vendas/por-departamento', { ...PERIODO, nivel: 'setor' }],
    ];
    for (const [rota, query] of rotas) {
      const res = await request(app).get(rota).query(query);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
      expect(res.text).not.toMatch(/segredo|vendacupom|inactivity/i);
    }

    const log = JSON.stringify(errorSpy.mock.calls);
    expect(log).toContain('PROTOCOL_SEQUENCE_TIMEOUT');
    expect(log).not.toMatch(/segredo|vendacupom|inactivity/i);
  });
});
