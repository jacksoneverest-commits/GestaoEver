import { beforeEach, describe, expect, it, vi } from 'vitest';
import { obterFaturamento } from '../../src/services/vendasService.js';
import { apiGet } from '../../src/services/apiClient.js';

vi.mock('../../src/services/apiClient.js');

describe('vendasService', () => {
  beforeEach(() => vi.resetAllMocks());

  it('obterFaturamento chama GET /api/vendas/faturamento com inicio e fim', async () => {
    apiGet.mockResolvedValue({ faturamento: 10 });

    const resultado = await obterFaturamento({ inicio: '2026-09-01', fim: '2026-09-24' });

    expect(apiGet).toHaveBeenCalledWith('/api/vendas/faturamento', { inicio: '2026-09-01', fim: '2026-09-24' });
    expect(resultado).toEqual({ faturamento: 10 });
  });
});
