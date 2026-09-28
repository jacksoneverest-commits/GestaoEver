jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

describe('auth.service autenticarUsuario', () => {
  let errorSpy;

  beforeEach(() => {
    jest.resetModules();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('não mantém em cache uma rejeição do hash falso: usuário inexistente volta a receber null na tentativa seguinte', async () => {
    const cryptoReal = jest.requireActual('../../../src/modules/auth/auth.crypto');
    const hashSenha = jest
      .fn()
      .mockRejectedValueOnce(new Error('falha pontual do scrypt'))
      .mockImplementation(cryptoReal.hashSenha);
    jest.doMock('../../../src/modules/auth/auth.crypto', () => ({
      hashSenha,
      verificarSenha: cryptoReal.verificarSenha,
    }));
    const { getPool } = require('../../../src/db/connection');
    getPool.mockReturnValue({ execute: jest.fn().mockResolvedValue([[], []]) });
    const { autenticarUsuario } = require('../../../src/modules/auth/auth.service');

    await expect(autenticarUsuario('fantasma', 'qualquer')).rejects.toThrow();
    await expect(autenticarUsuario('fantasma', 'qualquer')).resolves.toBeNull();
  });
});
