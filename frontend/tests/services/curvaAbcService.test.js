import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listarItens, obterCurvaAbc } from '../../src/services/curvaAbcService.js';
import { apiGet } from '../../src/services/apiClient.js';

vi.mock('../../src/services/apiClient.js');

const periodo = { inicio: '2026-08-25', fim: '2026-09-23' };

describe('curvaAbcService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue({ itens: [] });
  });

  it('obterCurvaAbc chama GET /api/curva-abc com inicio, fim e agrupador e devolve a resposta', async () => {
    const resultado = await obterCurvaAbc({ ...periodo, agrupador: 'setor' });

    expect(apiGet).toHaveBeenCalledWith('/api/curva-abc', { ...periodo, agrupador: 'setor' });
    expect(resultado).toEqual({ itens: [] });
  });

  it('obterCurvaAbc envia id e limite quando informados', async () => {
    await obterCurvaAbc({ ...periodo, agrupador: 'grupo', id: 7, limite: 250 });

    expect(apiGet).toHaveBeenCalledWith('/api/curva-abc', { ...periodo, agrupador: 'grupo', id: 7, limite: 250 });
  });

  it('obterCurvaAbc não envia id nem limite quando ausentes', async () => {
    await obterCurvaAbc({ ...periodo, agrupador: 'marca', id: undefined, limite: undefined });

    const [, parametros] = apiGet.mock.calls[0];
    expect(parametros).not.toHaveProperty('id');
    expect(parametros).not.toHaveProperty('limite');
  });

  it('listarItens chama GET /api/curva-abc/itens só com o agrupador quando não há busca nem limite', async () => {
    await listarItens({ agrupador: 'familia' });

    expect(apiGet).toHaveBeenCalledWith('/api/curva-abc/itens', { agrupador: 'familia' });
  });

  it('listarItens envia busca e limite quando informados', async () => {
    await listarItens({ agrupador: 'produto', busca: 'arroz', limite: 50 });

    expect(apiGet).toHaveBeenCalledWith('/api/curva-abc/itens', { agrupador: 'produto', busca: 'arroz', limite: 50 });
  });

  it('listarItens expõe totalItens e itens da resposta do backend sem alterá-los', async () => {
    const resposta = { agrupador: 'produto', busca: 'arroz', limite: 50, totalItens: 120, itens: [{ id: 1, nome: 'ARROZ' }] };
    apiGet.mockResolvedValue(resposta);

    const resultado = await listarItens({ agrupador: 'produto', busca: 'arroz', limite: 50 });

    expect(resultado.totalItens).toBe(120);
    expect(resultado.itens).toEqual([{ id: 1, nome: 'ARROZ' }]);
  });

  it('propaga o erro do apiClient (com o status HTTP) para a tela tratar', async () => {
    const erro = Object.assign(new Error('Escolha de fornecedor não suportada.'), { status: 400 });
    apiGet.mockRejectedValue(erro);

    await expect(obterCurvaAbc({ ...periodo, agrupador: 'fornecedor', id: 1 })).rejects.toBe(erro);
    await expect(listarItens({ agrupador: 'fornecedor' })).rejects.toBe(erro);
  });
});
