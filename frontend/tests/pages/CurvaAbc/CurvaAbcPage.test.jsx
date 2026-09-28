import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CurvaAbcPage from '../../../src/pages/CurvaAbc/CurvaAbcPage.jsx';
import { listarItens, obterCurvaAbc } from '../../../src/services/curvaAbcService.js';
import { formatCurrency } from '../../../src/utils/format.js';

// O Intl usa espaço não separável (nbsp); o Testing Library normaliza o texto do DOM para espaço comum.
const moeda = (valor) => formatCurrency(valor).replace(/\s/g, ' ');

vi.mock('../../../src/services/curvaAbcService.js');

const PERIODO_PADRAO = { inicio: '2026-08-25', fim: '2026-09-23' };
// A página envia SEMPRE o `limite` (padrão 100) e o `agrupador` (padrão setor); `id` só quando um item foi escolhido.
const CHAMADA_PADRAO = { ...PERIODO_PADRAO, agrupador: 'setor', limite: 100 };

const itemMercearia = {
  id: 1,
  nome: 'MERCEARIA',
  faturamento: 5000,
  lucro: 1000,
  valorEstoque: 2500,
  participacaoVenda: 50,
  acumuladoVenda: 50,
  classificacaoVenda: 'A',
  classificacaoMargem: 'A',
  classificacaoEstoque: 'B',
  semCusto: false,
};
const itemBebidas = {
  id: 2,
  nome: 'BEBIDAS',
  faturamento: 3000,
  lucro: 90,
  valorEstoque: 400,
  participacaoVenda: 30,
  acumuladoVenda: 80,
  classificacaoVenda: 'A',
  classificacaoMargem: 'C',
  classificacaoEstoque: 'C',
  semCusto: false,
};
const itemHortifruti = {
  id: 3,
  nome: 'HORTIFRUTI',
  faturamento: 2000,
  lucro: 500.5,
  valorEstoque: 1234.56,
  participacaoVenda: 20,
  acumuladoVenda: 100,
  classificacaoVenda: 'B',
  classificacaoMargem: 'B',
  classificacaoEstoque: 'A',
  semCusto: false,
};

const respostaSetor = {
  agrupador: 'setor',
  ...PERIODO_PADRAO,
  limite: 100,
  totalItens: 3,
  itens: [itemMercearia, itemBebidas, itemHortifruti],
};

const respostaFornecedor = {
  agrupador: 'fornecedor',
  ...PERIODO_PADRAO,
  limite: 100,
  totalItens: 2,
  itens: [
    { id: 5, nome: 'DISTRIBUIDORA ALFA', valorCompras: 9000, participacaoCompra: 75, acumuladoCompra: 75, classificacaoCompra: 'A' },
    { id: 6, nome: 'ATACADO BETA', valorCompras: 3000, participacaoCompra: 25, acumuladoCompra: 100, classificacaoCompra: 'B' },
  ],
};

const respostaCliente = {
  agrupador: 'cliente',
  ...PERIODO_PADRAO,
  limite: 100,
  totalItens: 2,
  itens: [
    {
      id: 0,
      nome: 'Venda consumidor',
      faturamento: 7000,
      lucro: 1400,
      valorEstoque: null,
      participacaoVenda: 70,
      acumuladoVenda: 70,
      classificacaoVenda: 'A',
      classificacaoMargem: 'A',
      classificacaoEstoque: null,
      semCusto: false,
    },
    {
      id: 44,
      nome: 'MARIA DA SILVA',
      faturamento: 3000,
      lucro: 600,
      valorEstoque: null,
      participacaoVenda: 30,
      acumuladoVenda: 100,
      classificacaoVenda: 'B',
      classificacaoMargem: 'B',
      classificacaoEstoque: null,
      semCusto: false,
    },
  ],
};

const listaSetores = {
  agrupador: 'setor',
  limite: 5000,
  totalItens: 3,
  itens: [
    { id: 2, nome: 'BEBIDAS' },
    { id: 3, nome: 'HORTIFRUTI' },
    { id: 1, nome: 'MERCEARIA' },
  ],
};

function erroHttp(status, mensagem) {
  return Object.assign(new Error(mensagem), { status });
}

const radio = (nome) => screen.getByRole('radio', { name: nome });
const seletorItem = () => screen.getByRole('combobox', { name: /Item/ });

// Lê uma linha da tabela como { 'nome da coluna': 'texto da célula' } (o rowheader é a coluna Nome/Fornecedor).
function valoresDaLinha(tabela, nome) {
  const cabecalhos = within(tabela).getAllByRole('columnheader').map((th) => th.textContent);
  const linha = within(tabela).getByRole('rowheader', { name: new RegExp(nome) }).closest('tr');
  const valores = Array.from(linha.children).map((celula) => celula.textContent.replace(/\s/g, ' '));
  return Object.fromEntries(cabecalhos.map((cabecalho, i) => [cabecalho, valores[i]]));
}

