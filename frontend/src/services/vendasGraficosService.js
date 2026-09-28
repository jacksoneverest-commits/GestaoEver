import { apiGet } from './apiClient.js';

// Services dos gráficos do módulo Vendas (Task 6.2). Toda chamada HTTP passa por apiGet.

export function obterVendasPorHora({ inicio, fim }) {
  return apiGet('/api/vendas/por-hora', { inicio, fim });
}

export function obterVendasPorDiaSemana({ inicio, fim }) {
  return apiGet('/api/vendas/por-dia-semana', { inicio, fim });
}

export function obterVendasPorFormaPagamento({ inicio, fim }) {
  return apiGet('/api/vendas/por-forma-pagamento', { inicio, fim });
}

// nivel: 'grupo' | 'setor' | 'familia'. Sem id: uma linha por departamento;
// com id: produtos daquele departamento.
export function obterVendasPorDepartamento({ inicio, fim, nivel, id }) {
  return apiGet('/api/vendas/por-departamento', { inicio, fim, nivel, id });
}
