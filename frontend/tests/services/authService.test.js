import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getToken, getUsuarioAtual, login, logout } from '../../src/services/authService.js';

function respostaJson(status, corpo) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) };
}

describe('authService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login guarda o token retornado e logout o remove', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(200, { token: 'tok123' }));
    vi.stubGlobal('fetch', fetchMock);

    await login({ usuario: 'gestor', senha: 'segredo' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ usuario: 'gestor', senha: 'segredo' }) })
    );
    expect(getToken()).toBe('tok123');
    logout();
    expect(getToken()).toBeNull();
  });

  it('login usa a URL salva em runtime', async () => {
    localStorage.setItem('apiUrl', 'http://outro:4000');
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(200, { token: 't' }));
    vi.stubGlobal('fetch', fetchMock);

    await login({ usuario: 'a', senha: 'b' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://outro:4000/api/auth/login');
  });

  it('login lança erro com a mensagem do backend e não guarda token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(401, { erro: 'Usuário ou senha inválidos.' })));

    await expect(login({ usuario: 'x', senha: 'y' })).rejects.toThrow('Usuário ou senha inválidos.');
    expect(getToken()).toBeNull();
  });

  it('getUsuarioAtual lê o nome de usuário do payload do token (só para exibição)', () => {
    const payload = btoa(JSON.stringify({ sub: 1, usuario: 'gestor', perfil: 'gestor' })).replace(/=+$/, '');
    localStorage.setItem('token', payload + '.assinatura');

    expect(getUsuarioAtual()).toBe('gestor');
  });

  it('getUsuarioAtual devolve null sem token ou com token malformado', () => {
    expect(getUsuarioAtual()).toBeNull();
    localStorage.setItem('token', 'lixo');
    expect(getUsuarioAtual()).toBeNull();
  });
});
