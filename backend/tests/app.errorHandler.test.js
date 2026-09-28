// Substitui o router de auth por um que falha, para exercitar o error handler final da app.
jest.mock('../src/modules/auth/auth.routes', () => {
  const express = require('express');
  const router = express.Router();
  router.get('/quebra', () => {
    const erro = new Error('detalhe interno senha-super-secreta');
    erro.code = 'ER_QUALQUER';
    throw erro;
  });
  return router;
});

const request = require('supertest');
const createApp = require('../src/app');

describe('error handler final da app', () => {
  it('responde 500 { erro: "Erro interno." } e loga só o code, sem stack nem mensagem, para erros inesperados', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(createApp()).get('/api/auth/quebra');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    const logado = JSON.stringify(errorSpy.mock.calls);
    expect(logado).toContain('ER_QUALQUER');
    expect(logado).not.toContain('senha-super-secreta');
    expect(logado).not.toMatch(/\.js:\d+/);
    errorSpy.mockRestore();
  });
});
