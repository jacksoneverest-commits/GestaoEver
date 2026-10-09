import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VendasCharts from '../../../../src/pages/Vendas/components/VendasCharts.jsx';
import {
  obterVendasPorHora,
  obterVendasPorDiaSemana,
  obterVendasPorFormaPagamento,
  obterVendasPorDepartamento,
} from '../../../../src/services/vendasGraficosService.js';
import { baixarCsv } from '../../../../src/utils/csv.js';

vi.mock('../../../../src/utils/csv.js', async (importOriginal) => ({
  ...(await importOriginal()),
  baixarCsv: vi.fn(),
}));

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
  return screen.getByRole('table', { name: nome });
}

// A tabela substitui o gráfico no mesmo espaço: é preciso alternar a visão do card.
async function abrirTabela(titulo) {
  const secao = screen.getByRole('region', { name: titulo });
  fireEvent.click(await within(secao).findByRole('button', { name: 'Tabela' }));
  return within(secao).getByRole('table', { name: `${titulo} (tabela)` });
}

function destaques(grafico) {
  return [...grafico.querySelectorAll('.recharts-bar-rectangle path')].filter(
    (el) => el.getAttribute('fill') === 'var(--vc-serie-destaque)',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
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
    // O gráfico de fato desenha: com o ResponsiveContainer mockado (dimensões fixas),
    // o Recharts renderiza uma barra por hora dentro do role="img" do card de hora.
    const secaoHora = screen.getByRole('region', { name: 'Vendas por hora' });
    const grafico = await within(secaoHora).findByRole('img', { name: /por hora do dia/i });
    expect(grafico.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(24);
    expect(obterVendasPorHora).toHaveBeenCalledWith({ inicio: INICIO, fim: FIM });

    const t = await abrirTabela('Vendas por hora');
    expect(within(t).getAllByRole('row')).toHaveLength(26); // cabeçalho + 24 + total
    const linhas = within(t).getAllByRole('row').slice(1, 25);
    expect(linhas[0]).toHaveTextContent('00h');
    expect(linhas[8]).toHaveTextContent('08h');
    expect(linhas[23]).toHaveTextContent('23h');
    expect(linhas[23]).toHaveTextContent('R$ 330,00');
  });

  it('substitui o antigo "Ver como tabela" pela alternância Gráfico | Tabela', async () => {
    const { container } = render(<VendasCharts inicio={INICIO} fim={FIM} />);
    const secao = screen.getByRole('region', { name: 'Vendas por hora' });
    await within(secao).findByRole('img', { name: /por hora do dia/i });

    expect(screen.queryByText('Ver como tabela')).not.toBeInTheDocument();
    expect(container.querySelector('details')).toBeNull();
    expect(within(secao).queryByRole('table')).not.toBeInTheDocument();
    expect(within(secao).getByRole('button', { name: 'Gráfico' })).toHaveAttribute('aria-pressed', 'true');

    await abrirTabela('Vendas por hora');
    expect(within(secao).queryByRole('img', { name: /por hora do dia/i })).not.toBeInTheDocument();
    expect(within(secao).getByRole('button', { name: 'Tabela' })).toHaveAttribute('aria-pressed', 'true');
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
    expect(await abrirTabela('Vendas por hora')).toHaveTextContent('R$ 105.000,00');
  });

  it('abrevia o dia da semana no eixo e mantém o nome completo na tabela', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const secao = screen.getByRole('region', { name: 'Vendas por dia da semana' });
    const grafico = await within(secao).findByRole('img', { name: /dia da semana/i });
    await waitFor(() => expect(grafico.textContent).toContain('Dom'));
    expect(grafico.textContent).toContain('Seg');
    expect(grafico.textContent).not.toContain('Domingo');
    expect(grafico.textContent).not.toContain('Segunda-feira');

    const t = await abrirTabela('Vendas por dia da semana');
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

    expect(screen.getAllByRole('status', { name: /carregando/i }).length).toBeGreaterThan(0);
  });

  it('503 em um gráfico mostra o estado "dados não preparados" apenas nele', async () => {
    obterVendasPorHora.mockRejectedValue(Object.assign(new Error('Execute o job de agregação.'), { status: 503 }));
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Dados desse período ainda não foram preparados');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('mostra erro apenas no gráfico que falhou, sem derrubar os demais', async () => {
    obterVendasPorDiaSemana.mockRejectedValue(new Error('Falha ao consultar o servidor.'));
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Falha ao consultar o servidor.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    expect(within(await abrirTabela('Vendas por hora')).getAllByRole('row')).toHaveLength(26);
    expect(await abrirTabela('Vendas por forma de pagamento')).toHaveTextContent('Dinheiro');
  });

  it('renderiza dia da semana e forma de pagamento (incluindo forma sem identificação)', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    expect(await abrirTabela('Vendas por dia da semana')).toHaveTextContent('Segunda-feira');
    expect(await abrirTabela('Vendas por forma de pagamento')).toHaveTextContent('Não informada');
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

    const t = await abrirTabela('Vendas por departamento');
    fireEvent.click(within(t).getByRole('button', { name: /Bebidas/ }));

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

    const t = await abrirTabela('Vendas por departamento');
    fireEvent.click(within(t).getByRole('button', { name: /Bebidas/ }));

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
    expect(within(secao).queryByRole('table')).not.toBeInTheDocument();
  });

  it('usa cabeçalho de linha na primeira coluna de todas as linhas do departamento', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const t = await abrirTabela('Vendas por departamento');
    // 2 departamentos + a linha "Total" do rodapé
    expect(within(t).getAllByRole('rowheader')).toHaveLength(3);
    expect(within(t).getByRole('rowheader', { name: 'Sem departamento' })).toBeInTheDocument();
  });

  it('não permite drill-down na linha "Sem departamento"', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const t = await abrirTabela('Vendas por departamento');
    expect(within(t).queryByRole('button', { name: /Sem departamento/ })).not.toBeInTheDocument();
    expect(within(t).getByRole('button', { name: /Bebidas/ })).toBeInTheDocument();
  });

  it('destaca com a cor de pico apenas a barra de maior valor', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);
    const secao = screen.getByRole('region', { name: 'Vendas por hora' });
    const grafico = await within(secao).findByRole('img', { name: /por hora do dia/i });

    expect(destaques(grafico)).toHaveLength(1);
    // a hora 23 tem o maior faturamento (R$ 330) e recebe o rótulo no pico
    await waitFor(() => expect(grafico.textContent).toContain('R$ 330'));
  });

  it('mostra a legenda "Pico do período" somente quando há pico', async () => {
    obterVendasPorDiaSemana.mockResolvedValue({
      porDiaSemana: porDiaSemana.map((item) => ({ ...item, faturamento: 0 })),
    });
    render(<VendasCharts inicio={INICIO} fim={FIM} />);

    const semPico = screen.getByRole('region', { name: 'Vendas por dia da semana' });
    const grafico = await within(semPico).findByRole('img', { name: /dia da semana/i });
    expect(within(semPico).queryByText('Pico do período')).not.toBeInTheDocument();
    expect(destaques(grafico)).toHaveLength(0);

    const comPico = screen.getByRole('region', { name: 'Vendas por hora' });
    expect(await within(comPico).findByText('Pico do período')).toBeInTheDocument();
  });

  it('mostra o valor no fim das barras horizontais', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);
    const secao = screen.getByRole('region', { name: 'Vendas por forma de pagamento' });
    const grafico = await within(secao).findByRole('img', { name: /forma de pagamento/i });

    await waitFor(() => expect(grafico.textContent).toContain('R$ 5 mil'));
    expect(grafico.textContent).toContain('R$ 100');
  });

  it('mostra valor e participação no fim das barras do departamento', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);
    const secao = screen.getByRole('region', { name: 'Vendas por departamento' });
    const grafico = await within(secao).findByRole('img', { name: /por grupo/i });

    await waitFor(() => expect(grafico.textContent).toContain('R$ 1 mil · 66,7%'));
  });

  it('exporta o CSV do departamento com nome de arquivo do período e os valores da API', async () => {
    render(<VendasCharts inicio={INICIO} fim={FIM} />);
    const secao = screen.getByRole('region', { name: 'Vendas por departamento' });
    await within(secao).findByRole('img', { name: /por grupo/i });

    fireEvent.click(within(secao).getByRole('button', { name: 'Exportar CSV' }));

    expect(baixarCsv).toHaveBeenCalledTimes(1);
    const [nome, conteudo] = baixarCsv.mock.calls[0];
    expect(nome).toBe('vendas-departamento-grupo-2026-03-01-2026-03-31.csv');
    expect(conteudo).toContain('Departamento;Faturamento;Quantidade;Participação (%)');
    expect(conteudo).toContain('Bebidas;1000;300;66,7');
    expect(conteudo).toContain('Sem departamento;500;40;33,3');
  });

  it('desabilita a exportação quando o card está sem vendas', async () => {
    obterVendasPorHora.mockResolvedValue({
      porHora: porHora.map((item) => ({ ...item, faturamento: 0, quantidadeCupons: 0 })),
    });
    render(<VendasCharts inicio={INICIO} fim={FIM} />);
    const secao = screen.getByRole('region', { name: 'Vendas por hora' });
    await within(secao).findByText('Sem vendas no período.');
    expect(within(secao).getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
  });
});
