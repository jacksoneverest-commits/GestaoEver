import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiUrl, normalizarApiUrl, setApiUrl, validarServidor } from '../../src/services/apiUrlService.js';

const respostaOk = (corpo = { status: 'ok' }) => ({ ok: true, status: 200, json: async () => corpo });

describe('apiUrlService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('getApiUrl devolve a URL salva, senão VITE_API_URL, senão http://localhost:3001', () => {
    expect(getApiUrl()).toBe('http://localhost:3001');

    vi.stubEnv('VITE_API_URL', 'http://env:3001');
    expect(getApiUrl()).toBe('http://env:3001');

    localStorage.setItem('apiUrl', 'http://salva:3001');
    expect(getApiUrl()).toBe('http://salva:3001');
  });

  it('getApiUrl ignora valor adulterado no localStorage e cai no padrão', () => {
    localStorage.setItem('apiUrl', 'javascript:alert(1)');
    expect(getApiUrl()).toBe('http://localhost:3001');

    vi.stubEnv('VITE_API_URL', 'http://env:3001');
    localStorage.setItem('apiUrl', 'http://a b/c');
    expect(getApiUrl()).toBe('http://env:3001');
  });

  it('setApiUrl normaliza a URL (remove / final) e rejeita valor que não seja http(s)://', () => {
    expect(setApiUrl('http://servidor:3001/')).toBe('http://servidor:3001');
    expect(getApiUrl()).toBe('http://servidor:3001');

    expect(() => setApiUrl('ftp://servidor')).toThrow();
    expect(() => setApiUrl('servidor:3001')).toThrow();
    expect(getApiUrl()).toBe('http://servidor:3001');
  });

  it('normalizarApiUrl rejeita URL com espaço no host', () => {
    expect(() => normalizarApiUrl('http://a b/c')).toThrow(/inválida/);
  });

  it('normalizarApiUrl descarta search e hash e remove a / final', () => {
    expect(normalizarApiUrl('http://host?x=1')).toBe('http://host');
    expect(normalizarApiUrl('https://host:8080/api/?x=1#topo')).toBe('https://host:8080/api');
    expect(() => normalizarApiUrl('http://')).toThrow();
  });

  it('validarServidor consulta GET {url}/health e falha quando o servidor está inacessível', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk());
    vi.stubGlobal('fetch', fetchMock);
    await validarServidor('http://servidor:3001');
    expect(fetchMock.mock.calls[0][0]).toBe('http://servidor:3001/health');
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(validarServidor('http://servidor:3001')).rejects.toThrow(/inacessível/);
  });

  it('validarServidor falha por timeout quando o servidor não responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url, { signal }) => new Promise((_, rejeitar) => {
        signal.addEventListener('abort', () => rejeitar(new DOMException('Aborted', 'AbortError')));
      }))
    );
    const controlador = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controlador.signal);
    const verificacao = expect(validarServidor('http://servidor:3001')).rejects.toThrow(/inacessível/);
    controlador.abort();
    await verificacao;
    expect(timeoutSpy).toHaveBeenCalledWith(8000);
    timeoutSpy.mockRestore();
  });

  it('validarServidor rejeita corpo sem status ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaOk({ status: 'erro' })));
    await expect(validarServidor('http://servidor:3001')).rejects.toThrow(/não parece ser o servidor/);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('html'); } }));
    await expect(validarServidor('http://servidor:3001')).rejects.toThrow(/não parece ser o servidor/);
  });
});
