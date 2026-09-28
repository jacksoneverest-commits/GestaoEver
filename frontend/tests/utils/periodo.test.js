import { describe, expect, it } from 'vitest';
import { periodoUltimosDias, periodoUltimosDiasAteOntem } from '../../src/utils/periodo.js';

describe('periodoUltimosDias', () => {
  it('retorna N dias terminando hoje, em ISO no fuso local', () => {
    const tardeDaNoite = new Date(2026, 8, 24, 23, 59);
    expect(periodoUltimosDias(30, tardeDaNoite)).toEqual({ inicio: '2026-08-26', fim: '2026-09-24' });
  });

  it('atravessa virada de ano', () => {
    expect(periodoUltimosDias(10, new Date(2026, 0, 5, 0, 1))).toEqual({ inicio: '2025-12-27', fim: '2026-01-05' });
  });
});

describe('periodoUltimosDiasAteOntem', () => {
  it('retorna N dias terminando ontem, em ISO no fuso local', () => {
    const tardeDaNoite = new Date(2026, 8, 24, 23, 59);
    expect(periodoUltimosDiasAteOntem(30, tardeDaNoite)).toEqual({ inicio: '2026-08-25', fim: '2026-09-23' });
  });

  it('atravessa virada de ano quando ontem é 31/12', () => {
    expect(periodoUltimosDiasAteOntem(10, new Date(2026, 0, 1, 0, 1))).toEqual({ inicio: '2025-12-22', fim: '2025-12-31' });
  });
});
