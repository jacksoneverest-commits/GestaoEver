import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App.jsx';
import * as authService from '../src/services/authService.js';
import { obterFaturamento } from '../src/services/vendasService.js';
import { obterRanking } from '../src/services/rankingProdutosService.js';
import { listarItens, obterCurvaAbc } from '../src/services/curvaAbcService.js';
import { obterNiveis } from '../src/services/estoqueService.js';

vi.mock('../src/services/authService.js');
vi.mock('../src/services/vendasService.js');
vi.mock('../src/services/rankingProdutosService.js');
vi.mock('../src/services/curvaAbcService.js');
vi.mock('../src/services/estoqueService.js');
vi.mock('../src/pages/Vendas/components/VendasCharts.jsx', () => ({ default: () => null }));

describe('App', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.location.hash = '';
  });

  it('sem token, renderiza a tela de login em vez do dashboard', () => {
    authService.getToken.mockReturnValue(null);
    render(<App />);

    expect(screen.getByText('GestãoEverSoftPlus')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  });

  it('login válido leva ao dashboard e Sair volta ao login', async () => {
    let token = null;
    authService.getToken.mockImplementation(() => token);
    authService.login.mockImplementation(async () => {
      token = 'abc';
      return { token };
    });
    authService.logout.mockImplementation(() => {
      token = null;
    });
    render(<App />);

    fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'gestor' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('button', { name: 'Sair' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/'));

    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('autenticado em #/, mostra o dashboard com link para Vendas', () => {
    authService.getToken.mockReturnValue('abc');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vendas' })).toHaveAttribute('href', '#/vendas');
  });

  it('autenticado em #/vendas, mostra a tela de Vendas e Voltar ao painel retorna ao dashboard', async () => {
    authService.getToken.mockReturnValue('abc');
    obterFaturamento.mockResolvedValue({
      faturamento: 100,
      ticketMedio: 10,
      quantidadeCupons: 10,
      itensPorCompra: 2,
      comparativoPeriodoAnterior: null,
    });
    window.location.hash = '#/vendas';
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Vendas e Faturamento' })).toBeInTheDocument();
    expect(await screen.findByText('Sem comparativo disponível')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Voltar ao painel' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('autenticado, o dashboard tem link para Ranking de Produtos e #/ranking-produtos mostra a tela', async () => {
    authService.getToken.mockReturnValue('abc');
    obterRanking.mockResolvedValue({
      criterio: 'vendas',
      limite: 10,
      itens: [{ posicao: 1, id: 1, nome: 'Arroz', quantidade: 2, faturamento: 10 }],
    });
    const { unmount } = render(<App />);
    expect(screen.getByRole('link', { name: 'Ranking de Produtos' })).toHaveAttribute('href', '#/ranking-produtos');
    unmount();

    window.location.hash = '#/ranking-produtos';
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Ranking de Produtos' })).toBeInTheDocument();
    expect(await screen.findByText('Arroz')).toBeInTheDocument();
  });

  it('autenticado, o dashboard tem link para Curva ABC e #/curva-abc mostra a tela', async () => {
    authService.getToken.mockReturnValue('abc');
    obterCurvaAbc.mockResolvedValue({
      agrupador: 'setor',
      inicio: '2026-08-25',
      fim: '2026-09-23',
      limite: 100,
      totalItens: 1,
      itens: [
        {
          id: 1,
          nome: 'MERCEARIA',
          faturamento: 10,
          lucro: 2,
          valorEstoque: 5,
          participacaoVenda: 100,
          acumuladoVenda: 100,
          classificacaoVenda: 'A',
          classificacaoMargem: 'A',
          classificacaoEstoque: 'A',
          semCusto: false,
        },
      ],
    });
    listarItens.mockResolvedValue({ agrupador: 'setor', limite: 5000, totalItens: 0, itens: [] });
    const { unmount } = render(<App />);
    expect(screen.getByRole('link', { name: 'Curva ABC' })).toHaveAttribute('href', '#/curva-abc');
    unmount();

    window.location.hash = '#/curva-abc';
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Curva ABC' })).toBeInTheDocument();
    expect(await screen.findByRole('rowheader', { name: /MERCEARIA/ })).toBeInTheDocument();
  });

  it('autenticado, o dashboard tem link para Estoque e #/estoque mostra a tela', async () => {
    authService.getToken.mockReturnValue('abc');
    obterNiveis.mockResolvedValue({
      inicio: '2026-08-25',
      fim: '2026-09-23',
      fimSolicitado: '2026-09-23',
      classificacao: 'ruptura',
      limite: 10,
      totalItens: 1,
      resumo: { ruptura: 1, proximoRuptura: 0, excesso: 0 },
      itens: [
        {
          id: 1,
          nome: 'Arroz Tipo 1 5kg',
          estoqueAtual: 0,
          estoqueMinimo: 10,
          estoqueMaximo: 50,
          quantidadeVendida: 12,
          mediaDiaria: 0.4,
          coberturaDias: 0,
          classificacao: 'ruptura',
        },
      ],
    });
    listarItens.mockResolvedValue({ agrupador: 'setor', limite: 5000, totalItens: 0, itens: [] });
    const { unmount } = render(<App />);
    expect(screen.getByRole('link', { name: 'Estoque' })).toHaveAttribute('href', '#/estoque');
    unmount();

    window.location.hash = '#/estoque';
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Estoque Inteligente' })).toBeInTheDocument();
    expect(await screen.findByRole('rowheader', { name: 'Arroz Tipo 1 5kg' })).toBeInTheDocument();
  });

  it('sem token, #/estoque continua exibindo o login', () => {
    authService.getToken.mockReturnValue(null);
    window.location.hash = '#/estoque';
    render(<App />);

    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Estoque Inteligente' })).not.toBeInTheDocument();
  });

  it('sem token, #/curva-abc continua exibindo o login', () => {
    authService.getToken.mockReturnValue(null);
    window.location.hash = '#/curva-abc';
    render(<App />);

    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Curva ABC' })).not.toBeInTheDocument();
  });

  it('sem token, #/ranking-produtos continua exibindo o login', () => {
    authService.getToken.mockReturnValue(null);
    window.location.hash = '#/ranking-produtos';
    render(<App />);

    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ranking de Produtos' })).not.toBeInTheDocument();
  });

  it('sem token, #/vendas continua exibindo o login', () => {
    authService.getToken.mockReturnValue(null);
    window.location.hash = '#/vendas';
    render(<App />);

    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vendas e Faturamento' })).not.toBeInTheDocument();
  });
});
