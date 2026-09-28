import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  obterVendasPorHora,
  obterVendasPorDiaSemana,
  obterVendasPorFormaPagamento,
  obterVendasPorDepartamento,
} from '../../src/services/vendasGraficosService.js';
import { apiGet } from '../../src/services/apiClient.js';

vi.mock('../../src/services/apiClient.js', () => ({ apiGet: vi.fn() }));

const periodo = { inicio: '2026-03-01', fim: '2026-03-31' };

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({});
});

describe('vendasGraficosService', () => {
  it('consulta os endpoints de hora, dia da semana e forma de pagamento com o período', async () => {
    await obterVendasPorHora(periodo);
    await obterVendasPorDiaSemana(periodo);
    await obterVendasPorFormaPagamento(periodo);

    expect(apiGet).toHaveBeenNthCalledWith(1, '/api/vendas/por-hora', periodo);
    expect(apiGet).toHaveBeenNthCalledWith(2, '/api/vendas/por-dia-semana', periodo);
    expect(apiGet).toHaveBeenNthCalledWith(3, '/api/vendas/por-forma-pagamento', periodo);
  });

  it('consulta por departamento enviando nivel e id opcional', async () => {
    await obterVendasPorDepartamento({ ...periodo, nivel: 'setor', id: 4 });

    expect(apiGet).toHaveBeenCalledWith('/api/vendas/por-departamento', { ...periodo, nivel: 'setor', id: 4 });
  });

  it('propaga o erro lançado pelo apiClient', async () => {
    apiGet.mockRejectedValue(new Error('Erro ao consultar o servidor. Tente novamente.'));

    await expect(obterVendasPorHora(periodo)).rejects.toThrow('Erro ao consultar o servidor');
  });
});
