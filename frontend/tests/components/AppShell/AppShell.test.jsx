import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AppShell from '../../../src/components/AppShell/AppShell.jsx';

function renderizar(props = {}) {
  return render(
    <AppShell rotaAtual="#/" onLogout={() => {}} {...props}>
      <p>Conteúdo da página</p>
    </AppShell>
  );
}

function abrirGaveta() {
  const botao = screen.getByRole('button', { name: 'Abrir menu' });
  fireEvent.click(botao);
  return botao;
}

describe('AppShell', () => {
  afterEach(() => {
    document.body.classList.remove('appshell-travado');
  });

  it('renderiza os itens do menu como links com o href de cada módulo', () => {
    renderizar();
    const menu = screen.getByRole('navigation', { name: 'Módulos' });

    expect(within(menu).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '#/');
    expect(within(menu).getByRole('link', { name: 'Vendas' })).toHaveAttribute('href', '#/vendas');
    expect(within(menu).getByRole('link', { name: 'Ranking de Produtos' })).toHaveAttribute('href', '#/ranking-produtos');
    expect(within(menu).getByRole('link', { name: 'Curva ABC' })).toHaveAttribute('href', '#/curva-abc');
    expect(within(menu).getByRole('link', { name: 'Estoque' })).toHaveAttribute('href', '#/estoque');
    expect(within(menu).getByRole('link', { name: 'Usuários' })).toHaveAttribute('href', '#/usuarios');
  });

  it('marca o item da rota atual com aria-current="page"', () => {
    renderizar({ rotaAtual: '#/vendas' });

    expect(screen.getByRole('link', { name: 'Vendas' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Estoque' })).not.toHaveAttribute('aria-current');
  });

  it('rota desconhecida marca o Dashboard como atual', () => {
    renderizar({ rotaAtual: '#/qualquer' });

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('Rentabilidade aparece desabilitada com "Em breve" e sem link', () => {
    renderizar();
    const item = screen.getByText('Rentabilidade').closest('[aria-disabled="true"]');

    expect(item).not.toBeNull();
    expect(within(item).getByText('Em breve')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rentabilidade/ })).not.toBeInTheDocument();
  });

  it('renderiza o conteúdo da página dentro do <main>', () => {
    renderizar();

    expect(within(screen.getByRole('main')).getByText('Conteúdo da página')).toBeInTheDocument();
  });

  it('o botão Sair da sidebar chama onLogout', () => {
    const onLogout = vi.fn();
    renderizar({ onLogout });

    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('o botão de menu abre a gaveta e Esc a fecha', () => {
    renderizar();
    const botao = screen.getByRole('button', { name: 'Abrir menu' });
    expect(botao).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicar fora (no fundo escurecido) fecha a gaveta', () => {
    renderizar();
    const botao = abrirGaveta();

    fireEvent.click(screen.getByTestId('appshell-fundo'));

    expect(botao).toHaveAttribute('aria-expanded', 'false');
  });

  it('escolher um módulo na gaveta a fecha', () => {
    renderizar();
    const botao = abrirGaveta();

    fireEvent.click(screen.getByRole('link', { name: 'Estoque' }));

    expect(botao).toHaveAttribute('aria-expanded', 'false');
  });

  it('gaveta aberta vira dialog modal; fechada, a sidebar não tem role de dialog', () => {
    renderizar();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    abrirGaveta();

    expect(screen.getByRole('dialog', { name: 'Menu de navegação' })).toHaveAttribute('aria-modal', 'true');
  });

  it('ao abrir a gaveta, o foco vai para o primeiro link do menu', () => {
    renderizar();
    abrirGaveta();

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveFocus();
  });

  it('gaveta aberta torna o restante da página inerte; ao fechar, remove', () => {
    const { container } = renderizar();
    const coluna = container.querySelector('.appshell__coluna');
    expect(coluna).not.toHaveAttribute('inert');

    abrirGaveta();
    expect(coluna).toHaveAttribute('inert');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(coluna).not.toHaveAttribute('inert');
  });

  it('Tab no último elemento da gaveta volta ao primeiro, e Shift+Tab no primeiro vai ao último (foco confinado)', () => {
    renderizar();
    abrirGaveta();
    const dialogo = screen.getByRole('dialog');
    const fechar = within(dialogo).getByRole('button', { name: 'Fechar menu' });
    const sair = within(dialogo).getByRole('button', { name: 'Sair' });

    sair.focus();
    fireEvent.keyDown(sair, { key: 'Tab' });
    expect(fechar).toHaveFocus();

    fireEvent.keyDown(fechar, { key: 'Tab', shiftKey: true });
    expect(sair).toHaveFocus();
  });

  it('Esc devolve o foco ao botão de menu', () => {
    renderizar();
    const botao = abrirGaveta();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(botao).toHaveFocus();
  });

  it('o botão Fechar menu dentro da gaveta a fecha e devolve o foco ao botão de menu', () => {
    renderizar();
    const botao = abrirGaveta();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar menu' }));

    expect(botao).toHaveAttribute('aria-expanded', 'false');
    expect(botao).toHaveFocus();
  });

  it('escolher um módulo move o foco para o conteúdo principal', () => {
    renderizar();
    abrirGaveta();

    fireEvent.click(screen.getByRole('link', { name: 'Vendas' }));

    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('gaveta aberta trava o scroll do body e fechar o libera', () => {
    renderizar();
    abrirGaveta();
    expect(document.body).toHaveClass('appshell-travado');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body).not.toHaveClass('appshell-travado');
  });

  it('a topbar mostra o título do módulo atual, a busca e o avatar do usuário', () => {
    renderizar({ rotaAtual: '#/curva-abc', usuario: 'Maria Souza' });

    expect(screen.getByTestId('appshell-titulo')).toHaveTextContent('Curva ABC');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Maria Souza/ })).toBeInTheDocument();
  });

  it('o título do documento acompanha o módulo atual', () => {
    const { rerender } = renderizar({ rotaAtual: '#/estoque' });
    expect(document.title).toBe('Estoque · GestãoEverSoftPlus');

    rerender(
      <AppShell rotaAtual="#/curva-abc" onLogout={() => {}}>
        <p>Conteúdo da página</p>
      </AppShell>
    );
    expect(document.title).toBe('Curva ABC · GestãoEverSoftPlus');
  });

  it('ao trocar de módulo o foco vai para o conteúdo principal; na primeira renderização não rouba o foco', () => {
    const { rerender } = renderizar({ rotaAtual: '#/vendas' });
    expect(screen.getByRole('main')).not.toHaveFocus();

    rerender(
      <AppShell rotaAtual="#/estoque" onLogout={() => {}}>
        <p>Conteúdo da página</p>
      </AppShell>
    );
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('não exibe sino de notificações (central de alertas fora do escopo)', () => {
    renderizar();

    expect(screen.queryByRole('button', { name: /notifica|alerta/i })).not.toBeInTheDocument();
  });
});
