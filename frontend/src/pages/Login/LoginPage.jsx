import { useState } from 'react';
import { login, logout } from '../../services/authService.js';
import { getApiUrl, normalizarApiUrl, setApiUrl, validarServidor } from '../../services/apiUrlService.js';
import './LoginPage.css';

function LoginPage({ onSuccess }) {
  const [servidor, setServidor] = useState(() => getApiUrl());
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  async function handleSubmit(evento) {
    evento.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const urlNova = normalizarApiUrl(servidor);
      await validarServidor(urlNova);
      const urlAnterior = getApiUrl();
      setApiUrl(urlNova);
      // Por design: ao trocar de servidor, o logout() (limpa o token antigo) roda antes do login.
      if (urlNova !== urlAnterior) logout();
      await login({ usuario, senha });
      onSuccess();
    } catch (e) {
      setErro(e.message);
      setCarregando(false);
    }
  }

  return (
    <main className="login">
      <form className="login__card" onSubmit={handleSubmit}>
        <h1 className="login__marca">GestãoEverSoftPlus</h1>
        <h2 className="login__titulo">Entrar</h2>

        <label className="login__campo" htmlFor="login-servidor">Servidor</label>
        <input
          id="login-servidor"
          type="text"
          autoComplete="url"
          value={servidor}
          onChange={(e) => setServidor(e.target.value)}
          aria-describedby="login-servidor-ajuda"
          disabled={carregando}
        />
        <p id="login-servidor-ajuda" className="login__ajuda">
          Se a API for http:// e esta página for https://, libere o conteúdo inseguro no navegador para este site
          (Chrome/Edge: chrome://settings/content/insecureContent).
        </p>

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

        {erro && <p role="alert" className="login__erro">{erro}</p>}

        <button type="submit" disabled={carregando}>
          {carregando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

export default LoginPage;
