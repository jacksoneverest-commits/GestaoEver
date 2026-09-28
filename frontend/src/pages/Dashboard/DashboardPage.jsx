const estiloLinkModulo = {
  display: 'inline-block',
  padding: '10px 16px',
  borderRadius: 6,
  background: '#1d4ed8',
  color: '#fff',
  textDecoration: 'none',
};

// Do segundo link em diante, afasta do anterior.
const estiloLinkModuloSeguinte = { ...estiloLinkModulo, marginLeft: 12 };

function DashboardPage({ onLogout }) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Dashboard</h1>
        <button type="button" onClick={onLogout}>Sair</button>
      </header>
      <nav aria-label="Módulos" style={{ marginTop: 24 }}>
        <a href="#/vendas" style={estiloLinkModulo}>
          Vendas
        </a>
        <a href="#/ranking-produtos" style={estiloLinkModuloSeguinte}>
          Ranking de Produtos
        </a>
        <a href="#/curva-abc" style={estiloLinkModuloSeguinte}>
          Curva ABC
        </a>
        <a href="#/estoque" style={estiloLinkModuloSeguinte}>
          Estoque
        </a>
        <a href="#/usuarios" style={estiloLinkModuloSeguinte}>
          Usuários
        </a>
      </nav>
    </div>
  );
}

export default DashboardPage;
