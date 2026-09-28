const { hashSenha, verificarSenha } = require('../../../src/modules/auth/auth.crypto');

describe('auth.crypto', () => {
  it('gera hash scrypt com salt aleatório que só confere com a senha original', async () => {
    const hash1 = await hashSenha('minha-senha');
    const hash2 = await hashSenha('minha-senha');

    expect(hash1).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toContain('minha-senha');
    await expect(verificarSenha('minha-senha', hash1)).resolves.toBe(true);
    await expect(verificarSenha('outra-senha', hash1)).resolves.toBe(false);
    await expect(verificarSenha('minha-senha', 'formato-invalido')).resolves.toBe(false);
  });
});
