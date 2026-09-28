import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import EstoquePage from '../../../src/pages/Estoque/EstoquePage.jsx';
import { obterCobertura, obterNiveis, obterParados } from '../../../src/services/estoqueService.js';
import { listarItens } from '../../../src/services/curvaAbcService.js';
import { formatCurrency } from '../../../src/utils/format.js';

// O Intl usa espaço não separável (nbsp); o Testing Library normaliza o texto do DOM para espaço comum.
const moeda = (valor) => formatCurrency(valor).replace(/\s/g, ' ');

vi.mock('../../../src/services/estoqueService.js');
vi.mock('../../../src/services/curvaAbcService.js');

const PERIODO_PADRAO = { inicio: '2026-08-25', fim: '2026-09-23' };
// A página envia SEMPRE `limite` (padrão 10); `nivel`+`id` só quando um item de departamento foi escolhido;
// /niveis envia sempre a `classificacao` da visão.
const CHAMADA_PADRAO = { ...PERIODO_PADRAO, limite: 10 };
const CHAMADA_NIVEIS = { ...CHAMADA_PADRAO, classificacao: 'ruptura' };

const RESUMO = { ruptura: 2, proximoRuptura: 3, excesso: 1 };
const base = { ...PERIODO_PADRAO, fimSolicitado: PERIODO_PADRAO.fim, limite: 10, resumo: RESUMO };

const respostaRuptura = {
  ...base,
  classificacao: 'ruptura',
  totalItens: 2,
  itens: [
    {
      id: 1, nome: 'Arroz Tipo 1 5kg', estoqueAtual: 0, estoqueMinimo: 10, estoqueMaximo: 50,
      quantidadeVendida: 120, mediaDiaria: 4, coberturaDias: 0, classificacao: 'ruptura',
    },
    {
      id: 2, nome: 'Feijão Carioca 1kg', estoqueAtual: -3, estoqueMinimo: null, estoqueMaximo: null,
      quantidadeVendida: 30.5, mediaDiaria: 1.02, coberturaDias: 0, classificacao: 'ruptura',
    },
  ],
};

const respostaProximo = {
  ...base,
  classificacao: 'proximo_ruptura',
  totalItens: 1,
  itens: [
    {
      id: 3, nome: 'Açúcar Refinado 1kg', estoqueAtual: 5, estoqueMinimo: 10, estoqueMaximo: 80,
      quantidadeVendida: 60, mediaDiaria: 2, coberturaDias: 2.5, classificacao: 'proximo_ruptura',
    },
  ],
};

const respostaExcesso = {
  ...base,
  classificacao: 'excesso',
  totalItens: 2,
  itens: [
    {
      id: 4, nome: 'Sal Refinado 1kg', estoqueAtual: 200, estoqueMinimo: 20, estoqueMaximo: 100,
      quantidadeVendida: 10, mediaDiaria: 0.33, coberturaDias: 606.06, classificacao: 'excesso',
    },
    {
      id: 5, nome: 'Vela Decorativa', estoqueAtual: 40, estoqueMinimo: null, estoqueMaximo: 10,
      quantidadeVendida: 0, mediaDiaria: 0, coberturaDias: null, classificacao: 'excesso',
    },
  ],
};

const respostaCobertura = {
  ...PERIODO_PADRAO,
  fimSolicitado: PERIODO_PADRAO.fim,
  limite: 10,
  totalItens: 2,
  itens: [
    { id: 6, nome: 'Leite Integral 1L', estoqueAtual: 12, quantidadeVendida: 90, mediaDiaria: 3, coberturaDias: 4 },
    { id: 7, nome: 'Café Torrado 500g', estoqueAtual: null, quantidadeVendida: 10, mediaDiaria: 0.33, coberturaDias: null },
  ],
};

const respostaParados = {
  ...PERIODO_PADRAO,
  fimSolicitado: PERIODO_PADRAO.fim,
  limite: 10,
  totalItens: 7,
  valorTotalParado: 12345.67,
  itens: [
    { id: 8, nome: 'Panetone Trufado', estoqueAtual: 30, custoUnitario: 12.5, valorParado: 375 },
    { id: 9, nome: 'Vinagre 750ml', estoqueAtual: 4.5, custoUnitario: 3, valorParado: 13.5 },
  ],
};

