import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from '../../../src/pages/Login/LoginPage.jsx';
import * as authService from '../../../src/services/authService.js';
import * as apiUrlService from '../../../src/services/apiUrlService.js';

vi.mock('../../../src/services/authService.js');
vi.mock('../../../src/services/apiUrlService.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, getApiUrl: vi.fn(), validarServidor: vi.fn() };
});

function preencherEEnviar(usuario, senha) {
  fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: usuario } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    apiUrlService.getApiUrl.mockReturnValue('http://localhost:3001');
    apiUrlService.validarServidor.mockResolvedValue(undefined);
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

  it('o campo Servidor vem preenchido com a URL atual', () => {
    render(<LoginPage onSuccess={vi.fn()} />);

    expect(screen.getByLabelText('Servidor')).toHaveValue('http://localhost:3001');
  });

  it('exibe texto de ajuda fixo sobre conteúdo inseguro (http em página https) junto ao campo Servidor', () => {
    render(<LoginPage onSuccess={vi.fn()} />);

    const ajuda = screen.getByText(/conteúdo inseguro/i);
    expect(ajuda).toHaveTextContent('chrome://settings/content/insecureContent');
    expect(screen.getByLabelText('Servidor')).toHaveAccessibleDescription(ajuda.textContent);
  });

  it('valida o servidor via /health antes do login e mostra erro claro quando falha', async () => {
    apiUrlService.validarServidor.mockRejectedValue(
      new Error('Servidor inacessível. Se a API é http e esta página https, libere conteúdo inseguro no navegador para este site.')
    );
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);

    preencherEEnviar('gestor', 'segredo');

    expect(await screen.findByRole('alert')).toHaveTextContent(/inacessível.*conteúdo inseguro/);
    expect(authService.login).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('URL de servidor inválida mostra erro de URL sem consultar o servidor', async () => {
    render(<LoginPage onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Servidor'), { target: { value: 'servidor:3001' } });
    preencherEEnviar('gestor', 'segredo');

    expect(await screen.findByRole('alert')).toHaveTextContent(/URL.*inválida/i);
    expect(apiUrlService.validarServidor).not.toHaveBeenCalled();
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('trocar de servidor salva a nova URL e limpa o token', async () => {
    authService.login.mockResolvedValue({ token: 'abc' });
    render(<LoginPage onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Servidor'), { target: { value: 'http://novo:3001/' } });
    preencherEEnviar('gestor', 'segredo');

    await waitFor(() => expect(authService.login).toHaveBeenCalled());
    expect(apiUrlService.validarServidor).toHaveBeenCalledWith('http://novo:3001');
    expect(localStorage.getItem('apiUrl')).toBe('http://novo:3001');
    expect(authService.logout).toHaveBeenCalled();
  });

  it('manter o mesmo servidor não limpa o token', async () => {
    authService.login.mockResolvedValue({ token: 'abc' });
    render(<LoginPage onSuccess={vi.fn()} />);

    preencherEEnviar('gestor', 'segredo');

    await waitFor(() => expect(authService.login).toHaveBeenCalled());
    expect(authService.logout).not.toHaveBeenCalled();
  });
});
