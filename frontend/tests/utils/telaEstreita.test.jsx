import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTelaEstreita } from '../../src/utils/telaEstreita.js';

function mockMatchMedia(matches) {
  let ouvinte = null;
  const mql = {
    matches,
    addEventListener: (_, fn) => { ouvinte = fn; },
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return (novo) => ouvinte({ matches: novo });
}

describe('useTelaEstreita', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('reflete a media query e reage à mudança de largura', () => {
    const mudar = mockMatchMedia(true);
    const { result } = renderHook(() => useTelaEstreita());
    expect(result.current).toBe(true);

    act(() => mudar(false));
    expect(result.current).toBe(false);
  });

  it('sem matchMedia (ex.: jsdom), assume tela larga', () => {
    const { result } = renderHook(() => useTelaEstreita());

    expect(result.current).toBe(false);
  });
});
