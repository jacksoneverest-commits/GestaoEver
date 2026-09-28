import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VendasPage from '../../../src/pages/Vendas/VendasPage.jsx';
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

describe('VendasPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Hoje = 24/09/2026 às 23:30 (horário local) — não pode virar 25/09 por causa de UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderiza os KPIs corretamente a partir da resposta da API', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<VendasPage onLogout={() => {}} />);

    expect(await screen.findByText(moeda(125430.5))).toBeInTheDocument();
    expect(screen.getByText(moeda(87.25))).toBeInTheDocument();
    expect(screen.getByText('1.438')).toBeInTheDocument();
    expect(screen.getByText('6,50')).toBeInTheDocument();
    expect(screen.getByText('+18,05%')).toBeInTheDocument();
    expect(screen.getByText(/27\/07\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/25\/08\/2026/)).toBeInTheDocument();
    expect(screen.getByText(`Faturamento anterior: ${moeda(106250)}`)).toBeInTheDocument();
    expect(screen.getByText('Meta não configurada')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // período padrão: últimos 30 dias terminando hoje (data local)
    expect(obterFaturamento).toHaveBeenCalledWith({ inicio: '2026-08-26', fim: '2026-09-24' });
    expect(screen.getByTestId('vendas-charts')).toHaveAttribute('data-inicio', '2026-08-26');
    expect(screen.getByTestId('vendas-charts')).toHaveAttribute('data-fim', '2026-09-24');
  });

  it('exibe estado de erro visível quando a API retorna falha', async () => {
    obterFaturamento.mockRejectedValue(new Error('O período máximo permitido é de 366 dias.'));
    render(<VendasPage onLogout={() => {}} />);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('O período máximo permitido é de 366 dias.');
    expect(screen.queryByText('Meta não configurada')).not.toBeInTheDocument();
  });

  it('exibe estado de carregando enquanto a requisição está pendente', async () => {
    obterFaturamento.mockReturnValue(new Promise(() => {}));
    render(<VendasPage onLogout={() => {}} />);

    expect(screen.getByRole('status')).toHaveTextContent(/carregando/i);
  });

  it('exibe "Sem comparativo disponível" quando o comparativo é null', async () => {
    obterFaturamento.mockResolvedValue({ ...respostaBase, comparativoPeriodoAnterior: null });
    render(<VendasPage onLogout={() => {}} />);

    expect(await screen.findByText('Sem comparativo disponível')).toBeInTheDocument();
    expect(screen.getByText(moeda(125430.5))).toBeInTheDocument();
  });

  it('variação negativa aparece com sinal e seta para baixo', async () => {
    obterFaturamento.mockResolvedValue({
      ...respostaBase,
      comparativoPeriodoAnterior: { ...respostaBase.comparativoPeriodoAnterior, variacaoPercentual: -7.5 },
    });
    render(<VendasPage onLogout={() => {}} />);

    expect(await screen.findByText('-7,50%')).toBeInTheDocument();
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('trocar o período refaz a chamada com as datas novas', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    render(<VendasPage onLogout={() => {}} />);
    await screen.findByText(moeda(125430.5));

    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-09-01' } });

    await waitFor(() =>
      expect(obterFaturamento).toHaveBeenLastCalledWith({ inicio: '2026-09-01', fim: '2026-09-24' })
    );
    expect(obterFaturamento).toHaveBeenCalledTimes(2);
  });

  it('tem link para voltar ao painel e botão Sair', async () => {
    obterFaturamento.mockResolvedValue(respostaBase);
    const onLogout = vi.fn();
    render(<VendasPage onLogout={onLogout} />);
    await screen.findByText(moeda(125430.5));

    expect(screen.getByRole('link', { name: 'Voltar ao painel' })).toHaveAttribute('href', '#/');
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
