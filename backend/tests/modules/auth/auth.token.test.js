const { gerarToken, verificarToken } = require('../../../src/modules/auth/auth.token');

describe('auth.token', () => {
  let envOriginal;

  beforeEach(() => {
    envOriginal = { ...process.env };
    process.env.AUTH_SECRET = 'segredo-de-teste-para-hmac-com-32-caracteres-ou-mais';
  });

  afterEach(() => {
    process.env = envOriginal;
    jest.useRealTimers();
  });

  it('gera token verificável com payload { sub, usuario, perfil, exp } expirando em 8h', () => {
    const agora = Math.floor(Date.now() / 1000);
    const token = gerarToken({ id: 3, usuario: 'joao', perfil: 'dono' });

    const payload = verificarToken(token);

    expect(payload).toEqual({ sub: 3, usuario: 'joao', perfil: 'dono', exp: expect.any(Number) });
    expect(payload.exp - agora).toBeGreaterThanOrEqual(8 * 3600 - 2);
    expect(payload.exp - agora).toBeLessThanOrEqual(8 * 3600 + 2);
  });

  it('rejeita token expirado, adulterado ou assinado com outro segredo', () => {
    const token = gerarToken({ id: 3, usuario: 'joao', perfil: 'dono' });
    const assinatura = token.split('.')[1];
    const payloadForjado = Buffer.from(
      JSON.stringify({ sub: 1, usuario: 'joao', perfil: 'dono', exp: 9999999999 })
    ).toString('base64url');
    const adulterado = `${payloadForjado}.${assinatura}`;

    expect(verificarToken(adulterado)).toBeNull();
    expect(verificarToken('lixo')).toBeNull();

    process.env.AUTH_SECRET = 'outro-segredo-de-teste-com-32-caracteres-ou-mais';
    expect(verificarToken(token)).toBeNull();
    process.env.AUTH_SECRET = 'segredo-de-teste-para-hmac-com-32-caracteres-ou-mais';

    jest.useFakeTimers().setSystemTime(Date.now() + 8 * 3600 * 1000 + 5000);
    expect(verificarToken(token)).toBeNull(); // expirado
  });

  it('falha com erro claro, sem expor segredo, quando AUTH_SECRET está ausente', () => {
    delete process.env.AUTH_SECRET;

    expect(() => gerarToken({ id: 1, usuario: 'a', perfil: 'dono' })).toThrow(/AUTH_SECRET/);
    expect(() => verificarToken('a.b')).toThrow(/AUTH_SECRET/);
  });

  it('rejeita AUTH_SECRET com menos de 32 caracteres, sem expor o valor na mensagem', () => {
    const curto = 'segredo-curto-123';
    process.env.AUTH_SECRET = curto;

    expect(() => gerarToken({ id: 1, usuario: 'a', perfil: 'dono' })).toThrow(/32 caracteres/);
    expect(() => verificarToken('a.b')).toThrow(/32 caracteres/);
    try {
      gerarToken({ id: 1, usuario: 'a', perfil: 'dono' });
    } catch (erro) {
      expect(erro.name).toBe('ErroConfiguracaoAuth');
      expect(erro.message).not.toContain(curto);
    }
  });
});
