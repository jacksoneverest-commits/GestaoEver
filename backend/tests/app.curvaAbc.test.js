const request = require('supertest');

jest.mock('../src/db/connection', () => ({ getPool: jest.fn() }));

const createApp = require('../src/app');

describe('app - rota /api/curva-abc', () => {
  it('exige autenticação e responde 401 sem token', async () => {
    const response = await request(createApp()).get(
      '/api/curva-abc?inicio=2026-09-01&fim=2026-09-07&agrupador=produto'
    );

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('erro');
  });

  it('exige autenticação em /itens e responde 401 sem token', async () => {
    const response = await request(createApp()).get('/api/curva-abc/itens?agrupador=grupo');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('erro');
  });
});
