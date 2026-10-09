// Geração e download de CSV no navegador (sem dependência). Formato para Excel pt-BR:
// separador `;`, decimal com vírgula, BOM UTF-8 e quebras de linha CRLF.

const SEPARADOR = ';';
const BOM = '﻿';
const INICIA_FORMULA = /^[=+\-@]/;

function formatarCampo(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor).replace('.', ',') : '';

  let texto = String(valor);
  // Planilhas executam texto que começa com = + - @ como fórmula: prefixa apóstrofo.
  // trimStart: espaço/quebra de linha antes do gatilho não impede a planilha de ver a fórmula.
  if (INICIA_FORMULA.test(texto.trimStart())) texto = `'${texto}`;
  if (/[;"\r\n]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

// cabecalho: string[]; linhas: Array<Array<string|number|null>> (valores já vindos da API, sem recálculo).
export function gerarCsv(cabecalho, linhas) {
  const todas = [cabecalho, ...linhas];
  return BOM + todas.map((linha) => linha.map(formatarCampo).join(SEPARADOR)).join('\r\n');
}

// Dispara o download do arquivo no navegador a partir de um Blob.
export function baixarCsv(nomeArquivo, conteudo) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