const listasDeItens = {
  grupo: [{ id: 11, nome: 'ALIMENTOS' }, { id: 12, nome: 'LIMPEZA' }],
  setor: [{ id: 21, nome: 'MERCEARIA' }, { id: 22, nome: 'BEBIDAS' }],
  familia: [{ id: 31, nome: 'GRÃOS' }, { id: 32, nome: 'LATICÍNIOS' }],
};

function erroHttp(status, mensagem) {
  return Object.assign(new Error(mensagem), { status });
}

// Promise controlável: permite resolver as respostas fora da ordem em que foram pedidas.
function adiada() {
  const controle = {};
  controle.promessa = new Promise((resolve) => {
    controle.resolver = resolve;
  });
  return controle;
}

function prepararMocksPadrao() {
  const porClassificacao = { ruptura: respostaRuptura, proximo_ruptura: respostaProximo, excesso: respostaExcesso };
  obterNiveis.mockImplementation(async ({ classificacao }) => porClassificacao[classificacao]);
  obterCobertura.mockResolvedValue(respostaCobertura);
  obterParados.mockResolvedValue(respostaParados);
  listarItens.mockImplementation(async ({ agrupador }) => ({
    agrupador,
    limite: 5000,
    totalItens: listasDeItens[agrupador].length,
    itens: listasDeItens[agrupador],
  }));
}

const radio = (nome) => screen.getByRole('radio', { name: nome });
const cartao = (nome) => screen.getByRole('button', { name: new RegExp(nome) });
const seletorItem = () => screen.getByRole('combobox', { name: /Item de/ });
const tabela = () => screen.getByRole('table');

// Lê uma linha da tabela como { 'nome da coluna': 'texto da célula' } (o rowheader é a coluna Produto).
function valoresDaLinha(nome) {
  const cabecalhos = within(tabela()).getAllByRole('columnheader').map((th) => th.textContent);
  const linha = within(tabela()).getByRole('rowheader', { name: new RegExp(nome) }).closest('tr');
  const valores = Array.from(linha.children).map((celula) => celula.textContent.replace(/\s/g, ' '));
  return Object.fromEntries(cabecalhos.map((cabecalho, i) => [cabecalho, valores[i]]));
}

