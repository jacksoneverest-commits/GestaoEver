import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DashboardPage from '../../../src/pages/Dashboard/DashboardPage.jsx';
import { obterFaturamento } from '../../../src/services/vendasService.js';
import { formatCurrency } from '../../../src/utils/format.js';

// O Intl usa espaço não separável (nbsp); o Testing Library normaliza o texto do DOM para espaço comum.
const moeda = (valor) => formatCurrency(valor).replace(/\s/g, ' ');

vi.mock('../../../src/services/vendasService.js');
vi.mock('../../../src/pages/Vendas/components/VendasCharts.jsx', () => ({
  default: ({ inicio, fim }) => <div data-testid="vendas-charts" data-inicio={inicio} data-fim={fim} />,
}));

const respostaBase = {
  faturamento: 125430.5,
  ticketMedio: 87.25,
  quantidadeCupons: 1438,
  itensPorCompra: 6.5,
  comparativoPeriodoAnterior: {
    periodoInicio: '2026-07-27',
    periodoFim: '2026-08-25',
    faturamento: 106250,
    quantidadeCupons: 1300,
    variacaoPercentual: 18.05,
  },
};

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Hoje = 24/09/2026 às 23:30 (horário local) — não pode virar 25/09 por causa de UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra os 4 KPIs (h2) com valores formatados vindos da API', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<DashboardPage />);

    expect(await screen.findByText(moeda(125430.5))).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Faturamento' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Ticket médio' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Quantidade de cupons' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Itens por compra' })).toBeInTheDocument();
    expect(screen.getByText(moeda(87.25))).toBeInTheDocument();
    expect(screen.getByText('1.438')).toBeInTheDocument();
    expect(screen.getByText('6,50')).toBeInTheDocument();
  });

  it('o período padrão são os últimos 30 dias fechados, terminando ontem', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<DashboardPage />);
    await screen.findByText(moeda(125430.5));

    expect(obterFaturamento).toHaveBeenCalledWith({ inicio: '2026-08-25', fim: '2026-09-23' });
    expect(screen.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('não mostra comparativo com o período anterior (isso fica no módulo Vendas)', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<DashboardPage />);
    await screen.findByText(moeda(125430.5));

    expect(screen.queryByText(/Aumento de|Queda de/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Período anterior/)).not.toBeInTheDocument();
  });

  it('mostra skeletons enquanto carrega', () => {
    obterFaturamento.mockReturnValue(new Promise(() => {}));
    render(<DashboardPage />);

    expect(screen.getAllByRole('status')).toHaveLength(4);
    expect(screen.queryByRole('heading', { level: 2, name: 'Faturamento' })).not.toBeInTheDocument();
  });

  it('mostra a mensagem de erro quando a API falha', async () => {
    obterFaturamento.mockRejectedValue(new Error('Erro ao consultar o servidor. Tente novamente.'));
    render(<DashboardPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao consultar o servidor. Tente novamente.');
    expect(screen.queryByRole('heading', { level: 2, name: 'Faturamento' })).not.toBeInTheDocument();
  });

  it('em 503 mostra que os dados do período ainda não foram preparados', async () => {
    obterFaturamento.mockRejectedValue(Object.assign(new Error('Execute o job de agregação.'), { status: 503 }));
    render(<DashboardPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Dados desse período ainda não foram preparados');
  });

  it('trocar para 7 dias refaz a chamada com os 7 dias fechados até ontem', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<DashboardPage />);
    await screen.findByText(moeda(125430.5));

    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    await screen.findByText(moeda(125430.5));

    expect(obterFaturamento).toHaveBeenLastCalledWith({ inicio: '2026-09-17', fim: '2026-09-23' });
    expect(screen.getByRole('button', { name: '7 dias' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Hoje usa só o dia atual e Mês vai do dia 1 até hoje', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<DashboardPage />);
    await screen.findByText(moeda(125430.5));

    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    await screen.findByText(moeda(125430.5));
    expect(obterFaturamento).toHaveBeenLastCalledWith({ inicio: '2026-09-24', fim: '2026-09-24' });

    fireEvent.click(screen.getByRole('button', { name: 'Mês' }));
    await screen.findByText(moeda(125430.5));
    expect(obterFaturamento).toHaveBeenLastCalledWith({ inicio: '2026-09-01', fim: '2026-09-24' });
  });

  it('o filtro de datas manual (PeriodFilter) também refaz a chamada', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<DashboardPage />);
    await screen.findByText(moeda(125430.5));

    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-09-10' } });
    await screen.findByText(moeda(125430.5));

    expect(obterFaturamento).toHaveBeenLastCalledWith({ inicio: '2026-09-10', fim: '2026-09-23' });
    expect(screen.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('mostra a grade de atalhos dos módulos com links, e Rentabilidade como "Em breve"', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<DashboardPage />);
    await screen.findByText(moeda(125430.5));
    const atalhos = screen.getByRole('region', { name: 'Módulos' });

    expect(within(atalhos).getByRole('link', { name: /^Vendas/ })).toHaveAttribute('href', '#/vendas');
    expect(within(atalhos).getByRole('link', { name: /^Ranking de Produtos/ })).toHaveAttribute('href', '#/ranking-produtos');
    expect(within(atalhos).getByRole('link', { name: /^Curva ABC/ })).toHaveAttribute('href', '#/curva-abc');
    expect(within(atalhos).getByRole('link', { name: /^Estoque/ })).toHaveAttribute('href', '#/estoque');
    expect(within(atalhos).getByRole('link', { name: /^Usuários/ })).toHaveAttribute('href', '#/usuarios');
    expect(within(atalhos).queryByRole('link', { name: /Rentabilidade/ })).not.toBeInTheDocument();
    expect(within(atalhos).getByText('Em breve')).toBeInTheDocument();
  });

  it('reutiliza o gráfico de faturamento diário com o período selecionado', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<DashboardPage />);
    await screen.findByText(moeda(125430.5));

    expect(screen.getByTestId('vendas-charts')).toHaveAttribute('data-inicio', '2026-08-25');
    expect(screen.getByTestId('vendas-charts')).toHaveAttribute('data-fim', '2026-09-23');
  });
});
