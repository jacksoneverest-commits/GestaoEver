// Valida o texto digitado no campo "Quantidade de itens": inteiro de `minimo` até `maximo`.
// Retorna o número, ou null se vazio/decimal/zero/negativo/notação científica/fora do intervalo.
export function interpretarLimite(texto, maximo, minimo = 1) {
  if (!/^\d+$/.test(texto)) return null;
  const numero = Number(texto);
  return numero >= minimo && numero <= maximo ? numero : null;
}