describe('EstoquePage', () => {
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

  it('Exibe lista de produtos em ruptura e próximos da ruptura a partir de uma resposta mock', async () => {
    render(<EstoquePage onLogout={() => {}} />);

    // Visão padrão: Ruptura.
    expect(await screen.findByRole('rowheader', { name: 'Arroz Tipo 1 5kg' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Feijão Carioca 1kg' })).toBeInTheDocument();
    expect(radio('Ruptura')).toBeChecked();
    expect(obterNiveis).toHaveBeenLastCalledWith(CHAMADA_NIVEIS);
    expect(cartao('Em ruptura')).toHaveTextContent('2');
    expect(cartao('Próximos da ruptura')).toHaveTextContent('3');
    expect(cartao('Em excesso')).toHaveTextContent('1');

    // Visão Próximos da ruptura.
    fireEvent.click(radio('Próximos da ruptura'));

    expect(await screen.findByRole('rowheader', { name: 'Açúcar Refinado 1kg' })).toBeInTheDocument();
    expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_PADRAO, classificacao: 'proximo_ruptura' });
    expect(screen.queryByRole('rowheader', { name: 'Arroz Tipo 1 5kg' })).not.toBeInTheDocument();
    expect(cartao('Em ruptura')).toHaveTextContent('2');
    expect(cartao('Próximos da ruptura')).toHaveTextContent('3');
    expect(cartao('Em excesso')).toHaveTextContent('1');
  });

  it('Trocar o filtro de departamento (grupo/setor/família) refaz a chamada à API com o parâmetro correto', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    // Nenhum nível selecionado por padrão = sem filtro (a primeira chamada não leva nivel nem id).
    expect(obterNiveis.mock.calls[0][0]).not.toHaveProperty('nivel');
    expect(obterNiveis.mock.calls[0][0]).not.toHaveProperty('id');

    const casos = [
      { rotulo: 'Grupo', nivel: 'grupo', item: 'LIMPEZA', id: 12 },
      { rotulo: 'Setor', nivel: 'setor', item: 'BEBIDAS', id: 22 },
      { rotulo: 'Família', nivel: 'familia', item: 'GRÃOS', id: 31 },
    ];
    for (const caso of casos) {
      fireEvent.click(radio(caso.rotulo));
      expect(listarItens).toHaveBeenLastCalledWith({ agrupador: caso.nivel });
      await screen.findByRole('option', { name: caso.item });

      fireEvent.change(seletorItem(), { target: { value: String(caso.id) } });

      await waitFor(() =>
        expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_NIVEIS, nivel: caso.nivel, id: caso.id }),
      );
      await screen.findByRole('table');
    }
  });

  it('só envia nivel e id quando um item foi escolhido: escolher só o nível não altera a chamada', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    expect(obterNiveis).toHaveBeenCalledTimes(1);

    fireEvent.click(radio('Setor'));
    await screen.findByRole('option', { name: 'BEBIDAS' });

    expect(seletorItem()).toHaveValue('');
    expect(obterNiveis).toHaveBeenCalledTimes(1);
  });

  it('trocar o nível reseta o item para "Todos" e a nova chamada não leva o id do item anterior', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    fireEvent.click(radio('Setor'));
    await screen.findByRole('option', { name: 'BEBIDAS' });
    fireEvent.change(seletorItem(), { target: { value: '22' } });
    await waitFor(() => expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_NIVEIS, nivel: 'setor', id: 22 }));

    fireEvent.click(radio('Grupo'));

    await screen.findByRole('option', { name: 'LIMPEZA' });
    expect(seletorItem()).toHaveValue('');
    await waitFor(() => expect(obterNiveis).toHaveBeenLastCalledWith(CHAMADA_NIVEIS));
    expect(obterNiveis.mock.calls.at(-1)[0]).not.toHaveProperty('id');
    expect(obterNiveis.mock.calls.at(-1)[0]).not.toHaveProperty('nivel');
  });

  it('a lista de itens do departamento tem estado de carregando (seletor desabilitado) e ignora cadastros com id 0', async () => {
    let resolver;
    listarItens.mockReturnValue(new Promise((resolve) => { resolver = resolve; }));
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.click(radio('Setor'));

    expect(screen.getByText('Carregando itens...')).toBeInTheDocument();
    expect(seletorItem()).toBeDisabled();

    await act(async () => {
      resolver({ itens: [{ id: 0, nome: 'Sem setor' }, { id: 21, nome: 'MERCEARIA' }] });
    });

    expect(seletorItem()).toBeEnabled();
    expect(screen.queryByText('Carregando itens...')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'MERCEARIA' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Sem setor' })).not.toBeInTheDocument();
  });

  it('erro ao carregar a lista de itens do departamento aparece junto ao seletor sem derrubar a tabela', async () => {
    listarItens.mockRejectedValue(new Error('Falha ao listar setores.'));
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.click(radio('Setor'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao listar setores.');
    expect(seletorItem()).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Todos' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Arroz Tipo 1 5kg' })).toBeInTheDocument();
  });

  it('cada cartão do resumo seleciona a visão correspondente e refaz a chamada', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    expect(cartao('Em ruptura')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(cartao('Próximos da ruptura'));

    expect(await screen.findByRole('rowheader', { name: 'Açúcar Refinado 1kg' })).toBeInTheDocument();
    expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_PADRAO, classificacao: 'proximo_ruptura' });
    expect(radio('Próximos da ruptura')).toBeChecked();
    expect(cartao('Próximos da ruptura')).toHaveAttribute('aria-pressed', 'true');
    expect(cartao('Em ruptura')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(cartao('Em excesso'));

    expect(await screen.findByRole('rowheader', { name: 'Sal Refinado 1kg' })).toBeInTheDocument();
    expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_PADRAO, classificacao: 'excesso' });
    expect(radio('Excesso')).toBeChecked();

    fireEvent.click(cartao('Em ruptura'));

    expect(await screen.findByRole('rowheader', { name: 'Arroz Tipo 1 5kg' })).toBeInTheDocument();
    expect(radio('Ruptura')).toBeChecked();
  });

  it('explica que as contagens do resumo não são exclusivas', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    expect(screen.getByText('Um produto pode aparecer em mais de uma contagem.')).toBeInTheDocument();
  });

  it('não oferece a visão "Próximos do vencimento" (fora desta fase)', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    expect(screen.queryByText(/vencimento/i)).not.toBeInTheDocument();
    const visoes = within(screen.getByRole('group', { name: 'Visão' })).getAllByRole('radio');
    expect(visoes.map((r) => r.parentElement.textContent)).toEqual([
      'Ruptura',
      'Próximos da ruptura',
      'Excesso',
      'Cobertura em dias',
      'Parados (com estoque)',
    ]);
  });

  it('na visão Excesso mostra estoque acima do máximo; mínimo/máximo nulos e cobertura nula aparecem como "—"', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.click(radio('Excesso'));

    await screen.findByRole('rowheader', { name: 'Sal Refinado 1kg' });
    expect(within(tabela()).getByText('Produtos em excesso', { selector: 'caption' })).toBeInTheDocument();
    const sal = valoresDaLinha('Sal Refinado');
    expect(sal['Estoque atual']).toBe('200');
    expect(sal['Máximo']).toBe('100');
    expect(sal['Cobertura (dias)']).toBe('606,06');
    const vela = valoresDaLinha('Vela Decorativa');
    expect(vela['Mínimo']).toBe('—');
    expect(vela['Máximo']).toBe('10');
    expect(vela['Cobertura (dias)']).toBe('—');
    expect(vela['Vendido no período']).toBe('0');
  });

  it('a tabela de níveis tem as colunas Produto, Estoque atual, Mínimo, Máximo, Vendido no período, Média/dia e Cobertura (dias)', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    const cabecalhos = within(tabela()).getAllByRole('columnheader');
    expect(cabecalhos.map((th) => th.textContent)).toEqual([
      'Produto', 'Estoque atual', 'Mínimo', 'Máximo', 'Vendido no período', 'Média/dia', 'Cobertura (dias)',
    ]);
    cabecalhos.forEach((th) => expect(th).toHaveAttribute('scope', 'col'));
    expect(within(tabela()).getByText('Produtos em ruptura', { selector: 'caption' })).toBeInTheDocument();
    const arroz = valoresDaLinha('Arroz');
    expect(arroz['Mínimo']).toBe('10');
    expect(arroz['Máximo']).toBe('50');
    expect(arroz['Vendido no período']).toBe('120');
    expect(arroz['Média/dia']).toBe('4,00');
  });

  it('estoque negativo aparece com sinal e selo de texto "Negativo"; cobertura 0 tem o selo "Sem cobertura"; mínimo/máximo nulos viram "—"', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    const feijao = within(tabela()).getByRole('rowheader', { name: /Feijão/ }).closest('tr');
    const valores = valoresDaLinha('Feijão');
    expect(valores['Estoque atual']).toMatch(/^-3\s?Negativo$/);
    expect(within(feijao).getByText('Negativo')).toBeInTheDocument();
    expect(valores['Cobertura (dias)']).toMatch(/^0,00\s?Sem cobertura$/);
    expect(within(feijao).getByText('Sem cobertura')).toBeInTheDocument();
    expect(valores['Mínimo']).toBe('—');
    expect(valores['Máximo']).toBe('—');
    expect(valores['Vendido no período']).toBe('30,5');

    // Estoque zero não é negativo, mas a cobertura 0 continua com o selo.
    const arroz = within(tabela()).getByRole('rowheader', { name: /Arroz/ }).closest('tr');
    expect(within(arroz).queryByText('Negativo')).not.toBeInTheDocument();
    expect(within(arroz).getByText('Sem cobertura')).toBeInTheDocument();
  });

  it('na visão Cobertura em dias lista os produtos com venda, com colunas próprias e "—" para estoque nulo', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.click(radio('Cobertura em dias'));

    await screen.findByRole('rowheader', { name: 'Leite Integral 1L' });
    expect(obterCobertura).toHaveBeenCalledWith(CHAMADA_PADRAO);
    const cabecalhos = within(tabela()).getAllByRole('columnheader').map((th) => th.textContent);
    expect(cabecalhos).toEqual(['Produto', 'Estoque atual', 'Vendido', 'Média/dia', 'Cobertura (dias)']);
    const leite = valoresDaLinha('Leite');
    expect(leite['Estoque atual']).toBe('12');
    expect(leite['Vendido']).toBe('90');
    expect(leite['Média/dia']).toBe('3,00');
    expect(leite['Cobertura (dias)']).toBe('4,00');
    const cafe = valoresDaLinha('Café');
    expect(cafe['Estoque atual']).toBe('—');
    expect(cafe['Cobertura (dias)']).toBe('—');
    expect(within(tabela()).getByText('Cobertura de estoque em dias', { selector: 'caption' })).toBeInTheDocument();
  });

  it('na visão Parados mostra o valor total parado em destaque, o total de produtos parados e os valores em R$', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.click(radio('Parados (com estoque)'));

    await screen.findByRole('rowheader', { name: 'Panetone Trufado' });
    expect(obterParados).toHaveBeenCalledWith(CHAMADA_PADRAO);
    expect(screen.getByText(`Valor total parado em estoque: ${moeda(12345.67)}`)).toBeInTheDocument();
    expect(screen.getByText('7 produtos parados')).toBeInTheDocument();
    const cabecalhos = within(tabela()).getAllByRole('columnheader').map((th) => th.textContent);
    expect(cabecalhos).toEqual(['Produto', 'Estoque atual', 'Custo unitário (R$)', 'Valor parado (R$)']);
    const panetone = valoresDaLinha('Panetone');
    expect(panetone['Estoque atual']).toBe('30');
    expect(panetone['Custo unitário (R$)']).toBe(moeda(12.5));
    expect(panetone['Valor parado (R$)']).toBe(moeda(375));
    expect(valoresDaLinha('Vinagre')['Estoque atual']).toBe('4,5');
  });

  it('quando a API não retorna valorTotalParado, o destaque mostra "—" em vez de "R$ 0,00"', async () => {
    obterParados.mockResolvedValue({ ...respostaParados, valorTotalParado: undefined });
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.click(radio('Parados (com estoque)'));

    expect(await screen.findByText('Valor total parado em estoque: —')).toBeInTheDocument();
  });

  it('quando valorTotalParado é 0 (valor real), o destaque mostra "R$ 0,00" e não "—"', async () => {
    obterParados.mockResolvedValue({ ...respostaParados, valorTotalParado: 0 });
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.click(radio('Parados (com estoque)'));

    expect(await screen.findByText(`Valor total parado em estoque: ${moeda(0)}`)).toBeInTheDocument();
  });

  it('na visão "Parados (com estoque)" mostra o texto de apoio explicando o critério, só nessa visão', async () => {
    const texto = 'Produtos com estoque positivo e nenhuma venda no período.';
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    expect(screen.queryByText(texto)).not.toBeInTheDocument();

    fireEvent.click(radio('Parados (com estoque)'));

    expect(await screen.findByText(texto)).toBeInTheDocument();
  });

  it('na visão "Cobertura em dias" mostra o texto de apoio explicando o critério, só nessa visão', async () => {
    const texto = 'Só produtos que tiveram venda no período.';
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    expect(screen.queryByText(texto)).not.toBeInTheDocument();

    fireEvent.click(radio('Cobertura em dias'));

    expect(await screen.findByText(texto)).toBeInTheDocument();
  });

  it('nas visões Cobertura e Parados o resumo continua vindo de /niveis: é mantido enquanto o filtro é o mesmo', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    expect(obterNiveis).toHaveBeenCalledTimes(1);

    fireEvent.click(radio('Cobertura em dias'));
    await screen.findByRole('rowheader', { name: 'Leite Integral 1L' });
    fireEvent.click(radio('Parados (com estoque)'));
    await screen.findByRole('rowheader', { name: 'Panetone Trufado' });

    expect(obterNiveis).toHaveBeenCalledTimes(1);
    expect(cartao('Em ruptura')).toHaveTextContent('2');
    expect(cartao('Próximos da ruptura')).toHaveTextContent('3');
    expect(cartao('Em excesso')).toHaveTextContent('1');
    // Nenhum cartão fica marcado: a visão atual não é uma das classificações.
    expect(cartao('Em ruptura')).toHaveAttribute('aria-pressed', 'false');
  });

  it('nas visões Cobertura e Parados, mudar o filtro busca o resumo do novo filtro em /niveis', async () => {
    obterNiveis.mockImplementation(async ({ classificacao, id }) => ({
      ...respostaRuptura,
      classificacao,
      resumo: id === 22 ? { ruptura: 9, proximoRuptura: 8, excesso: 7 } : RESUMO,
    }));
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    fireEvent.click(radio('Cobertura em dias'));
    await screen.findByRole('rowheader', { name: 'Leite Integral 1L' });
    fireEvent.click(radio('Setor'));
    await screen.findByRole('option', { name: 'BEBIDAS' });

    fireEvent.change(seletorItem(), { target: { value: '22' } });

    await waitFor(() => expect(cartao('Em ruptura')).toHaveTextContent('9'));
    expect(cartao('Próximos da ruptura')).toHaveTextContent('8');
    expect(cartao('Em excesso')).toHaveTextContent('7');
    expect(obterCobertura).toHaveBeenLastCalledWith({ ...CHAMADA_PADRAO, nivel: 'setor', id: 22 });
    expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_NIVEIS, limite: 1, nivel: 'setor', id: 22 });
  });

  it('se a chamada extra do resumo falhar, os cartões mostram "—" sem exibir outro alerta na tela', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    fireEvent.click(radio('Cobertura em dias'));
    await screen.findByRole('rowheader', { name: 'Leite Integral 1L' });

    obterNiveis.mockRejectedValueOnce(new Error('Falha ao buscar resumo.'));
    fireEvent.click(radio('Setor'));
    await screen.findByRole('option', { name: 'BEBIDAS' });
    fireEvent.change(seletorItem(), { target: { value: '22' } });

    await waitFor(() => expect(obterCobertura).toHaveBeenLastCalledWith({ ...CHAMADA_PADRAO, nivel: 'setor', id: 22 }));
    await waitFor(() => expect(cartao('Em ruptura')).toHaveTextContent('—'));
    expect(cartao('Próximos da ruptura')).toHaveTextContent('—');
    expect(cartao('Em excesso')).toHaveTextContent('—');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    // A tela principal (lista de Cobertura) continua normal.
    expect(screen.getByRole('rowheader', { name: 'Leite Integral 1L' })).toBeInTheDocument();
  });

  it('resposta tardia do resumo de um filtro antigo não sobrescreve o resumo do filtro atual', async () => {
    const controles = {};
    obterNiveis.mockImplementation(({ id }) => {
      if (id === undefined) return Promise.resolve({ ...respostaRuptura, resumo: RESUMO });
      controles[id] = controles[id] || adiada();
      return controles[id].promessa;
    });
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');
    fireEvent.click(radio('Cobertura em dias'));
    await screen.findByRole('rowheader', { name: 'Leite Integral 1L' });
    fireEvent.click(radio('Setor'));
    await screen.findByRole('option', { name: 'BEBIDAS' });

    fireEvent.change(seletorItem(), { target: { value: '22' } }); // filtro ANTIGO (resumo ficará pendente)
    await waitFor(() => expect(controles[22]).toBeDefined());

    fireEvent.change(seletorItem(), { target: { value: '21' } }); // filtro ATUAL (resumo também pendente)
    await waitFor(() => expect(controles[21]).toBeDefined());

    // A mais RECENTE (21) resolve primeiro; a mais ANTIGA (22) resolve por último.
    await act(async () => {
      controles[21].resolver({ ...respostaRuptura, resumo: { ruptura: 5, proximoRuptura: 6, excesso: 7 } });
    });
    await act(async () => {
      controles[22].resolver({ ...respostaRuptura, resumo: { ruptura: 1, proximoRuptura: 1, excesso: 1 } });
    });

    expect(cartao('Em ruptura')).toHaveTextContent('5');
    expect(cartao('Próximos da ruptura')).toHaveTextContent('6');
    expect(cartao('Em excesso')).toHaveTextContent('7');
  });

  it('avisa quando o período foi ajustado porque só dias encerrados são considerados (anunciado como status)', async () => {
    obterNiveis.mockResolvedValue({ ...respostaRuptura, fim: '2026-09-23', fimSolicitado: '2026-09-25' });
    render(<EstoquePage onLogout={() => {}} />);

    const aviso = await screen.findByText('Período ajustado até 23/09/2026: só dias encerrados');
    expect(aviso).toHaveAttribute('role', 'status');
  });

  it('não exibe o aviso de período ajustado quando o fim efetivo é o solicitado', async () => {
    render(<EstoquePage onLogout={() => {}} />);

    await screen.findByRole('table');
    expect(screen.queryByText(/Período ajustado/)).not.toBeInTheDocument();
  });

  it('avisa "Exibindo os N de M itens" quando há mais itens do que os exibidos, com separador de milhar', async () => {
    obterNiveis.mockResolvedValue({ ...respostaRuptura, totalItens: 5481 });
    render(<EstoquePage onLogout={() => {}} />);

    expect(await screen.findByText('Exibindo os 2 de 5.481 itens')).toBeInTheDocument();
  });

  it('não exibe o aviso de lista limitada quando todos os itens estão na tela', async () => {
    render(<EstoquePage onLogout={() => {}} />); // totalItens 2, itens 2

    await screen.findByRole('table');
    expect(screen.queryByText(/Exibindo os/)).not.toBeInTheDocument();
  });

  it('exibe o estado de carregando enquanto a requisição está pendente', () => {
    obterNiveis.mockReturnValue(new Promise(() => {}));
    render(<EstoquePage onLogout={() => {}} />);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando estoque...');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('exibe o erro da API em um alerta e não mostra tabela', async () => {
    obterNiveis.mockRejectedValue(new Error('Erro ao consultar o servidor. Tente novamente.'));
    render(<EstoquePage onLogout={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao consultar o servidor. Tente novamente.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('em 503 exibe que os dados do período ainda não foram preparados, com a mensagem do servidor em segundo plano', async () => {
    obterNiveis.mockRejectedValue(erroHttp(503, 'Execute npm run job:cache-produtos para o período.'));
    render(<EstoquePage onLogout={() => {}} />);

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Dados desse período ainda não foram preparados');
    expect(aviso).toHaveTextContent('Execute npm run job:cache-produtos para o período.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('as visões Cobertura e Parados também tratam erro, 503 e vazio', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    obterCobertura.mockRejectedValue(erroHttp(503, 'Cache incompleto.'));
    fireEvent.click(radio('Cobertura em dias'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dados desse período ainda não foram preparados');

    obterParados.mockResolvedValue({ ...respostaParados, totalItens: 0, valorTotalParado: 0, itens: [] });
    fireEvent.click(radio('Parados (com estoque)'));
    expect(await screen.findByText('Nenhum produto encontrado no período')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('exibe mensagem de estado vazio quando a API não retorna produtos', async () => {
    obterNiveis.mockResolvedValue({ ...respostaRuptura, totalItens: 0, itens: [] });
    render(<EstoquePage onLogout={() => {}} />);

    expect(await screen.findByText('Nenhum produto encontrado no período')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('refaz a chamada ao mudar o período pelo PeriodFilter', async () => {
    render(<EstoquePage onLogout={() => {}} />);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-09-20' } });

    await waitFor(() =>
      expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_NIVEIS, inicio: '2026-08-25', fim: '2026-09-20' }),
    );
  });

  it('descarta a resposta antiga quando o filtro muda antes dela chegar (corrida de requisições)', async () => {
    const respostaAntiga = { ...respostaRuptura, itens: [{ ...respostaRuptura.itens[0], id: 90, nome: 'Produto Antigo' }] };
    const respostaNova = { ...respostaRuptura, itens: [{ ...respostaRuptura.itens[0], id: 91, nome: 'Produto Novo' }] };
    let resolverAntiga;
    obterNiveis.mockImplementation(({ id }) =>
      id === undefined
        ? new Promise((resolve) => { resolverAntiga = resolve; })
        : Promise.resolve(respostaNova),
    );
    render(<EstoquePage onLogout={() => {}} />);
    fireEvent.click(radio('Setor'));
    await screen.findByRole('option', { name: 'BEBIDAS' });

    fireEvent.change(seletorItem(), { target: { value: '22' } });
    expect(await screen.findByRole('rowheader', { name: 'Produto Novo' })).toBeInTheDocument();

    await act(async () => {
      resolverAntiga(respostaAntiga); // a resposta da 1ª chamada chega por último
    });

    expect(screen.getByRole('rowheader', { name: 'Produto Novo' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Produto Antigo' })).not.toBeInTheDocument();
  });

  it('descarta a resposta antiga quando a visão muda antes dela chegar', async () => {
    let resolverRuptura;
    obterNiveis.mockImplementation(({ classificacao }) =>
      classificacao === 'ruptura'
        ? new Promise((resolve) => { resolverRuptura = resolve; })
        : Promise.resolve(respostaExcesso),
    );
    render(<EstoquePage onLogout={() => {}} />);

    fireEvent.click(radio('Excesso'));
    expect(await screen.findByRole('rowheader', { name: 'Sal Refinado 1kg' })).toBeInTheDocument();

    await act(async () => {
      resolverRuptura(respostaRuptura);
    });

    expect(screen.getByRole('rowheader', { name: 'Sal Refinado 1kg' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Arroz Tipo 1 5kg' })).not.toBeInTheDocument();
  });

  it('o contêiner rolável da tabela é uma região focável e nomeada, com legenda e cabeçalhos com scope', async () => {
    render(<EstoquePage onLogout={() => {}} />);

    const regiao = await screen.findByRole('region', { name: 'Tabela de estoque' });
    expect(regiao).toHaveAttribute('tabindex', '0');
    expect(within(regiao).getByRole('table', { name: 'Produtos em ruptura' })).toBeInTheDocument();
    expect(within(regiao).getByRole('rowheader', { name: 'Arroz Tipo 1 5kg' })).toHaveAttribute('scope', 'row');
  });

  it('tem o título "Estoque Inteligente", link para voltar ao painel e botão Sair', async () => {
    const onLogout = vi.fn();
    render(<EstoquePage onLogout={onLogout} />);
    await screen.findByRole('table');

    expect(screen.getByRole('heading', { level: 1, name: 'Estoque Inteligente' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao painel' })).toHaveAttribute('href', '#/');
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

describe('EstoquePage - quantidade de itens (limite)', () => {
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
  const DEBOUNCE = 500; // maior que o debounce interno da página

  async function renderizar() {
    render(<EstoquePage onLogout={() => {}} />);
    await avancar(0);
  }

  const campoQuantidade = () => screen.getByLabelText('Quantidade de itens');

  async function digitar(valor) {
    fireEvent.change(campoQuantidade(), { target: { value: valor } });
    await avancar(DEBOUNCE);
  }

  it('por padrão envia limite=10 em todas as visões e o campo mostra 10', async () => {
    await renderizar();
    expect(campoQuantidade()).toHaveValue(10);
    expect(obterNiveis).toHaveBeenLastCalledWith(CHAMADA_NIVEIS);

    fireEvent.click(radio('Cobertura em dias'));
    await avancar(0);
    expect(obterCobertura).toHaveBeenLastCalledWith(CHAMADA_PADRAO);

    fireEvent.click(radio('Parados (com estoque)'));
    await avancar(0);
    expect(obterParados).toHaveBeenLastCalledWith(CHAMADA_PADRAO);
    expect(campoQuantidade()).toHaveValue(10);
  });

  it('alterar a quantidade refaz a chamada com o novo limite; valor inválido ou acima de 500 não chama a API e mostra mensagem clara', async () => {
    await renderizar();
    expect(obterNiveis).toHaveBeenCalledTimes(1);

    await digitar('25');

    expect(obterNiveis).toHaveBeenCalledTimes(2);
    expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_NIVEIS, limite: 25 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await digitar('501'); // acima do máximo (500)

    expect(obterNiveis).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um número inteiro de 1 a 500.');
    expect(screen.getByRole('rowheader', { name: 'Arroz Tipo 1 5kg' })).toBeInTheDocument(); // tabela anterior continua

    await digitar('500'); // máximo válido
    expect(obterNiveis).toHaveBeenCalledTimes(3);
    expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_NIVEIS, limite: 500 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['vazio', ''],
    ['zero', '0'],
    ['negativo', '-3'],
    ['decimal', '2.5'],
    ['acima do máximo', '501'],
    ['notação científica', '1e1'],
  ])('valor %s não dispara chamada, sinaliza o campo como inválido e associa a mensagem via aria-describedby', async (_nome, valor) => {
    await renderizar();
    const campo = campoQuantidade();
    expect(campo).not.toHaveAttribute('aria-invalid', 'true');

    await digitar(valor);

    expect(obterNiveis).toHaveBeenCalledTimes(1);
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Informe um número inteiro de 1 a 500.');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo.getAttribute('aria-describedby')).toBe(alerta.id);
  });

  it('não chama a API a cada tecla: só uma chamada, com o valor final, depois da pausa na digitação', async () => {
    await renderizar();

    fireEvent.change(campoQuantidade(), { target: { value: '2' } });
    await avancar(100);
    fireEvent.change(campoQuantidade(), { target: { value: '25' } });
    await avancar(100);
    expect(obterNiveis).toHaveBeenCalledTimes(1);

    await avancar(DEBOUNCE);

    expect(obterNiveis).toHaveBeenCalledTimes(2);
    expect(obterNiveis).toHaveBeenLastCalledWith({ ...CHAMADA_NIVEIS, limite: 25 });
  });

  it('voltar ao valor já aplicado não refaz a chamada', async () => {
    await renderizar();

    await digitar('10');

    expect(obterNiveis).toHaveBeenCalledTimes(1);
  });

  it('o limite aplicado vale também nas visões Cobertura e Parados', async () => {
    await renderizar();
    await digitar('50');

    fireEvent.click(radio('Cobertura em dias'));
    await avancar(0);
    expect(obterCobertura).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 50 });

    fireEvent.click(radio('Parados (com estoque)'));
    await avancar(0);
    expect(obterParados).toHaveBeenLastCalledWith({ ...PERIODO_PADRAO, limite: 50 });
  });
});
