import { apiGet, apiPost, apiPut } from './apiClient.js';

// GET /api/auth/usuarios -> { usuarios: [{ id, usuario, nome, perfil, ativo }, ...] } (nunca senha/hash).
export function listarUsuarios() {
  return apiGet('/api/auth/usuarios');
}

// POST /api/auth/usuarios { usuario, nome, senha, perfil } -> 201 com o usuário criado (sem senha/hash).
export function criarUsuario({ usuario, nome, senha, perfil }) {
  return apiPost('/api/auth/usuarios', { usuario, nome, senha, perfil });
}

// PUT /api/auth/usuarios/:id/senha { senhaNova } -> reseta a senha de outro usuário, sem exigir a senha atual.
export function resetarSenha({ id, senhaNova }) {
  return apiPut(`/api/auth/usuarios/${id}/senha`, { senhaNova });
}

// PUT /api/auth/senha { senhaAtual, senhaNova } -> troca a PRÓPRIA senha (id vem do token); 400 se senhaAtual errada
// (não 401: 401 é reservado a token ausente/inválido/expirado, que o apiClient trata deslogando o usuário).
export function trocarMinhaSenha({ senhaAtual, senhaNova }) {
  return apiPut('/api/auth/senha', { senhaAtual, senhaNova });
}
