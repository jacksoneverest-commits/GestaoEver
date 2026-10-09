import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import KpiCard from '../../../src/components/KpiCard/KpiCard.jsx';

describe('KpiCard', () => {
  it('exibe o rótulo e o valor já formatado', () => {
    render(<KpiCard rotulo="Faturamento" valor="R$ 1.234,50" variante="azul" />);

    expect(screen.getByText('Faturamento')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.234,50')).toBeInTheDocument();
  });

  it('variação positiva tem texto acessível "Aumento de" além da seta', () => {
    render(<KpiCard rotulo="Faturamento" valor="R$ 10,00" variacao={12.5} />);

    expect(screen.getByText(/Aumento de/)).toBeInTheDocument();
    expect(screen.getByText('12,50%')).toBeInTheDocument();
  });

  it('variação negativa tem texto acessível "Queda de"', () => {
    render(<KpiCard rotulo="Faturamento" valor="R$ 10,00" variacao={-3} />);

    expect(screen.getByText(/Queda de/)).toBeInTheDocument();
    expect(screen.getByText('3,00%')).toBeInTheDocument();
  });

  it('sem variação informada, não mostra linha de variação', () => {
    render(<KpiCard rotulo="Ticket médio" valor="R$ 5,00" />);

    expect(screen.queryByText(/Aumento de|Queda de|Sem variação/)).not.toBeInTheDocument();
  });

  it('aplica a classe da variante de cor', () => {
    const { container } = render(<KpiCard rotulo="Itens" valor="2,00" variante="verde" />);

    expect(container.firstChild).toHaveClass('kpi-card--verde');
  });

  it('o texto da variação não repete o sinal (a seta e o texto acessível já indicam o sentido)', () => {
    render(<KpiCard rotulo="Faturamento" valor="R$ 10,00" variacao={-3} />);

    expect(screen.queryByText('-3,00%')).not.toBeInTheDocument();
  });

  it('o rótulo é h3 por padrão e respeita a prop nivel', () => {
    const { rerender } = render(<KpiCard rotulo="Faturamento" valor="1" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Faturamento' })).toBeInTheDocument();

    rerender(<KpiCard rotulo="Faturamento" valor="1" nivel={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Faturamento' })).toBeInTheDocument();
  });

  it('exibe o detalhe opcional (ex.: período do comparativo)', () => {
    render(<KpiCard rotulo="Faturamento" valor="1" detalhe="Período anterior: 01/08/2026 a 30/08/2026" />);

    expect(screen.getByText('Período anterior: 01/08/2026 a 30/08/2026')).toBeInTheDocument();
  });
});
