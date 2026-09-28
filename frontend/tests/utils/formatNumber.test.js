import { describe, expect, it } from 'vitest';
import {
  formatCurrencyCompact,
  formatDecimal,
  formatHora,
  formatInteger,
  formatPercent,
  formatPercentualDuasCasas,
  formatPercentualSimples,
  formatQuantidade,
} from '../../src/utils/formatNumber.js';

describe('formatNumber', () => {
  it('formatPercent usa vírgula e sinal explícito', () => {
    expect(formatPercent(18.05)).toBe('+18,05%');
    expect(formatPercent(-7.5)).toBe('-7,50%');
    expect(formatPercent(0)).toBe('0,00%');
  });

  it('formatInteger e formatDecimal seguem pt-BR', () => {
    expect(formatInteger(1438)).toBe('1.438');
    expect(formatDecimal(6.5)).toBe('6,50');
  });

  it('formatQuantidade mostra até 3 casas (itens pesáveis) sem zeros à direita', () => {
    expect(formatQuantidade(1234)).toBe('1.234');
    expect(formatQuantidade(2.5)).toBe('2,5');
    expect(formatQuantidade(0.12345)).toBe('0,123');
    expect(formatQuantidade(null)).toBe('0');
  });

  it('formatQuantidade mantém o sinal de quantidades negativas (estoque negativo)', () => {
    expect(formatQuantidade(-1.63)).toBe('-1,63');
    expect(formatQuantidade(-2)).toBe('-2');
  });

  it('formatPercentualSimples usa até 1 casa e não força sinal', () => {
    expect(formatPercentualSimples(66.66)).toBe('66,7%');
    expect(formatPercentualSimples(100)).toBe('100%');
    expect(formatPercentualSimples(undefined)).toBe('0%');
  });

  it('formatPercentualDuasCasas usa sempre 2 casas e não força sinal', () => {
    expect(formatPercentualDuasCasas(40)).toBe('40,00%');
    expect(formatPercentualDuasCasas(32.456)).toBe('32,46%');
    expect(formatPercentualDuasCasas(-5.5)).toBe('-5,50%');
    expect(formatPercentualDuasCasas(undefined)).toBe('0,00%');
  });

  it('formatCurrencyCompact abrevia em mil/mi/bi, sem centavos', () => {
    expect(formatCurrencyCompact(0)).toBe('R$ 0');
    expect(formatCurrencyCompact(950)).toBe('R$ 950');
    expect(formatCurrencyCompact(1500)).toBe('R$ 1,5 mil');
    expect(formatCurrencyCompact(15000)).toBe('R$ 15 mil');
    expect(formatCurrencyCompact(105000)).toBe('R$ 105 mil');
    expect(formatCurrencyCompact(1250000)).toBe('R$ 1,25 mi');
    expect(formatCurrencyCompact(2000000000)).toBe('R$ 2 bi');
    expect(formatCurrencyCompact(-15000)).toBe('-R$ 15 mil');
    expect(formatCurrencyCompact(undefined)).toBe('R$ 0');
  });

  it('formatHora devolve a hora com dois dígitos e sufixo h', () => {
    expect(formatHora(8)).toBe('08h');
    expect(formatHora(23)).toBe('23h');
  });
});
