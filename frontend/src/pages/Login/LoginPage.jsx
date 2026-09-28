import { useState } from 'react';
import { login } from '../../services/authService.js';
import './LoginPage.css';

function LoginPage({ onSuccess }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  async function handleSubmit(evento) {
    evento.preventDefault();
    setErro('');
    setCarregando(true);
    try {
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
