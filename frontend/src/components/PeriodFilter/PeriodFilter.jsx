import { useState } from 'react';
import './PeriodFilter.css';

const MSG_INTERVALO_INVALIDO = 'A data final não pode ser anterior à data inicial.';

// Filtro de período reutilizável. Datas em ISO 8601 (YYYY-MM-DD).
// Só chama onChange quando ambas as datas estão preenchidas e startDate <= endDate.
function PeriodFilter({ startDate = '', endDate = '', onChange }) {
  const [inicio, setInicio] = useState(startDate);
  const [fim, setFim] = useState(endDate);
  const [erro, setErro] = useState('');

  function atualizar(novoInicio, novoFim) {
    setInicio(novoInicio);
    setFim(novoFim);

    if (!novoInicio || !novoFim) {
      setErro('');
      return;
    }
    // Strings ISO comparam corretamente em ordem lexicográfica.
    if (novoFim < novoInicio) {
      setErro(MSG_INTERVALO_INVALIDO);
      return;
    }
    setErro('');
    onChange({ startDate: novoInicio, endDate: novoFim });
  }

  return (
    <div className="period-filter">
      <div className="period-filter__campos">
        <label className="period-filter__campo" htmlFor="period-filter-inicio">
          Data inicial
          <input
            id="period-filter-inicio"
            type="date"
            value={inicio}
            max={fim || undefined}
            onChange={(e) => atualizar(e.target.value, fim)}
          />
        </label>
        <label className="period-filter__campo" htmlFor="period-filter-fim">
          Data final
          <input
            id="period-filter-fim"
            type="date"
            value={fim}
            min={inicio || undefined}
            onChange={(e) => atualizar(inicio, e.target.value)}
          />
        </label>
      </div>
      {erro && <p role="alert" className="period-filter__erro">{erro}</p>}
    </div>
  );
}

export default PeriodFilter;
