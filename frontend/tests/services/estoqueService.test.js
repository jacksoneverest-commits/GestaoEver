import { beforeEach, describe, expect, it, vi } from 'vitest';
import { obterCobertura, obterNiveis, obterParados } from '../../src/services/estoqueService.js';
import { apiGet } from '../../src/services/apiClient.js';

vi.mock('../../src/services/apiClient.js');

const periodo = { inicio: '2026-08-25', fim: '2026-09-23' };

describe('estoqueService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue({ itens: [] });
  });

  it('obterNiveis chama GET /api/estoque/niveis só com o período quando nada mais é informado e devolve a resposta', async () => {
    const resposta = { resumo: { ruptura: 1, proximoRuptura: 2, excesso: 3 }, itens: [] };
    apiGet.mockResolvedValue(resposta);

    const resultado = await obterNiveis(periodo);

    expect(apiGet).toHaveBeenCalledWith('/api/estoque/niveis', periodo);
    expect(resultado).toBe(resposta);
  });

  it('obterNiveis envia nivel, id, classificacao e limite quando informados', async () => {
    await obterNiveis({ ...periodo, nivel: 'setor', id: 4, classificacao: 'proximo_ruptura', limite: 25 });

    expect(apiGet).toHaveBeenCalledWith('/api/estoque/niveis', {
      ...periodo,
      nivel: 'setor',
      id: 4,
      classificacao: 'proximo_ruptura',
      limite: 25,
    });
  });

  it('obterNiveis não envia parâmetros ausentes (undefined ou null)', async () => {
    await obterNiveis({ ...periodo, nivel: undefined, id: null, classificacao: undefined, limite: undefined });

    const [, parametros] = apiGet.mock.calls[0];
    expect(Object.keys(parametros).sort()).toEqual(['fim', 'inicio']);
  });

  it('obterCobertura chama GET /api/estoque/cobertura repassando período, departamento e limite', async () => {
    await obterCobertura({ ...periodo, nivel: 'familia', id: 9, limite: 50 });

    expect(apiGet).toHaveBeenCalledWith('/api/estoque/cobertura', { ...periodo, nivel: 'familia', id: 9, limite: 50 });
  });

  it('obterCobertura não envia parâmetros ausentes', async () => {
    await obterCobertura(periodo);

    expect(apiGet).toHaveBeenCalledWith('/api/estoque/cobertura', periodo);
  });

  it('obterParados chama GET /api/estoque/parados repassando período, departamento e limite', async () => {
    await obterParados({ ...periodo, nivel: 'grupo', id: 2, limite: 10 });

    expect(apiGet).toHaveBeenCalledWith('/api/estoque/parados', { ...periodo, nivel: 'grupo', id: 2, limite: 10 });
  });

  it('obterParados não envia parâmetros ausentes', async () => {
    await obterParados(periodo);

    expect(apiGet).toHaveBeenCalledWith('/api/estoque/parados', periodo);
  });

  it('propaga o erro do apiClient (com o status HTTP) para a tela tratar', async () => {
    const erro = Object.assign(new Error('Cache não preparado.'), { status: 503 });
    apiGet.mockRejectedValue(erro);

    await expect(obterNiveis(periodo)).rejects.toBe(erro);
    await expect(obterCobertura(periodo)).rejects.toBe(erro);
    await expect(obterParados(periodo)).rejects.toBe(erro);
  });
});
