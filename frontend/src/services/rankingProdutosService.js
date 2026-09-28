import { apiGet } from './apiClient.js';

// GET /api/ranking-produtos?criterio=vendas|faturamento|margem|crescimento|queda&inicio&fim[&limite][&ordenarPor]
// -> { criterio, limite, itens: [...] } (campos de cada item variam conforme o critério).
// `ordenarPor` (lucro|margemPercentual) só é enviado no critério margem.
export function obterRanking({ criterio, inicio, fim, limite, ordenarPor }) {
  const parametros = { criterio, inicio, fim };
  if (limite !== undefined) parametros.limite = limite;
  if (criterio === 'margem' && ordenarPor !== undefined) parametros.ordenarPor = ordenarPor;
  return apiGet('/api/ranking-produtos', parametros);
}

// GET /api/ranking-produtos/parados -> { inicio, fim, limite, itens: [{ id, nome }] }
export function obterProdutosParados({ inicio, fim, limite }) {
  const parametros = { inicio, fim };
  if (limite !== undefined) parametros.limite = limite;
  return apiGet('/api/ranking-produtos/parados', parametros);
}

// GET /api/ranking-produtos/novos -> { inicio, fim, fimSolicitado, limite, itens: [{ id, nome, primeiraVenda, quantidade, faturamento }] }
export function obterProdutosNovos({ inicio, fim, limite }) {
  const parametros = { inicio, fim };
  if (limite !== undefined) parametros.limite = limite;
  return apiGet('/api/ranking-produtos/novos', parametros);
}

// GET /api/ranking-produtos/demanda-baixo-estoque?inicio&fim[&limite] (limite 1-500)
// -> { inicio, fim, limite, itens: [{ id, nome, quantidadeVendida, mediaDiaria, estoqueAtual, estoqueMinimo,
//    estoqueMaximo, coberturaDias, motivo }] }, do mais urgente (menor cobertura) ao menos urgente; sem `posicao`.
export function obterDemandaBaixoEstoque({ inicio, fim, limite }) {
  const parametros = { inicio, fim };
  if (limite !== undefined) parametros.limite = limite;
  return apiGet('/api/ranking-produtos/demanda-baixo-estoque', parametros);
}
