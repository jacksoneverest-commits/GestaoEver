import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Skeleton from '../../../src/components/Skeleton/Skeleton.jsx';

describe('Skeleton', () => {
  it('anuncia o carregamento via role=status com rótulo acessível', () => {
    render(<Skeleton rotulo="Carregando indicadores" />);

    expect(screen.getByRole('status', { name: 'Carregando indicadores' })).toBeInTheDocument();
  });

  it('aplica a variante de tamanho por classe, sem estilo inline', () => {
    render(<Skeleton tamanho="bloco" />);

    const el = screen.getByRole('status');
    expect(el).toHaveClass('skeleton--bloco');
    expect(el).not.toHaveAttribute('style');
  });
});
