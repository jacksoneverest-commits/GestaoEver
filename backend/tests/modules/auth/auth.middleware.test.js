const express = require('express');
const request = require('supertest');
const { autenticar } = require('../../../src/modules/auth/auth.middleware');
const { gerarToken } = require('../../../src/modules/auth/auth.token');

describe('auth.middleware autenticar', () => {
  let envOriginal;
  let app;

  beforeEach(() => {
    envOriginal = { ...process.env };
    process.env.AUTH_SECRET = 'segredo-de-teste-para-hmac-com-32-caracteres-ou-mais';
    app = express();
    app.get('/protegida', autenticar, (req, res) => res.json({ usuario: req.usuario.usuario }));
  });

  afterEach(() => {
    process.env = envOriginal;
  });

  it('retorna 401 { erro } sem token ou com token inválido e libera com Bearer válido', async () => {
    const semToken = await request(app).get('/protegida');
    const invalido = await request(app).get('/protegida').set('Authorization', 'Bearer lixo');
    const token = gerarToken({ id: 1, usuario: 'maria', perfil: 'gestor' });
    const valido = await request(app).get('/protegida').set('Authorization', `Bearer ${token}`);

    expect(semToken.status).toBe(401);
    expect(semToken.body).toEqual({ erro: expect.any(String) });
    expect(invalido.status).toBe(401);
    expect(invalido.body).toEqual({ erro: expect.any(String) });
    expect(valido.status).toBe(200);
    expect(valido.body).toEqual({ usuario: 'maria' });
  });
});
