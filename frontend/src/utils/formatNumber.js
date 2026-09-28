// Helpers compartilhados de formatação numérica (pt-BR), complementam utils/format.js.

const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentual = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});

const quantidade = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const percentualDuasCasas = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentualSimples = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

// 2.5 -> '2,5'; 1234 -> '1.234' (até 3 casas: itens pesáveis)
export function formatQuantidade(valor) {
  return quantidade.format(Number(valor) || 0);
}

// 66.66 -> '66,7%' (sem sinal explícito; usado em participação)
export function formatPercentualSimples(valor) {
  return `${percentualSimples.format(Number(valor) || 0)}%`;
}

// 40 -> '40,00%'; 32.456 -> '32,46%' (sempre 2 casas, sem sinal explícito; usado em margem)
export function formatPercentualDuasCasas(valor) {
  return `${percentualDuasCasas.format(Number(valor) || 0)}%`;
}

const compacto = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const ESCALAS_COMPACTAS = [
  { limite: 1e9, sufixo: ' bi' },
  { limite: 1e6, sufixo: ' mi' },
  { limite: 1e3, sufixo: ' mil' },
];

// Para ticks de eixo (sem centavos): 0 -> 'R$ 0'; 15000 -> 'R$ 15 mil'; 1250000 -> 'R$ 1,25 mi'
export function formatCurrencyCompact(valor) {
  const numero = Number(valor) || 0;
  const absoluto = Math.abs(numero);
  const sinal = numero < 0 ? '-' : '';
  const escala = ESCALAS_COMPACTAS.find(({ limite }) => absoluto >= limite);
  if (!escala) return `${sinal}R$ ${inteiro.format(absoluto)}`;
  return `${sinal}R$ ${compacto.format(absoluto / escala.limite)}${escala.sufixo}`;
}

// 8 -> '08h'
export function formatHora(hora) {
  return `${String(hora).padStart(2, '0')}h`;
}

// 1438 -> '1.438'
export function formatInteger(valor) {
  return inteiro.format(Number(valor) || 0);
}

// 6.5 -> '6,50'
export function formatDecimal(valor) {
  return decimal.format(Number(valor) || 0);
}

// 18.05 -> '+18,05%'; -7.5 -> '-7,50%'; 0 -> '0,00%'
export function formatPercent(valor) {
  return `${percentual.format(Number(valor) || 0)}%`;
}
