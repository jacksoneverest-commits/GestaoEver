import { useEffect, useState } from 'react';
import MensagemErro from '../../components/MensagemErro/MensagemErro.jsx';
import { criarUsuario, listarUsuarios, resetarSenha, trocarMinhaSenha } from '../../services/usuariosService.js';
import { classificarErro } from '../../utils/erroApi.js';
import './UsuariosPage.css';

// Perfis válidos do cadastro (Task 3.4): sem diferenciação de acesso entre eles nesta fase.
const PERFIS = [
  { valor: 'dono', rotulo: 'Dono' },
  { valor: 'gestor', rotulo: 'Gestor' },
  { valor: 'gerente_loja', rotulo: 'Gerente de loja' },
];
const PERFIL_PADRAO = 'gestor';

const CADASTRO_INICIAL = { usuario: '', nome: '', senha: '', perfil: PERFIL_PADRAO };

function rotuloPerfil(perfil) {
  const encontrado = PERFIS.find((p) => p.valor === perfil);
  return encontrado ? encontrado.rotulo : perfil;
}

// Linha da tabela de usuários: cada uma controla seu próprio estado de reset de senha.
function LinhaUsuario({ usuario, resetAberto, onAbrirReset, onFecharReset, sucessoReset }) {
  const [senhaNova, setSenhaNova] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const aberto = resetAberto === usuario.id;
  const idCampo = `usuarios-reset-senha-${usuario.id}`;

  const abrir = () => {
    setSenhaNova('');
    setErro(null);
    onAbrirReset(usuario.id);
  };

  const salvar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      await resetarSenha({ id: usuario.id, senhaNova });
      setCarregando(false);
      onFecharReset(usuario);
    } catch (e) {
      setCarregando(false);
      setErro((e && e.message) || 'Erro ao redefinir a senha.');
    }
  };

  return (
    <tr>
      <td>{usuario.usuario}</td>
      <td>{usuario.nome}</td>
      <td>{rotuloPerfil(usuario.perfil)}</td>
      <td>{usuario.ativo ? 'Sim' : 'Não'}</td>
      <td className="usuarios__acoes">
        {aberto ? (
          <div className="usuarios__reset-form">
            <label htmlFor={idCampo}>{`Nova senha para ${usuario.usuario}`}</label>
            <input
              id={idCampo}
              type="password"
              value={senhaNova}
              onChange={(e) => setSenhaNova(e.target.value)}
              disabled={carregando}
            />
            <div className="usuarios__reset-botoes">
              <button type="button" onClick={salvar} disabled={carregando || !senhaNova}>
                Salvar nova senha
              </button>
              <button type="button" onClick={() => onFecharReset(null)} disabled={carregando}>
                Cancelar
              </button>
            </div>
            {erro && <p role="alert" className="usuarios__erro">{erro}</p>}
          </div>
        ) : (
          <button type="button" onClick={abrir}>Resetar senha</button>
        )}
        {!aberto && sucessoReset && sucessoReset.id === usuario.id && (
          <p className="usuarios__sucesso">{`Senha de ${sucessoReset.usuario} redefinida com sucesso.`}</p>
        )}
      </td>
    </tr>
  );
}