function prepararMocksPadrao() {
  obterCurvaAbc.mockResolvedValue(respostaSetor);
  listarItens.mockResolvedValue(listaSetores);
}

describe('CurvaAbcPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Hoje = 24/09/2026 às 23:30 (horário local): o período padrão termina ONTEM (23/09).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
    prepararMocksPadrao();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a tabela exibe a classificação A/B/C de venda, margem e estoque para cada item retornado', async () => {
    render(<CurvaAbcPage onLogout={() => {}} />);

    const tabela = await screen.findByRole('table');
    const mercearia = valoresDaLinha(tabela, 'MERCEARIA');
    const bebidas = valoresDaLinha(tabela, 'BEBIDAS');
    const hortifruti = valoresDaLinha(tabela, 'HORTIFRUTI');

    expect([mercearia['Classe venda'], mercearia['Classe margem'], mercearia['Classe estoque']]).toEqual(['A', 'A', 'B']);
    expect([bebidas['Classe venda'], bebidas['Classe margem'], bebidas['Classe estoque']]).toEqual(['A', 'C', 'C']);
    expect([hortifruti['Classe venda'], hortifruti['Classe margem'], hortifruti['Classe estoque']]).toEqual(['B', 'B', 'A']);
    expect(within(tabela).getAllByRole('row')).toHaveLength(4); // cabeçalho + 3 itens
  });

  it('item com classe A em venda e C em margem recebe o destaque "Vende muito, margem baixa" (badge com texto)', async () => {
    render(<CurvaAbcPage onLogout={() => {}} />);

    const tabela = await screen.findByRole('table');
    const linhaBebidas = within(tabela).getByRole('rowheader', { name: /BEBIDAS/ }).closest('tr');
    expect(within(linhaBebidas).getByText('Vende muito, margem baixa')).toBeInTheDocument();
    expect(linhaBebidas).toHaveClass('curva-abc__linha--atencao');

    // Só esse cruzamento é destacado: A/A e B/B não recebem o selo.
    expect(screen.getAllByText('Vende muito, margem baixa')).toHaveLength(1);
    const linhaMercearia = within(tabela).getByRole('rowheader', { name: /MERCEARIA/ }).closest('tr');
    expect(linhaMercearia).not.toHaveClass('curva-abc__linha--atencao');
  });

  it('trocar a dimensão refaz a chamada com o agrupador correto e escolher um item envia o id', async () => {
    listarItens.mockImplementation(async ({ agrupador }) =>
      agrupador === 'grupo'
        ? { agrupador, limite: 5000, totalItens: 1, itens: [{ id: 9, nome: 'SECOS' }] }
        : listaSetores,
    );
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('table');
    expect(obterCurvaAbc).toHaveBeenLastCalledWith(CHAMADA_PADRAO);

    // Escolher um item envia o id (e continua no mesmo agrupador).
    await screen.findByRole('option', { name: 'BEBIDAS' });
    fireEvent.change(seletorItem(), { target: { value: '2' } });
    await waitFor(() => expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...CHAMADA_PADRAO, id: 2 }));

    // Trocar a dimensão refaz a chamada com o novo agrupador (e sem o id do item anterior).
    fireEvent.click(radio('Grupo'));
    await waitFor(() => expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'grupo', limite: 100 }));
    expect(obterCurvaAbc.mock.calls.at(-1)[0]).not.toHaveProperty('id');

    await screen.findByRole('option', { name: 'SECOS' });
    fireEvent.change(seletorItem(), { target: { value: '9' } });
    await waitFor(() =>
      expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'grupo', id: 9, limite: 100 }),
    );
  });

  it('a dimensão é um grupo de rádios "Analisar por" na ordem do ERP, com Setor selecionado por padrão', async () => {
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('table');

    const grupo = screen.getByRole('group', { name: 'Analisar por' });
    const rotulos = within(grupo).getAllByRole('radio').map((r) => r.closest('label').textContent.trim());
    expect(rotulos).toEqual(['Grupo', 'Marca', 'Família', 'Produto', 'Cliente', 'Fornecedor', 'Setor']);
    expect(radio('Setor')).toBeChecked();
    expect(radio('Grupo')).not.toBeChecked();
  });

  it('por padrão chama a API para o setor, sem id, com o período dos últimos 30 dias terminando ontem e limite 100', async () => {
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('table');

    expect(obterCurvaAbc).toHaveBeenCalledTimes(1);
    expect(obterCurvaAbc).toHaveBeenCalledWith({ inicio: '2026-08-25', fim: '2026-09-23', agrupador: 'setor', limite: 100 });
    expect(obterCurvaAbc.mock.calls[0][0]).not.toHaveProperty('id');
    expect(screen.getByLabelText('Data inicial')).toHaveValue('2026-08-25');
    expect(screen.getByLabelText('Data final')).toHaveValue('2026-09-23');
  });

  it('o seletor do item começa em "Todos" e lista os itens da dimensão vindos de /itens', async () => {
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('option', { name: 'BEBIDAS' });

    expect(listarItens).toHaveBeenCalledWith({ agrupador: 'setor' });
    expect(seletorItem()).toHaveValue('');
    const opcoes = within(seletorItem()).getAllByRole('option').map((o) => o.textContent);
    expect(opcoes).toEqual(['Todos', 'BEBIDAS', 'HORTIFRUTI', 'MERCEARIA']);
  });

  it('trocar a dimensão volta o item para "Todos" e carrega a lista da nova dimensão', async () => {
    listarItens.mockImplementation(async ({ agrupador }) =>
      agrupador === 'marca'
        ? { agrupador, limite: 5000, totalItens: 1, itens: [{ id: 20, nome: 'NESTLE' }] }
        : listaSetores,
    );
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('option', { name: 'BEBIDAS' });
    fireEvent.change(seletorItem(), { target: { value: '3' } });
    await waitFor(() => expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...CHAMADA_PADRAO, id: 3 }));

    fireEvent.click(radio('Marca'));

    await screen.findByRole('option', { name: 'NESTLE' });
    expect(listarItens).toHaveBeenLastCalledWith({ agrupador: 'marca' });
    expect(seletorItem()).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'BEBIDAS' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'marca', limite: 100 }),
    );
    expect(obterCurvaAbc.mock.calls.at(-1)[0]).not.toHaveProperty('id');
  });

  it('enquanto a lista de itens carrega mostra "Carregando itens..." e mantém o seletor desabilitado', async () => {
    listarItens.mockReturnValue(new Promise(() => {}));
    render(<CurvaAbcPage onLogout={() => {}} />);

    expect(screen.getByText('Carregando itens...')).toBeInTheDocument();
    expect(seletorItem()).toBeDisabled();
    // A curva não depende da lista de itens.
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('se a lista de itens falha, exibe o erro do servidor em alerta, mantém "Todos" e a tabela continua disponível', async () => {
    listarItens.mockRejectedValue(new Error('Erro ao consultar o servidor. Tente novamente.'));
    render(<CurvaAbcPage onLogout={() => {}} />);

    const tabela = await screen.findByRole('table');
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao consultar o servidor. Tente novamente.');
    expect(within(seletorItem()).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos']);
    expect(within(tabela).getByRole('rowheader', { name: /MERCEARIA/ })).toBeInTheDocument();
  });

  it('para fornecedor mostra a curva de compras (sem venda, margem e estoque) e o seletor de item fica desabilitado em "Todos"', async () => {
    obterCurvaAbc.mockImplementation(async ({ agrupador }) => (agrupador === 'fornecedor' ? respostaFornecedor : respostaSetor));
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('table');
    listarItens.mockClear();

    fireEvent.click(radio('Fornecedor'));

    const tabela = await screen.findByRole('table', { name: /fornecedor/i });
    const cabecalhos = within(tabela).getAllByRole('columnheader').map((th) => th.textContent);
    expect(cabecalhos).toEqual(['Posição', 'Fornecedor', 'Valor comprado (R$)', '% compras', '% acumulado', 'Classe']);
    expect(valoresDaLinha(tabela, 'DISTRIBUIDORA ALFA')).toEqual({
      Posição: '1',
      Fornecedor: 'DISTRIBUIDORA ALFA',
      'Valor comprado (R$)': moeda(9000),
      '% compras': '75,00%',
      '% acumulado': '75,00%',
      Classe: 'A',
    });
    expect(valoresDaLinha(tabela, 'ATACADO BETA').Classe).toBe('B');
    expect(seletorItem()).toBeDisabled();
    expect(seletorItem()).toHaveValue('');
    expect(within(seletorItem()).getByRole('option', { name: 'Todos' })).toBeInTheDocument();
    expect(listarItens).not.toHaveBeenCalled();
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'fornecedor', limite: 100 });
  });

  it('para cliente omite as colunas de estoque e mostra "Venda consumidor" como uma linha normal', async () => {
    obterCurvaAbc.mockImplementation(async ({ agrupador }) => (agrupador === 'cliente' ? respostaCliente : respostaSetor));
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.click(radio('Cliente'));

    const tabela = await screen.findByRole('table', { name: /cliente/i });
    const cabecalhos = within(tabela).getAllByRole('columnheader').map((th) => th.textContent);
    expect(cabecalhos).toEqual([
      'Posição',
      'Nome',
      'Faturamento (R$)',
      '% venda',
      '% acumulado',
      'Classe venda',
      'Lucro (R$)',
      'Classe margem',
    ]);
    expect(within(tabela).getByRole('rowheader', { name: 'Venda consumidor' })).toBeInTheDocument();
    expect(valoresDaLinha(tabela, 'MARIA DA SILVA')['Classe margem']).toBe('B');
    expect(tabela.textContent).not.toMatch(/NaN|undefined|null/);
    // Cliente tem lista de itens (select habilitado, como as demais dimensões com cadastro).
    expect(listarItens).toHaveBeenLastCalledWith({ agrupador: 'cliente' });
  });

  it('formata faturamento, lucro, valor em estoque e percentuais pelos helpers e numera a posição de 1 a N', async () => {
    render(<CurvaAbcPage onLogout={() => {}} />);

    const tabela = await screen.findByRole('table');
    expect(within(tabela).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Posição',
      'Nome',
      'Faturamento (R$)',
      '% venda',
      '% acumulado',
      'Classe venda',
      'Lucro (R$)',
      'Classe margem',
      'Valor em estoque (R$)',
      'Classe estoque',
    ]);
    expect(valoresDaLinha(tabela, 'HORTIFRUTI')).toMatchObject({
      Posição: '3',
      'Faturamento (R$)': moeda(2000),
      '% venda': '20,00%',
      '% acumulado': '100,00%',
      'Lucro (R$)': moeda(500.5),
      'Valor em estoque (R$)': moeda(1234.56),
    });
    expect(valoresDaLinha(tabela, 'MERCEARIA').Posição).toBe('1');
  });

  it('sinaliza "Custo incompleto" (texto + estilo) só nas linhas com semCusto e mantém o lucro parcial visível', async () => {
    obterCurvaAbc.mockResolvedValue({
      ...respostaSetor,
      itens: [itemMercearia, { ...itemBebidas, lucro: 300, semCusto: true }],
      totalItens: 2,
    });
    render(<CurvaAbcPage onLogout={() => {}} />);

    const tabela = await screen.findByRole('table');
    const linhaBebidas = within(tabela).getByRole('rowheader', { name: /BEBIDAS/ }).closest('tr');
    expect(within(linhaBebidas).getByText('Custo incompleto')).toBeInTheDocument();
    expect(linhaBebidas).toHaveClass('curva-abc__linha--sem-custo');
    expect(within(linhaBebidas).getByText(new RegExp(moeda(300).replace(/[$]/g, '\\$')))).toBeInTheDocument();

    const linhaMercearia = within(tabela).getByRole('rowheader', { name: /MERCEARIA/ }).closest('tr');
    expect(within(linhaMercearia).queryByText('Custo incompleto')).not.toBeInTheDocument();
    expect(linhaMercearia).not.toHaveClass('curva-abc__linha--sem-custo');
  });

  it('valores null (lucro, estoque e classes) aparecem como "—", sem NaN/undefined/null', async () => {
    obterCurvaAbc.mockResolvedValue({
      ...respostaSetor,
      totalItens: 1,
      itens: [{ ...itemMercearia, lucro: null, valorEstoque: null, classificacaoMargem: null, classificacaoEstoque: null }],
    });
    render(<CurvaAbcPage onLogout={() => {}} />);

    const tabela = await screen.findByRole('table');
    const linha = valoresDaLinha(tabela, 'MERCEARIA');
    expect(linha['Lucro (R$)']).toBe('—');
    expect(linha['Valor em estoque (R$)']).toBe('—');
    expect(linha['Classe margem']).toBe('—');
    expect(linha['Classe estoque']).toBe('—');
    expect(tabela.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it('avisa "Exibindo os N de M itens" quando totalItens é maior que os itens exibidos, com separador de milhar', async () => {
    obterCurvaAbc.mockResolvedValue({ ...respostaSetor, totalItens: 5481 });
    render(<CurvaAbcPage onLogout={() => {}} />);

    expect(await screen.findByText('Exibindo os 3 de 5.481 itens')).toBeInTheDocument();
  });

  it('não exibe o aviso de lista limitada quando todos os itens estão na tabela', async () => {
    render(<CurvaAbcPage onLogout={() => {}} />);

    await screen.findByRole('table');
    expect(screen.queryByText(/Exibindo os/)).not.toBeInTheDocument();
  });

  it('refaz a chamada ao mudar o período pelo PeriodFilter', async () => {
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-09-20' } });

    await waitFor(() =>
      expect(obterCurvaAbc).toHaveBeenLastCalledWith({ inicio: '2026-08-25', fim: '2026-09-20', agrupador: 'setor', limite: 100 }),
    );
    await screen.findByRole('table');
  });

  it('exibe o estado de carregando enquanto a requisição está pendente', () => {
    obterCurvaAbc.mockReturnValue(new Promise(() => {}));
    render(<CurvaAbcPage onLogout={() => {}} />);

    expect(screen.getByText('Carregando curva ABC...')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('exibe a mensagem de erro do servidor em um alerta', async () => {
    obterCurvaAbc.mockRejectedValue(new Error('Erro ao consultar o servidor. Tente novamente.'));
    render(<CurvaAbcPage onLogout={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao consultar o servidor. Tente novamente.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Ainda indisponível')).not.toBeInTheDocument();
  });

  it('exibe "Nenhum dado no período" quando a API não retorna itens', async () => {
    obterCurvaAbc.mockResolvedValue({ ...respostaSetor, totalItens: 0, itens: [] });
    render(<CurvaAbcPage onLogout={() => {}} />);

    expect(await screen.findByText('Nenhum dado no período')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('em 503 exibe que os dados do período ainda não foram preparados, com a mensagem do servidor', async () => {
    obterCurvaAbc.mockRejectedValue(erroHttp(503, 'Execute o job de agregação para o período.'));
    render(<CurvaAbcPage onLogout={() => {}} />);

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Dados desse período ainda não foram preparados');
    expect(aviso).toHaveTextContent('Execute o job de agregação para o período.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('em 501 exibe "Ainda indisponível" com a mensagem do servidor', async () => {
    obterCurvaAbc.mockRejectedValue(erroHttp(501, 'Recurso ainda não implementado.'));
    render(<CurvaAbcPage onLogout={() => {}} />);

    expect(await screen.findByText('Ainda indisponível')).toBeInTheDocument();
    expect(screen.getByText(/Recurso ainda não implementado\./)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a tabela tem legenda, cabeçalhos com scope, o nome como cabeçalho de linha e uma região focável nomeada', async () => {
    render(<CurvaAbcPage onLogout={() => {}} />);

    const regiao = await screen.findByRole('region', { name: 'Tabela da Curva ABC' });
    expect(regiao).toHaveAttribute('tabindex', '0');
    const tabela = within(regiao).getByRole('table', { name: 'Curva ABC por Setor' });
    expect(within(tabela).getByText('Curva ABC por Setor', { selector: 'caption' })).toBeInTheDocument();
    within(tabela).getAllByRole('columnheader').forEach((th) => expect(th).toHaveAttribute('scope', 'col'));
    expect(within(tabela).getByRole('rowheader', { name: /MERCEARIA/ })).toHaveAttribute('scope', 'row');
  });
});

describe('CurvaAbcPage - quantidade de itens (limite)', () => {
  // Timers falsos (inclui setTimeout) para controlar o debounce do campo sem esperas reais.
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
    prepararMocksPadrao();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const avancar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const DEBOUNCE = 500; // maior que o debounce interno da página (400 ms)

  async function renderizar() {
    render(<CurvaAbcPage onLogout={() => {}} />);
    await avancar(0);
  }

  const campoQuantidade = () => screen.getByLabelText('Quantidade de itens');

  async function digitar(valor) {
    fireEvent.change(campoQuantidade(), { target: { value: valor } });
    await avancar(DEBOUNCE);
  }

  it('o campo "Quantidade de itens" começa em 100, aceita de 1 a 1000 e oferece sugestões', async () => {
    await renderizar();

    const campo = campoQuantidade();
    expect(campo).toHaveValue(100);
    expect(campo).toHaveAttribute('type', 'number');
    expect(campo).toHaveAttribute('min', '1');
    expect(campo).toHaveAttribute('max', '1000');
    const opcoes = Array.from(document.getElementById(campo.getAttribute('list')).options).map((o) => o.value);
    expect(opcoes).toEqual(['50', '100', '250', '500', '1000']);
    expect(obterCurvaAbc).toHaveBeenLastCalledWith(CHAMADA_PADRAO);
  });

  it('alterar a quantidade para um valor válido refaz a chamada com o novo limite depois da pausa na digitação', async () => {
    obterCurvaAbc.mockImplementation(async ({ limite }) => ({ ...respostaSetor, limite, itens: [itemMercearia] , totalItens: limite === 250 ? 1 : 3 }));
    await renderizar();
    expect(obterCurvaAbc).toHaveBeenCalledTimes(1);

    await digitar('250');

    expect(obterCurvaAbc).toHaveBeenCalledTimes(2);
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'setor', limite: 250 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await digitar('1000');
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'setor', limite: 1000 });
  });

  it.each([
    ['vazio', ''],
    ['zero', '0'],
    ['negativo', '-3'],
    ['decimal', '2.5'],
    ['acima do máximo', '1001'],
    ['notação científica', '1e2'],
  ])('valor %s não chama a API, sinaliza o campo como inválido e mostra a mensagem em alerta', async (_nome, valor) => {
    await renderizar();
    const campo = campoQuantidade();
    expect(campo).not.toHaveAttribute('aria-invalid', 'true');

    await digitar(valor);

    expect(obterCurvaAbc).toHaveBeenCalledTimes(1);
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Informe um número inteiro de 1 a 1000.');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription('Informe um número inteiro de 1 a 1000.');
    // A tabela anterior continua visível.
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('depois de um valor inválido, voltar a um valor válido remove a mensagem e refaz a chamada', async () => {
    await renderizar();
    await digitar('5000');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await digitar('500');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(obterCurvaAbc).toHaveBeenCalledTimes(2);
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'setor', limite: 500 });
  });

  it('não chama a API a cada tecla: só uma chamada, com o valor final, depois de 400 ms de pausa', async () => {
    await renderizar();

    fireEvent.change(campoQuantidade(), { target: { value: '2' } });
    await avancar(100);
    fireEvent.change(campoQuantidade(), { target: { value: '25' } });
    await avancar(100);
    expect(obterCurvaAbc).toHaveBeenCalledTimes(1);

    await avancar(DEBOUNCE);

    expect(obterCurvaAbc).toHaveBeenCalledTimes(2);
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'setor', limite: 25 });
  });

  it('voltar ao valor já aplicado não refaz a chamada', async () => {
    await renderizar();

    await digitar('100');

    expect(obterCurvaAbc).toHaveBeenCalledTimes(1);
  });

  it('trocar a dimensão mantém a quantidade escolhida', async () => {
    await renderizar();
    await digitar('250');

    fireEvent.click(radio('Marca'));
    await avancar(0);

    expect(campoQuantidade()).toHaveValue(250);
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'marca', limite: 250 });
  });
});

// Promise controlável: permite resolver as respostas fora da ordem em que foram pedidas.
function adiada() {
  const controle = {};
  controle.promessa = new Promise((resolve, reject) => {
    controle.resolver = resolve;
    controle.rejeitar = reject;
  });
  return controle;
}

describe('CurvaAbcPage - corrida de requisições e seletor de item', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
    prepararMocksPadrao();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('descarta a resposta obsoleta: se a chamada antiga resolve por último, a tela mostra só os dados da nova', async () => {
    const antiga = adiada();
    const nova = adiada();
    obterCurvaAbc.mockResolvedValueOnce(respostaSetor).mockReturnValueOnce(antiga.promessa).mockReturnValueOnce(nova.promessa);
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-09-19' } });
    await waitFor(() => expect(obterCurvaAbc).toHaveBeenCalledTimes(3));

    await act(async () => {
      nova.resolver({ ...respostaSetor, totalItens: 1, itens: [{ ...itemHortifruti, nome: 'RESPOSTA NOVA' }] });
    });
    await act(async () => {
      antiga.resolver({ ...respostaSetor, totalItens: 1, itens: [{ ...itemMercearia, nome: 'RESPOSTA ANTIGA' }] });
    });

    const tabela = await screen.findByRole('table');
    expect(within(tabela).getByRole('rowheader', { name: 'RESPOSTA NOVA' })).toBeInTheDocument();
    expect(screen.queryByText('RESPOSTA ANTIGA')).not.toBeInTheDocument();
    expect(within(tabela).getAllByRole('row')).toHaveLength(2);
  });

  it('não renderiza a resposta de outra dimensão: sem os dados do setor enquanto Fornecedor carrega e, depois, com as colunas de compras', async () => {
    const fornecedor = adiada();
    obterCurvaAbc.mockImplementation((parametros) =>
      parametros.agrupador === 'fornecedor' ? fornecedor.promessa : Promise.resolve(respostaSetor),
    );
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('table', { name: /setor/i });

    fireEvent.click(radio('Fornecedor'));

    await screen.findByText('Carregando curva ABC...');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('MERCEARIA')).not.toBeInTheDocument();

    await act(async () => {
      fornecedor.resolver(respostaFornecedor);
    });
    const tabela = await screen.findByRole('table', { name: /fornecedor/i });
    expect(within(tabela).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Posição',
      'Fornecedor',
      'Valor comprado (R$)',
      '% compras',
      '% acumulado',
      'Classe',
    ]);
    expect(screen.queryByText('MERCEARIA')).not.toBeInTheDocument();
  });

  it('a resposta atrasada da dimensão anterior não sobrescreve a tabela da dimensão atual', async () => {
    const setorAtrasado = adiada();
    obterCurvaAbc.mockImplementation((parametros) =>
      parametros.agrupador === 'fornecedor' ? Promise.resolve(respostaFornecedor) : setorAtrasado.promessa,
    );
    render(<CurvaAbcPage onLogout={() => {}} />);

    fireEvent.click(radio('Fornecedor'));
    await screen.findByRole('table', { name: /fornecedor/i });

    await act(async () => {
      setorAtrasado.resolver(respostaSetor);
    });

    const tabela = screen.getByRole('table', { name: /fornecedor/i });
    expect(within(tabela).getByRole('rowheader', { name: 'DISTRIBUIDORA ALFA' })).toBeInTheDocument();
    expect(within(tabela).getAllByRole('columnheader').map((th) => th.textContent)).toContain('Valor comprado (R$)');
    expect(screen.queryByText('MERCEARIA')).not.toBeInTheDocument();
  });

  it('o seletor de item ignora itens com id menor ou igual a 0 ou não inteiro', async () => {
    listarItens.mockResolvedValue({
      agrupador: 'setor',
      limite: 5000,
      totalItens: 7,
      itens: [
        { id: 0, nome: 'SEM SETOR' },
        { id: -1, nome: 'NEGATIVO' },
        { id: 1.5, nome: 'DECIMAL' },
        { id: '7', nome: 'TEXTO' },
        { id: null, nome: 'NULO' },
        { id: 2, nome: 'BEBIDAS' },
        { id: 3, nome: 'HORTIFRUTI' },
      ],
    });
    render(<CurvaAbcPage onLogout={() => {}} />);
    await screen.findByRole('option', { name: 'BEBIDAS' });

    const opcoes = within(seletorItem()).getAllByRole('option').map((o) => o.textContent);
    expect(opcoes).toEqual(['Todos', 'BEBIDAS', 'HORTIFRUTI']);
  });
});

describe('CurvaAbcPage - selo "Vende muito, margem baixa" com custo incompleto', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
    prepararMocksPadrao();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('item A em venda e C em margem com semCusto mostra só "Custo incompleto", sem o selo nem a linha de atenção', async () => {
    obterCurvaAbc.mockResolvedValue({
      ...respostaSetor,
      totalItens: 1,
      itens: [{ ...itemBebidas, semCusto: true }],
    });
    render(<CurvaAbcPage onLogout={() => {}} />);

    const tabela = await screen.findByRole('table');
    const linha = within(tabela).getByRole('rowheader', { name: /BEBIDAS/ }).closest('tr');
    expect(within(linha).getByText('Custo incompleto')).toBeInTheDocument();
    expect(linha).toHaveClass('curva-abc__linha--sem-custo');
    expect(linha).not.toHaveClass('curva-abc__linha--atencao');
    expect(screen.queryByText('Vende muito, margem baixa')).not.toBeInTheDocument();
  });
});

describe('CurvaAbcPage - seleção de produto por busca', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30));
    prepararMocksPadrao();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const avancar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const respostaBusca = {
    agrupador: 'produto',
    busca: 'arroz',
    limite: 50,
    totalItens: 2,
    itens: [
      { id: 10, nome: 'ARROZ TIPO 1 5KG' },
      { id: 11, nome: 'ARROZ INTEGRAL 1KG' },
    ],
  };

  async function abrirProduto() {
    render(<CurvaAbcPage onLogout={() => {}} />);
    await avancar(0);
    listarItens.mockClear();
    fireEvent.click(radio('Produto'));
    await avancar(0);
  }

  const campoBusca = () => screen.getByLabelText('Buscar produto');

  async function buscar(texto, ms = 500) {
    fireEvent.change(campoBusca(), { target: { value: texto } });
    await avancar(ms);
  }

  it('para produto troca o select por um campo de busca, com "Todos" como item padrão e sem carregar os ~16 mil produtos', async () => {
    await abrirProduto();

    expect(campoBusca()).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Item/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Item selecionado:/)).toHaveTextContent('Item selecionado: Todos');
    expect(listarItens).not.toHaveBeenCalled();
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'produto', limite: 100 });
  });

  it('exige ao menos 2 caracteres: com 1 caractere não chama /itens e mostra a dica', async () => {
    await abrirProduto();

    await buscar('a', 1000);

    expect(listarItens).not.toHaveBeenCalled();
    expect(screen.getByText('Digite ao menos 2 caracteres para buscar.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Sugestões de produtos' })).not.toBeInTheDocument();
  });

  it('a busca tem debounce de 400 ms: uma única chamada com o texto final, limite 50 e agrupador produto', async () => {
    listarItens.mockResolvedValue(respostaBusca);
    await abrirProduto();

    fireEvent.change(campoBusca(), { target: { value: 'ar' } });
    await avancar(100);
    fireEvent.change(campoBusca(), { target: { value: 'arr' } });
    await avancar(300);
    expect(listarItens).not.toHaveBeenCalled();

    await avancar(200);

    expect(listarItens).toHaveBeenCalledTimes(1);
    expect(listarItens).toHaveBeenCalledWith({ agrupador: 'produto', busca: 'arr', limite: 50 });
  });

  it('lista os resultados como sugestões acessíveis e escolher um envia o id à curva, com o nome no item selecionado', async () => {
    listarItens.mockResolvedValue(respostaBusca);
    await abrirProduto();

    await buscar('arroz');

    const lista = screen.getByRole('list', { name: 'Sugestões de produtos' });
    const botoes = within(lista).getAllByRole('button');
    expect(botoes.map((b) => b.textContent)).toEqual(['ARROZ TIPO 1 5KG', 'ARROZ INTEGRAL 1KG']);

    fireEvent.click(within(lista).getByRole('button', { name: 'ARROZ TIPO 1 5KG' }));
    await avancar(0);

    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'produto', id: 10, limite: 100 });
    expect(screen.getByText(/Item selecionado:/)).toHaveTextContent('Item selecionado: ARROZ TIPO 1 5KG');
    expect(screen.queryByRole('list', { name: 'Sugestões de produtos' })).not.toBeInTheDocument();
  });

  it('"Voltar para Todos" limpa o produto escolhido e refaz a chamada sem id', async () => {
    listarItens.mockResolvedValue(respostaBusca);
    await abrirProduto();
    await buscar('arroz');
    fireEvent.click(screen.getByRole('button', { name: 'ARROZ INTEGRAL 1KG' }));
    await avancar(0);
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'produto', id: 11, limite: 100 });

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Todos' }));
    await avancar(0);

    expect(screen.getByText(/Item selecionado:/)).toHaveTextContent('Item selecionado: Todos');
    expect(screen.queryByRole('button', { name: 'Voltar para Todos' })).not.toBeInTheDocument();
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'produto', limite: 100 });
    expect(obterCurvaAbc.mock.calls.at(-1)[0]).not.toHaveProperty('id');
  });

  it('sem resultados mostra "Nenhum produto encontrado" e, se a busca falha, o erro do servidor em alerta', async () => {
    await abrirProduto(); // a lista de setores (dimensão inicial) já consumiu o mock padrão
    listarItens.mockResolvedValueOnce({ ...respostaBusca, totalItens: 0, itens: [] });

    await buscar('zzz');
    expect(screen.getByText('Nenhum produto encontrado para a busca.')).toBeInTheDocument();

    listarItens.mockRejectedValueOnce(new Error('A busca deve ter ao menos 2 caracteres.'));
    await buscar('yyy');
    expect(screen.getByRole('alert')).toHaveTextContent('A busca deve ter ao menos 2 caracteres.');
    expect(screen.queryByText('Nenhum produto encontrado para a busca.')).not.toBeInTheDocument();
  });

  it('avisa "Mostrando 50 de N produtos; refine a busca" só quando há mais resultados do que os exibidos', async () => {
    const cinquenta = Array.from({ length: 50 }, (_, i) => ({ id: 100 + i, nome: `ARROZ ${i + 1}` }));
    listarItens.mockResolvedValue({ ...respostaBusca, totalItens: 120, itens: cinquenta });
    await abrirProduto();

    await buscar('arroz');

    expect(screen.getByText('Mostrando 50 de 120 produtos; refine a busca')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Sugestões de produtos' })).getAllByRole('button')).toHaveLength(50);
  });

  it('não exibe o aviso de busca limitada quando todos os resultados cabem na lista', async () => {
    listarItens.mockResolvedValue(respostaBusca); // totalItens 2 = 2 itens exibidos
    await abrirProduto();

    await buscar('arroz');

    expect(screen.getByRole('list', { name: 'Sugestões de produtos' })).toBeInTheDocument();
    expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument();
  });

  it('trocar de dimensão depois de escolher um produto volta o item para "Todos"', async () => {
    listarItens.mockResolvedValue(respostaBusca);
    await abrirProduto();
    await buscar('arroz');
    fireEvent.click(screen.getByRole('button', { name: 'ARROZ TIPO 1 5KG' }));
    await avancar(0);

    listarItens.mockResolvedValue(listaSetores);
    fireEvent.click(radio('Setor'));
    await avancar(0);

    expect(seletorItem()).toHaveValue('');
    expect(obterCurvaAbc).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, agrupador: 'setor', limite: 100 });
    expect(obterCurvaAbc.mock.calls.at(-1)[0]).not.toHaveProperty('id');
  });
});
