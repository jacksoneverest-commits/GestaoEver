import { useId, useState } from 'react';
import AlternarVisao from '../AlternarVisao/AlternarVisao.jsx';
import EstadoVazio from '../EstadoVazio/EstadoVazio.jsx';
import MensagemErro from '../MensagemErro/MensagemErro.jsx';
import Skeleton from '../Skeleton/Skeleton.jsx';
import { baixarCsv, gerarCsv } from '../../utils/csv.js';
import { lerVisao, salvarVisao } from '../../utils/preferenciaVisao.js';
import './CartaoGrafico.css';

// Cartão de gráfico: cabeçalho (título à esquerda, ações à direita), corpo sobre a "cartela"
// e estados carregando / erro / vazio / sucesso que preservam a altura do corpo.
//
// - `acoes`: controles extras do card (ex.: seletor de nível).
// - `topo`: renderizado em qualquer estado (ex.: trilha com "Voltar" do drill-down).
// - `grafico` + `tabela` + `idVisao`: habilita a alternância Gráfico | Tabela (a tabela substitui
//   o gráfico) e lembra a escolha em localStorage. Sem eles, o corpo mostra `children`.
// - `exportacao`: { nomeArquivo, cabecalho, linhas } habilita "Exportar CSV" (dados já carregados).
function CartaoGrafico({
  titulo,
  subtitulo,
  estado,
  vazio = false,
  mensagemVazio = 'Sem dados para o período selecionado.',
  className = '',
  acoes,
  topo,
  idVisao,
  grafico,
  tabela,
  exportacao,
  children,
}) {
  const alternavel = Boolean(idVisao) && grafico !== undefined && tabela !== undefined;
  const [visao, setVisao] = useState(() => (alternavel ? lerVisao(idVisao) : null) ?? 'grafico');
  const pronto = estado.status === 'sucesso' && !vazio;

  function mudarVisao(nova) {
    setVisao(nova);
    salvarVisao(idVisao, nova);
  }

  const idMotivo = useId();
  const podeExportar = pronto && exportacao && exportacao.linhas.length > 0;
  const motivoDesabilitado =
    exportacao && !podeExportar
      ? estado.status === 'carregando'
        ? 'Aguarde o carregamento dos dados.'
        : 'Sem dados para exportar.'
      : null;
  function exportar() {
    baixarCsv(exportacao.nomeArquivo, gerarCsv(exportacao.cabecalho, exportacao.linhas));
  }

  return (
    <section className={`cartao-grafico ${className}`.trim()} aria-label={titulo}>
      <div className="cartao-grafico__cabecalho">
        <div className="cartao-grafico__titulos">
          <h2 className="cartao-grafico__titulo">{titulo}</h2>
          {subtitulo && <p className="cartao-grafico__subtitulo">{subtitulo}</p>}
        </div>
        <div className="cartao-grafico__acoes">
          {acoes}
          {alternavel && pronto && (
            <AlternarVisao valor={visao} aoMudar={mudarVisao} rotulo={`Visualização de ${titulo}`} />
          )}
          {exportacao && (
            <>
              <button
                type="button"
                className="cartao-grafico__exportar"
                disabled={!podeExportar}
                title={motivoDesabilitado ?? undefined}
                aria-describedby={motivoDesabilitado ? idMotivo : undefined}
                onClick={exportar}
              >
                Exportar CSV
              </button>
              {motivoDesabilitado && (
                <span id={idMotivo} className="sr-only">
                  {motivoDesabilitado}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {topo}
      <div className="cartao-grafico__corpo">
        {estado.status === 'carregando' && <Skeleton rotulo={`Carregando ${titulo.toLowerCase()}...`} tamanho="bloco" />}
        {estado.status === 'erro' && <MensagemErro prefixo="vendas-charts" erro={estado.erro} />}
        {estado.status === 'sucesso' && vazio && <EstadoVazio titulo={mensagemVazio} />}
        {pronto && (alternavel ? (visao === 'tabela' ? tabela : grafico) : children)}
      </div>
    </section>
  );
}

export default CartaoGrafico;
