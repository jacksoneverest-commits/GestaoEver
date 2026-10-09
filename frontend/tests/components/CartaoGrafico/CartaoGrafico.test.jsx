import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CartaoGrafico from '../../../src/components/CartaoGrafico/CartaoGrafico.jsx';
import { baixarCsv } from '../../../src/utils/csv.js';

vi.mock('../../../src/utils/csv.js', async (importOriginal) => ({
  ...(await importOriginal()),
  baixarCsv: vi.fn(),
}));

const sucesso = { status: 'sucesso', dados: {}, erro: null };
const carregando = { status: 'carregando', dados: null, erro: null };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('CartaoGrafico', () => {
  it('renderiza o título no cabeçalho junto da área de ações', () => {
    render(
      <CartaoGrafico titulo="Vendas por hora" subtitulo="Faturamento" estado={sucesso} acoes={<button type="button">Ação extra</button>}>
        <p>conteúdo</p>
      </CartaoGrafico>,
    );
    const secao = screen.getByRole('region', { name: 'Vendas por hora' });
    expect(within(secao).getByRole('heading', { name: 'Vendas por hora' })).toBeInTheDocument();
    expect(within(secao).getByText('Faturamento')).toBeInTheDocument();
    expect(within(secao).getByRole('button', { name: 'Ação extra' })).toBeInTheDocument();
    expect(within(secao).getByText('conteúdo')).toBeInTheDocument();
  });

  it('mantém o corpo com o estado de carregamento', () => {
    const { container } = render(<CartaoGrafico titulo="X" estado={carregando} />);
    const corpo = container.querySelector('.cartao-grafico__corpo');
    expect(within(corpo).getByRole('status', { name: /carregando x/i })).toBeInTheDocument();
  });

  it('mantém o corpo com a mensagem de erro', () => {
    const estado = { status: 'erro', dados: null, erro: { tipo: 'erro', mensagem: 'Falhou' } };
    const { container } = render(<CartaoGrafico titulo="X" estado={estado} />);
    expect(within(container.querySelector('.cartao-grafico__corpo')).getByRole('alert')).toHaveTextContent('Falhou');
  });

  it('mantém o corpo com o estado vazio, sem alternância nem conteúdo', () => {
    const { container } = render(
      <CartaoGrafico titulo="X" estado={sucesso} vazio mensagemVazio="Nada aqui." idVisao="x" grafico={<p>g</p>} tabela={<p>t</p>}>
        <p>filho</p>
      </CartaoGrafico>,
    );
    expect(within(container.querySelector('.cartao-grafico__corpo')).getByText('Nada aqui.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tabela' })).not.toBeInTheDocument();
    expect(screen.queryByText('g')).not.toBeInTheDocument();
  });

  it('não usa estilo inline', () => {
    const { container } = render(
      <CartaoGrafico
        titulo="X"
        estado={sucesso}
        idVisao="x"
        grafico={<p>g</p>}
        tabela={<p>t</p>}
        exportacao={{ nomeArquivo: 'a.csv', cabecalho: ['A'], linhas: [[1]] }}
      />,
    );
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  const propsAlternavel = {
    titulo: 'X',
    estado: sucesso,
    idVisao: 'x',
    grafico: <p>visão gráfico</p>,
    tabela: <p>visão tabela</p>,
  };

  it('alterna do gráfico para a tabela no mesmo espaço', () => {
    render(<CartaoGrafico {...propsAlternavel} />);
    expect(screen.getByText('visão gráfico')).toBeInTheDocument();
    expect(screen.queryByText('visão tabela')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tabela' }));
    expect(screen.getByText('visão tabela')).toBeInTheDocument();
    expect(screen.queryByText('visão gráfico')).not.toBeInTheDocument();
  });

  it('volta da tabela para o gráfico', () => {
    render(<CartaoGrafico {...propsAlternavel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tabela' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gráfico' }));
    expect(screen.getByText('visão gráfico')).toBeInTheDocument();
    expect(screen.queryByText('visão tabela')).not.toBeInTheDocument();
  });

  it('reflete a visão atual em aria-pressed', () => {
    render(<CartaoGrafico {...propsAlternavel} />);
    expect(screen.getByRole('button', { name: 'Gráfico' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tabela' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Tabela' }));
    expect(screen.getByRole('button', { name: 'Tabela' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Gráfico' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lembra a visão escolhida no localStorage', () => {
    const props = { titulo: 'X', estado: sucesso, idVisao: 'x', grafico: <p>visão gráfico</p>, tabela: <p>visão tabela</p> };
    const { unmount } = render(<CartaoGrafico {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tabela' }));
    expect(localStorage.getItem('vendas-charts:visao:x')).toBe('tabela');
    unmount();

    render(<CartaoGrafico {...props} />);
    expect(screen.getByText('visão tabela')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tabela' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('funciona quando o localStorage lança exceção', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    render(<CartaoGrafico titulo="X" estado={sucesso} idVisao="x" grafico={<p>visão gráfico</p>} tabela={<p>visão tabela</p>} />);
    expect(screen.getByText('visão gráfico')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tabela' }));
    expect(screen.getByText('visão tabela')).toBeInTheDocument();
  });

  it('exporta o CSV com cabeçalho e linhas ao clicar em Exportar CSV', () => {
    render(
      <CartaoGrafico
        titulo="X"
        estado={sucesso}
        exportacao={{ nomeArquivo: 'vendas-x-2026-03-01-2026-03-31.csv', cabecalho: ['Hora', 'Faturamento'], linhas: [['08h', 10.5]] }}
      >
        <p>c</p>
      </CartaoGrafico>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(baixarCsv).toHaveBeenCalledTimes(1);
    const [nome, conteudo] = baixarCsv.mock.calls[0];
    expect(nome).toBe('vendas-x-2026-03-01-2026-03-31.csv');
    expect(conteudo).toContain('Hora;Faturamento');
    expect(conteudo).toContain('08h;10,5');
  });

  it('explica por que Exportar CSV está desabilitado sem dados', () => {
    render(
      <CartaoGrafico titulo="X" estado={sucesso} exportacao={{ nomeArquivo: 'a.csv', cabecalho: ['A'], linhas: [] }}>
        <p>c</p>
      </CartaoGrafico>,
    );
    const botao = screen.getByRole('button', { name: 'Exportar CSV' });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('title', 'Sem dados para exportar.');
    expect(botao).toHaveAccessibleDescription('Sem dados para exportar.');
  });

  it('explica que Exportar CSV aguarda o carregamento', () => {
    render(<CartaoGrafico titulo="X" estado={carregando} exportacao={{ nomeArquivo: 'a.csv', cabecalho: ['A'], linhas: [] }} />);
    const botao = screen.getByRole('button', { name: 'Exportar CSV' });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAccessibleDescription('Aguarde o carregamento dos dados.');
  });

  it('não adiciona descrição quando Exportar CSV está habilitado', () => {
    render(
      <CartaoGrafico titulo="X" estado={sucesso} exportacao={{ nomeArquivo: 'a.csv', cabecalho: ['A'], linhas: [[1]] }}>
        <p>c</p>
      </CartaoGrafico>,
    );
    const botao = screen.getByRole('button', { name: 'Exportar CSV' });
    expect(botao).toBeEnabled();
    expect(botao).not.toHaveAttribute('title');
  });
});
