const request = require('supertest');

jest.mock('../src/db/connection', () => ({ getPool: jest.fn() }));

const createApp = require('../src/app');

const ROTAS_RANKING = [
  '/api/ranking-produtos',
  '/api/ranking-produtos/parados',
  '/api/ranking-produtos/novos',
  '/api/ranking-produtos/demanda-baixo-estoque',
];

describe('app - rotas /api/ranking-produtos', () => {
  it.each(ROTAS_RANKING)('%s exige autenticação e responde 401 sem token', async (rota) => {
    const response = await request(createApp()).get(`${rota}?inicio=2026-09-01&fim=2026-09-07&criterio=vendas`);

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('erro');
  });
});
