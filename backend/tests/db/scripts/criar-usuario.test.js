const { criarUsuario } = require('../../../src/db/scripts/criar-usuario');
const { verificarSenha } = require('../../../src/modules/auth/auth.crypto');

describe('db/scripts/criar-usuario', () => {
  it('insere o usuário com hash scrypt via query parametrizada e rejeita perfil inválido', async () => {
    const execute = jest.fn().mockResolvedValue([{ insertId: 1 }]);
    const pool = { execute };

    await criarUsuario(
      { usuario: 'maria', nome: 'Maria Silva', perfil: 'gestor', senha: 'senha-forte-123' },
      pool
    );

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO usuarios_gestao/i);
    expect(sql).not.toContain('maria');
    expect(params.slice(0, 2)).toEqual(['maria', 'Maria Silva']);
    expect(params).not.toContain('senha-forte-123');
    const hash = params.find((p) => typeof p === 'string' && p.startsWith('scrypt$'));
    await expect(verificarSenha('senha-forte-123', hash)).resolves.toBe(true);
    expect(params).toContain('gestor');

    await expect(
      criarUsuario({ usuario: 'x', nome: 'X', perfil: 'admin', senha: 'senha-forte-123' }, pool)
    ).rejects.toThrow(/perfil/i);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('faz trim do usuário antes de inserir e rejeita usuário vazio após o trim', async () => {
    const execute = jest.fn().mockResolvedValue([{ insertId: 2 }]);
    const pool = { execute };

    await criarUsuario(
      { usuario: '  joao  ', nome: 'Joao', perfil: 'dono', senha: 'senha-forte-123' },
      pool
    );
    expect(execute.mock.calls[0][1][0]).toBe('joao');

    await expect(
      criarUsuario({ usuario: '   ', nome: 'X', perfil: 'dono', senha: 'senha-forte-123' }, pool)
    ).rejects.toThrow(/usu[aá]rio/i);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
