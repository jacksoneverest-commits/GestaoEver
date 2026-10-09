import { useEffect, useId, useRef, useState } from 'react';
import Icon from '../Icon/Icon.jsx';

function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const letras = partes.length === 1 ? partes[0].slice(0, 2) : partes[0][0] + partes[partes.length - 1][0];
  return letras.toUpperCase();
}

// Avatar com as iniciais do usuário e um painel (disclosure simples) com a ação Sair.
function AvatarMenu({ nome, onLogout }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  const botao = useRef(null);
  const idPainel = useId();

  useEffect(() => {
    if (!aberto) return undefined;
    function aoTeclar(e) {
      if (e.key === 'Escape') {
        setAberto(false);
        if (botao.current) botao.current.focus();
      }
    }
    function aoClicarFora(e) {
      if (raiz.current && !raiz.current.contains(e.target)) setAberto(false);
    }
    document.addEventListener('keydown', aoTeclar);
    document.addEventListener('mousedown', aoClicarFora);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('mousedown', aoClicarFora);
    };
  }, [aberto]);

  // Fecha quando o foco vai para fora do componente. Sem relatedTarget (clique em área sem foco) não
  // fecha aqui: o clique fora é tratado por mousedown, e isso evita perder o clique em "Sair" no Safari.
  function aoPerderFoco(e) {
    const destino = e.relatedTarget;
    if (destino && raiz.current && !raiz.current.contains(destino)) setAberto(false);
  }

  return (
    <div className="avatar-menu" ref={raiz} onBlur={aoPerderFoco}>
      <button
        ref={botao}
        type="button"
        className="avatar-menu__botao"
        aria-expanded={aberto}
        aria-controls={idPainel}
        aria-label={nome ? `Menu do usuário ${nome}` : 'Menu do usuário'}
        onClick={() => setAberto((a) => !a)}
      >
        {iniciais(nome)}
      </button>
      {aberto && (
        <div id={idPainel} className="avatar-menu__menu">
          <button type="button" className="avatar-menu__item" onClick={onLogout}>
            <Icon nome="sair" tamanho={18} />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

export default AvatarMenu;
