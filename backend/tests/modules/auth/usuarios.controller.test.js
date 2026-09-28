jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const createApp = require('../../../src/app');
const { hashSenha } = require('../../../src/modules/auth/auth.crypto');
const { gerarToken } = require('../../../src/modules/auth/auth.token');

const SENHA_ATUAL = 'senha-atual-123';

describe('rotas de usuários e senha (/api/auth)', () => {
  let execute;
  let envOriginal;
  let errorSpy;
  let app;
  let token;

  beforeEach(() => {
    envOriginal = { ...process.env };
    process.env.AUTH_SECRET = 'segredo-de-teste-para-hmac-com-32-caracteres-ou-mais';
    execute = jest.fn();
    getPool.mockReturnValue({ execute });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createApp();
    token = gerarToken({ id: 7, usuario: 'maria', perfil: 'gestor' });
  });

  afterEach(() => {
    process.env = envOriginal;
    errorSpy.mockRestore();
    getPool.mockReset();
  });

  it('POST /api/auth/usuarios com dados válidos retorna 201, grava senha_hash (nunca a senha em texto puro) e não retorna o hash no corpo', async () => {
    execute.mockResolvedValue([{ insertId: 42 }]);

    const res = await request(app)
      .post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .send({ usuario: 'joao', nome: 'Joao Silva', senha: 'senha-forte-123', perfil: 'gestor' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 42, usuario: 'joao', nome: 'Joao Silva', perfil: 'gestor', ativo: 1 });
    expect(Object.keys(res.body)).not.toContain('senha_hash');

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO usuarios_gestao/i);
    expect(params).not.toContain('senha-forte-123');
    const hash = params.find((p) => typeof p === 'string' && p.startsWith('scrypt$'));
    expect(hash).toBeDefined();
  });

  it('POST /api/auth/usuarios com usuario já existente retorna 400 sem vazar o erro do MariaDB', async () => {
    const erroBruto = new Error("Duplicate entry 'joao' for key 'uq_usuarios_gestao_usuario'");
    erroBruto.code = 'ER_DUP_ENTRY';
    erroBruto.errno = 1062;
    execute.mockRejectedValue(erroBruto);

    const res = await request(app)
      .post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .send({ usuario: 'joao', nome: 'Joao Silva', senha: 'senha-forte-123', perfil: 'gestor' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(res.text).not.toMatch(/Duplicate entry|uq_usuarios_gestao_usuario/);
  });

  it('GET /api/auth/usuarios e as rotas de senha sem token retornam 401', async () => {
    const semTokenLista = await request(app).get('/api/auth/usuarios');
    const semTokenReset = await request(app)
      .put('/api/auth/usuarios/7/senha')
      .send({ senhaNova: 'nova-senha-123' });
    const semTokenTroca = await request(app)
      .put('/api/auth/senha')
      .send({ senhaAtual: SENHA_ATUAL, senhaNova: 'nova-senha-123' });

    for (const res of [semTokenLista, semTokenReset, semTokenTroca]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ erro: expect.any(String) });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('PUT /api/auth/senha com senhaAtual incorreta retorna 400 e não altera senha_hash', async () => {
    execute.mockResolvedValueOnce([[{ senha_hash: await hashSenha(SENHA_ATUAL) }], []]);

    const res = await request(app)
      .put('/api/auth/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaAtual: 'senha-errada', senhaNova: 'nova-senha-123' });

    // 400, não 401: a sessão (token) continua válida, só o campo senhaAtual não confere. 401 aqui
    // faria o apiClient do frontend tratar como sessão expirada e deslogar o usuário.
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    // só a consulta do hash atual foi feita; nenhum UPDATE aconteceu
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatch(/SELECT/i);
  });

  it('PUT /api/auth/usuarios/:id/senha com senhaNova válida altera senha_hash (mock do pool) sem exigir a senha atual', async () => {
    execute.mockResolvedValue([{ affectedRows: 1 }]);

    const res = await request(app)
      .put('/api/auth/usuarios/7/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaNova: 'nova-senha-123' });

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/UPDATE usuarios_gestao SET senha_hash/i);
    expect(params[1]).toBe(7);
    expect(typeof params[0]).toBe('string');
    expect(params[0].startsWith('scrypt$')).toBe(true);
    expect(params).not.toContain('nova-senha-123');
  });

  it('PUT /api/auth/usuarios/:id/senha com id inexistente retorna 404', async () => {
    execute.mockResolvedValue([{ affectedRows: 0 }]);

    const res = await request(app)
      .put('/api/auth/usuarios/999/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaNova: 'nova-senha-123' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: expect.any(String) });
  });

  it('POST /api/auth/usuarios com campos obrigatórios ausentes retorna 400 sem consultar o banco', async () => {
    const res = await request(app)
      .post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .send({ usuario: 'joao' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('POST /api/auth/usuarios com usuario ou nome além do limite da coluna retorna 400 sem consultar o banco', async () => {
    // usuario VARCHAR(50) / nome VARCHAR(100) na migration 002_create_usuarios_gestao.sql
    const res = await request(app)
      .post('/api/auth/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .send({ usuario: 'a'.repeat(51), nome: 'Nome válido', senha: 'senha-forte-123', perfil: 'gestor' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('GET /api/auth/usuarios com token válido retorna a lista sem senha_hash', async () => {
    execute.mockResolvedValue([
      [
        { id: 1, usuario: 'maria', nome: 'Maria', perfil: 'gestor', ativo: 1 },
        { id: 2, usuario: 'joao', nome: 'Joao', perfil: 'dono', ativo: 0 },
      ],
      [],
    ]);

    const res = await request(app).get('/api/auth/usuarios').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.usuarios).toEqual([
      { id: 1, usuario: 'maria', nome: 'Maria', perfil: 'gestor', ativo: 1 },
      { id: 2, usuario: 'joao', nome: 'Joao', perfil: 'dono', ativo: 0 },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/senha/i);
  });
});
