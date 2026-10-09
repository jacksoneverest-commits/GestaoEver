import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Icon from '../../../src/components/Icon/Icon.jsx';

describe('Icon', () => {
  it('renderiza um svg decorativo (aria-hidden) para cada nome conhecido', () => {
    const nomes = ['dashboard', 'vendas', 'ranking', 'curva-abc', 'estoque', 'usuarios', 'rentabilidade', 'busca', 'sair', 'menu', 'fechar'];
    nomes.forEach((nome) => {
      const { container, unmount } = render(<Icon nome={nome} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      unmount();
    });
  });

  it('nome desconhecido não renderiza nada', () => {
    const { container } = render(<Icon nome="inexistente" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
