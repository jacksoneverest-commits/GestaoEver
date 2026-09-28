import { useEffect, useState } from 'react';
import LoginPage from './pages/Login/LoginPage.jsx';
import DashboardPage from './pages/Dashboard/DashboardPage.jsx';
import VendasPage from './pages/Vendas/VendasPage.jsx';
import RankingProdutosPage from './pages/RankingProdutos/RankingProdutosPage.jsx';
import CurvaAbcPage from './pages/CurvaAbc/CurvaAbcPage.jsx';
import EstoquePage from './pages/Estoque/EstoquePage.jsx';
import UsuariosPage from './pages/Usuarios/UsuariosPage.jsx';
import { getToken, logout } from './services/authService.js';

// Navegação mínima por hash (#/login e #/), sem dependência de roteador.
function navegar(rota) {
  window.location.hash = rota;
}

function App() {
  const [, forcarRender] = useState(0);

  useEffect(() => {
    const aoMudarHash = () => forcarRender((n) => n + 1);
    window.addEventListener('hashchange', aoMudarHash);
    return () => window.removeEventListener('hashchange', aoMudarHash);
  }, []);

  const autenticado = Boolean(getToken());

  // Rota protegida: sem token, sempre login. Com token, #/vendas mostra Vendas, #/ranking-produtos mostra o Ranking, #/curva-abc mostra a Curva ABC, #/estoque mostra o Estoque Inteligente, #/usuarios mostra a gestão de Usuários e qualquer outro hash mostra o dashboard.
  if (!autenticado) {
    return (
      <LoginPage
        onSuccess={() => {
          navegar('#/');
          forcarRender((n) => n + 1);
        }}
      />
    );
  }

  function sair() {
    logout();
    navegar('#/login');
    forcarRender((n) => n + 1);
  }

  if (window.location.hash === '#/vendas') {
    return <VendasPage onLogout={sair} />;
  }

  if (window.location.hash === '#/ranking-produtos') {
    return <RankingProdutosPage onLogout={sair} />;
  }

  if (window.location.hash === '#/curva-abc') {
    return <CurvaAbcPage onLogout={sair} />;
  }

  if (window.location.hash === '#/estoque') {
    return <EstoquePage onLogout={sair} />;
  }

  if (window.location.hash === '#/usuarios') {
    return <UsuariosPage onLogout={sair} />;
  }

  return <DashboardPage onLogout={sair} />;
}

export default App;
