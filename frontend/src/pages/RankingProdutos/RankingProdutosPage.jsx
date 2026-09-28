import { useEffect, useState } from 'react';
import CampoQuantidade from '../../components/CampoQuantidade/CampoQuantidade.jsx';
import MensagemErro from '../../components/MensagemErro/MensagemErro.jsx';
import PeriodFilter from '../../components/PeriodFilter/PeriodFilter.jsx';
import {
  obterDemandaBaixoEstoque,
  obterProdutosNovos,
  obterProdutosParados,
  obterRanking,
} from '../../services/rankingProdutosService.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { formatDecimal, formatPercent, formatPercentualDuasCasas, formatQuantidade } from '../../utils/formatNumber.js';
import { classificarErro } from '../../utils/erroApi.js';
import { interpretarLimite } from '../../utils/limite.js';
import { periodoUltimosDiasAteOntem } from '../../utils/periodo.js';
import './RankingProdutosPage.css';

// Crescimento/queda/novos só consideram dias fechados: o período padrão termina ONTEM, não hoje.
const DIAS_PERIODO_PADRAO = 30;
const SEM_VALOR = '—';

// Quantidade de itens (`limite`): decisão do usuário = mostrar 10 em TODAS as visões (o backend assumiria
// 50 em parados/novos) e deixar escolher/digitar mais. Os máximos espelham a validação do backend:
// ranking (vendas, faturamento, margem, crescimento, queda) 1-100; parados e novos 1-500.
// Alta demanda / baixo estoque também aceita 1-500.
const LIMITE_PADRAO = 10;
const LIMITE_MINIMO = 1;
const LIMITE_MAXIMO_RANKING = 100;
const LIMITE_MAXIMO_LISTA = 500;
const SUGESTOES_LIMITE = [10, 25, 50, 100, 250, 500];
// Pausa (ms) após a última tecla antes de refazer a chamada: evita uma requisição por dígito digitado.
const LIMITE_DEBOUNCE_MS = 400;

const VISOES = [
  { valor: 'vendas', rotulo: 'Mais vendidos (quantidade)', titulo: 'Produtos mais vendidos (quantidade)', limiteMaximo: LIMITE_MAXIMO_RANKING },
  { valor: 'faturamento', rotulo: 'Maior faturamento', titulo: 'Produtos com maior faturamento', limiteMaximo: LIMITE_MAXIMO_RANKING },
  { valor: 'margem', rotulo: 'Maior margem', titulo: 'Produtos com maior margem', limiteMaximo: LIMITE_MAXIMO_RANKING },
  { valor: 'crescimento', rotulo: 'Em crescimento', titulo: 'Produtos em crescimento', limiteMaximo: LIMITE_MAXIMO_RANKING },
  { valor: 'queda', rotulo: 'Em queda', titulo: 'Produtos em queda', limiteMaximo: LIMITE_MAXIMO_RANKING },
  { valor: 'parados', rotulo: 'Sem nenhuma venda no período', titulo: 'Produtos sem nenhuma venda no período', limiteMaximo: LIMITE_MAXIMO_LISTA },
  { valor: 'novos', rotulo: 'Produtos novos', titulo: 'Produtos novos (primeira venda no período)', limiteMaximo: LIMITE_MAXIMO_LISTA },
  { valor: 'demanda-baixo-estoque', rotulo: 'Alta demanda / baixo estoque', titulo: 'Alta demanda e baixo estoque', limiteMaximo: LIMITE_MAXIMO_LISTA },
];

const ORDENACOES_MARGEM = [
  { valor: 'lucro', rotulo: 'Lucro em R$' },
  { valor: 'margemPercentual', rotulo: 'Margem %' },
];

// Alta demanda / baixo estoque também: a taxa de venda diária só faz sentido com dias completos.
const VISOES_COM_DIAS_FECHADOS = ['crescimento', 'queda', 'novos', 'demanda-baixo-estoque'];
// Parados vem em ordem alfabética e novos por faturamento, ambos sem `posicao` no backend: sem coluna Posição.
const VISOES_SEM_POSICAO = ['parados', 'novos'];
// Alta demanda / baixo estoque vem ordenada por urgência (menor cobertura primeiro), sem `posicao`: numera pelo índice.
const VISOES_POSICAO_POR_INDICE = ['demanda-baixo-estoque'];

