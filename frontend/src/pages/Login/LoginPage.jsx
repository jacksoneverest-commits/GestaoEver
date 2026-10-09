import { useState } from 'react';
import { login, logout } from '../../services/authService.js';
import { getApiUrl, normalizarApiUrl, setApiUrl, validarServidor } from '../../services/apiUrlService.js';
import Icon from '../../components/Icon/Icon.jsx';
import './LoginPage.css';

function LoginPage({ onSuccess }) {
  const [servidor, setServidor] = useState(() => getApiUrl());
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [configAberta, setConfigAberta] = useState(false);
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Grava o servidor (validado via /health) sem fazer login. Trocar de servidor invalida o token antigo.
  async function handleSalvarServidor() {
    setErro('');
    setAviso('');
    setSalvando(true);
    try {
      const urlNova = normalizarApiUrl(servidor);
      await validarServidor(urlNova);
      const urlAnterior = getApiUrl();
      setApiUrl(urlNova);
      if (urlNova !== urlAnterior) logout();
      setServidor(urlNova);
      setAviso('Servidor salvo.');
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function handleSubmit(evento) {
    evento.preventDefault();
    setErro('');
    setAviso('');
    setCarregando(true);
    let etapaServidor = true;
    try {
      const urlNova = normalizarApiUrl(servidor);
      await validarServidor(urlNova);
      const urlAnterior = getApiUrl();
      setApiUrl(urlNova);
      // Por design: ao trocar de servidor, o logout() (limpa o token antigo) roda antes do login.
      if (urlNova !== urlAnterior) logout();
      etapaServidor = false;
      await login({ usuario, senha });
      onSuccess();
    } catch (e) {
      setErro(e.message);
      // Erro de servidor: abre as Configurações para o usuário ver e corrigir o campo.
      if (etapaServidor) setConfigAberta(true);
      setCarregando(false);
    }
  }

  return (
    <main className="login">
      <section className="login__marca-painel">
        <span className="login__logo" aria-hidden="true">G</span>
        <h1 className="login__marca">GestãoEverSoftPlus</h1>
        <p className="login__slogan">Vendas, ranking de produtos, curva ABC e estoque em um só painel, sempre atualizado.</p>
      </section>

      <section className="login__form-painel">
        <form className="login__card" onSubmit={handleSubmit}>
          <div className="login__cabecalho">
            <h2 className="login__titulo">Entrar</h2>
            <button
              type="button"
              className="login__config-botao"
              aria-label="Configurações"
              aria-expanded={configAberta}
              aria-controls="login-config"
              onClick={() => setConfigAberta((aberta) => !aberta)}
            >
              <Icon nome="configuracoes" />
            </button>
          </div>

          <label className="login__campo" htmlFor="login-usuario">Usuário</label>
          <input
            id="login-usuario"
            type="text"
            autoComplete="username"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            disabled={carregando}
          />

          <label className="login__campo" htmlFor="login-senha">Senha</label>
          <input
            id="login-senha"
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            disabled={carregando}
          />

          {configAberta && (
            <div id="login-config" className="login__config">
              <label className="login__campo" htmlFor="login-servidor">Servidor</label>
              <input
                id="login-servidor"
                type="text"
                autoComplete="url"
                value={servidor}
                onChange={(e) => setServidor(e.target.value)}
                aria-describedby="login-servidor-ajuda"
                disabled={carregando || salvando}
              />
              <p id="login-servidor-ajuda" className="login__ajuda">
                Se a API for http:// e esta página for https://, libere o conteúdo inseguro no navegador para este site
                (Chrome/Edge: chrome://settings/content/insecureContent).
              </p>
              <button
                type="button"
                className="login__salvar"
                onClick={handleSalvarServidor}
                disabled={carregando || salvando}
              >
                {salvando ? 'Salvando...' : 'Salvar servidor'}
              </button>
              {aviso && <p role="status" className="login__aviso">{aviso}</p>}
            </div>
          )}

          {erro && <p role="alert" className="login__erro">{erro}</p>}

          <button type="submit" disabled={carregando}>
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

export default LoginPage;
