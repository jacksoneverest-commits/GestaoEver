import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { lerVisao, salvarVisao } from '../../src/utils/preferenciaVisao.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('preferenciaVisao', () => {
  it('salva e lê a visão por card', () => {
    salvarVisao('hora', 'tabela');
    expect(lerVisao('hora')).toBe('tabela');
    expect(localStorage.getItem('vendas-charts:visao:hora')).toBe('tabela');
    expect(lerVisao('dia-semana')).toBeNull();
  });

  it('ignora valor inválido guardado', () => {
    localStorage.setItem('vendas-charts:visao:hora', 'qualquer');
    expect(lerVisao('hora')).toBeNull();
  });

  it('não lança quando o localStorage falha', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cheio');
    });
    expect(lerVisao('hora')).toBeNull();
    expect(() => salvarVisao('hora', 'grafico')).not.toThrow();
  });
});
