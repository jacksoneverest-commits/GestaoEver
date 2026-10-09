import { Fragment, useEffect, useState } from 'react';
import LoginPage from './pages/Login/LoginPage.jsx';
import DashboardPage from './pages/Dashboard/DashboardPage.jsx';
import VendasPage from './pages/Vendas/VendasPage.jsx';
import RankingProdutosPage from './pages/RankingProdutos/RankingProdutosPage.jsx';
import CurvaAbcPage from './pages/CurvaAbc/CurvaAbcPage.jsx';
import EstoquePage from './pages/Estoque/EstoquePage.jsx';
import UsuariosPage from './pages/Usuarios/UsuariosPage.jsx';
import AppShell from './components/AppShell/AppShell.jsx';
import { getToken, getUsuarioAtual, logout } from './services/authService.js';

// Navegação mínima por hash (#/login e #/), sem dependência de roteador.
function navegar(rota) {
  window.location.hash = rota;
}

function App() {
  const [, forcarRender] = useState(0);
  // Muda quando o botão "Atualizar dados" conclui: a página atual remonta e recarrega os dados.
  const [versaoDados, setVersaoDados] = useState(0);

  useEffect(() => {
    const aoMudarHash = () => forcarRender((n) => n + 1);
    window.addEventListener('hashchange', aoMudarHash);
    return () => window.removeEventListener('hashchange', aoMudarHash);
  }, []);

  const autenticado = Boolean(getToken());

  useEffect(() => {
    if (!autenticado) document.title = 'Entrar · GestãoEverSoftPlus';
  }, [autenticado]);

  // Rotas por hash (sem roteador): sem token, sempre o Login (fora do AppShell). Com token, a página abaixo é
  // renderizada dentro do AppShell: #/vendas, #/ranking-produtos, #/curva-abc, #/estoque, #/usuarios; qualquer
  // outro hash cai no Dashboard (home). O AppShell também atualiza document.title e o foco ao trocar de módulo.
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

  const rota = window.location.hash;
  let pagina = <DashboardPage />;
  if (rota === '#/vendas') pagina = <VendasPage />;
  else if (rota === '#/ranking-produtos') pagina = <RankingProdutosPage />;
  else if (rota === '#/curva-abc') pagina = <CurvaAbcPage />;
  else if (rota === '#/estoque') pagina = <EstoquePage />;
  else if (rota === '#/usuarios') pagina = <UsuariosPage />;

  return (
    <AppShell
      rotaAtual={rota}
      usuario={getUsuarioAtual()}
      onLogout={sair}
      onDadosAtualizados={() => setVersaoDados((n) => n + 1)}
    >
      <Fragment key={versaoDados}>{pagina}</Fragment>
    </AppShell>
  );

}

export default App;
