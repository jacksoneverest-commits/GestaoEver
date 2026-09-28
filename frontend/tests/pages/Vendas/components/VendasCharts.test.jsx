import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VendasCharts from '../../../../src/pages/Vendas/components/VendasCharts.jsx';
import {
  obterVendasPorHora,
  obterVendasPorDiaSemana,
  obterVendasPorFormaPagamento,
  obterVendasPorDepartamento,
} from '../../../../src/services/vendasGraficosService.js';

vi.mock('../../../../src/services/vendasGraficosService.js', () => ({
  obterVendasPorHora: vi.fn(),
  obterVendasPorDiaSemana: vi.fn(),
  obterVendasPorFormaPagamento: vi.fn(),
  obterVendasPorDepartamento: vi.fn(),
}));

// ResponsiveContainer não mede largura no jsdom: entrega dimensões fixas ao gráfico.
vi.mock('recharts', async (importOriginal) => {
  const React = await import('react');
  const original = await importOriginal();
  return {
    ...original,
    ResponsiveContainer: ({ children, height }) =>
      React.cloneElement(children, { width: 600, height: typeof height === 'number' ? height : 300 }),
  };
});

const INICIO = '2026-03-01';
const FIM = '2026-03-31';

const porHora = Array.from({ length: 24 }, (_, hora) => ({
  hora,
  faturamento: 100 + hora * 10,
  quantidadeCupons: hora + 1,
}));

const porDiaSemana = [
  { diaSemana: 0, nome: 'Domingo', faturamento: 900, quantidadeCupons: 9 },
  { diaSemana: 1, nome: 'Segunda-feira', faturamento: 800, quantidadeCupons: 8 },
];

const porFormaPagamento = [
  { formaPagamentoId: 1, nome: 'Dinheiro', faturamento: 5000, quantidadeCupons: 50 },
  { formaPagamentoId: null, nome: 'Não informada', faturamento: 100, quantidadeCupons: 2 },
];

const departamentos = {
  nivel: 'grupo',
  id: null,
  total: 1500,
  itens: [
    { id: 1, nome: 'Bebidas', faturamento: 1000, quantidade: 300, participacaoPercentual: 66.7 },
    { id: 0, nome: 'Sem departamento', faturamento: 500, quantidade: 40, participacaoPercentual: 33.3 },
  ],
};

const produtosDoDepartamento = {
  nivel: 'grupo',
  id: 1,
  total: 1000,
  itens: [{ id: 77, nome: 'Refrigerante 2L', faturamento: 1000, quantidade: 300, participacaoPercentual: 100 }],
};

