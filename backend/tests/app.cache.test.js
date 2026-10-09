const request = require('supertest');

jest.mock('../src/db/connection', () => ({ getPool: jest.fn() }));

const createApp = require('../src/app');

describe('app - rotas /api/cache', () => {
  it('POST /api/cache/atualizar exige autenticação e responde 401 sem token', async () => {
    const response = await request(createApp()).post('/api/cache/atualizar');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('erro');
  });

  it('GET /api/cache/status exige autenticação e responde 401 sem token', async () => {
    const response = await request(createApp()).get('/api/cache/status');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('erro');
  });
});
