import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import RankingProdutosPage from '../../../src/pages/RankingProdutos/RankingProdutosPage.jsx';
import {
  obterRanking,
  obterProdutosParados,
  obterProdutosNovos,
  obterDemandaBaixoEstoque,
} from '../../../src/services/rankingProdutosService.js';
import { formatCurrency } from '../../../src/utils/format.js';

// O Intl usa espaço não separável (nbsp); o Testing Library normaliza o texto do DOM para espaço comum.
const moeda = (valor) => formatCurrency(valor).replace(/\s/g, ' ');

vi.mock('../../../src/services/rankingProdutosService.js');

const PERIODO_PADRAO = { inicio: '2026-08-25', fim: '2026-09-23' };
// A pagina envia SEMPRE `limite` (padrao 10) nas visoes que aceitam limite.
const CHAMADA_PADRAO = { ...PERIODO_PADRAO, limite: 10 };

const respostaVendas = {
  criterio: 'vendas',
  limite: 10,
  itens: [
    { posicao: 1, id: 10, nome: 'Arroz Tipo 1 5kg', quantidade: 120, faturamento: 3600 },
    { posicao: 2, id: 11, nome: 'Feijão Carioca 1kg', quantidade: 12.5, faturamento: 900.5 },
  ],
};

const respostaFaturamento = {
  criterio: 'faturamento',
  limite: 10,
  itens: [{ posicao: 1, id: 30, nome: 'Carne Bovina Kg', quantidade: 40, faturamento: 5000 }],
};

const respostaMargem = {
  criterio: 'margem',
  limite: 10,
  itens: [
    { posicao: 1, id: 10, nome: 'Café Torrado 500g', quantidade: 10, faturamento: 200, custoTotal: 120, lucro: 80, margemPercentual: 40, semCusto: false },
    { posicao: 2, id: 99, nome: 'Produto Novo Sem Custo', quantidade: 3, faturamento: 45, custoTotal: null, lucro: null, margemPercentual: null, semCusto: true },
  ],
};

const respostaCrescimento = {
  criterio: 'crescimento',
  limite: 10,
  inicio: '2026-08-25',
  fim: '2026-09-23',
  fimSolicitado: '2026-09-23',
  periodoAnterior: { inicio: '2026-07-26', fim: '2026-08-24' },
  itens: [
    { posicao: 1, id: 1, nome: 'Suco de Uva', faturamentoAtual: 1500, faturamentoAnterior: 1000, variacao: 500, variacaoPercentual: 50 },
    { posicao: 2, id: 2, nome: 'Item Lançado', faturamentoAtual: 300, faturamentoAnterior: 0, variacao: 300, variacaoPercentual: null },
  ],
};

function erroHttp(status, mensagem) {
  return Object.assign(new Error(mensagem), { status });
}

function selecionarCriterio(valor) {
  fireEvent.change(screen.getByLabelText('Critério'), { target: { value: valor } });
}

