export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const TOKEN_KEY = 'token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
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
    resposta = await fetch(`${API_URL}/api/auth/login`, {
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
