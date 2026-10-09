import { useEffect, useState } from 'react';
import Icon from '../../components/Icon/Icon.jsx';
import KpiCard from '../../components/KpiCard/KpiCard.jsx';
import MensagemErro from '../../components/MensagemErro/MensagemErro.jsx';
import { MODULOS } from '../../components/AppShell/modulos.js';
import PageHeader from '../../components/PageHeader/PageHeader.jsx';
import PeriodFilter from '../../components/PeriodFilter/PeriodFilter.jsx';
import Skeleton from '../../components/Skeleton/Skeleton.jsx';
import { obterFaturamento } from '../../services/vendasService.js';
import { classificarErro } from '../../utils/erroApi.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { formatDecimal, formatInteger } from '../../utils/formatNumber.js';
import { periodoMesAtual, periodoUltimosDias } from '../../utils/periodo.js';
import VendasCharts from '../Vendas/components/VendasCharts.jsx';
import './DashboardPage.css';

const ATALHOS_PERIODO = [
  { id: 'hoje', rotulo: 'Hoje', calcular: () => periodoUltimosDias(1) },
  { id: '7-dias', rotulo: '7 dias', calcular: () => periodoUltimosDias(7) },
  { id: '30-dias', rotulo: '30 dias', calcular: () => periodoUltimosDias(30) },
  { id: 'mes', rotulo: 'Mês', calcular: () => periodoMesAtual() },
];
const ATALHO_PADRAO = '30-dias';

function periodoInicial() {
  return { ...ATALHOS_PERIODO.find((a) => a.id === ATALHO_PADRAO).calcular(), atalho: ATALHO_PADRAO };
}

// Home: indicadores do período (valores prontos da API de vendas) e atalhos para os módulos.
function DashboardPage() {
  const [periodo, setPeriodo] = useState(periodoInicial);
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
        setErro(classificarErro(e, 'Erro ao carregar os indicadores.'));
        setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [periodo.inicio, periodo.fim]);

  const comparativo = dados && dados.comparativoPeriodoAnterior;

  return (
    <div className="dashboard">
      <PageHeader titulo="Dashboard" subtitulo="Visão geral das vendas no período">
        <div role="group" aria-label="Período rápido" className="dashboard__atalhos-periodo">
          {ATALHOS_PERIODO.map((atalho) => (
            <button
              key={atalho.id}
              type="button"
              className="dashboard__atalho-periodo"
              aria-pressed={periodo.atalho === atalho.id}
              onClick={() => setPeriodo({ ...atalho.calcular(), atalho: atalho.id })}
            >
              {atalho.rotulo}
            </button>
          ))}
        </div>
      </PageHeader>

      <section aria-label="Período personalizado" className="dashboard__periodo">
        <PeriodFilter
          key={`${periodo.inicio}|${periodo.fim}`}
          startDate={periodo.inicio}
          endDate={periodo.fim}
          onChange={({ startDate, endDate }) => setPeriodo({ inicio: startDate, fim: endDate, atalho: null })}
        />
      </section>

      <section aria-label="Indicadores" className="dashboard__kpis">
        {carregando && (
          <>
            <Skeleton rotulo="Carregando faturamento" />
            <Skeleton rotulo="Carregando ticket médio" />
            <Skeleton rotulo="Carregando quantidade de cupons" />
            <Skeleton rotulo="Carregando itens por compra" />
          </>
        )}
        {erro && (
          <div className="dashboard__erro-bloco">
            <MensagemErro prefixo="dashboard" erro={erro} />
          </div>
        )}
        {!carregando && !erro && dados && (
          <>
            <KpiCard
              nivel={2}
              variante="azul"
              icone="vendas"
              rotulo="Faturamento"
              valor={formatCurrency(dados.faturamento)}
              variacao={comparativo ? comparativo.variacaoPercentual : null}
              detalhe={
                comparativo
                  ? `Período anterior: ${formatDate(comparativo.periodoInicio)} a ${formatDate(comparativo.periodoFim)}`
                  : undefined
              }
            />
            <KpiCard nivel={2} variante="ambar" icone="ranking" rotulo="Ticket médio" valor={formatCurrency(dados.ticketMedio)} />
            <KpiCard nivel={2} variante="ciano" icone="dashboard" rotulo="Quantidade de cupons" valor={formatInteger(dados.quantidadeCupons)} />
            <KpiCard nivel={2} variante="verde" icone="estoque" rotulo="Itens por compra" valor={formatDecimal(dados.itensPorCompra)} />
          </>
        )}
      </section>

      <VendasCharts inicio={periodo.inicio} fim={periodo.fim} />

      <section aria-labelledby="dashboard-modulos" className="dashboard__modulos">
        <h2 id="dashboard-modulos" className="dashboard__secao-titulo">Módulos</h2>
        <ul className="dashboard__grade">
          {MODULOS.filter((m) => m.id !== 'dashboard').map((modulo) => (
            <li key={modulo.id}>
              {modulo.desabilitado ? (
                <div className="dashboard__modulo dashboard__modulo--desabilitado" aria-disabled="true">
                  <Icon nome={modulo.icone} tamanho={24} />
                  <span className="dashboard__modulo-nome">{modulo.rotulo}</span>
                  <span className="dashboard__modulo-desc">{modulo.descricao}</span>
                  <span className="dashboard__em-breve">Em breve</span>
                </div>
              ) : (
                <a className="dashboard__modulo" href={modulo.rota}>
                  <Icon nome={modulo.icone} tamanho={24} />
                  <span className="dashboard__modulo-nome">{modulo.rotulo}</span>
                  <span className="dashboard__modulo-desc">{modulo.descricao}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default DashboardPage;
