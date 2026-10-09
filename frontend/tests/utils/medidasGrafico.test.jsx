import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useMedidasGrafico } from '../../src/utils/medidasGrafico.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--vc-barra-largura');
});

describe('useMedidasGrafico', () => {
  it('usa os valores padrão quando os tokens CSS não estão carregados', () => {
    const { result } = renderHook(() => useMedidasGrafico());
    expect(result.current.barSize).toBe(16);
    expect(result.current.larguraEixoValor).toBe(64);
    expect(result.current.alturaGrafico).toBe(280);
  });

  it('lê as medidas dos tokens quando definidos', () => {
    document.documentElement.style.setProperty('--vc-barra-largura', '20');
    const { result } = renderHook(() => useMedidasGrafico());
    expect(result.current.barSize).toBe(20);
  });

  it('lê os tokens uma única vez, mesmo com novas renderizações', () => {
    const espiao = vi.spyOn(window, 'getComputedStyle');
    const { result, rerender } = renderHook(() => useMedidasGrafico());
    const chamadas = espiao.mock.calls.length;
    const primeira = result.current;
    rerender();
    rerender();
    expect(espiao.mock.calls.length).toBe(chamadas);
    expect(result.current).toBe(primeira);
  });
});
