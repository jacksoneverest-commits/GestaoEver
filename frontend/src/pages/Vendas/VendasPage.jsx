import { useEffect, useState } from 'react';
import EstadoVazio from '../../components/EstadoVazio/EstadoVazio.jsx';
import MensagemErro from '../../components/MensagemErro/MensagemErro.jsx';
import KpiCard from '../../components/KpiCard/KpiCard.jsx';
import Skeleton from '../../components/Skeleton/Skeleton.jsx';
import PeriodFilter from '../../components/PeriodFilter/PeriodFilter.jsx';
import { obterFaturamento } from '../../services/vendasService.js';
import { classificarErro } from '../../utils/erroApi.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { formatDecimal, formatInteger, formatPercent } from '../../utils/formatNumber.js';
import { periodoUltimosDias } from '../../utils/periodo.js';
import VendasCharts from './components/VendasCharts.jsx';
import PageHeader from '../../components/PageHeader/PageHeader.jsx';
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
      <span className="sr-only">{descricao} </span>
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

function VendasPage() {
  const [periodo, setPeriodo] = useState(() => periodoUltimosDias(DIAS_PERIODO_PADRAO));
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    obterFaturamento({ inicio: periodo.inicio, fim: periodo.fim })
      .then((resposta) => {
        if (cancelado) return;
        setDados(resposta);
        setCarregando(false);
      })
      .catch((e) => {
        if (cancelado) return;
        setDados(null);
        setErro(classificarErro(e, 'Erro ao carregar os dados de vendas.'));
        setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [periodo.inicio, periodo.fim]);

  return (
    <div className="vendas">
      <PageHeader titulo="Vendas e Faturamento" />

      <div className="vendas__conteudo">
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

          {carregando && <Skeleton rotulo="Carregando indicadores" />}
          {erro && <MensagemErro prefixo="vendas" erro={erro} />}

          {!carregando && !erro && dados && (
            <div className="vendas__grid">
              <KpiCard variante="azul" icone="vendas" rotulo="Faturamento" valor={formatCurrency(dados.faturamento)} />
              <CardComparativo comparativo={dados.comparativoPeriodoAnterior} />
              <Card id="vendas-kpi-meta" titulo="Meta x realizado">
                <EstadoVazio titulo="Meta não configurada" descricao="A meta de faturamento ainda não foi definida para este período." />
              </Card>
              <KpiCard variante="ambar" icone="ranking" rotulo="Ticket médio" valor={formatCurrency(dados.ticketMedio)} />
              <KpiCard variante="ciano" icone="dashboard" rotulo="Quantidade de cupons" valor={formatInteger(dados.quantidadeCupons)} />
              <KpiCard variante="verde" icone="estoque" rotulo="Itens por compra" valor={formatDecimal(dados.itensPorCompra)} />
            </div>
          )}
        </section>

        <VendasCharts inicio={periodo.inicio} fim={periodo.fim} />
      </div>
    </div>
  );
}

export default VendasPage;