const ROTULOS_SITUACAO = {
  abaixo_minimo: 'Abaixo do mínimo',
  cobertura_baixa: 'Cobertura baixa (< 7 dias)',
  abaixo_minimo_e_cobertura_baixa: 'Abaixo do mínimo e cobertura baixa',
};

const comValor = (valor, formatar) => (valor === null || valor === undefined ? SEM_VALOR : formatar(valor));

const COLUNA_QUANTIDADE = { titulo: 'Quantidade', numerica: true, celula: (i) => formatQuantidade(i.quantidade) };
const COLUNA_FATURAMENTO = { titulo: 'Faturamento', numerica: true, celula: (i) => formatCurrency(i.faturamento) };

const COLUNAS_VARIACAO = [
  { titulo: 'Faturamento atual', numerica: true, celula: (i) => formatCurrency(i.faturamentoAtual) },
  { titulo: 'Faturamento anterior', numerica: true, celula: (i) => formatCurrency(i.faturamentoAnterior) },
  { titulo: 'Variação (R$)', numerica: true, celula: (i) => formatCurrency(i.variacao) },
  { titulo: 'Variação %', numerica: true, celula: (i) => comValor(i.variacaoPercentual, formatPercent) },
];

// Estoque negativo mostra o sinal e o selo "Negativo" (texto, não só cor).
function CelulaEstoque({ valor }) {
  if (valor === null || valor === undefined) return SEM_VALOR;
  return (
    <>
      {formatQuantidade(valor)}
      {valor < 0 && <span className="ranking__selo-alerta">Negativo</span>}
    </>
  );
}

// Cobertura 0 (estoque esgotado ou negativo) ganha o selo "Sem cobertura" (texto, não só cor).
function CelulaCobertura({ valor }) {
  if (valor === null || valor === undefined) return SEM_VALOR;
  return (
    <>
      {formatDecimal(valor)}
      {valor === 0 && <span className="ranking__selo-alerta">Sem cobertura</span>}
    </>
  );
}

const COLUNAS = {
  vendas: [COLUNA_QUANTIDADE, COLUNA_FATURAMENTO],
  faturamento: [COLUNA_QUANTIDADE, COLUNA_FATURAMENTO],
  margem: [
    COLUNA_QUANTIDADE,
    COLUNA_FATURAMENTO,
    { titulo: 'Custo total', numerica: true, celula: (i) => comValor(i.custoTotal, formatCurrency) },
    { titulo: 'Lucro', numerica: true, celula: (i) => comValor(i.lucro, formatCurrency) },
    { titulo: 'Margem', numerica: true, celula: (i) => comValor(i.margemPercentual, formatPercentualDuasCasas) },
  ],
  crescimento: COLUNAS_VARIACAO,
  queda: COLUNAS_VARIACAO,
  parados: [],
  novos: [
    { titulo: 'Primeira venda', celula: (i) => formatDate(i.primeiraVenda) },
    COLUNA_QUANTIDADE,
    COLUNA_FATURAMENTO,
  ],
  'demanda-baixo-estoque': [
    { titulo: 'Vendido no período', numerica: true, celula: (i) => comValor(i.quantidadeVendida, formatQuantidade) },
    { titulo: 'Média/dia', numerica: true, celula: (i) => comValor(i.mediaDiaria, formatDecimal) },
    { titulo: 'Estoque atual', numerica: true, celula: (i) => <CelulaEstoque valor={i.estoqueAtual} /> },
    { titulo: 'Mínimo', numerica: true, celula: (i) => comValor(i.estoqueMinimo, formatQuantidade) },
    { titulo: 'Cobertura (dias)', numerica: true, celula: (i) => <CelulaCobertura valor={i.coberturaDias} /> },
    { titulo: 'Situação', celula: (i) => ROTULOS_SITUACAO[i.motivo] || comValor(i.motivo, String) },
  ],
};

