import { useEffect, useState } from 'react';

const CONSULTA = '(max-width: 600px)';

function lerCorrespondencia() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(CONSULTA).matches;
}

// true em telas estreitas (<= 600px). Sem matchMedia (ex.: jsdom), assume tela larga.
export function useTelaEstreita() {
  const [estreita, setEstreita] = useState(lerCorrespondencia);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const lista = window.matchMedia(CONSULTA);
    const aoMudar = (e) => setEstreita(e.matches);
    lista.addEventListener('change', aoMudar);
    setEstreita(lista.matches);
    return () => lista.removeEventListener('change', aoMudar);
  }, []);

  return estreita;
}
