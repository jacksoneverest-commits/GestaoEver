import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from '../../../src/pages/Login/LoginPage.jsx';
import * as authService from '../../../src/services/authService.js';

vi.mock('../../../src/services/authService.js');

function preencherEEnviar(usuario, senha) {
  fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: usuario } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('submeter credenciais válidas chama a API e redireciona para o dashboard', async () => {
    authService.login.mockResolvedValue({ token: 'abc' });
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);

    preencherEEnviar('gestor', 'segredo');

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(authService.login).toHaveBeenCalledWith({ usuario: 'gestor', senha: 'segredo' });
  });

  it('submeter credenciais inválidas exibe mensagem de erro e mantém o usuário no login', async () => {
    authService.login.mockRejectedValue(new Error('Usuário ou senha inválidos.'));
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);

    preencherEEnviar('gestor', 'errada');

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuário ou senha inválidos.');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });
});
