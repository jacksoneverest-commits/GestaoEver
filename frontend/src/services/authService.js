import { getApiUrl } from './apiUrlService.js';

const TOKEN_KEY = 'token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// Nome de usuário lido do payload do token, apenas para exibição (avatar). Não valida assinatura:
// a autorização é sempre do backend.
export function getUsuarioAtual() {
  const token = getToken();
  if (!token) return null;
  try {
    const base64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return typeof payload.usuario === 'string' && payload.usuario ? payload.usuario : null;
  } catch {
    return null;
  }
}

export function logout() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // armazenamento indisponível: nada a remover
  }
}

export async function login({ usuario, senha }) {
  let resposta;
  try {
    resposta = await fetch(`${getApiUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Tente novamente.');
  }

  let corpo = {};
  try {
    corpo = await resposta.json();
  } catch {
    // resposta sem corpo JSON
  }

  if (!resposta.ok) {
    throw new Error(corpo.erro || 'Erro ao fazer login. Tente novamente.');
  }
  if (!corpo.token) {
    throw new Error('Resposta inválida do servidor.');
  }

  try {
    localStorage.setItem(TOKEN_KEY, corpo.token);
  } catch {
    throw new Error('Não foi possível salvar a sessão neste navegador.');
  }
  return { token: corpo.token };
}
