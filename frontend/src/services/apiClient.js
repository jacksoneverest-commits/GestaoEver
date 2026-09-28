import { API_URL, getToken, logout } from './authService.js';

// Cliente HTTP das rotas autenticadas. Toda chamada aos módulos de dados passa por aqui
// (via os services em frontend/src/services/), nunca direto de um componente.
export async function apiGet(caminho, parametros = {}) {
  const query = new URLSearchParams();
  Object.entries(parametros).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && valor !== '') query.append(chave, valor);
  });
  const texto = query.toString();
  const url = `${API_URL}${caminho}${texto ? `?${texto}` : ''}`;

  let resposta;
  try {
    resposta = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Tente novamente.');
  }

  let corpo = {};
  try {
    corpo = await resposta.json();
  } catch {
    // resposta sem corpo JSON
  }

  if (resposta.status === 401) {
    // Token ausente, inválido ou expirado: encerra a sessão e volta ao login.
    logout();
    window.location.hash = '#/login';
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  if (!resposta.ok) {
    // O status HTTP fica no erro (ex: 501 indisponível, 503 cache não preparado) para a tela distinguir o caso.
    const erro = new Error(corpo.erro || 'Erro ao consultar o servidor. Tente novamente.');
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

// Base de apiPost/apiPut: mesmo tratamento de 401 (logout + volta ao login) e de erro (erro.status) do apiGet.
async function enviar(metodo, caminho, corpoEnvio) {
  let resposta;
  try {
    resposta = await fetch(`${API_URL}${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(corpoEnvio || {}),
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

  if (resposta.status === 401) {
    // Token ausente, inválido ou expirado: encerra a sessão e volta ao login.
    logout();
    window.location.hash = '#/login';
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  if (!resposta.ok) {
    const erro = new Error(corpo.erro || 'Erro ao consultar o servidor. Tente novamente.');
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

export function apiPost(caminho, corpo) {
  return enviar('POST', caminho, corpo);
}

export function apiPut(caminho, corpo) {
  return enviar('PUT', caminho, corpo);
}
