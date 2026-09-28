jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));

const ENV_VARS = {
  DB_HOST: 'host-teste',
  DB_USER: 'usuario-teste',
  DB_PASSWORD: 'senha-super-secreta',
  DB_NAME: 'banco-teste',
};

function carregarConnection() {
  return require('../../src/db/connection');
}

describe('db/connection', () => {
  let mysql;
  let envOriginal;
  let errorSpy;

  beforeEach(() => {
    jest.resetModules();
    // após resetModules, a instância do mock muda: obter a mesma que connection.js vai usar
    mysql = require('mysql2/promise');
    mysql.createPool.mockReset();
    envOriginal = { ...process.env };
    Object.assign(process.env, ENV_VARS);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = envOriginal;
    errorSpy.mockRestore();
  });

  it('com credenciais válidas, retorna uma pool que executa SELECT 1 com sucesso', async () => {
    const poolFalso = { query: jest.fn().mockResolvedValue([[{ 1: 1 }], []]) };
    mysql.createPool.mockReturnValue(poolFalso);
    const { getPool, testConnection } = carregarConnection();

    const pool = getPool();
    const [linhas] = await pool.query('SELECT 1');

    expect(linhas).toEqual([{ 1: 1 }]);
    expect(mysql.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        host: ENV_VARS.DB_HOST,
        user: ENV_VARS.DB_USER,
        password: ENV_VARS.DB_PASSWORD,
        database: ENV_VARS.DB_NAME,
      })
    );
    await expect(testConnection()).resolves.toBe(true);
    expect(getPool()).toBe(pool);
  });

  it('com credenciais inválidas, lança erro tratado com mensagem clara sem vazar detalhes do MariaDB', async () => {
    const erroBruto = new Error(
      "Access denied for user 'usuario-teste'@'localhost' (using password: YES) senha-super-secreta"
    );
    erroBruto.code = 'ER_ACCESS_DENIED_ERROR';
    mysql.createPool.mockReturnValue({ query: jest.fn().mockRejectedValue(erroBruto) });
    const { testConnection } = carregarConnection();

    let erro;
    try {
      await testConnection();
    } catch (e) {
      erro = e;
    }

    expect(erro).toBeDefined();
    expect(erro.message).toMatch(/banco de dados/i);
    expect(erro.message).not.toMatch(/Access denied/i);
    expect(erro.message).not.toContain(ENV_VARS.DB_PASSWORD);
    const logado = JSON.stringify(errorSpy.mock.calls);
    expect(logado).not.toContain(ENV_VARS.DB_PASSWORD);
  });

  it('lança erro claro citando a variável ausente, sem criar a pool', () => {
    delete process.env.DB_NAME;
    const { getPool } = carregarConnection();

    expect(() => getPool()).toThrow(/DB_NAME/);
    expect(mysql.createPool).not.toHaveBeenCalled();
  });
});
