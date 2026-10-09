// Índice da primeira ocorrência do maior valor (> 0); -1 sem dados ou com tudo zerado.
// Apenas marca o máximo já retornado pela API; não calcula indicadores de negócio.
export function indiceDoPico(valores) {
  let indice = -1;
  let maior = 0;
  valores.forEach((valor, i) => {
    const numero = Number(valor) || 0;
    if (numero > maior) {
      maior = numero;
      indice = i;
    }
  });
  return indice;
}

// Lê um token numérico (sem unidade) de tokens.css, para props que o Recharts exige em número
// (barSize, radius). Sem o CSS carregado (ex.: testes) usa o padrão informado.
export function lerTokenNumero(nome, padrao) {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return padrao;
  const bruto = window.getComputedStyle(document.documentElement).getPropertyValue(nome);
  const numero = parseFloat(bruto);
  return Number.isFinite(numero) ? numero : padrao;
}
