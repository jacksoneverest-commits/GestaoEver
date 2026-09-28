import { useId } from 'react';

// Campo numérico "Quantidade de itens" (limite). Quem usa guarda o texto digitado, valida com
// `interpretarLimite` (utils/limite.js) e passa `erro` quando inválido. Sem CSS próprio: as classes usam o
// `prefixo` da tela (`<prefixo>__campo`, `__input--invalido`, `__campo-erro`) e são estilizadas no CSS dela.
function CampoQuantidade({ prefixo, valor, onChange, erro, maximo, minimo = 1, sugestoes = [] }) {
  const id = useId();
  const idLista = `${id}-sugestoes`;
  const idErro = `${id}-erro`;
  return (
    <div className={`${prefixo}__campo`}>
      <label htmlFor={id}>Quantidade de itens</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        min={minimo}
        max={maximo}
        list={idLista}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={erro ? 'true' : undefined}
        aria-describedby={erro ? idErro : undefined}
        className={erro ? `${prefixo}__input--invalido` : undefined}
      />
      <datalist id={idLista}>
        {sugestoes.filter((n) => n <= maximo).map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {erro && (
        <p id={idErro} role="alert" className={`${prefixo}__campo-erro`}>
          {`Informe um número inteiro de ${minimo} a ${maximo}.`}
        </p>
      )}
    </div>
  );
}

export default CampoQuantidade;
