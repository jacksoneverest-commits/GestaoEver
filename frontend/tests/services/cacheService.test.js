import { beforeEach, describe, expect, it, vi } from 'vitest';
import { iniciarAtualizacao, obterStatusAtualizacao } from '../../src/services/cacheService.js';
import { apiGet, apiPost } from '../../src/services/apiClient.js';

vi.mock('../../src/services/apiClient.js');

describe('cacheService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('iniciarAtualizacao chama POST /api/cache/atualizar e devolve o status', async () => {
    const resposta = { situacao: 'rodando', iniciadoEm: '2026-10-09T10:00:00.000Z', finalizadoEm: null, ultimaAtualizacao: null };
    apiPost.mockResolvedValue(resposta);

    const resultado = await iniciarAtualizacao();

    expect(apiPost).toHaveBeenCalledWith('/api/cache/atualizar');
    expect(resultado).toBe(resposta);
  });

  it('obterStatusAtualizacao chama GET /api/cache/status e devolve o status', async () => {
    const resposta = { situacao: 'ok', iniciadoEm: null, finalizadoEm: null, ultimaAtualizacao: '2026-10-09' };
    apiGet.mockResolvedValue(resposta);

    const resultado = await obterStatusAtualizacao();

    expect(apiGet).toHaveBeenCalledWith('/api/cache/status');
    expect(resultado).toBe(resposta);
  });
});
