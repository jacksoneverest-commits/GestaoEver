import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import BuscaModulos from '../../../src/components/AppShell/BuscaModulos.jsx';

describe('BuscaModulos', () => {
  it('digitar filtra os módulos pelo nome, ignorando acentos e caixa', () => {
    render(<BuscaModulos onNavegar={() => {}} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'usuario' } });

    expect(screen.getByRole('option', { name: 'Usuários' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Vendas' })).not.toBeInTheDocument();
  });

  it('buscar Rentabilidade mostra a opção desabilitada "em breve" e clicar nela não navega', () => {
    const onNavegar = vi.fn();
    render(<BuscaModulos onNavegar={onNavegar} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rentab' } });
    const opcao = screen.getByRole('option', { name: /Rentabilidade/ });

    expect(opcao).toHaveAttribute('aria-disabled', 'true');
    expect(opcao).toHaveTextContent(/em breve/i);
    fireEvent.click(opcao);
    expect(onNavegar).not.toHaveBeenCalled();
  });

  it('busca sem correspondência mostra "Nenhum módulo encontrado"', () => {
    render(<BuscaModulos onNavegar={() => {}} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } });

    expect(screen.getByText('Nenhum módulo encontrado')).toBeInTheDocument();
  });

  it('Enter com apenas a opção desabilitada nos resultados não navega', () => {
    const onNavegar = vi.fn();
    render(<BuscaModulos onNavegar={onNavegar} />);
    const campo = screen.getByRole('combobox');

    fireEvent.change(campo, { target: { value: 'rentab' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    expect(onNavegar).not.toHaveBeenCalled();
  });

  it('perder o foco (blur) fecha a lista de resultados', () => {
    render(<BuscaModulos onNavegar={() => {}} />);
    const campo = screen.getByRole('combobox');

    fireEvent.change(campo, { target: { value: 'v' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.blur(campo);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('voltar o foco ao campo com texto reabre a lista', () => {
    render(<BuscaModulos onNavegar={() => {}} />);
    const campo = screen.getByRole('combobox');

    fireEvent.change(campo, { target: { value: 'v' } });
    fireEvent.blur(campo);
    fireEvent.focus(campo);

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('clicar em um resultado navega para a rota do módulo', () => {
    const onNavegar = vi.fn();
    render(<BuscaModulos onNavegar={onNavegar} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'curva' } });
    fireEvent.click(screen.getByRole('option', { name: 'Curva ABC' }));

    expect(onNavegar).toHaveBeenCalledWith('#/curva-abc');
  });

  it('seta para baixo + Enter navega para o item ativo', () => {
    const onNavegar = vi.fn();
    render(<BuscaModulos onNavegar={onNavegar} />);
    const campo = screen.getByRole('combobox');

    fireEvent.change(campo, { target: { value: 'e' } });
    fireEvent.keyDown(campo, { key: 'ArrowDown' });
    const ativo = campo.getAttribute('aria-activedescendant');
    expect(ativo).toBeTruthy();
    expect(document.getElementById(ativo)).toHaveAttribute('role', 'option');
    fireEvent.keyDown(campo, { key: 'Enter' });

    expect(onNavegar).toHaveBeenCalledTimes(1);
  });

  it('Esc fecha a lista de resultados', () => {
    render(<BuscaModulos onNavegar={() => {}} />);
    const campo = screen.getByRole('combobox');

    fireEvent.change(campo, { target: { value: 'v' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(campo, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(campo).toHaveAttribute('aria-expanded', 'false');
  });

  it('aria-controls só existe com a lista aberta', () => {
    render(<BuscaModulos onNavegar={() => {}} />);
    const campo = screen.getByRole('combobox');
    expect(campo).not.toHaveAttribute('aria-controls');

    fireEvent.change(campo, { target: { value: 'v' } });
    expect(campo).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);

    fireEvent.keyDown(campo, { key: 'Escape' });
    expect(campo).not.toHaveAttribute('aria-controls');
  });

  it('a região de status fica sempre montada (vazia até haver algo a anunciar)', () => {
    render(<BuscaModulos onNavegar={() => {}} />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } });

    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Nenhum módulo encontrado');
  });

  it('Enter em item "em breve" anuncia que o módulo ainda não está disponível', () => {
    render(<BuscaModulos onNavegar={() => {}} />);
    const campo = screen.getByRole('combobox');

    fireEvent.change(campo, { target: { value: 'rentab' } });
    fireEvent.keyDown(campo, { key: 'ArrowDown' });
    fireEvent.keyDown(campo, { key: 'Enter' });

    expect(screen.getByRole('status')).toHaveTextContent('Rentabilidade ainda não está disponível (em breve).');
  });
});
