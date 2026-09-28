const request = require('supertest');

jest.mock('../src/db/connection', () => ({ getPool: jest.fn() }));

const createApp = require('../src/app');

const ROTAS_VENDAS = [
  '/api/vendas/faturamento',
  '/api/vendas/por-hora',
  '/api/vendas/por-dia-semana',
  '/api/vendas/por-forma-pagamento',
  '/api/vendas/por-departamento',
];

describe('app - rotas /api/vendas', () => {
  it.each(ROTAS_VENDAS)('%s exige autenticação e responde 401 sem token', async (rota) => {
    const response = await request(createApp()).get(`${rota}?inicio=2026-09-01&fim=2026-09-07`);

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('erro');
  });
});