function buscarDados({ visao, periodo, ordenarPor, limite }) {
  const { inicio, fim } = periodo;
  switch (visao) {
    case 'parados':
      return obterProdutosParados({ inicio, fim, limite });
    case 'novos':
      return obterProdutosNovos({ inicio, fim, limite });
    case 'demanda-baixo-estoque':
      return obterDemandaBaixoEstoque({ inicio, fim, limite });
    case 'margem':
      return obterRanking({ criterio: visao, inicio, fim, limite, ordenarPor });
    default:
      return obterRanking({ criterio: visao, inicio, fim, limite });
  }
}

function TabelaRanking({ visao, titulo, itens }) {
  const colunas = COLUNAS[visao];
  const comPosicao = !VISOES_SEM_POSICAO.includes(visao);
  const posicaoPorIndice = VISOES_POSICAO_POR_INDICE.includes(visao);
  return (
    <div className="ranking__tabela-wrapper" role="region" aria-label="Tabela do ranking de produtos" tabIndex={0}>
      <table className="ranking__tabela">
        <caption className="ranking__legenda">{titulo}</caption>
        <thead>
          <tr>
            {comPosicao && <th scope="col" className="ranking__col-posicao">Posição</th>}
            <th scope="col">Produto</th>
            {colunas.map((coluna) => (
              <th key={coluna.titulo} scope="col" className={coluna.numerica ? 'ranking__numero' : undefined}>
                {coluna.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((item, indice) => (
            <tr key={item.id} className={item.semCusto ? 'ranking__linha--sem-custo' : undefined}>
              {comPosicao && <td className="ranking__col-posicao">{posicaoPorIndice ? indice + 1 : item.posicao}</td>}
              <th scope="row" className="ranking__produto">
                {item.nome}
                {item.semCusto && <span className="ranking__selo-sem-custo">Sem custo cadastrado</span>}
              </th>
              {colunas.map((coluna) => (
                <td key={coluna.titulo} className={coluna.numerica ? 'ranking__numero' : undefined}>
                  {coluna.celula(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankingProdutosPage({ onLogout }) {
  const [periodo, setPeriodo] = useState(() => periodoUltimosDiasAteOntem(DIAS_PERIODO_PADRAO));
  const [visao, setVisao] = useState('vendas');
  const [ordenarPor, setOrdenarPor] = useState('lucro');
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  // `campoLimite` é o texto digitado; `limite` é o valor VÁLIDO já aplicado (o único que vai à API).
  const [campoLimite, setCampoLimite] = useState(String(LIMITE_PADRAO));
  const [limite, setLimite] = useState(LIMITE_PADRAO);

  const visaoAtual = VISOES.find((v) => v.valor === visao);
  const limiteMaximo = visaoAtual.limiteMaximo;
  const limiteDigitado = limiteMaximo ? interpretarLimite(campoLimite, limiteMaximo, LIMITE_MINIMO) : null;
  const limiteInvalido = Boolean(limiteMaximo) && limiteDigitado === null;

  // Valor válido e diferente do aplicado: refaz a chamada só após uma pausa na digitação.
  // Valor inválido: não chama a API e mantém o estado anterior (tabela anterior continua visível).
  useEffect(() => {
    if (limiteDigitado === null || limiteDigitado === limite) return undefined;
    const temporizador = setTimeout(() => setLimite(limiteDigitado), LIMITE_DEBOUNCE_MS);
    return () => clearTimeout(temporizador);
  }, [limiteDigitado, limite]);

  // Ao trocar de visão o máximo muda. Regra: se o valor digitado ainda é válido na nova visão, é mantido
  // (e aplicado na hora); se está acima do novo máximo ou inválido, volta ao padrão (10).
  const trocarVisao = (novaVisao) => {
    const { limiteMaximo: novoMaximo } = VISOES.find((v) => v.valor === novaVisao);
    const mantido = novoMaximo ? interpretarLimite(campoLimite, novoMaximo, LIMITE_MINIMO) : null;
    const proximo = mantido === null ? LIMITE_PADRAO : mantido;
    setVisao(novaVisao);
    setCampoLimite(String(proximo));
    setLimite(proximo);
  };

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    buscarDados({ visao, periodo, ordenarPor, limite })
      .then((resposta) => {
        if (cancelado) return;
        setResultado({ visao, resposta });
        setCarregando(false);
      })
      .catch((e) => {
        if (cancelado) return;
        setResultado(null);
        setErro(classificarErro(e, 'Erro ao carregar o ranking de produtos.'));
        setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [visao, periodo.inicio, periodo.fim, ordenarPor, limite]);

  // Só usa a resposta se ela pertence à visão atual: evita renderizar um frame com dados de outra visão
  // (colunas incompatíveis) entre a troca do seletor e a nova resposta da API.
  const dados = resultado && resultado.visao === visao ? resultado.resposta : null;
  const itens = (dados && dados.itens) || [];
  const periodoAjustado =
    dados && VISOES_COM_DIAS_FECHADOS.includes(visao) && dados.fimSolicitado && dados.fim !== dados.fimSolicitado;
  const periodoAnterior = dados && dados.periodoAnterior;
  // Lista que atingiu o limite pode estar truncada: avisa o usuário.
  const listaLimitada = dados && dados.limite > 0 && itens.length === dados.limite;

  return (
    <div className="ranking">
      <header className="ranking__topo">
        <div>
          <a className="ranking__voltar" href="#/">Voltar ao painel</a>
          <h1 className="ranking__titulo">Ranking de Produtos</h1>
        </div>
        <button type="button" className="ranking__sair" onClick={onLogout}>Sair</button>
      </header>

      <main className="ranking__conteudo">
        <section aria-labelledby="ranking-filtros" className="ranking__filtros">
          <h2 id="ranking-filtros" className="ranking__secao-titulo">Filtros</h2>
          <div className="ranking__filtros-campos">
            <label className="ranking__campo" htmlFor="ranking-criterio">
              Critério
              <select id="ranking-criterio" value={visao} onChange={(e) => trocarVisao(e.target.value)}>
                {VISOES.map((v) => (
                  <option key={v.valor} value={v.valor}>{v.rotulo}</option>
                ))}
              </select>
            </label>
            {visao === 'margem' && (
              <label className="ranking__campo" htmlFor="ranking-ordenar-por">
                Ordenar por
                <select id="ranking-ordenar-por" value={ordenarPor} onChange={(e) => setOrdenarPor(e.target.value)}>
                  {ORDENACOES_MARGEM.map((o) => (
                    <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                  ))}
                </select>
              </label>
            )}
            {limiteMaximo && (
              <CampoQuantidade
                prefixo="ranking"
                minimo={LIMITE_MINIMO}
                sugestoes={SUGESTOES_LIMITE}
                maximo={limiteMaximo}
                valor={campoLimite}
                onChange={setCampoLimite}
                erro={limiteInvalido}
              />
            )}
          </div>
          <PeriodFilter
            startDate={periodo.inicio}
            endDate={periodo.fim}
            onChange={({ startDate, endDate }) => setPeriodo({ inicio: startDate, fim: endDate })}
          />
        </section>

        <section aria-labelledby="ranking-resultado">
          <h2 id="ranking-resultado" className="ranking__secao-titulo">{visaoAtual.titulo}</h2>

          {carregando && (
            <p role="status" aria-live="polite" className="ranking__carregando">Carregando ranking...</p>
          )}
          {erro && <MensagemErro prefixo="ranking" erro={erro} />}

          {!carregando && !erro && dados && (
            <>
              {periodoAjustado && (
                <p role="status" className="ranking__aviso ranking__aviso--atencao">
                  {`Período ajustado até ${formatDate(dados.fim)}: só dias encerrados`}
                </p>
              )}
              {periodoAnterior && (
                <p className="ranking__detalhe">
                  {`Período anterior: ${formatDate(periodoAnterior.inicio)} a ${formatDate(periodoAnterior.fim)}`}
                </p>
              )}
              {listaLimitada && <p className="ranking__detalhe">{`Exibindo os ${dados.limite} primeiros produtos`}</p>}
              {itens.length === 0 ? (
                <p className="ranking__vazio">Nenhum produto encontrado para o período e critério selecionados.</p>
              ) : (
                <TabelaRanking visao={visao} titulo={visaoAtual.titulo} itens={itens} />
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default RankingProdutosPage;
