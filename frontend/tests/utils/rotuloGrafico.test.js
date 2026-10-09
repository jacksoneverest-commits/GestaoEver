import { describe, expect, it } from 'vitest';
import { truncarRotulo } from '../../src/utils/rotuloGrafico.js';

describe('truncarRotulo', () => {
  it('mantém rótulos que cabem no limite', () => {
    expect(truncarRotulo('Bebidas', 10)).toBe('Bebidas');
  });

  it('corta rótulos longos e termina com reticências, respeitando o limite total', () => {
    const resultado = truncarRotulo('Produtos de limpeza doméstica', 12);

    expect(resultado).toHaveLength(12);
    expect(resultado.endsWith('…')).toBe(true);
  });

  it('valores nulos viram texto vazio', () => {
    expect(truncarRotulo(null, 10)).toBe('');
  });
});
