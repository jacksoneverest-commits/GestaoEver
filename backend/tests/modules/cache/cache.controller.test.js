jest.mock('../../../src/modules/cache/cache.service', () => ({
  iniciarAtualizacao: jest.fn(),
  obterStatus: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const cacheService = require('../../../src/modules/cache/cache.service');
const cacheRouter = require('../../../src/modules/cache/cache.routes');

function montarApp() {
  const app = express();
  app.use('/api/cache', cacheRouter);
  return app;
}

describe('/api/cache', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('POST /atualizar responde 202 com o status da atualização disparada', async () => {
    const status = { situacao: 'rodando', iniciadoEm: '2026-10-09T10:00:00.000Z', finalizadoEm: null, ultimaAtualizacao: null };
    cacheService.iniciarAtualizacao.mockReturnValue(status);

    const response = await request(montarApp()).post('/api/cache/atualizar');

    expect(response.status).toBe(202);
    expect(response.body).toEqual(status);
  });

  it('GET /status responde 200 com o status atual', async () => {
    const status = { situacao: 'ok', iniciadoEm: '2026-10-09T10:00:00.000Z', finalizadoEm: '2026-10-09T10:02:00.000Z', ultimaAtualizacao: '2026-10-09' };
    cacheService.obterStatus.mockReturnValue(status);

    const response = await request(montarApp()).get('/api/cache/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(status);
  });

  it('erro inesperado no service responde 500 { erro } sem expor detalhes', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    cacheService.iniciarAtualizacao.mockImplementation(() => {
      throw new Error('detalhe interno secreto');
    });

    const response = await request(montarApp()).post('/api/cache/atualizar');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ erro: 'Erro interno.' });
  });
});
