import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AtualizarDados from '../../../src/components/AtualizarDados/AtualizarDados.jsx';
import { iniciarAtualizacao, obterStatusAtualizacao } from '../../../src/services/cacheService.js';

vi.mock('../../../src/services/cacheService.js');

const OCIOSO = { situacao: 'ocioso', iniciadoEm: null, finalizadoEm: null, ultimaAtualizacao: '2026-10-08' };
const RODANDO = { ...OCIOSO, situacao: 'rodando', iniciadoEm: '2026-10-09T10:00:00.000Z' };
const OK = { ...OCIOSO, situacao: 'ok', ultimaAtualizacao: '2026-10-09' };
const FALHA = { ...OCIOSO, situacao: 'falha' };

// Deixa as promises pendentes resolverem dentro do act e avança os timers do polling.
async function avancar(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('AtualizarDados', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    obterStatusAtualizacao.mockResolvedValue(OCIOSO);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra o botão "Atualizar dados" e a data da última atualização em dd/mm/aaaa', async () => {
    render(<AtualizarDados />);
    await avancar(0);

    expect(screen.getByRole('button', { name: /Atualizar dados/ })).toBeEnabled();
    expect(screen.getByText(/08\/10\/2026/)).toBeInTheDocument();
  });

  it('ao clicar dispara a atualização e desabilita o botão mostrando "Atualizando"', async () => {
    iniciarAtualizacao.mockResolvedValue(RODANDO);
    obterStatusAtualizacao.mockResolvedValueOnce(OCIOSO).mockResolvedValue(RODANDO);
    render(<AtualizarDados />);
    await avancar(0);

    fireEvent.click(screen.getByRole('button', { name: /Atualizar dados/ }));
    await avancar(0);

    expect(iniciarAtualizacao).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Atualizando/ })).toBeDisabled();
  });

  it('quando a rotina termina com sucesso chama onConcluido e mostra a mensagem de sucesso', async () => {
    const onConcluido = vi.fn();
    iniciarAtualizacao.mockResolvedValue(RODANDO);
    obterStatusAtualizacao.mockResolvedValueOnce(OCIOSO).mockResolvedValue(OK);
    render(<AtualizarDados onConcluido={onConcluido} />);
    await avancar(0);

    fireEvent.click(screen.getByRole('button', { name: /Atualizar dados/ }));
    await avancar(3500);

    expect(onConcluido).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/Dados atualizados/);
    expect(screen.getByRole('button', { name: /Atualizar dados/ })).toBeEnabled();
  });

  it('quando a rotina termina com falha mostra o erro e não chama onConcluido', async () => {
    const onConcluido = vi.fn();
    iniciarAtualizacao.mockResolvedValue(RODANDO);
    obterStatusAtualizacao.mockResolvedValueOnce(OCIOSO).mockResolvedValue(FALHA);
    render(<AtualizarDados onConcluido={onConcluido} />);
    await avancar(0);

    fireEvent.click(screen.getByRole('button', { name: /Atualizar dados/ }));
    await avancar(3500);

    expect(onConcluido).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Falha ao atualizar/);
  });

  it('erro ao chamar a API mostra a mensagem do erro e libera o botão', async () => {
    iniciarAtualizacao.mockRejectedValue(new Error('Não foi possível conectar ao servidor. Tente novamente.'));
    render(<AtualizarDados />);
    await avancar(0);

    fireEvent.click(screen.getByRole('button', { name: /Atualizar dados/ }));
    await avancar(0);

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível conectar ao servidor.');
    expect(screen.getByRole('button', { name: /Atualizar dados/ })).toBeEnabled();
  });

  it('se já houver uma atualização rodando ao abrir, mostra "Atualizando" e acompanha até terminar', async () => {
    obterStatusAtualizacao.mockResolvedValueOnce(RODANDO).mockResolvedValue(OK);
    render(<AtualizarDados />);
    await avancar(0);

    expect(screen.getByRole('button', { name: /Atualizando/ })).toBeDisabled();

    await avancar(3500);
    expect(screen.getByRole('button', { name: /Atualizar dados/ })).toBeEnabled();
  });
});
