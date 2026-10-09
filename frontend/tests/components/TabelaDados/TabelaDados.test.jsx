import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TabelaDados from '../../../src/components/TabelaDados/TabelaDados.jsx';

const colunas = [
  { chave: 'nome', rotulo: 'Departamento' },
  { chave: 'faturamento', rotulo: 'Faturamento', numerica: true, somar: true, barra: true, formatar: (v) => `R$ ${v}` },
  { chave: 'quantidade', rotulo: 'Quantidade', numerica: true, somar: true, formatar: (v) => `${v} un` },
];
const itens = [
  { id: 1, nome: 'Bebidas', faturamento: 750, quantidade: 3, participacaoPercentual: 75 },
  { id: 2, nome: 'Padaria', faturamento: 250, quantidade: 2, participacaoPercentual: 25 },
];

describe('TabelaDados', () => {
  it('renderiza uma mini-barra decorativa proporcional à participação na coluna de valor', () => {
    render(<TabelaDados titulo="Dep" colunas={colunas} itens={itens} />);
    const barras = document.querySelectorAll('progress');
    expect(barras).toHaveLength(2);
    expect(barras[0]).toHaveAttribute('aria-hidden', 'true');
    expect(Number(barras[0].value)).toBe(75);
    expect(Number(barras[1].value)).toBe(25);
    expect(screen.getByText('R$ 750')).toBeInTheDocument(); // o número continua visível
  });

  it('sem participação da API escala a barra pelo maior valor exibido', () => {
    const semParticipacao = itens.map(({ participacaoPercentual, ...resto }) => resto);
    render(<TabelaDados titulo="Dep" colunas={colunas} itens={semParticipacao} />);
    const barras = document.querySelectorAll('progress');
    expect(Number(barras[0].value)).toBe(100);
    expect(Number(barras[1].value)).toBe(33);
  });

  it('mostra a linha de total somando os itens exibidos, formatada pelos helpers', () => {
    render(<TabelaDados titulo="Dep" colunas={colunas} itens={itens} />);
    const rodape = within(screen.getByRole('table', { name: 'Dep (tabela)' })).getAllByRole('row').at(-1);
    expect(rodape).toHaveTextContent('Total');
    expect(rodape).not.toHaveTextContent('Total exibido');
    expect(rodape).toHaveTextContent('R$ 1000');
    expect(rodape).toHaveTextContent('5 un');
  });

  it('rotula "Total exibido" quando o total da API é maior que a soma exibida', () => {
    render(<TabelaDados titulo="Dep" colunas={colunas} itens={itens} totalCompleto={5000} />);
    expect(screen.getByRole('rowheader', { name: 'Total exibido' })).toBeInTheDocument();
  });

  it('alinha colunas numéricas à direita e marca a linha do pico', () => {
    render(<TabelaDados titulo="Dep" colunas={colunas} itens={itens} indicePico={0} />);
    const cabecalho = screen.getByRole('columnheader', { name: 'Faturamento' });
    expect(cabecalho).toHaveClass('num');
    const linha = screen.getByText('Bebidas').closest('tr');
    expect(within(linha).getByText('Pico')).toBeInTheDocument();
    expect(within(screen.getByText('Padaria').closest('tr')).queryByText('Pico')).not.toBeInTheDocument();
  });

  it('não soma a coluna de participação no total (mostra traço)', () => {
    const comParticipacao = [
      ...colunas,
      { chave: 'participacaoPercentual', rotulo: 'Participação', numerica: true, formatar: (v) => `${v}%` },
    ];
    render(<TabelaDados titulo="Dep" colunas={comParticipacao} itens={itens} />);
    const rodape = within(screen.getByRole('table', { name: 'Dep (tabela)' })).getAllByRole('row').at(-1);
    expect(rodape).toHaveTextContent('—');
    expect(rodape).not.toHaveTextContent('100%');
  });
});
