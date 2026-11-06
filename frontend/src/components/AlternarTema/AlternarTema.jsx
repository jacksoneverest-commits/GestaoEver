import { useEffect, useState } from 'react';
import Icon from '../Icon/Icon.jsx';
import { aplicarTema, lerTema, salvarTema } from '../../utils/tema.js';
import './AlternarTema.css';

// Botão da topbar que alterna entre tema claro e escuro; a escolha fica salva no navegador.
function AlternarTema() {
  const [tema, setTema] = useState(lerTema);

  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

  function alternar() {
    const proximo = tema === 'escuro' ? 'claro' : 'escuro';
    salvarTema(proximo);
    setTema(proximo);
  }

  const escuro = tema === 'escuro';
  return (
    <button
      type="button"
      className="alternar-tema"
      aria-label="Alternar tema claro/escuro"
      aria-pressed={escuro}
      title="Alternar tema claro/escuro"
      onClick={alternar}
    >
      <Icon nome={escuro ? 'sol' : 'lua'} />
    </button>
  );
}

export default AlternarTema;
