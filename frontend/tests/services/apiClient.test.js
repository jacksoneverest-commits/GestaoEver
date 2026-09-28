import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiGet, apiPost, apiPut } from '../../src/services/apiClient.js';

function respostaJson(status, corpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

describe('apiClient.apiGet', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'abc123');
    window.location.hash = '#/vendas';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('envia o token Bearer e os parâmetros na query, ignorando vazios', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const dados = await apiGet('/api/vendas/faturamento', { inicio: '2026-09-01', fim: '2026-09-07', id: '', nivel: undefined });

    expect(dados).toEqual({ ok: true });
    const [url, opcoes] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/vendas\/faturamento\?inicio=2026-09-01&fim=2026-09-07$/);
    expect(opcoes.headers.Authorization).toBe('Bearer abc123');
  });

  it('em 401 limpa o token, volta ao login e lança erro de sessão expirada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(401, { erro: 'Sessão inválida ou expirada.' })));

    await expect(apiGet('/api/vendas/faturamento')).rejects.toThrow('Sessão expirada');

    expect(localStorage.getItem('token')).toBeNull();
    expect(window.location.hash).toBe('#/login');
  });

  it('em erro do backend lança a mensagem { erro } recebida', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(400, { erro: 'O período máximo permitido é de 366 dias.' })));

    await expect(apiGet('/api/vendas/faturamento')).rejects.toThrow('O período máximo permitido é de 366 dias.');
  });

  it('quando a rede falha lança mensagem clara de conexão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiGet('/api/vendas/faturamento')).rejects.toThrow('Não foi possível conectar ao servidor');
  });
});

describe('apiClient.apiGet — status do erro', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'abc123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('expõe o status HTTP no erro lançado (ex: 503 e 501)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(503, { erro: 'Cache não cobre o período.' })));

    await expect(apiGet('/api/ranking-produtos')).rejects.toMatchObject({
      message: 'Cache não cobre o período.',
      status: 503,
    });
  });
});

describe.each([
  ['apiPost', apiPost, 'POST'],
  ['apiPut', apiPut, 'PUT'],
])('apiClient.%s', (_nome, chamar, metodoEsperado) => {
  beforeEach(() => {
    localStorage.setItem('token', 'abc123');
    window.location.hash = '#/usuarios';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('envia o token Bearer, o método e o corpo em JSON, devolvendo o corpo da resposta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const dados = await chamar('/api/auth/usuarios', { usuario: 'joao', senha: '123456' });

    expect(dados).toEqual({ ok: true });
    const [url, opcoes] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/usuarios$/);
    expect(opcoes.method).toBe(metodoEsperado);
    expect(opcoes.headers.Authorization).toBe('Bearer abc123');
    expect(opcoes.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opcoes.body)).toEqual({ usuario: 'joao', senha: '123456' });
  });

  it('em 401 limpa o token, volta ao login e lança erro de sessão expirada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(401, { erro: 'Sessão inválida ou expirada.' })));

    await expect(chamar('/api/auth/usuarios', {})).rejects.toThrow('Sessão expirada');

    expect(localStorage.getItem('token')).toBeNull();
    expect(window.location.hash).toBe('#/login');
  });

  it('em erro do backend lança a mensagem { erro } recebida, com o status exposto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(400, { erro: 'Campo obrigatório ausente.' })));

    await expect(chamar('/api/auth/usuarios', {})).rejects.toMatchObject({
      message: 'Campo obrigatório ausente.',
      status: 400,
    });
  });

  it('quando a rede falha lança mensagem clara de conexão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(chamar('/api/auth/usuarios', {})).rejects.toThrow('Não foi possível conectar ao servidor');
  });
});
