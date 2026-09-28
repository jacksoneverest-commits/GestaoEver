import { useEffect, useState } from 'react';
import PeriodFilter from '../../components/PeriodFilter/PeriodFilter.jsx';
import { obterFaturamento } from '../../services/vendasService.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { formatDecimal, formatInteger, formatPercent } from '../../utils/formatNumber.js';
import { periodoUltimosDias } from '../../utils/periodo.js';
import VendasCharts from './components/VendasCharts.jsx';
import './VendasPage.css';

const DIAS_PERIODO_PADRAO = 30;

function Variacao({ valor }) {
  if (valor === null || valor === undefined) {
    return <p className="vendas__variacao vendas__variacao--neutra">Variação indisponível</p>;
  }
  const tipo = valor > 0 ? 'positiva' : valor < 0 ? 'negativa' : 'neutra';
  const seta = valor > 0 ? '▲' : valor < 0 ? '▼' : '=';
  const descricao = valor > 0 ? 'Aumento de' : valor < 0 ? 'Queda de' : 'Sem variação:';
  return (
    <p className={`vendas__variacao vendas__variacao--${tipo}`}>
      <span aria-hidden="true">{seta}</span>
      <span className="vendas__sr-only">{descricao} </span>
      <span>{formatPercent(valor)}</span>
    </p>
  );
}

function Card({ id, titulo, children }) {
  return (
    <article className="vendas__card" aria-labelledby={id}>
      <h3 id={id} className="vendas__card-titulo">{titulo}</h3>
      {children}
    </article>
  );
}

function CardComparativo({ comparativo }) {
  return (
    <Card id="vendas-kpi-comparativo" titulo="Comparativo com período anterior">
      {comparativo ? (
        <>
          <Variacao valor={comparativo.variacaoPercentual} />
          <p className="vendas__detalhe">
            {formatDate(comparativo.periodoInicio)} a {formatDate(comparativo.periodoFim)}
          </p>
          <p className="vendas__detalhe">Faturamento anterior: {formatCurrency(comparativo.faturamento)}</p>
        </>
      ) : (
        <p className="vendas__vazio">Sem comparativo disponível</p>
      )}
    </Card>
  );
}

function VendasPage({ onLogout }) {
  const [periodo, setPeriodo] = useState(() => periodoUltimosDias(DIAS_PERIODO_PADRAO));
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro('');
    obterFaturamento({ inicio: periodo.inicio, fim: periodo.fim })
      .then((resposta) => {
        if (cancelado) return;
        setDados(resposta);
        setCarregando(false);
      })
      .catch((e) => {
        if (cancelado) return;
        setDados(null);
        setErro(e.message || 'Erro ao carregar os dados de vendas.');
        setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [periodo.inicio, periodo.fim]);

  return (
    <div className="vendas">
      <header className="vendas__topo">
        <div>
          <a className="vendas__voltar" href="#/">Voltar ao painel</a>
          <h1 className="vendas__titulo">Vendas e Faturamento</h1>
        </div>
        <button type="button" className="vendas__sair" onClick={onLogout}>Sair</button>
      </header>

      <main className="vendas__conteudo">
        <section aria-labelledby="vendas-periodo" className="vendas__periodo">
          <h2 id="vendas-periodo" className="vendas__secao-titulo">Período</h2>
          <PeriodFilter
            startDate={periodo.inicio}
            endDate={periodo.fim}
            onChange={({ startDate, endDate }) => setPeriodo({ inicio: startDate, fim: endDate })}
          />
        </section>

        <section aria-labelledby="vendas-indicadores">
          <h2 id="vendas-indicadores" className="vendas__secao-titulo">Indicadores</h2>

          {carregando && (
            <p role="status" aria-live="polite" className="vendas__carregando">Carregando indicadores...</p>
          )}
          {erro && <p role="alert" className="vendas__erro">{erro}</p>}

          {!carregando && !erro && dados && (
            <div className="vendas__grid">
              <Card id="vendas-kpi-faturamento" titulo="Faturamento">
                <p className="vendas__valor">{formatCurrency(dados.faturamento)}</p>
              </Card>
              <CardComparativo comparativo={dados.comparativoPeriodoAnterior} />
              <Card id="vendas-kpi-meta" titulo="Meta x realizado">
                <p className="vendas__vazio">Meta não configurada</p>
              </Card>
              <Card id="vendas-kpi-ticket" titulo="Ticket médio">
                <p className="vendas__valor">{formatCurrency(dados.ticketMedio)}</p>
              </Card>
              <Card id="vendas-kpi-cupons" titulo="Quantidade de cupons">
                <p className="vendas__valor">{formatInteger(dados.quantidadeCupons)}</p>
              </Card>
              <Card id="vendas-kpi-itens" titulo="Itens por compra">
                <p className="vendas__valor">{formatDecimal(dados.itensPorCompra)}</p>
              </Card>
            </div>
          )}
        </section>

        <VendasCharts inicio={periodo.inicio} fim={periodo.fim} />
      </main>
    </div>
  );
}

export default VendasPage;