function tabela(nome) {
  return screen.getByRole('table', { name: nome, hidden: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  obterVendasPorHora.mockResolvedValue({ porHora });
  obterVendasPorDiaSemana.mockResolvedValue({ porDiaSemana });
  obterVendasPorFormaPagamento.mockResolvedValue({ porFormaPagamento });
  obterVendasPorDepartamento.mockImplementation(async ({ id }) =>
    id ? produtosDoDepartamento : departamentos,
  );
});

describe('VendasCharts', () => {
  it('renderiza o gráfico de vendas por hora com os 24 pontos retornados pela API', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    expect(screen.getByRole('heading', { name: 'Vendas por hora' })).toBeInTheDocument();
    const t = await waitFor(() => {
      const el = tabela('Vendas por hora (tabela)');
      expect(within(el).getAllByRole('row', { hidden: true })).toHaveLength(25); // cabeçalho + 24
      return el;
    });

    const linhas = within(t).getAllByRole('row', { hidden: true }).slice(1);
    expect(linhas[0]).toHaveTextContent('00h');
    expect(linhas[8]).toHaveTextContent('08h');
    expect(linhas[23]).toHaveTextContent('23h');
    expect(linhas[23]).toHaveTextContent('R$ 330,00');
    expect(obterVendasPorHora).toHaveBeenCalledWith({ inicio: INICIO, fim: FIM });

    // O gráfico de fato desenha: com o ResponsiveContainer mockado (dimensões fixas),
    // o Recharts renderiza uma barra por hora dentro do role="img" do card de hora.
    const secaoHora = screen.getByRole('region', { name: 'Vendas por hora' });
    const grafico = within(secaoHora).getByRole('img', { name: /por hora do dia/i });
    expect(grafico.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(24);
  });

  it('usa valores compactos (sem centavos) apenas nos ticks do eixo de valor', async () => {
    obterVendasPorHora.mockResolvedValue({
      porHora: porHora.map((item) => ({ ...item, faturamento: item.hora === 0 ? 105000 : 15000 })),
    });
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const secaoHora = screen.getByRole('region', { name: 'Vendas por hora' });
    const grafico = await within(secaoHora).findByRole('img', { name: /por hora do dia/i });
    await waitFor(() => expect(grafico.textContent).toMatch(/R\$ \d+ mil/));
    expect(grafico.textContent).not.toMatch(/,\d\d/);
    // a tabela mantém o valor exato
    expect(tabela('Vendas por hora (tabela)')).toHaveTextContent('R$ 105.000,00');
  });

  it('abrevia o dia da semana no eixo e mantém o nome completo na tabela', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const secao = screen.getByRole('region', { name: 'Vendas por dia da semana' });
    const grafico = await within(secao).findByRole('img', { name: /dia da semana/i });
    await waitFor(() => expect(grafico.textContent).toContain('Dom'));
    expect(grafico.textContent).toContain('Seg');
    expect(grafico.textContent).not.toContain('Domingo');
    expect(grafico.textContent).not.toContain('Segunda-feira');

    const t = tabela('Vendas por dia da semana (tabela)');
    expect(t).toHaveTextContent('Domingo');
    expect(t).toHaveTextContent('Segunda-feira');
  });

  it('refaz a chamada à API com o nível correto ao trocar a navegação de departamento', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    await waitFor(() =>
      expect(obterVendasPorDepartamento).toHaveBeenCalledWith(
        expect.objectContaining({ inicio: INICIO, fim: FIM, nivel: 'grupo' }),
      ),
    );

    const grupo = screen.getByRole('radiogroup', { name: /nível/i });
    expect(within(grupo).getByRole('radio', { name: 'Grupo' })).toBeChecked();

    fireEvent.click(within(grupo).getByRole('radio', { name: 'Setor' }));
    await waitFor(() =>
      expect(obterVendasPorDepartamento).toHaveBeenLastCalledWith(
        expect.objectContaining({ nivel: 'setor' }),
      ),
    );

    fireEvent.click(within(grupo).getByRole('radio', { name: 'Família' }));
    await waitFor(() =>
      expect(obterVendasPorDepartamento).toHaveBeenLastCalledWith(
        expect.objectContaining({ nivel: 'familia' }),
      ),
    );
  });

  it('exibe estado de carregamento enquanto as requisições estão pendentes', () => {
    obterVendasPorHora.mockReturnValue(new Promise(() => {}));
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    expect(screen.getAllByText(/carregando/i).length).toBeGreaterThan(0);
  });

  it('mostra erro apenas no gráfico que falhou, sem derrubar os demais', async () => {
    obterVendasPorDiaSemana.mockRejectedValue(new Error('Falha ao consultar o servidor.'));
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Falha ao consultar o servidor.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    await waitFor(() => {
      expect(within(tabela('Vendas por hora (tabela)')).getAllByRole('row', { hidden: true })).toHaveLength(25);
    });
    expect(tabela('Vendas por forma de pagamento (tabela)')).toHaveTextContent('Dinheiro');
  });

  it('renderiza dia da semana e forma de pagamento (incluindo forma sem identificação)', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    await waitFor(() => expect(tabela('Vendas por dia da semana (tabela)')).toHaveTextContent('Segunda-feira'));
    expect(tabela('Vendas por forma de pagamento (tabela)')).toHaveTextContent('Não informada');
  });

  it('refaz as chamadas quando o período muda', async () => {
    const { rerender } = render(<VendasCharts inicio={INICIO} fim={FIM} />);
    await waitFor(() => expect(obterVendasPorHora).toHaveBeenCalledTimes(1));

    rerender(<VendasCharts inicio="2026-04-01" fim="2026-04-30" />);

    await waitFor(() =>
      expect(obterVendasPorHora).toHaveBeenLastCalledWith({ inicio: '2026-04-01', fim: '2026-04-30' }),
    );
    expect(obterVendasPorDepartamento).toHaveBeenLastCalledWith(
      expect.objectContaining({ inicio: '2026-04-01', fim: '2026-04-30', nivel: 'grupo' }),
    );
  });

  it('faz drill-down nos produtos do departamento e volta ao nível', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const t = await waitFor(() => {
      const el = tabela('Vendas por departamento (tabela)');
      expect(el).toHaveTextContent('Bebidas');
      return el;
    });
    fireEvent.click(within(t).getByRole('button', { name: /Bebidas/, hidden: true }));

    await waitFor(() =>
      expect(obterVendasPorDepartamento).toHaveBeenLastCalledWith(
        expect.objectContaining({ nivel: 'grupo', id: 1 }),
      ),
    );
    expect(await screen.findByText('Refrigerante 2L', { selector: 'th' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /voltar/i }));
    await waitFor(() => expect(tabela('Vendas por departamento (tabela)')).toHaveTextContent('Bebidas'));
    expect(obterVendasPorDepartamento.mock.calls.at(-1)[0].id).toBeUndefined();
  });

  it('mantém o botão Voltar e mostra o erro quando a chamada de detalhe falha', async () => {
    obterVendasPorDepartamento.mockImplementation(async ({ id }) => {
      if (id) throw new Error('Falha ao carregar os produtos.');
      return departamentos;
    });
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const t = await waitFor(() => {
      const el = tabela('Vendas por departamento (tabela)');
      expect(el).toHaveTextContent('Bebidas');
      return el;
    });
    fireEvent.click(within(t).getByRole('button', { name: /Bebidas/, hidden: true }));

    const secao = screen.getByRole('region', { name: 'Vendas por departamento' });
    expect(await within(secao).findByRole('alert')).toHaveTextContent('Falha ao carregar os produtos.');
    const voltar = within(secao).getByRole('button', { name: /voltar/i });

    fireEvent.click(voltar);
    await waitFor(() => expect(tabela('Vendas por departamento (tabela)')).toHaveTextContent('Bebidas'));
    expect(within(secao).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(secao).queryByRole('button', { name: /voltar/i })).not.toBeInTheDocument();
  });

  it('mostra estado vazio quando todas as horas têm faturamento zero', async () => {
    obterVendasPorHora.mockResolvedValue({
      porHora: porHora.map((item) => ({ ...item, faturamento: 0, quantidadeCupons: 0 })),
    });
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const secao = screen.getByRole('region', { name: 'Vendas por hora' });
    expect(await within(secao).findByText('Sem vendas no período.')).toBeInTheDocument();
    expect(within(secao).queryByRole('table', { hidden: true })).not.toBeInTheDocument();
  });

  it('usa cabeçalho de linha na primeira coluna de todas as linhas do departamento', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const t = await waitFor(() => {
      const el = tabela('Vendas por departamento (tabela)');
      expect(el).toHaveTextContent('Sem departamento');
      return el;
    });
    expect(within(t).getAllByRole('rowheader', { hidden: true })).toHaveLength(2);
    expect(within(t).getByRole('rowheader', { name: 'Sem departamento', hidden: true })).toBeInTheDocument();
  });

  it('não permite drill-down na linha "Sem departamento"', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const t = await waitFor(() => {
      const el = tabela('Vendas por departamento (tabela)');
      expect(el).toHaveTextContent('Sem departamento');
      return el;
    });
    expect(within(t).queryByRole('button', { name: /Sem departamento/, hidden: true })).not.toBeInTheDocument();
    expect(within(t).getByRole('button', { name: /Bebidas/, hidden: true })).toBeInTheDocument();
  });
});
