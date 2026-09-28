import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  obterRanking,
  obterProdutosParados,
  obterProdutosNovos,
  obterDemandaBaixoEstoque,
} from '../../src/services/rankingProdutosService.js';
import { apiGet } from '../../src/services/apiClient.js';

vi.mock('../../src/services/apiClient.js');

const periodo = { inicio: '2026-08-25', fim: '2026-09-23' };

describe('rankingProdutosService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue({ itens: [] });
  });

  it('obterRanking chama GET /api/ranking-produtos com criterio, inicio e fim', async () => {
    const resultado = await obterRanking({ criterio: 'vendas', ...periodo });

    expect(apiGet).toHaveBeenCalledWith('/api/ranking-produtos', { criterio: 'vendas', ...periodo });
    expect(resultado).toEqual({ itens: [] });
  });

  it('obterRanking envia ordenarPor apenas no critério margem', async () => {
    await obterRanking({ criterio: 'margem', ...periodo, ordenarPor: 'margemPercentual' });

    expect(apiGet).toHaveBeenCalledWith('/api/ranking-produtos', {
      criterio: 'margem',
      ...periodo,
      ordenarPor: 'margemPercentual',
    });
  });

  it('obterRanking não envia ordenarPor fora do critério margem', async () => {
    await obterRanking({ criterio: 'faturamento', ...periodo, ordenarPor: 'lucro' });

    const [, parametros] = apiGet.mock.calls[0];
    expect(parametros).not.toHaveProperty('ordenarPor');
  });

  it('obterRanking repassa o limite quando informado', async () => {
    await obterRanking({ criterio: 'queda', ...periodo, limite: 20 });

    expect(apiGet).toHaveBeenCalledWith('/api/ranking-produtos', { criterio: 'queda', ...periodo, limite: 20 });
  });

  it('obterProdutosParados e obterProdutosNovos chamam seus endpoints com o período', async () => {
    await obterProdutosParados(periodo);
    await obterProdutosNovos(periodo);

    expect(apiGet).toHaveBeenNthCalledWith(1, '/api/ranking-produtos/parados', periodo);
    expect(apiGet).toHaveBeenNthCalledWith(2, '/api/ranking-produtos/novos', periodo);
  });

  it('obterDemandaBaixoEstoque chama seu endpoint repassando o período e o limite', async () => {
    const resposta = { ...periodo, limite: 10, itens: [] };
    apiGet.mockResolvedValue(resposta);

    const resultado = await obterDemandaBaixoEstoque({ ...periodo, limite: 10 });

    expect(apiGet).toHaveBeenCalledWith('/api/ranking-produtos/demanda-baixo-estoque', { ...periodo, limite: 10 });
    expect(resultado).toEqual(resposta);
  });

  it('obterDemandaBaixoEstoque não envia limite quando não informado', async () => {
    await obterDemandaBaixoEstoque(periodo);

    expect(apiGet).toHaveBeenCalledWith('/api/ranking-produtos/demanda-baixo-estoque', periodo);
  });
});
