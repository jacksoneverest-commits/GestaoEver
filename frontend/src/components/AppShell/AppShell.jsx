import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon/Icon.jsx';
import AvatarMenu from './AvatarMenu.jsx';
import BuscaModulos from './BuscaModulos.jsx';
import { MODULOS, moduloDaRota } from './modulos.js';
import './AppShell.css';

// Layout autenticado: sidebar (gaveta no mobile), topbar e área principal. Só apresentação e navegação por hash.
function AppShell({ rotaAtual, usuario, onLogout, children }) {
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const botaoMenu = useRef(null);
  const sidebar = useRef(null);
  const coluna = useRef(null);
  const alvoFoco = useRef(null); // 'menu' | 'conteudo': para onde o foco vai depois de fechar a gaveta
  const moduloAtual = moduloDaRota(rotaAtual);

  // Título do documento por módulo; ao trocar de módulo (não na primeira renderização) o foco vai ao conteúdo.
  const primeiraRota = useRef(true);
  useEffect(() => {
    document.title = `${moduloAtual.rotulo} · GestãoEverSoftPlus`;
    if (primeiraRota.current) {
      primeiraRota.current = false;
      return;
    }
    const principal = document.getElementById('conteudo-principal');
    if (principal) principal.focus();
  }, [moduloAtual.id, moduloAtual.rotulo]);

  function fechar(alvo) {
    alvoFoco.current = alvo;
    setGavetaAberta(false);
  }

  // Gaveta aberta: restante da página inerte, scroll do body travado e foco no primeiro link.
  // Ao fechar (cleanup + próximo efeito), o foco vai para o botão de menu ou para o conteúdo.
  useEffect(() => {
    const elColuna = coluna.current;
    if (gavetaAberta) {
      if (elColuna) elColuna.setAttribute('inert', '');
      document.body.classList.add('appshell-travado');
      const primeiroLink = sidebar.current && sidebar.current.querySelector('a[href]');
      if (primeiroLink) primeiroLink.focus();
      return () => {
        if (elColuna) elColuna.removeAttribute('inert');
        document.body.classList.remove('appshell-travado');
      };
    }
    if (alvoFoco.current === 'menu' && botaoMenu.current) botaoMenu.current.focus();
    if (alvoFoco.current === 'conteudo') {
      const principal = document.getElementById('conteudo-principal');
      if (principal) principal.focus();
    }
    alvoFoco.current = null;
    return undefined;
  }, [gavetaAberta]);

  useEffect(() => {
    if (!gavetaAberta) return undefined;
    function aoTeclar(e) {
      if (e.key === 'Escape') fechar('menu');
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [gavetaAberta]);

  // Confina o Tab dentro da gaveta aberta.
  function aoTeclarNaGaveta(e) {
    if (!gavetaAberta || e.key !== 'Tab' || !sidebar.current) return;
    const focaveis = sidebar.current.querySelectorAll('a[href], button:not([disabled])');
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  return (
    <div className="appshell">
      <a
        href="#conteudo-principal"
        className="appshell__pular"
        onClick={(e) => {
          e.preventDefault();
          const alvo = document.getElementById('conteudo-principal');
          if (alvo) alvo.focus();
        }}
      >
        Pular para o conteúdo
      </a>

      {gavetaAberta && (
        <div
          className="appshell__fundo"
          data-testid="appshell-fundo"
          aria-hidden="true"
          onClick={() => fechar('menu')}
        />
      )}

      <aside
        id="appshell-sidebar"
        ref={sidebar}
        className={`appshell__sidebar${gavetaAberta ? ' appshell__sidebar--aberta' : ''}`}
        role={gavetaAberta ? 'dialog' : undefined}
        aria-modal={gavetaAberta ? 'true' : undefined}
        aria-label={gavetaAberta ? 'Menu de navegação' : undefined}
        onKeyDown={aoTeclarNaGaveta}
      >
        {gavetaAberta && (
          <button type="button" className="appshell__fechar" onClick={() => fechar('menu')}>
            <Icon nome="fechar" />
            <span>Fechar menu</span>
          </button>
        )}

        <div className="appshell__marca">
          <span className="appshell__logo" aria-hidden="true">G</span>
          <span className="appshell__marca-nome">GestãoEverSoftPlus</span>
        </div>

        <nav aria-label="Módulos" className="appshell__nav">
          <ul className="appshell__lista">
            {MODULOS.map((modulo) => (
              <li key={modulo.id}>
                {modulo.desabilitado ? (
                  <span className="appshell__item appshell__item--desabilitado" aria-disabled="true">
                    <Icon nome={modulo.icone} />
                    <span>{modulo.rotulo}</span>
                    <span className="appshell__emBreve">Em breve</span>
                  </span>
                ) : (
                  <a
                    href={modulo.rota}
                    className={`appshell__item${modulo.id === moduloAtual.id ? ' appshell__item--ativo' : ''}`}
                    aria-current={modulo.id === moduloAtual.id ? 'page' : undefined}
                    onClick={() => {
                      if (gavetaAberta) fechar('conteudo');
                    }}
                  >
                    <Icon nome={modulo.icone} />
                    <span>{modulo.rotulo}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <button type="button" className="appshell__sair" onClick={onLogout}>
          <Icon nome="sair" />
          Sair
        </button>
      </aside>

      <div className="appshell__coluna" ref={coluna}>
        <div className="appshell__topbar">
          <button
            ref={botaoMenu}
            type="button"
            className="appshell__hamburguer"
            aria-label="Abrir menu"
            aria-expanded={gavetaAberta}
            aria-controls="appshell-sidebar"
            onClick={() => setGavetaAberta(true)}
          >
            <Icon nome="menu" />
          </button>
          <p className="appshell__titulo" data-testid="appshell-titulo">{moduloAtual.rotulo}</p>
          <BuscaModulos />
          <AvatarMenu nome={usuario} onLogout={onLogout} />
        </div>

        <main id="conteudo-principal" tabIndex={-1} className="appshell__conteudo">
          {children}
        </main>
      </div>
    </div>
  );
}

export default AppShell;
