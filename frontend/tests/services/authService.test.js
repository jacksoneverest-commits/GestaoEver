import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getToken, login, logout } from '../../src/services/authService.js';

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

  it('login lança erro com a mensagem do backend e não guarda token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(401, { erro: 'Usuário ou senha inválidos.' })));

    await expect(login({ usuario: 'x', senha: 'y' })).rejects.toThrow('Usuário ou senha inválidos.');
    expect(getToken()).toBeNull();
  });
});
