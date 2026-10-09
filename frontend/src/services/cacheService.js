import { apiGet, apiPost } from './apiClient.js';

// POST /api/cache/atualizar -> 202 { situacao, iniciadoEm, finalizadoEm, ultimaAtualizacao }
// Dispara em segundo plano a mesma rotina do job diário; se já houver uma rodando, devolve o status dela.
export function iniciarAtualizacao() {
  return apiPost('/api/cache/atualizar');
}

// GET /api/cache/status -> { situacao: 'ocioso'|'rodando'|'ok'|'falha', iniciadoEm, finalizadoEm, ultimaAtualizacao }
// ultimaAtualizacao é 'AAAA-MM-DD' (última execução bem-sucedida) ou null.
export function obterStatusAtualizacao() {
  return apiGet('/api/cache/status');
}
