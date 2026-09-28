import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import UsuariosPage from '../../../src/pages/Usuarios/UsuariosPage.jsx';
import {
  criarUsuario,
  listarUsuarios,
  resetarSenha,
  trocarMinhaSenha,
} from '../../../src/services/usuariosService.js';

vi.mock('../../../src/services/usuariosService.js');

const usuariosMock = [
  { id: 1, usuario: 'joao', nome: 'João Silva', perfil: 'gestor', ativo: true },
  { id: 2, usuario: 'maria', nome: 'Maria Souza', perfil: 'dono', ativo: true },
];

function preencher(campo, valor) {
  fireEvent.change(screen.getByLabelText(campo), { target: { value: valor } });
}

describe('UsuariosPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('a lista de usuários trata os 3 estados (carregando, erro, sucesso) sem deixar a tela em branco', async () => {
    // Estado carregando: a promise da API ainda não resolveu.
    listarUsuarios.mockReturnValue(new Promise(() => {}));
    const carregando = render(<UsuariosPage onLogout={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando usuários...');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    carregando.unmount();

    // Estado erro: a API rejeita.
    listarUsuarios.mockRejectedValue(new Error('Erro ao consultar o servidor. Tente novamente.'));
    const comErro = render(<UsuariosPage onLogout={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao consultar o servidor. Tente novamente.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    comErro.unmount();

    // Estado sucesso: a API resolve com a lista de usuários.
    listarUsuarios.mockResolvedValue({ usuarios: usuariosMock });
    render(<UsuariosPage onLogout={() => {}} />);
    expect(await screen.findByRole('cell', { name: 'joao' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'maria' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cadastrar um novo usuário com dados válidos (mock do service) atualiza a lista exibida', async () => {
    listarUsuarios.mockResolvedValue({ usuarios: usuariosMock });
    const novoUsuario = { id: 3, usuario: 'pedro', nome: 'Pedro Lima', perfil: 'gerente_loja', ativo: true };
    criarUsuario.mockResolvedValue(novoUsuario);
    render(<UsuariosPage onLogout={() => {}} />);
    await screen.findByRole('cell', { name: 'joao' });

    preencher('Usuário', 'pedro');
    preencher('Nome', 'Pedro Lima');
    preencher('Senha', 'segredo123');
    fireEvent.change(screen.getByLabelText('Perfil'), { target: { value: 'gerente_loja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar usuário' }));

    expect(await screen.findByRole('cell', { name: 'pedro' })).toBeInTheDocument();
    expect(criarUsuario).toHaveBeenCalledWith({
      usuario: 'pedro',
      nome: 'Pedro Lima',
      senha: 'segredo123',
      perfil: 'gerente_loja',
    });
    // A lista mostra os três usuários (os dois originais + o novo).
    expect(screen.getAllByRole('row')).toHaveLength(4); // cabeçalho + 3 usuários
    // O formulário é limpo após o cadastro.
    expect(screen.getByLabelText('Usuário')).toHaveValue('');
  });

  it('trocar a própria senha informando a senha atual errada (mock retorna erro) exibe mensagem de erro e mantém a sessão logada', async () => {
    listarUsuarios.mockResolvedValue({ usuarios: usuariosMock });
    const erro400 = Object.assign(new Error('Senha atual incorreta.'), { status: 400 });
    trocarMinhaSenha.mockRejectedValue(erro400);
    const onLogout = vi.fn();
    render(<UsuariosPage onLogout={onLogout} />);
    await screen.findByRole('cell', { name: 'joao' });

    preencher('Senha atual', 'senhaErrada');
    preencher('Nova senha', 'novaSenha123');
    fireEvent.click(screen.getByRole('button', { name: 'Trocar minha senha' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Senha atual incorreta.');
    // A sessão continua ativa: nada chamou onLogout e a tela de Usuários segue montada.
    expect(onLogout).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Usuários' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'joao' })).toBeInTheDocument();
  });

  it('reseta a senha de outro usuário sem pedir a senha atual', async () => {
    listarUsuarios.mockResolvedValue({ usuarios: usuariosMock });
    resetarSenha.mockResolvedValue({});
    render(<UsuariosPage onLogout={() => {}} />);
    await screen.findByRole('cell', { name: 'joao' });
    const linhaJoao = screen.getByRole('cell', { name: 'joao' }).closest('tr');

    fireEvent.click(within(linhaJoao).getByRole('button', { name: 'Resetar senha' }));
    fireEvent.change(within(linhaJoao).getByLabelText(/Nova senha para joao/i), { target: { value: 'outraSenha1' } });
    fireEvent.click(within(linhaJoao).getByRole('button', { name: 'Salvar nova senha' }));

    await screen.findByText(/Senha de joao redefinida/i);
    expect(resetarSenha).toHaveBeenCalledWith({ id: 1, senhaNova: 'outraSenha1' });
  });

  it('cadastro com o service retornando erro exibe a mensagem e não altera a lista exibida', async () => {
    listarUsuarios.mockResolvedValue({ usuarios: usuariosMock });
    criarUsuario.mockRejectedValue(Object.assign(new Error('usuario já existe.'), { status: 400 }));
    render(<UsuariosPage onLogout={() => {}} />);
    await screen.findByRole('cell', { name: 'joao' });

    preencher('Usuário', 'joao');
    preencher('Nome', 'João Duplicado');
    preencher('Senha', 'segredo123');
    fireEvent.change(screen.getByLabelText('Perfil'), { target: { value: 'gestor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar usuário' }));

    expect(await screen.findByText('usuario já existe.')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // cabeçalho + 2 usuários originais
  });
});
