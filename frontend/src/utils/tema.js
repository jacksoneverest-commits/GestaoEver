// Tema claro/escuro: preferência no localStorage, aplicada em <html data-theme="...">.
// Qualquer falha de armazenamento (bloqueado, cheio, modo privado) é ignorada: o tema vale só nesta sessão.

const CHAVE = 'gestao:tema';
const TEMAS = ['claro', 'escuro'];

export function lerTema() {
  try {
    const valor = window.localStorage.getItem(CHAVE);
    if (TEMAS.includes(valor)) return valor;
  } catch {
    // sem persistência: cai no padrão do sistema
  }
  const prefereEscuro = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefereEscuro ? 'escuro' : 'claro';
}

export function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
}

export function salvarTema(tema) {
  try {
    window.localStorage.setItem(CHAVE, tema);
  } catch {
    // sem persistência
  }
}
