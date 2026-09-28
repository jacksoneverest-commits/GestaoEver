import { apiGet } from './apiClient.js';

// GET /api/vendas/faturamento?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
// -> { faturamento, ticketMedio, quantidadeCupons, itensPorCompra, comparativoPeriodoAnterior }
export function obterFaturamento({ inicio, fim }) {
  return apiGet('/api/vendas/faturamento', { inicio, fim });
}
