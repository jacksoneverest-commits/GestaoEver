import { describe, it, expect } from 'vitest';
import { formatDate, formatCurrency } from '../../src/utils/format.js';

describe('formatDate', () => {
  it('converte data ISO para dd/mm/aaaa sem deslocamento de fuso', () => {
    expect(formatDate('2026-03-05')).toBe('05/03/2026');
  });

  it('retorna string vazia para valor ausente ou inválido', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate('05/03/2026')).toBe('');
  });
});

describe('formatCurrency', () => {
  it('formata número como moeda brasileira', () => {
    // Intl usa espaço não separável (U+00A0) entre R$ e o valor
    expect(formatCurrency(1234.5).replace(/ /g, ' ')).toBe('R$ 1.234,50');
  });

  it('formata zero e valores negativos', () => {
    expect(formatCurrency(0).replace(/ /g, ' ')).toBe('R$ 0,00');
    expect(formatCurrency(-10).replace(/ /g, ' ')).toBe('-R$ 10,00');
  });
});
