// Corta rótulos longos de eixo com reticências, respeitando o limite total de caracteres.
export function truncarRotulo(texto, maximo) {
  const valor = texto === null || texto === undefined ? '' : String(texto);
  if (valor.length <= maximo) return valor;
  return `${valor.slice(0, Math.max(1, maximo - 1)).trimEnd()}…`;
}
