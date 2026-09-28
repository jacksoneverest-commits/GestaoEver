const request = require('supertest');

jest.mock('../src/db/connection', () => ({ getPool: jest.fn() }));

const createApp = require('../src/app');

const ROTAS_ESTOQUE = [
  '/api/estoque/niveis',
  '/api/estoque/cobertura',
  '/api/estoque/parados',
];

describe('app - rotas /api/estoque', () => {
  it.each(ROTAS_ESTOQUE)('%s exige autenticação e responde 401 sem token', async (rota) => {
    const response = await request(createApp()).get(`${rota}?inicio=2026-09-01&fim=2026-09-07`);

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('erro');
  });
});