function UsuariosPage({ onLogout }) {
  const [usuariosState, setUsuariosState] = useState({ carregando: true, erro: null, lista: [] });
  const [cadastro, setCadastro] = useState(CADASTRO_INICIAL);
  const [cadastroCarregando, setCadastroCarregando] = useState(false);
  const [cadastroErro, setCadastroErro] = useState(null);

  const [resetAberto, setResetAberto] = useState(null); // id do usuário com o formulário de reset aberto
  const [sucessoReset, setSucessoReset] = useState(null); // { id, usuario } da última redefinição concluída

  const [trocarSenhaForm, setTrocarSenhaForm] = useState({ senhaAtual: '', senhaNova: '' });
  const [trocarSenhaCarregando, setTrocarSenhaCarregando] = useState(false);
  const [trocarSenhaErro, setTrocarSenhaErro] = useState(null);
  const [trocarSenhaSucesso, setTrocarSenhaSucesso] = useState(false);

  useEffect(() => {
    let cancelado = false;
    listarUsuarios()
      .then((resposta) => {
        if (cancelado) return;
        setUsuariosState({ carregando: false, erro: null, lista: (resposta && resposta.usuarios) || [] });
      })
      .catch((e) => {
        if (cancelado) return;
        setUsuariosState({ carregando: false, erro: classificarErro(e, 'Erro ao carregar os usuários.'), lista: [] });
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function aoCadastrar(e) {
    e.preventDefault();
    setCadastroCarregando(true);
    setCadastroErro(null);
    try {
      const usuarioCriado = await criarUsuario(cadastro);
      setUsuariosState((atual) => ({ ...atual, lista: [...atual.lista, usuarioCriado] }));
      setCadastro(CADASTRO_INICIAL);
      setCadastroCarregando(false);
    } catch (e) {
      setCadastroCarregando(false);
      setCadastroErro((e && e.message) || 'Erro ao cadastrar o usuário.');
    }
  }

  function fecharReset(usuarioAtualizado) {
    setResetAberto(null);
    if (usuarioAtualizado) {
      setSucessoReset({ id: usuarioAtualizado.id, usuario: usuarioAtualizado.usuario });
    }
  }

  async function aoTrocarSenha(e) {
    e.preventDefault();
    setTrocarSenhaCarregando(true);
    setTrocarSenhaErro(null);
    setTrocarSenhaSucesso(false);
    try {
      await trocarMinhaSenha(trocarSenhaForm);
      setTrocarSenhaCarregando(false);
      setTrocarSenhaSucesso(true);
      setTrocarSenhaForm({ senhaAtual: '', senhaNova: '' });
    } catch (e) {
      // "senha atual incorreta" vem como 400 (não 401 — a sessão/token continua válido, só o campo não confere).
      // Por isso a tela nunca desloga aqui: qualquer 401 já teria sido interceptado antes pelo apiClient.
      setTrocarSenhaCarregando(false);
      setTrocarSenhaErro((e && e.message) || 'Erro ao trocar a senha.');
    }
  }

  return (
    <div className="usuarios">
      <header className="usuarios__topo">
        <div>
          <a className="usuarios__voltar" href="#/">Voltar ao painel</a>
          <h1 className="usuarios__titulo">Usuários</h1>
        </div>
        <button type="button" className="usuarios__sair" onClick={onLogout}>Sair</button>
      </header>

      <main className="usuarios__conteudo">
        <section aria-labelledby="usuarios-lista-titulo">
          <h2 id="usuarios-lista-titulo" className="usuarios__secao-titulo">Usuários cadastrados</h2>
          {usuariosState.carregando && (
            <p role="status" aria-live="polite" className="usuarios__carregando">Carregando usuários...</p>
          )}
          {usuariosState.erro && <MensagemErro prefixo="usuarios" erro={usuariosState.erro} />}
          {!usuariosState.carregando && !usuariosState.erro && (
            usuariosState.lista.length === 0 ? (
              <p className="usuarios__vazio">Nenhum usuário cadastrado.</p>
            ) : (
              <table className="usuarios__tabela">
                <thead>
                  <tr>
                    <th scope="col">Usuário</th>
                    <th scope="col">Nome</th>
                    <th scope="col">Perfil</th>
                    <th scope="col">Ativo</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {usuariosState.lista.map((usuario) => (
                    <LinhaUsuario
                      key={usuario.id}
                      usuario={usuario}
                      resetAberto={resetAberto}
                      onAbrirReset={setResetAberto}
                      onFecharReset={fecharReset}
                      sucessoReset={sucessoReset}
                    />
                  ))}
                </tbody>
              </table>
            )
          )}
        </section>

        <section aria-labelledby="usuarios-cadastro-titulo">
          <h2 id="usuarios-cadastro-titulo" className="usuarios__secao-titulo">Cadastrar usuário</h2>
          <form className="usuarios__form" onSubmit={aoCadastrar}>
            <div className="usuarios__campo">
              <label htmlFor="usuarios-cadastro-usuario">Usuário</label>
              <input
                id="usuarios-cadastro-usuario"
                type="text"
                required
                value={cadastro.usuario}
                onChange={(e) => setCadastro({ ...cadastro, usuario: e.target.value })}
              />
            </div>
            <div className="usuarios__campo">
              <label htmlFor="usuarios-cadastro-nome">Nome</label>
              <input
                id="usuarios-cadastro-nome"
                type="text"
                required
                value={cadastro.nome}
                onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })}
              />
            </div>
            <div className="usuarios__campo">
              <label htmlFor="usuarios-cadastro-senha">Senha</label>
              <input
                id="usuarios-cadastro-senha"
                type="password"
                required
                value={cadastro.senha}
                onChange={(e) => setCadastro({ ...cadastro, senha: e.target.value })}
              />
            </div>
            <div className="usuarios__campo">
              <label htmlFor="usuarios-cadastro-perfil">Perfil</label>
              <select
                id="usuarios-cadastro-perfil"
                value={cadastro.perfil}
                onChange={(e) => setCadastro({ ...cadastro, perfil: e.target.value })}
              >
                {PERFIS.map((p) => (
                  <option key={p.valor} value={p.valor}>{p.rotulo}</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={cadastroCarregando}>Cadastrar usuário</button>
          </form>
          {cadastroErro && <p role="alert" className="usuarios__erro">{cadastroErro}</p>}
        </section>

        <section aria-labelledby="usuarios-trocar-senha-titulo">
          <h2 id="usuarios-trocar-senha-titulo" className="usuarios__secao-titulo">Trocar minha senha</h2>
          <form className="usuarios__form" onSubmit={aoTrocarSenha}>
            <div className="usuarios__campo">
              <label htmlFor="usuarios-senha-atual">Senha atual</label>
              <input
                id="usuarios-senha-atual"
                type="password"
                required
                value={trocarSenhaForm.senhaAtual}
                onChange={(e) => setTrocarSenhaForm({ ...trocarSenhaForm, senhaAtual: e.target.value })}
              />
            </div>
            <div className="usuarios__campo">
              <label htmlFor="usuarios-senha-nova">Nova senha</label>
              <input
                id="usuarios-senha-nova"
                type="password"
                required
                value={trocarSenhaForm.senhaNova}
                onChange={(e) => setTrocarSenhaForm({ ...trocarSenhaForm, senhaNova: e.target.value })}
              />
            </div>
            <button type="submit" disabled={trocarSenhaCarregando}>Trocar minha senha</button>
          </form>
          {trocarSenhaErro && <p role="alert" className="usuarios__erro">{trocarSenhaErro}</p>}
          {trocarSenhaSucesso && <p className="usuarios__sucesso">Senha alterada com sucesso.</p>}
        </section>
      </main>
    </div>
  );
}

export default UsuariosPage;
