import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AvatarMenu from '../../../src/components/AppShell/AvatarMenu.jsx';

describe('AvatarMenu', () => {
  it('mostra as iniciais do usuário no botão', () => {
    render(<AvatarMenu nome="Maria Souza" onLogout={() => {}} />);

    expect(screen.getByRole('button', { name: /Maria Souza/ })).toHaveTextContent('MS');
  });

  it('sem nome, usa um fallback para as iniciais', () => {
    render(<AvatarMenu onLogout={() => {}} />);

    expect(screen.getByRole('button', { name: /usuário/i })).toHaveTextContent('?');
  });

  it('é um disclosure simples: sem role menu/menuitem nem aria-haspopup', () => {
    render(<AvatarMenu nome="gestor" onLogout={() => {}} />);
    const botao = screen.getByRole('button', { name: /gestor/ });

    expect(botao).not.toHaveAttribute('aria-haspopup');
    fireEvent.click(botao);

    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('abre o painel e o botão Sair chama onLogout', () => {
    const onLogout = vi.fn();
    render(<AvatarMenu nome="gestor" onLogout={onLogout} />);

    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /gestor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('Esc fecha o painel', () => {
    render(<AvatarMenu nome="gestor" onLogout={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /gestor/ }));
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  });

  it('o foco saindo do painel para outro elemento fecha o painel', () => {
    render(
      <>
        <AvatarMenu nome="gestor" onLogout={() => {}} />
        <button type="button">Outro</button>
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /gestor/ }));
    const sair = screen.getByRole('button', { name: 'Sair' });

    fireEvent.blur(sair, { relatedTarget: screen.getByRole('button', { name: 'Outro' }) });

    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  });

  it('o foco indo do botão do avatar para o painel não fecha o painel', () => {
    render(<AvatarMenu nome="gestor" onLogout={() => {}} />);
    const botao = screen.getByRole('button', { name: /gestor/ });
    fireEvent.click(botao);

    fireEvent.blur(botao, { relatedTarget: screen.getByRole('button', { name: 'Sair' }) });

    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  });
});
