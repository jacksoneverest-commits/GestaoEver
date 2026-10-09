import { describe, it, expect } from 'vitest';
import { indiceDoPico, lerTokenNumero } from '../../src/utils/graficos.js';

describe('indiceDoPico', () => {
  it('retorna o índice do maior valor', () => {
    expect(indiceDoPico([10, 50, 30])).toBe(1);
  });

  it('em empate usa a primeira ocorrência', () => {
    expect(indiceDoPico([5, 9, 9, 1])).toBe(1);
  });

  it('retorna -1 sem dados ou com todos os valores zerados', () => {
    expect(indiceDoPico([])).toBe(-1);
    expect(indiceDoPico([0, 0, '0', null])).toBe(-1);
  });

  it('aceita valores numéricos em texto, como vêm da API', () => {
    expect(indiceDoPico(['10.50', '99.90', '3'])).toBe(1);
  });
});

describe('lerTokenNumero', () => {
  it('usa o padrão quando o token CSS não está definido', () => {
    expect(lerTokenNumero('--token-inexistente', 12)).toBe(12);
  });

  it('lê o valor numérico do token quando definido', () => {
    document.documentElement.style.setProperty('--token-teste', '20');
    expect(lerTokenNumero('--token-teste', 12)).toBe(20);
    document.documentElement.style.removeProperty('--token-teste');
  });
});
