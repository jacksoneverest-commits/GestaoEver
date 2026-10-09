// Preferência de visão (gráfico/tabela) por card, guardada no localStorage.
// Qualquer falha de armazenamento (bloqueado, cheio, modo privado) é ignorada: a tela funciona igual.

const PREFIXO = 'vendas-charts:visao:';
const VISOES = ['grafico', 'tabela'];

export function lerVisao(idCard) {
  try {
    const valor = window.localStorage.getItem(`${PREFIXO}${idCard}`);
    return VISOES.includes(valor) ? valor : null;
  } catch {
    return null;
  }
}

export function salvarVisao(idCard, visao) {
  try {
    window.localStorage.setItem(`${PREFIXO}${idCard}`, visao);
  } catch {
    // sem persistência: a escolha vale só nesta sessão da tela
  }
}
