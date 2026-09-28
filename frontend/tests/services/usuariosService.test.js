import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  criarUsuario,
  listarUsuarios,
  resetarSenha,
  trocarMinhaSenha,
} from '../../src/services/usuariosService.js';
import { apiGet, apiPost, apiPut } from '../../src/services/apiClient.js';

vi.mock('../../src/services/apiClient.js');

describe('usuariosService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('listarUsuarios chama GET /api/auth/usuarios e devolve a resposta', async () => {
    const resposta = { usuarios: [{ id: 1, usuario: 'joao', nome: 'João', perfil: 'gestor', ativo: true }] };
    apiGet.mockResolvedValue(resposta);

    const resultado = await listarUsuarios();

    expect(apiGet).toHaveBeenCalledWith('/api/auth/usuarios');
    expect(resultado).toBe(resposta);
  });

  it('criarUsuario chama POST /api/auth/usuarios com usuario, nome, senha e perfil', async () => {
    const usuarioCriado = { id: 2, usuario: 'maria', nome: 'Maria', perfil: 'dono', ativo: true };
    apiPost.mockResolvedValue(usuarioCriado);

    const resultado = await criarUsuario({ usuario: 'maria', nome: 'Maria', senha: 'segredo123', perfil: 'dono' });

    expect(apiPost).toHaveBeenCalledWith('/api/auth/usuarios', {
      usuario: 'maria',
      nome: 'Maria',
      senha: 'segredo123',
      perfil: 'dono',
    });
    expect(resultado).toBe(usuarioCriado);
  });

  it('resetarSenha chama PUT /api/auth/usuarios/:id/senha com senhaNova, sem exigir a senha atual', async () => {
    apiPut.mockResolvedValue({});

    await resetarSenha({ id: 7, senhaNova: 'novaSenha123' });

    expect(apiPut).toHaveBeenCalledWith('/api/auth/usuarios/7/senha', { senhaNova: 'novaSenha123' });
  });

  it('trocarMinhaSenha chama PUT /api/auth/senha com senhaAtual e senhaNova', async () => {
    apiPut.mockResolvedValue({});

    await trocarMinhaSenha({ senhaAtual: 'antiga123', senhaNova: 'nova12345' });

    expect(apiPut).toHaveBeenCalledWith('/api/auth/senha', { senhaAtual: 'antiga123', senhaNova: 'nova12345' });
  });

  it('propaga o erro do apiClient (com o status HTTP) para a tela tratar', async () => {
    const erro = Object.assign(new Error('Senha atual incorreta.'), { status: 400 });
    apiPut.mockRejectedValue(erro);
    apiGet.mockRejectedValue(erro);
    apiPost.mockRejectedValue(erro);

    await expect(listarUsuarios()).rejects.toBe(erro);
    await expect(criarUsuario({ usuario: 'x', nome: 'X', senha: '123456', perfil: 'dono' })).rejects.toBe(erro);
    await expect(resetarSenha({ id: 1, senhaNova: '123456' })).rejects.toBe(erro);
    await expect(trocarMinhaSenha({ senhaAtual: 'errada', senhaNova: '123456' })).rejects.toBe(erro);
  });
});
