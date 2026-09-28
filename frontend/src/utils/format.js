// Helpers compartilhados de formatação (regra frontend.md): datas e moeda.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

// 'YYYY-MM-DD' -> 'dd/mm/aaaa'. Faz parse da string (sem new Date) para evitar erro de fuso.
export function formatDate(isoDate) {
  if (typeof isoDate !== 'string') return '';
  const match = ISO_DATE.exec(isoDate);
  if (!match) return '';
  const [, ano, mes, dia] = match;
  return `${dia}/${mes}/${ano}`;
}

// 1234.5 -> 'R$ 1.234,50'
export function formatCurrency(valor) {
  return currencyFormatter.format(Number(valor) || 0);
}
