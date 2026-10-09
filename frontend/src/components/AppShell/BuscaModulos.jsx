import { useId, useState } from 'react';
import Icon from '../Icon/Icon.jsx';
import { MODULOS, normalizarTexto } from './modulos.js';

function navegarPadrao(rota) {
  window.location.hash = rota;
}

// Busca de módulos (combobox com lista): filtra por nome e navega com Enter/clique. Não busca dados do ERP.
function BuscaModulos({ onNavegar = navegarPadrao }) {
  const idBase = useId();
  const idLista = `${idBase}-lista`;
  const [consulta, setConsulta] = useState('');
  const [fechado, setFechado] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(-1);
  const [aviso, setAviso] = useState('');

  const termo = normalizarTexto(consulta);
  const resultados = termo ? MODULOS.filter((m) => normalizarTexto(m.rotulo).includes(termo)) : [];
  const aberto = termo !== '' && !fechado;
  const listaVisivel = aberto && resultados.length > 0;
  const idOpcao = (indice) => `${idBase}-opcao-${indice}`;

  // Região de status sempre montada (leitores de tela só anunciam mudanças em regiões já existentes).
  let mensagemStatus = aviso;
  if (!mensagemStatus && aberto && resultados.length === 0) mensagemStatus = 'Nenhum módulo encontrado';

  function escolher(modulo) {
    if (modulo.desabilitado) {
      setAviso(`${modulo.rotulo} ainda não está disponível (em breve).`);
      return;
    }
    onNavegar(modulo.rota);
    setConsulta('');
    setFechado(false);
    setIndiceAtivo(-1);
    setAviso('');
  }

  function aoDigitar(e) {
    setConsulta(e.target.value);
    setFechado(false);
    setIndiceAtivo(-1);
    setAviso('');
  }

  function aoTeclar(e) {
    if (e.key === 'ArrowDown' && resultados.length > 0) {
      e.preventDefault();
      setFechado(false);
      setIndiceAtivo((i) => (i + 1) % resultados.length);
    } else if (e.key === 'ArrowUp' && resultados.length > 0) {
      e.preventDefault();
      setIndiceAtivo((i) => (i <= 0 ? resultados.length - 1 : i - 1));
    } else if (e.key === 'Enter' && aberto && resultados.length > 0) {
      e.preventDefault();
      const alvo = indiceAtivo >= 0 ? resultados[indiceAtivo] : resultados.find((m) => !m.desabilitado) || resultados[0];
      escolher(alvo);
    } else if (e.key === 'Escape') {
      setFechado(true);
      setIndiceAtivo(-1);
    }
  }

  return (
    <div className="busca-modulos">
      <label htmlFor={`${idBase}-campo`} className="sr-only">Buscar módulo</label>
      <Icon nome="busca" className="busca-modulos__icone" />
      <input
        id={`${idBase}-campo`}
        className="busca-modulos__campo"
        type="text"
        role="combobox"
        autoComplete="off"
        placeholder="Buscar módulo"
        aria-expanded={listaVisivel}
        aria-controls={listaVisivel ? idLista : undefined}
        aria-autocomplete="list"
        aria-activedescendant={listaVisivel && indiceAtivo >= 0 ? idOpcao(indiceAtivo) : undefined}
        value={consulta}
        onChange={aoDigitar}
        onKeyDown={aoTeclar}
        onFocus={() => setFechado(false)}
        onBlur={() => setFechado(true)}
      />
      {listaVisivel && (
        <ul id={idLista} role="listbox" aria-label="Módulos encontrados" className="busca-modulos__lista">
          {resultados.map((modulo, indice) => (
            <li
              key={modulo.id}
              id={idOpcao(indice)}
              role="option"
              aria-selected={indice === indiceAtivo}
              aria-disabled={modulo.desabilitado ? 'true' : undefined}
              className={`busca-modulos__opcao${indice === indiceAtivo ? ' busca-modulos__opcao--ativa' : ''}${modulo.desabilitado ? ' busca-modulos__opcao--desabilitada' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(modulo)}
            >
              <Icon nome={modulo.icone} tamanho={18} />
              {modulo.rotulo}
              {modulo.desabilitado && <span className="busca-modulos__emBreve">em breve</span>}
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="busca-modulos__status">{mensagemStatus}</p>
    </div>
  );
}

export default BuscaModulos;
