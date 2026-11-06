import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AlternarTema from '../../../src/components/AlternarTema/AlternarTema.jsx';

describe('AlternarTema', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('expõe um botão com o rótulo "Alternar tema claro/escuro"', () => {
    render(<AlternarTema />);

    expect(screen.getByRole('button', { name: 'Alternar tema claro/escuro' })).toBeInTheDocument();
  });

  it('começa no tema claro quando não há preferência salva', () => {
    render(<AlternarTema />);

    expect(document.documentElement.getAttribute('data-theme')).toBe('claro');
  });

  it('alterna para o tema escuro ao clicar e de volta para o claro no segundo clique', () => {
    render(<AlternarTema />);
    const botao = screen.getByRole('button', { name: 'Alternar tema claro/escuro' });

    fireEvent.click(botao);
    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro');

    fireEvent.click(botao);
    expect(document.documentElement.getAttribute('data-theme')).toBe('claro');
  });

  it('salva a escolha no localStorage', () => {
    render(<AlternarTema />);

    fireEvent.click(screen.getByRole('button', { name: 'Alternar tema claro/escuro' }));

    expect(window.localStorage.getItem('gestao:tema')).toBe('escuro');
  });

  it('restaura o tema escuro salvo ao montar', () => {
    window.localStorage.setItem('gestao:tema', 'escuro');

    render(<AlternarTema />);

    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro');
    expect(screen.getByRole('button', { name: 'Alternar tema claro/escuro' })).toHaveAttribute('aria-pressed', 'true');
  });
});