describe('RankingProdutosPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Hoje = 24/09/2026 às 23:30 (horário local): o período padrão termina ONTEM (23/09).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exibe tabela com os produtos retornados para o critério selecionado por padrão', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    render(<RankingProdutosPage onLogout={() => {}} />);

    const tabela = await screen.findByRole('table');
    expect(screen.getByLabelText('Critério')).toHaveValue('vendas');
    expect(obterRanking).toHaveBeenCalledWith({ criterio: 'vendas', ...CHAMADA_PADRAO });

    expect(within(tabela).getByRole('columnheader', { name: 'Produto' })).toHaveAttribute('scope', 'col');
    const linhas = within(tabela).getAllByRole('row');
    expect(linhas).toHaveLength(3); // cabeçalho + 2 produtos
    expect(within(linhas[1]).getByRole('rowheader', { name: 'Arroz Tipo 1 5kg' })).toBeInTheDocument();
    const celulas = within(linhas[1]).getAllByRole('cell');
    expect(celulas[0]).toHaveTextContent(/^1$/); // posição
    expect(celulas[1]).toHaveTextContent(/^120$/); // quantidade
    expect(within(linhas[1]).getByText(moeda(3600))).toBeInTheDocument();
    expect(within(linhas[2]).getByText('12,5')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('trocar o critério refaz a chamada à API e atualiza a tabela sem recarregar a página', async () => {
    obterRanking.mockImplementation(async ({ criterio }) => (criterio === 'faturamento' ? respostaFaturamento : respostaVendas));
    render(<RankingProdutosPage onLogout={() => {}} />);
    expect(await screen.findByText('Arroz Tipo 1 5kg')).toBeInTheDocument();

    selecionarCriterio('faturamento');

    expect(await screen.findByText('Carne Bovina Kg')).toBeInTheDocument();
    expect(obterRanking).toHaveBeenCalledTimes(2);
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'faturamento', ...CHAMADA_PADRAO });
    expect(screen.queryByText('Arroz Tipo 1 5kg')).not.toBeInTheDocument();
    expect(screen.getByText(moeda(5000))).toBeInTheDocument();
  });

  it('exibe o estado de carregando enquanto a requisição está pendente', () => {
    obterRanking.mockReturnValue(new Promise(() => {}));
    render(<RankingProdutosPage onLogout={() => {}} />);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando ranking...');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('exibe o erro genérico da API em um alerta', async () => {
    obterRanking.mockRejectedValue(new Error('Erro ao consultar o servidor. Tente novamente.'));
    render(<RankingProdutosPage onLogout={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao consultar o servidor. Tente novamente.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Ainda indisponível')).not.toBeInTheDocument();
  });

  it('em 503 exibe que os dados do período ainda não foram preparados, com a mensagem do servidor', async () => {
    obterRanking.mockRejectedValue(erroHttp(503, 'Execute o job de agregação para o período.'));
    render(<RankingProdutosPage onLogout={() => {}} />);

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Dados desse período ainda não foram preparados');
    expect(aviso).toHaveTextContent('Execute o job de agregação para o período.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('em 501 (tratamento genérico, qualquer visão) exibe "Ainda indisponível" com a mensagem do servidor', async () => {
    obterRanking.mockRejectedValue(erroHttp(501, 'Recurso ainda não implementado.'));
    render(<RankingProdutosPage onLogout={() => {}} />);

    expect(await screen.findByText('Ainda indisponível')).toBeInTheDocument();
    expect(screen.getByText(/Recurso ainda não implementado\./)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('exibe mensagem de estado vazio quando a API não retorna produtos', async () => {
    obterRanking.mockResolvedValue({ criterio: 'vendas', limite: 10, itens: [] });
    render(<RankingProdutosPage onLogout={() => {}} />);

    expect(await screen.findByText('Nenhum produto encontrado para o período e critério selecionados.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('refaz a chamada ao mudar o período pelo PeriodFilter', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-09-20' } });

    await screen.findByRole('table');
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'vendas', inicio: '2026-08-25', fim: '2026-09-20', limite: 10 });
  });

  it('na visão margem mostra custo total, lucro e margem percentual', async () => {
    obterRanking.mockImplementation(async ({ criterio }) => (criterio === 'margem' ? respostaMargem : respostaVendas));
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    selecionarCriterio('margem');

    const tabela = await screen.findByRole('table', { name: /margem/i });
    expect(within(tabela).getByRole('columnheader', { name: 'Custo total' })).toBeInTheDocument();
    expect(within(tabela).getByRole('columnheader', { name: 'Lucro' })).toBeInTheDocument();
    expect(within(tabela).getByRole('columnheader', { name: 'Margem' })).toBeInTheDocument();
    const linha = within(tabela).getByRole('rowheader', { name: 'Café Torrado 500g' }).closest('tr');
    expect(within(linha).getByText(moeda(120))).toBeInTheDocument();
    expect(within(linha).getByText(moeda(80))).toBeInTheDocument();
    expect(within(linha).getByText('40,00%')).toBeInTheDocument();
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'margem', ...CHAMADA_PADRAO, ordenarPor: 'lucro' });
  });

  it('destaca em vermelho e com o texto "Sem custo cadastrado" as linhas semCusto, com valores nulos como "—"', async () => {
    obterRanking.mockResolvedValue(respostaMargem);
    render(<RankingProdutosPage onLogout={() => {}} />);
    selecionarCriterio('margem');

    const linha = (await screen.findByRole('rowheader', { name: /Produto Novo Sem Custo/ })).closest('tr');
    expect(linha).toHaveClass('ranking__linha--sem-custo');
    expect(within(linha).getByText('Sem custo cadastrado')).toBeInTheDocument();
    expect(within(linha).getAllByText('—')).toHaveLength(3);
    const linhaComCusto = screen.getByRole('rowheader', { name: 'Café Torrado 500g' }).closest('tr');
    expect(linhaComCusto).not.toHaveClass('ranking__linha--sem-custo');
  });

  it('o seletor "Ordenar por" só aparece na visão margem e refaz a chamada com ordenarPor', async () => {
    obterRanking.mockResolvedValue(respostaMargem);
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Ordenar por')).not.toBeInTheDocument();

    selecionarCriterio('margem');
    const ordenarPor = await screen.findByLabelText('Ordenar por');
    expect(ordenarPor).toHaveValue('lucro');

    fireEvent.change(ordenarPor, { target: { value: 'margemPercentual' } });

    await screen.findByRole('table');
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'margem', ...CHAMADA_PADRAO, ordenarPor: 'margemPercentual' });
  });

  it('em crescimento mostra faturamento atual e anterior, variação em R$ e %, e o período anterior usado', async () => {
    obterRanking.mockResolvedValue(respostaCrescimento);
    render(<RankingProdutosPage onLogout={() => {}} />);
    selecionarCriterio('crescimento');

    const linha = (await screen.findByRole('rowheader', { name: 'Suco de Uva' })).closest('tr');
    expect(within(linha).getByText(moeda(1500))).toBeInTheDocument();
    expect(within(linha).getByText(moeda(1000))).toBeInTheDocument();
    expect(within(linha).getByText(moeda(500))).toBeInTheDocument();
    expect(within(linha).getByText('+50,00%')).toBeInTheDocument();
    expect(screen.getByText(/Período anterior: 26\/07\/2026 a 24\/08\/2026/)).toBeInTheDocument();
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'crescimento', ...CHAMADA_PADRAO });
  });

  it('em queda/crescimento, variação percentual null (produto sem histórico) aparece como "—"', async () => {
    obterRanking.mockResolvedValue({ ...respostaCrescimento, criterio: 'queda' });
    render(<RankingProdutosPage onLogout={() => {}} />);
    selecionarCriterio('queda');

    const linha = (await screen.findByRole('rowheader', { name: 'Item Lançado' })).closest('tr');
    expect(within(linha).getByText('—')).toBeInTheDocument();
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'queda', ...CHAMADA_PADRAO });
  });

  it('avisa quando o período foi ajustado porque só dias encerrados são considerados', async () => {
    obterRanking.mockResolvedValue({ ...respostaCrescimento, fim: '2026-09-23', fimSolicitado: '2026-09-25' });
    render(<RankingProdutosPage onLogout={() => {}} />);
    selecionarCriterio('crescimento');

    expect(await screen.findByText('Período ajustado até 23/09/2026: só dias encerrados')).toBeInTheDocument();
  });

  it('não exibe aviso de período ajustado quando o fim efetivo é o solicitado', async () => {
    obterRanking.mockResolvedValue(respostaCrescimento);
    render(<RankingProdutosPage onLogout={() => {}} />);
    selecionarCriterio('crescimento');

    await screen.findByRole('rowheader', { name: 'Suco de Uva' });
    expect(screen.queryByText(/Período ajustado/)).not.toBeInTheDocument();
  });

  it('a visão sem nenhuma venda no período usa esse rótulo no seletor, no título da seção e na legenda da tabela (nunca "Produtos parados")', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    obterProdutosParados.mockResolvedValue({
      inicio: '2026-08-25',
      fim: '2026-09-23',
      limite: 10,
      itens: [{ id: 5, nome: 'Vinagre 750ml' }],
    });
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    const opcao = within(screen.getByLabelText('Critério')).getByRole('option', { name: 'Sem nenhuma venda no período' });
    expect(opcao).toHaveValue('parados'); // o valor interno da visão não muda
    selecionarCriterio('parados');

    const tabela = await screen.findByRole('table', { name: 'Produtos sem nenhuma venda no período' });
    expect(within(tabela).getByText('Produtos sem nenhuma venda no período', { selector: 'caption' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Produtos sem nenhuma venda no período' })).toBeInTheDocument();
    expect(screen.queryByText(/Produtos parados/)).not.toBeInTheDocument();
  });

  it('na visão sem nenhuma venda no período lista os produtos retornados', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    obterProdutosParados.mockResolvedValue({
      inicio: '2026-08-25',
      fim: '2026-09-23',
      limite: 10,
      itens: [{ id: 5, nome: 'Vinagre 750ml' }],
    });
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    selecionarCriterio('parados');

    expect(await screen.findByRole('rowheader', { name: 'Vinagre 750ml' })).toBeInTheDocument();
    expect(obterProdutosParados).toHaveBeenCalledWith(CHAMADA_PADRAO);
  });

  it('na visão produtos novos mostra a primeira venda, quantidade e faturamento', async () => {
    obterProdutosNovos.mockResolvedValue({
      inicio: '2026-08-25',
      fim: '2026-09-23',
      fimSolicitado: '2026-09-23',
      limite: 10,
      itens: [{ id: 7, nome: 'Biscoito Novo', primeiraVenda: '2026-09-10', quantidade: 8, faturamento: 64 }],
    });
    obterRanking.mockResolvedValue(respostaVendas);
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    selecionarCriterio('novos');

    const linha = (await screen.findByRole('rowheader', { name: 'Biscoito Novo' })).closest('tr');
    expect(within(linha).getByText('10/09/2026')).toBeInTheDocument();
    expect(within(linha).getByText(moeda(64))).toBeInTheDocument();
    expect(obterProdutosNovos).toHaveBeenCalledWith(CHAMADA_PADRAO);
  });

  it('na visão margem exibe a margem percentual com 2 casas decimais', async () => {
    obterRanking.mockResolvedValue({
      ...respostaMargem,
      itens: [{ ...respostaMargem.itens[0], margemPercentual: 32.456 }],
    });
    render(<RankingProdutosPage onLogout={() => {}} />);
    selecionarCriterio('margem');

    const linha = (await screen.findByRole('rowheader', { name: 'Café Torrado 500g' })).closest('tr');
    expect(within(linha).getByText('32,46%')).toBeInTheDocument();
  });

  it('a coluna Posição aparece nas visões ranqueadas', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    render(<RankingProdutosPage onLogout={() => {}} />);

    const tabela = await screen.findByRole('table');
    expect(within(tabela).getByRole('columnheader', { name: 'Posição' })).toBeInTheDocument();
  });

  it('oculta a coluna Posição na visão sem nenhuma venda no período (lista alfabética, sem posição)', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    obterProdutosParados.mockResolvedValue({
      inicio: '2026-08-25',
      fim: '2026-09-23',
      limite: 10,
      itens: [{ id: 5, nome: 'Vinagre 750ml' }],
    });
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    selecionarCriterio('parados');

    const linha = (await screen.findByRole('rowheader', { name: 'Vinagre 750ml' })).closest('tr');
    expect(screen.queryByRole('columnheader', { name: 'Posição' })).not.toBeInTheDocument();
    expect(within(linha).queryAllByRole('cell')).toHaveLength(0);
  });

  it('oculta a coluna Posição na visão produtos novos (ordenados por faturamento, sem posição)', async () => {
    obterProdutosNovos.mockResolvedValue({
      inicio: '2026-08-25',
      fim: '2026-09-23',
      fimSolicitado: '2026-09-23',
      limite: 10,
      itens: [{ id: 7, nome: 'Biscoito Novo', primeiraVenda: '2026-09-10', quantidade: 8, faturamento: 64 }],
    });
    obterRanking.mockResolvedValue(respostaVendas);
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    selecionarCriterio('novos');

    await screen.findByRole('rowheader', { name: 'Biscoito Novo' });
    expect(screen.queryByRole('columnheader', { name: 'Posição' })).not.toBeInTheDocument();
  });

  it('avisa "Exibindo os N primeiros produtos" quando a lista atinge o limite', async () => {
    obterRanking.mockResolvedValue({ ...respostaVendas, limite: 2 });
    render(<RankingProdutosPage onLogout={() => {}} />);

    expect(await screen.findByText('Exibindo os 2 primeiros produtos')).toBeInTheDocument();
  });

  it('não exibe o aviso de lista limitada quando a lista tem menos itens que o limite', async () => {
    obterRanking.mockResolvedValue(respostaVendas); // 2 itens, limite 10
    render(<RankingProdutosPage onLogout={() => {}} />);

    await screen.findByRole('table');
    expect(screen.queryByText(/Exibindo os/)).not.toBeInTheDocument();
  });

  it('o aviso de período ajustado é anunciado como status', async () => {
    obterRanking.mockResolvedValue({ ...respostaCrescimento, fim: '2026-09-23', fimSolicitado: '2026-09-25' });
    render(<RankingProdutosPage onLogout={() => {}} />);
    selecionarCriterio('crescimento');

    const aviso = await screen.findByText(/Período ajustado até/);
    expect(aviso).toHaveAttribute('role', 'status');
  });

  it('o contêiner rolável da tabela é uma região focável e nomeada', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    render(<RankingProdutosPage onLogout={() => {}} />);

    const regiao = await screen.findByRole('region', { name: 'Tabela do ranking de produtos' });
    expect(regiao).toHaveAttribute('tabindex', '0');
    expect(within(regiao).getByRole('table')).toBeInTheDocument();
  });
});

