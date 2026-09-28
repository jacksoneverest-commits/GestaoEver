import { describe, expect, it } from 'vitest';
import { interpretarLimite } from '../../src/utils/limite.js';

describe('interpretarLimite', () => {
  it('aceita inteiros de 1 até o máximo informado e devolve o número', () => {
    expect(interpretarLimite('1', 100)).toBe(1);
    expect(interpretarLimite('25', 100)).toBe(25);
    expect(interpretarLimite('100', 100)).toBe(100);
  });

  it.each(['', '0', '-3', '2.5', '2,5', '1e1', 'abc', ' 5', '101'])('rejeita "%s" (devolve null)', (texto) => {
    expect(interpretarLimite(texto, 100)).toBeNull();
  });

  it('respeita um mínimo diferente de 1 quando informado', () => {
    expect(interpretarLimite('1', 100, 5)).toBeNull();
    expect(interpretarLimite('5', 100, 5)).toBe(5);
  });
});
