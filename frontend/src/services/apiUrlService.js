const API_URL_KEY = 'apiUrl';
const API_URL_PADRAO = 'http://localhost:3001';

const MENSAGEM_URL_INVALIDA = 'URL do servidor inválida. Use o formato http://endereco:porta ou https://endereco.';
const TIMEOUT_VALIDACAO_MS = 8000;

// Normaliza e valida a URL do servidor: exige http(s) com host, descarta search/hash e remove a "/" final.
export function normalizarApiUrl(valor) {
  let url;
  try {
    url = new URL(String(valor ?? '').trim());
  } catch {
    throw new Error(MENSAGEM_URL_INVALIDA);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.host) {
    throw new Error(MENSAGEM_URL_INVALIDA);
  }
  return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');
}

function urlPadrao() {
  return import.meta.env.VITE_API_URL || API_URL_PADRAO;
}

// Prioridade: URL salva no navegador (revalidada) -> VITE_API_URL -> http://localhost:3001.
export function getApiUrl() {
  try {
    const salva = localStorage.getItem(API_URL_KEY);
    if (salva) return normalizarApiUrl(salva);
  } catch {
    // armazenamento indisponível ou valor adulterado: cai para o padrão
  }
  return urlPadrao();
}

export function setApiUrl(valor) {
  const url = normalizarApiUrl(valor);
  try {
    localStorage.setItem(API_URL_KEY, url);
  } catch {
    throw new Error('Não foi possível salvar o servidor neste navegador.');
  }
  return url;
}

function criarSinalTimeout(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), limpar: () => {} };
  }
  const controlador = new AbortController();
  const id = setTimeout(() => controlador.abort(), ms);
  return { signal: controlador.signal, limpar: () => clearTimeout(id) };
}

// Confirma que o servidor responde em GET {url}/health com { status: 'ok' }.
export async function validarServidor(url) {
  const { signal, limpar } = criarSinalTimeout(TIMEOUT_VALIDACAO_MS);
  let resposta;
  try {
    resposta = await fetch(`${url}/health`, { signal });
  } catch {
    throw new Error(
      'Servidor inacessível. Se a API é http e esta página é https, libere conteúdo inseguro no navegador para este site.'
    );
  } finally {
    limpar();
  }
  const invalido = new Error('O endereço respondeu, mas não parece ser o servidor do GestãoEverSoftPlus.');
  if (!resposta.ok) throw invalido;
  let corpo;
  try {
    corpo = await resposta.json();
  } catch {
    throw invalido;
  }
  if (corpo?.status !== 'ok') throw invalido;
}