describe('RankingProdutosPage - quantidade de itens (limite)', () => {
  // Timers falsos (inclui setTimeout) para controlar o debounce do campo sem esperas reais.
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
    const vazio = (limite) => ({ criterio: 'vendas', limite, itens: [] });
    obterRanking.mockResolvedValue(vazio(10));
    obterProdutosParados.mockResolvedValue(vazio(10));
    obterProdutosNovos.mockResolvedValue(vazio(10));
    obterDemandaBaixoEstoque.mockResolvedValue({ ...PERIODO_PADRAO, limite: 10, itens: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const avancar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const DEBOUNCE = 500; // maior que o debounce interno da página

  async function renderizar() {
    render(<RankingProdutosPage onLogout={() => {}} />);
    await avancar(0);
  }

  const campoQuantidade = () => screen.getByLabelText('Quantidade de itens');

  async function digitar(valor) {
    fireEvent.change(campoQuantidade(), { target: { value: valor } });
    await avancar(DEBOUNCE);
  }

  async function trocarCriterio(valor) {
    selecionarCriterio(valor);
    await avancar(0);
  }

  it('por padrão a chamada à API envia limite=10 em todas as visões, inclusive parados e novos', async () => {
    await renderizar();
    expect(campoQuantidade()).toHaveValue(10);
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'vendas', ...CHAMADA_PADRAO });

    for (const criterio of ['faturamento', 'crescimento', 'queda']) {
      await trocarCriterio(criterio);
      expect(obterRanking).toHaveBeenLastCalledWith({ criterio, ...CHAMADA_PADRAO });
      expect(campoQuantidade()).toHaveValue(10);
    }
    await trocarCriterio('margem');
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'margem', ...CHAMADA_PADRAO, ordenarPor: 'lucro' });
    await trocarCriterio('parados');
    expect(obterProdutosParados).toHaveBeenLastCalledWith(CHAMADA_PADRAO);
    expect(campoQuantidade()).toHaveValue(10);
    await trocarCriterio('novos');
    expect(obterProdutosNovos).toHaveBeenLastCalledWith(CHAMADA_PADRAO);
    expect(campoQuantidade()).toHaveValue(10);
  });

  it('alterar a quantidade refaz a chamada com o novo limite e atualiza a tabela; valor acima do máximo ou inválido não dispara chamada e mostra mensagem clara', async () => {
    obterRanking.mockImplementation(async ({ limite }) => (limite === 25 ? respostaFaturamento : respostaVendas));
    await renderizar();
    expect(screen.getByText('Arroz Tipo 1 5kg')).toBeInTheDocument();
    expect(obterRanking).toHaveBeenCalledTimes(1);

    await digitar('25');

    expect(obterRanking).toHaveBeenCalledTimes(2);
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'vendas', ...PERIODO_PADRAO, limite: 25 });
    expect(screen.getByText('Carne Bovina Kg')).toBeInTheDocument();
    expect(screen.queryByText('Arroz Tipo 1 5kg')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await digitar('101'); // acima do máximo do ranking (100)

    expect(obterRanking).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um número inteiro de 1 a 100.');
    expect(screen.getByText('Carne Bovina Kg')).toBeInTheDocument(); // tabela anterior continua visível

    await digitar('2.5'); // inválido (decimal)
    expect(obterRanking).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um número inteiro de 1 a 100.');

    await digitar('100'); // volta a ser válido: a mensagem some e a chamada é refeita
    expect(obterRanking).toHaveBeenCalledTimes(3);
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'vendas', ...PERIODO_PADRAO, limite: 100 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['vazio', ''],
    ['zero', '0'],
    ['negativo', '-3'],
    ['decimal', '2.5'],
    ['acima do máximo', '101'],
    ['notação científica', '1e1'],
  ])('valor %s não dispara chamada, sinaliza o campo como inválido e associa a mensagem via aria-describedby', async (_nome, valor) => {
    await renderizar();
    const campo = campoQuantidade();
    expect(campo).not.toHaveAttribute('aria-invalid', 'true');

    await digitar(valor);

    expect(obterRanking).toHaveBeenCalledTimes(1);
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Informe um número inteiro de 1 a 100.');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription('Informe um número inteiro de 1 a 100.');
    expect(campo.getAttribute('aria-describedby')).toBe(alerta.id);
  });

  it('não chama a API a cada tecla: só uma chamada, com o valor final, depois da pausa na digitação', async () => {
    await renderizar();

    fireEvent.change(campoQuantidade(), { target: { value: '2' } });
    await avancar(100);
    fireEvent.change(campoQuantidade(), { target: { value: '25' } });
    await avancar(100);
    expect(obterRanking).toHaveBeenCalledTimes(1);

    await avancar(DEBOUNCE);

    expect(obterRanking).toHaveBeenCalledTimes(2);
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'vendas', ...PERIODO_PADRAO, limite: 25 });
  });

  it('voltar ao valor já aplicado não refaz a chamada', async () => {
    await renderizar();

    await digitar('10');

    expect(obterRanking).toHaveBeenCalledTimes(1);
  });

  it('parados e novos aceitam até 500; acima disso a mensagem cita o máximo da visão e min/max do campo acompanham a visão', async () => {
    await renderizar();
    expect(campoQuantidade()).toHaveAttribute('min', '1');
    expect(campoQuantidade()).toHaveAttribute('max', '100');

    await trocarCriterio('parados');
    expect(campoQuantidade()).toHaveAttribute('max', '500');
    await digitar('300');
    expect(obterProdutosParados).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 300 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await digitar('501');
    expect(obterProdutosParados).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um número inteiro de 1 a 500.');

    await digitar('500');
    expect(obterProdutosParados).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 500 });

    await trocarCriterio('novos');
    expect(campoQuantidade()).toHaveAttribute('max', '500');
    expect(campoQuantidade()).toHaveValue(500);
    expect(obterProdutosNovos).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 500 });
  });

  it('ao trocar para uma visão com máximo menor que o valor atual, volta ao padrão 10 e chama a API com 10', async () => {
    await renderizar();
    await trocarCriterio('parados');
    await digitar('200');
    expect(obterProdutosParados).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 200 });

    await trocarCriterio('vendas');

    expect(campoQuantidade()).toHaveValue(10);
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'vendas', ...CHAMADA_PADRAO });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ao trocar para uma visão em que o valor atual continua válido, mantém a quantidade escolhida', async () => {
    await renderizar();
    await digitar('80');

    await trocarCriterio('faturamento');

    expect(campoQuantidade()).toHaveValue(80);
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'faturamento', ...PERIODO_PADRAO, limite: 80 });
  });

  it('ao trocar de visão com o campo inválido, volta ao padrão 10 e limpa a mensagem', async () => {
    await renderizar();
    await digitar('');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await trocarCriterio('faturamento');

    expect(campoQuantidade()).toHaveValue(10);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'faturamento', ...CHAMADA_PADRAO });
  });

  it('oferece sugestões (datalist) de 10 a 100 no ranking e até 500 em parados', async () => {
    await renderizar();
    const campo = campoQuantidade();
    const opcoes = () => Array.from(document.getElementById(campo.getAttribute('list')).options).map((o) => o.value);

    expect(campo).toHaveAttribute('type', 'number');
    expect(opcoes()).toEqual(['10', '25', '50', '100']);

    await trocarCriterio('parados');
    expect(opcoes()).toEqual(['10', '25', '50', '100', '250', '500']);
  });

  it('o aviso "Exibindo os N primeiros produtos" reflete o limite pedido', async () => {
    obterRanking.mockImplementation(async ({ limite }) => ({
      criterio: 'vendas',
      limite,
      itens: respostaVendas.itens
        .concat([{ posicao: 3, id: 12, nome: 'Açúcar 1kg', quantidade: 5, faturamento: 20 }])
        .slice(0, limite),
    }));
    await renderizar();
    expect(screen.queryByText(/Exibindo os/)).not.toBeInTheDocument();

    await digitar('3');

    expect(screen.getByText('Exibindo os 3 primeiros produtos')).toBeInTheDocument();
  });

  it('a visão alta demanda / baixo estoque também tem o controle: padrão 10, máximo 500 e sugestões até 500', async () => {
    obterDemandaBaixoEstoque.mockResolvedValue({ ...PERIODO_PADRAO, limite: 10, itens: [] });
    await renderizar();

    await trocarCriterio('demanda-baixo-estoque');

    expect(campoQuantidade()).toHaveValue(10);
    expect(campoQuantidade()).toHaveAttribute('max', '500');
    expect(obterDemandaBaixoEstoque).toHaveBeenLastCalledWith(CHAMADA_PADRAO);
    const opcoes = Array.from(document.getElementById(campoQuantidade().getAttribute('list')).options).map((o) => o.value);
    expect(opcoes).toEqual(['10', '25', '50', '100', '250', '500']);
  });

  it('em alta demanda / baixo estoque alterar a quantidade refaz a chamada; acima de 500 ou inválido não chama e cita o máximo', async () => {
    obterDemandaBaixoEstoque.mockResolvedValue({ ...PERIODO_PADRAO, limite: 10, itens: [] });
    await renderizar();
    await trocarCriterio('demanda-baixo-estoque');
    expect(obterDemandaBaixoEstoque).toHaveBeenCalledTimes(1);

    await digitar('300');
    expect(obterDemandaBaixoEstoque).toHaveBeenCalledTimes(2);
    expect(obterDemandaBaixoEstoque).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 300 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await digitar('501');
    expect(obterDemandaBaixoEstoque).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um número inteiro de 1 a 500.');

    await digitar('0');
    expect(obterDemandaBaixoEstoque).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um número inteiro de 1 a 500.');

    await digitar('500');
    expect(obterDemandaBaixoEstoque).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 500 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ao trocar entre parados e alta demanda / baixo estoque mantém a quantidade; ao voltar ao ranking (máx. 100) com 300 volta ao padrão 10', async () => {
    obterDemandaBaixoEstoque.mockResolvedValue({ ...PERIODO_PADRAO, limite: 10, itens: [] });
    await renderizar();
    await trocarCriterio('parados');
    await digitar('300');

    await trocarCriterio('demanda-baixo-estoque');
    expect(campoQuantidade()).toHaveValue(300);
    expect(obterDemandaBaixoEstoque).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 300 });

    await trocarCriterio('vendas');
    expect(campoQuantidade()).toHaveValue(10);
    expect(obterRanking).toHaveBeenLastCalledWith({ criterio: 'vendas', ...CHAMADA_PADRAO });
  });
});

