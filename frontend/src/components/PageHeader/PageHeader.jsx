import './PageHeader.css';

// Cabeçalho padrão de página: título (h1), subtítulo opcional e área de ações (children), ex.: filtro de período.
function PageHeader({ titulo, subtitulo, children }) {
  return (
    <header className="page-header">
      <div className="page-header__texto">
        <h1 className="page-header__titulo">{titulo}</h1>
        {subtitulo && <p className="page-header__subtitulo">{subtitulo}</p>}
      </div>
      {children && <div className="page-header__acoes">{children}</div>}
    </header>
  );
}

export default PageHeader;
