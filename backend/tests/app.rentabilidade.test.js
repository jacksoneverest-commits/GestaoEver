const request = require('supertest');

jest.mock('../src/db/connection', () => ({ getPool: jest.fn() }));

const createApp = require('../src/app');

const ROTAS_RENTABILIDADE = [
  '/api/rentabilidade/margem?agrupador=produto',
  '/api/rentabilidade/evolucao',
  '/api/rentabilidade/abaixo-minimo?minimo=20',
];

describe('app - rotas /api/rentabilidade', () => {
  it.each(ROTAS_RENTABILIDADE)('%s exige autenticação e responde 401 sem token', async (rota) => {
    const separador = rota.includes('?') ? '&' : '?';
    const response = await request(createApp()).get(`${rota}${separador}inicio=2026-09-01&fim=2026-09-07`);

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('erro');
  });
});