describe('RankingProdutosPage - visão alta demanda / baixo estoque', () => {
  const itemCerveja = {
    id: 15407,
    nome: 'CERVEJA ANTARCTICA LT 473ML GELADA',
    quantidadeVendida: 636,
    mediaDiaria: 42.4,
    estoqueAtual: 0,
    estoqueMinimo: 0,
    estoqueMaximo: 0,
    coberturaDias: 0,
    motivo: 'abaixo_minimo_e_cobertura_baixa',
  };
  const itemTomate = {
    id: 2723,
    nome: 'FLV TOMATE KG',
    quantidadeVendida: 148.112,
    mediaDiaria: 9.87,
    estoqueAtual: -1.63,
    estoqueMinimo: 10,
    estoqueMaximo: 40,
    coberturaDias: 0,
    motivo: 'abaixo_minimo_e_cobertura_baixa',
  };
  const itemArroz = {
    id: 3,
    nome: 'ARROZ TIPO 1 5KG',
    quantidadeVendida: 120,
    mediaDiaria: 4,
    estoqueAtual: 20,
    estoqueMinimo: null,
    estoqueMaximo: null,
    coberturaDias: 5,
    motivo: 'cobertura_baixa',
  };
  const itemLeite = {
    id: 4,
    nome: 'LEITE INTEGRAL 1L',
    quantidadeVendida: 30,
    mediaDiaria: 1,
    estoqueAtual: 8,
    estoqueMinimo: 10,
    estoqueMaximo: 50,
    coberturaDias: 8,
    motivo: 'abaixo_minimo',
  };
  const itemSemEstoque = {
    id: 5,
    nome: 'PRODUTO SEM ESTOQUE INFORMADO',
    quantidadeVendida: 7,
    mediaDiaria: 0.23,
    estoqueAtual: null,
    estoqueMinimo: null,
    estoqueMaximo: null,
    coberturaDias: null,
    motivo: 'motivo_novo',
  };

  const respostaDemanda = {
    ...PERIODO_PADRAO,
    limite: 10,
    itens: [itemCerveja, itemTomate, itemArroz, itemLeite, itemSemEstoque],
  };

  async function abrirVisao(resposta = respostaDemanda) {
    obterRanking.mockResolvedValue(respostaVendas);
    obterDemandaBaixoEstoque.mockResolvedValue(resposta);
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');
    selecionarCriterio('demanda-baixo-estoque');
    return screen.findByRole('table', { name: /alta demanda e baixo estoque/i });
  }

  const linhaDe = (nome) => screen.getByRole('rowheader', { name: new RegExp(nome) }).closest('tr');

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exibe a tabela com produto, vendido no período, média/dia, estoque atual, mínimo, cobertura em dias e a situação, a partir da resposta', async () => {
    const tabela = await abrirVisao();

    const cabecalhos = within(tabela).getAllByRole('columnheader').map((th) => th.textContent);
    expect(cabecalhos).toEqual([
      'Posição',
      'Produto',
      'Vendido no período',
      'Média/dia',
      'Estoque atual',
      'Mínimo',
      'Cobertura (dias)',
      'Situação',
    ]);
    within(tabela).getAllByRole('columnheader').forEach((th) => expect(th).toHaveAttribute('scope', 'col'));

    const linha = linhaDe('LEITE INTEGRAL 1L');
    const celulas = within(linha).getAllByRole('cell').map((td) => td.textContent);
    expect(celulas).toEqual(['4', '30', '1,00', '8', '10', '8,00', 'Abaixo do mínimo']);
    expect(obterDemandaBaixoEstoque).toHaveBeenCalledWith(CHAMADA_PADRAO);
  });

  it('estoque negativo ou nulo e mínimo nulo aparecem de forma legível (sem NaN/undefined) e a chamada envia limite', async () => {
    const tabela = await abrirVisao();

    const tomate = within(linhaDe('FLV TOMATE KG')).getAllByRole('cell');
    expect(tomate[3]).toHaveTextContent('-1,63');
    expect(tomate[3]).toHaveTextContent('Negativo');
    expect(tomate[1]).toHaveTextContent('148,112'); // quantidade decimal (item por kg)
    expect(tomate[2]).toHaveTextContent('9,87');

    const arroz = within(linhaDe('ARROZ TIPO 1 5KG')).getAllByRole('cell');
    expect(arroz[4]).toHaveTextContent(/^—$/); // mínimo nulo

    const semEstoque = within(linhaDe('PRODUTO SEM ESTOQUE INFORMADO')).getAllByRole('cell');
    expect(semEstoque[3]).toHaveTextContent(/^—$/); // estoque nulo
    expect(semEstoque[4]).toHaveTextContent(/^—$/); // mínimo nulo
    expect(semEstoque[5]).toHaveTextContent(/^—$/); // cobertura nula

    expect(tabela.textContent).not.toMatch(/NaN|undefined|null/);
    expect(obterDemandaBaixoEstoque).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 10 });
  });

  it('estoque zero não é marcado como negativo', async () => {
    await abrirVisao();

    const cerveja = within(linhaDe('CERVEJA ANTARCTICA')).getAllByRole('cell');
    expect(cerveja[3]).toHaveTextContent(/^0$/);
    expect(within(linhaDe('CERVEJA ANTARCTICA')).queryByText('Negativo')).not.toBeInTheDocument();
  });

  it('numera a coluna Posição de 1 a N pelo índice, na ordem recebida (mais urgente primeiro)', async () => {
    const tabela = await abrirVisao();

    const linhas = within(tabela).getAllByRole('row').slice(1);
    const posicoes = linhas.map((linha) => within(linha).getAllByRole('cell')[0].textContent);
    const nomes = linhas.map((linha) => within(linha).getByRole('rowheader').textContent);
    expect(posicoes).toEqual(['1', '2', '3', '4', '5']);
    expect(nomes[0]).toContain('CERVEJA ANTARCTICA');
    expect(nomes[4]).toContain('PRODUTO SEM ESTOQUE INFORMADO');
  });

  it('traduz o motivo em rótulos amigáveis e exibe o texto cru de um motivo desconhecido', async () => {
    await abrirVisao();

    expect(within(linhaDe('CERVEJA ANTARCTICA')).getByText('Abaixo do mínimo e cobertura baixa')).toBeInTheDocument();
    expect(within(linhaDe('ARROZ TIPO 1 5KG')).getByText('Cobertura baixa (< 7 dias)')).toBeInTheDocument();
    expect(within(linhaDe('LEITE INTEGRAL 1L')).getByText('Abaixo do mínimo')).toBeInTheDocument();
    expect(within(linhaDe('PRODUTO SEM ESTOQUE INFORMADO')).getByText('motivo_novo')).toBeInTheDocument();
  });

  it('destaca com texto "Sem cobertura" a cobertura 0, e só ela', async () => {
    await abrirVisao();

    expect(within(linhaDe('CERVEJA ANTARCTICA')).getByText('Sem cobertura')).toBeInTheDocument();
    expect(within(linhaDe('FLV TOMATE KG')).getByText('Sem cobertura')).toBeInTheDocument();
    expect(within(linhaDe('ARROZ TIPO 1 5KG')).queryByText('Sem cobertura')).not.toBeInTheDocument();
    expect(within(linhaDe('PRODUTO SEM ESTOQUE INFORMADO')).queryByText('Sem cobertura')).not.toBeInTheDocument();
  });

  it('a tabela tem legenda (caption) e o nome do produto é cabeçalho de linha', async () => {
    const tabela = await abrirVisao();

    expect(within(tabela).getByText('Alta demanda e baixo estoque', { selector: 'caption' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /LEITE INTEGRAL 1L/ })).toHaveAttribute('scope', 'row');
  });

  it('não exibe mais "Ainda indisponível" nesta visão', async () => {
    await abrirVisao();

    expect(screen.queryByText('Ainda indisponível')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('avisa "Exibindo os N primeiros produtos" quando a lista atinge o limite', async () => {
    await abrirVisao({ ...respostaDemanda, limite: 5 });

    expect(screen.getByText('Exibindo os 5 primeiros produtos')).toBeInTheDocument();
  });

  it('não avisa de lista limitada quando há menos itens que o limite', async () => {
    await abrirVisao();

    expect(screen.queryByText(/Exibindo os/)).not.toBeInTheDocument();
  });

  it('avisa o período ajustado (só dias encerrados) quando o fim efetivo difere do solicitado', async () => {
    await abrirVisao({ ...respostaDemanda, fim: '2026-09-23', fimSolicitado: '2026-09-25' });

    const aviso = screen.getByText('Período ajustado até 23/09/2026: só dias encerrados');
    expect(aviso).toHaveAttribute('role', 'status');
  });

  it('não exibe aviso de período ajustado na demanda quando o fim efetivo é o solicitado', async () => {
    await abrirVisao({ ...respostaDemanda, fimSolicitado: PERIODO_PADRAO.fim });

    expect(screen.queryByText(/Período ajustado/)).not.toBeInTheDocument();
  });

  it('exibe o estado vazio quando nenhum produto atende ao critério', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    obterDemandaBaixoEstoque.mockResolvedValue({ ...PERIODO_PADRAO, limite: 10, itens: [] });
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    selecionarCriterio('demanda-baixo-estoque');

    expect(await screen.findByText('Nenhum produto encontrado para o período e critério selecionados.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('exibe carregando enquanto a requisição desta visão está pendente', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    obterDemandaBaixoEstoque.mockReturnValue(new Promise(() => {}));
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    selecionarCriterio('demanda-baixo-estoque');

    expect(await screen.findByText('Carregando ranking...')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('exibe o erro da API desta visão em um alerta', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    obterDemandaBaixoEstoque.mockRejectedValue(new Error('Erro ao consultar o servidor. Tente novamente.'));
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    selecionarCriterio('demanda-baixo-estoque');

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao consultar o servidor. Tente novamente.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('em 503 exibe que os dados do período ainda não foram preparados', async () => {
    obterRanking.mockResolvedValue(respostaVendas);
    obterDemandaBaixoEstoque.mockRejectedValue(erroHttp(503, 'Execute o job de agregação para o período.'));
    render(<RankingProdutosPage onLogout={() => {}} />);
    await screen.findByRole('table');

    selecionarCriterio('demanda-baixo-estoque');

    expect(await screen.findByRole('alert')).toHaveTextContent('Dados desse período ainda não foram preparados');
  });
});
