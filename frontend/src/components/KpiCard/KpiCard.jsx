import Icon from '../Icon/Icon.jsx';
import { formatPercentualDuasCasas } from '../../utils/formatNumber.js';
import './KpiCard.css';

const VARIANTES = ['azul', 'ambar', 'ciano', 'verde'];

// A variação (percentual) vem pronta da API; aqui só é exibida, nunca só por cor (seta + texto).
function Variacao({ valor }) {
  const sentido = valor > 0 ? 'positiva' : valor < 0 ? 'negativa' : 'neutra';
  const seta = valor > 0 ? '▲' : valor < 0 ? '▼' : '=';
  const descricao = valor > 0 ? 'Aumento de' : valor < 0 ? 'Queda de' : 'Sem variação:';
  return (
    <p className={`kpi-card__variacao kpi-card__variacao--${sentido}`}>
      <span aria-hidden="true">{seta}</span>
      <span className="sr-only">{descricao} </span>
      <span>{formatPercentualDuasCasas(Math.abs(valor))}</span>
    </p>
  );
}

// nivel: nível do heading do rótulo (h2 quando o card é filho direto de um h1; h3 dentro de uma seção com h2).
function KpiCard({ rotulo, valor, variante = 'azul', variacao, icone, nivel = 3, detalhe }) {
  const Titulo = `h${nivel === 2 ? 2 : 3}`;
  const cor = VARIANTES.includes(variante) ? variante : 'azul';
  const temVariacao = variacao !== null && variacao !== undefined;
  return (
    <article className={`kpi-card kpi-card--${cor}`}>
      <div className="kpi-card__topo">
        <Titulo className="kpi-card__rotulo">{rotulo}</Titulo>
        {icone && <Icon nome={icone} className="kpi-card__icone" />}
      </div>
      <p className="kpi-card__valor">{valor}</p>
      {temVariacao && <Variacao valor={variacao} />}
      {detalhe && <p className="kpi-card__detalhe">{detalhe}</p>}
    </article>
  );
}

export default KpiCard;
