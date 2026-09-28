jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const createApp = require('../../../src/app');
const { hashSenha } = require('../../../src/modules/auth/auth.crypto');
const { verificarToken } = require('../../../src/modules/auth/auth.token');

const SENHA_CORRETA = 'senha-correta-123';
const MENSAGEM_INVALIDO = { erro: 'Usuário ou senha inválidos.' };

async function montarUsuario(sobrescrever = {}) {
  return {
    id: 7,
    usuario: 'maria',
    nome: 'Maria',
    senha_hash: await hashSenha(SENHA_CORRETA),
    perfil: 'gestor',
    ativo: 1,
    ...sobrescrever,
  };
}

describe('POST /api/auth/login', () => {
  let execute;
  let envOriginal;
  let errorSpy;
  let app;

  beforeEach(() => {
    envOriginal = { ...process.env };
    process.env.AUTH_SECRET = 'segredo-de-teste-para-hmac-com-32-caracteres-ou-mais';
    execute = jest.fn();
    getPool.mockReturnValue({ execute });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createApp();
  });

  afterEach(() => {
    process.env = envOriginal;
    errorSpy.mockRestore();
    getPool.mockReset();
  });

  it('com credenciais válidas retorna 200 e um token', async () => {
    execute.mockResolvedValue([[await montarUsuario()], []]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'maria', senha: SENHA_CORRETA });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(Object.keys(res.body)).toEqual(['token']);
    expect(verificarToken(res.body.token)).toEqual(
      expect.objectContaining({ sub: 7, usuario: 'maria', perfil: 'gestor' })
    );
    // consulta parametrizada: o usuário vai como parâmetro, nunca concatenado no SQL
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('?');
    expect(sql).not.toContain('maria');
    expect(params).toEqual(['maria']);
  });

  it('com credenciais inválidas retorna 401 com a mesma resposta para usuário inexistente, senha errada e usuário inativo', async () => {
    execute.mockResolvedValueOnce([[], []]); // usuário inexistente
    const inexistente = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'fantasma', senha: SENHA_CORRETA });

    execute.mockResolvedValueOnce([[await montarUsuario()], []]); // senha errada
    const senhaErrada = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'maria', senha: 'outra-senha' });

    execute.mockResolvedValueOnce([[await montarUsuario({ ativo: 0 })], []]); // inativo, senha correta
    const inativo = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'maria', senha: SENHA_CORRETA });

    for (const res of [inexistente, senhaErrada, inativo]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(MENSAGEM_INVALIDO);
    }
  });

  it('retorna 400 quando usuário ou senha estão ausentes ou não são texto', async () => {
    const semSenha = await request(app).post('/api/auth/login').send({ usuario: 'maria' });
    const tipoInvalido = await request(app)
      .post('/api/auth/login')
      .send({ usuario: { $ne: '' }, senha: 123 });

    for (const res of [semSenha, tipoInvalido]) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: 'Informe usuário e senha.' });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('faz trim do usuário antes de consultar e retorna 400 se ele ficar vazio após o trim', async () => {
    execute.mockResolvedValue([[await montarUsuario()], []]);

    const comEspacos = await request(app)
      .post('/api/auth/login')
      .send({ usuario: '  maria ', senha: SENHA_CORRETA });
    const soEspacos = await request(app)
      .post('/api/auth/login')
      .send({ usuario: '   ', senha: SENHA_CORRETA });

    expect(comEspacos.status).toBe(200);
    expect(execute.mock.calls[0][1]).toEqual(['maria']);
    expect(soEspacos.status).toBe(400);
    expect(soEspacos.body).toEqual({ erro: 'Informe usuário e senha.' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retorna 400 { erro } sem stack trace quando o corpo JSON é malformado', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"usuario":');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ erro: 'Requisição inválida.' });
    expect(res.text).not.toMatch(/SyntaxError|at .*\(.*:\d+:\d+\)|node_modules/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('retorna 500 genérico, sem vazar o erro do banco, quando a consulta falha', async () => {
    const erroBruto = new Error("Access denied for user 'root'@'localhost' senha-super-secreta");
    erroBruto.code = 'ER_ACCESS_DENIED_ERROR';
    execute.mockRejectedValue(erroBruto);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'maria', senha: SENHA_CORRETA });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    const logado = JSON.stringify(errorSpy.mock.calls);
    expect(logado).not.toContain('senha-super-secreta');
    expect(logado).not.toContain(SENHA_CORRETA);
  });
});
