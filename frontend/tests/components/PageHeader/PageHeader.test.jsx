import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PageHeader from '../../../src/components/PageHeader/PageHeader.jsx';

describe('PageHeader', () => {
  it('renderiza título como h1, subtítulo e a área de ações', () => {
    render(
      <PageHeader titulo="Vendas e Faturamento" subtitulo="Resumo do período">
        <button type="button">Ação</button>
      </PageHeader>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Vendas e Faturamento' })).toBeInTheDocument();
    expect(screen.getByText('Resumo do período')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ação' })).toBeInTheDocument();
  });

  it('sem subtítulo nem ações, renderiza só o título', () => {
    render(<PageHeader titulo="Usuários" />);

    expect(screen.getByRole('heading', { name: 'Usuários' })).toBeInTheDocument();
  });
});
