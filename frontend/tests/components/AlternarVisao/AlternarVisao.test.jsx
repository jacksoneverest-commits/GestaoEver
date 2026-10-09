import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AlternarVisao from '../../../src/components/AlternarVisao/AlternarVisao.jsx';

describe('AlternarVisao', () => {
  it('marca com aria-pressed a visão atual', () => {
    render(<AlternarVisao valor="tabela" aoMudar={() => {}} rotulo="Visualização de Vendas" />);
    expect(screen.getByRole('group', { name: 'Visualização de Vendas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tabela' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Gráfico' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('chama aoMudar com a visão escolhida', () => {
    const aoMudar = vi.fn();
    render(<AlternarVisao valor="grafico" aoMudar={aoMudar} rotulo="Visualização" />);
    fireEvent.click(screen.getByRole('button', { name: 'Tabela' }));
    expect(aoMudar).toHaveBeenCalledWith('tabela');
  });
});
