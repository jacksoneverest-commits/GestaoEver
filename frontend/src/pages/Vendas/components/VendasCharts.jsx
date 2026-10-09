import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  obterVendasPorDepartamento,
  obterVendasPorDiaSemana,
  obterVendasPorFormaPagamento,
  obterVendasPorHora,
} from '../../../services/vendasGraficosService.js';
import CartaoGrafico from '../../../components/CartaoGrafico/CartaoGrafico.jsx';
import TabelaDados from '../../../components/TabelaDados/TabelaDados.jsx';
import { classificarErro } from '../../../utils/erroApi.js';
import { formatCurrency } from '../../../utils/format.js';
import {
  formatCurrencyCompact,
  formatHora,
  formatInteger,
  formatPercentualSimples,
  formatQuantidade,
} from '../../../utils/formatNumber.js';
import { indiceDoPico } from '../../../utils/graficos.js';
import { useMedidasGrafico } from '../../../utils/medidasGrafico.js';
import { truncarRotulo } from '../../../utils/rotuloGrafico.js';
import { useTelaEstreita } from '../../../utils/telaEstreita.js';
import './VendasCharts.css';

const NIVEIS = [
  { valor: 'grupo', rotulo: 'Grupo' },
  { valor: 'setor', rotulo: 'Setor' },
  { valor: 'familia', rotulo: 'Família' },
];

// Máximo de barras desenhadas no gráfico de departamento (a tabela lista todos).
const MAX_BARRAS_DEPARTAMENTO = 10;

// Abreviações só para o eixo X (0 = domingo); tooltip e tabela usam o nome completo.
const DIAS_ABREVIADOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const COR_SERIE = 'var(--vc-serie)';
const COR_DESTAQUE = 'var(--vc-serie-destaque)';
const ESTILO_EIXO = { fill: 'var(--vc-texto-suave)' }; // tamanho da fonte vem do CSS (token --fs-xs)

function temIdValido(id) {
  return id !== null && id !== undefined && id !== 0 && id !== '0' && id !== '';
}

// Valor da API para o CSV: número (sem recalcular); ausente fica vazio.
function numeroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

// Carrega dados de um gráfico de forma independente (carregando / erro / sucesso).
// Respostas obsoletas (período trocado antes da resposta chegar) são ignoradas.
function useDados(carregar, dependencias) {
  const [estado, setEstado] = useState({ status: 'carregando', dados: null, erro: null });

  useEffect(() => {
    let ativo = true;
    setEstado({ status: 'carregando', dados: null, erro: null });
    (async () => {
      try {
        const dados = await carregar();
        if (ativo) setEstado({ status: 'sucesso', dados, erro: null });
      } catch (e) {
        if (ativo) {
          setEstado({
            status: 'erro',
            dados: null,
            erro: classificarErro(e, 'Não foi possível carregar este gráfico.'),
          });
        }
      }
    })();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencias);

  return estado;
}

function TooltipValores({ active, payload, detalhes, rotuloPico }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0].payload;
  return (
    <div className="vendas-charts__tooltip">
      <strong className="vendas-charts__tooltip-rotulo">{linha.rotulo}</strong>
      {linha.ehPico && <div className="vendas-charts__tooltip-pico">{rotuloPico}</div>}
      <div>
        Faturamento: <strong>{formatCurrency(linha.faturamento)}</strong>
      </div>
      {detalhes.map(({ chave, rotulo, formatar }) => (
        <div key={chave}>
          {rotulo}: {formatar(linha[chave])}
        </div>
      ))}
    </div>
  );
}

const DETALHE_CUPONS = [{ chave: 'quantidadeCupons', rotulo: 'Cupons', formatar: formatInteger }];

// Rótulo de valor: nas barras horizontais (`horizontais`), no fim de cada barra (com participação,
// quando a API a traz); nas barras verticais, só no pico.
function RotuloBarra({ x, y, width, height, index, value, dados, horizontais, picoIndice, comParticipacao }) {
  const linha = dados[index];
  if (!linha || x === undefined || y === undefined) return null;

  if (horizontais) {
    const participacao =
      comParticipacao && linha.participacaoPercentual !== undefined && linha.participacaoPercentual !== null
        ? ` · ${formatPercentualSimples(linha.participacaoPercentual)}`
        : '';
    return (
      <text
        x={Number(x) + Number(width) + 6}
        y={Number(y) + Number(height) / 2}
        dominantBaseline="middle"
        className="vendas-charts__rotulo"
      >
        {`${formatCurrencyCompact(value)}${participacao}`}
      </text>
    );
  }

  if (index !== picoIndice) return null;
  return (
    <text
      x={Number(x) + Number(width) / 2}
      y={Number(y) - 6}
      textAnchor="middle"
      className="vendas-charts__rotulo vendas-charts__rotulo--pico"
    >
      {formatCurrencyCompact(value)}
    </text>
  );
}

function GraficoBarras({
  descricao,
  dados,
  layout = 'horizontal',
  altura,
  larguraRotulo,
  detalhes,
  aoClicar,
  rotuloPico = 'Pico do período',
}) {
  const vertical = layout === 'vertical'; // barras horizontais, categorias no eixo Y
  const estreita = useTelaEstreita();
  const medidas = useMedidasGrafico();
  const alturaGrafico = altura ?? medidas.alturaGrafico;
  const { barSize, raioBarra: raio } = medidas;

  const picoIndice = indiceDoPico(dados.map((item) => item.faturamento));
  const dadosGrafico = dados.map((item, indice) => ({ ...item, ehPico: indice === picoIndice }));

  // Em telas estreitas (<= 600px) o eixo de rótulos encolhe e os nomes longos são truncados com reticências.
  // Mesma largura de eixo para gráficos do mesmo tipo (token por tipo, não por gráfico).
  const larguraBase = larguraRotulo ?? medidas.larguraEixoValor;
  const larguraEixo = estreita
    ? Math.min(larguraBase, vertical ? medidas.larguraEixoRotuloEstreito : medidas.larguraEixoValorEstreito)
    : larguraBase;
  const maxCaracteres = estreita ? 12 : 24;
  const margem = vertical
    ? { top: 8, right: estreita ? medidas.margemDireitaBarrasEstreita : medidas.margemDireitaBarras, bottom: 8, left: estreita ? 0 : 8 }
    : { top: medidas.margemTopoColunas, right: estreita ? 8 : 16, bottom: 4, left: estreita ? 0 : 8 };

  return (
    <>
      {picoIndice >= 0 && (
        <p className="vendas-charts__legenda">
          <span className="vendas-charts__legenda-marca" aria-hidden="true" />
          {rotuloPico}
        </p>
      )}
      <div className="vendas-charts__grafico" role="img" aria-label={descricao}>
        <ResponsiveContainer width="100%" height={alturaGrafico}>
          <BarChart data={dadosGrafico} layout={layout} margin={margem}>
            {!vertical && <CartesianGrid stroke="var(--vc-grade)" vertical={false} />}
            {vertical ? (
              <>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="rotulo"
                  width={larguraEixo}
                  tick={ESTILO_EIXO}
                  tickFormatter={(valor) => truncarRotulo(valor, maxCaracteres)}
                  axisLine={false}
                  tickLine={false}
                />
              </>
            ) : (
              <>
                <XAxis dataKey="rotuloEixo" tick={ESTILO_EIXO} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis
                  type="number"
                  width={larguraEixo}
                  tick={ESTILO_EIXO}
                  tickFormatter={formatCurrencyCompact}
                  axisLine={false}
                  tickLine={false}
                />
              </>
            )}
            <Tooltip
              cursor={{ fill: 'var(--vc-cursor)' }}
              content={<TooltipValores detalhes={detalhes} rotuloPico={rotuloPico} />}
            />
            <Bar
              dataKey="faturamento"
              name="Faturamento"
              fill={COR_SERIE}
              barSize={barSize}
              radius={vertical ? [0, raio, raio, 0] : [raio, raio, 0, 0]}
              cursor={aoClicar ? 'pointer' : undefined}
              onClick={aoClicar ? (barra) => aoClicar(barra?.payload ?? barra) : undefined}
              isAnimationActive={false}
            >
              {dadosGrafico.map((item, indice) => (
                <Cell key={indice} fill={item.ehPico ? COR_DESTAQUE : COR_SERIE} />
              ))}
              <LabelList
                dataKey="faturamento"
                content={(props) => (
                  <RotuloBarra
                    {...props}
                    dados={dadosGrafico}
                    horizontais={vertical}
                    picoIndice={picoIndice}
                    comParticipacao={!estreita}
                  />
                )}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

const COLUNA_FATURAMENTO = {
  chave: 'faturamento',
  rotulo: 'Faturamento',
  numerica: true,
  somar: true,
  barra: true,
  formatar: formatCurrency,
};
const COLUNA_CUPONS = {
  chave: 'quantidadeCupons',
  rotulo: 'Cupons',
  numerica: true,
  somar: true,
  formatar: formatInteger,
};

function nomeArquivo(card, inicio, fim) {
  return `vendas-${card}-${inicio}-${fim}.csv`;
}

function linhasCsv(itens) {
  return itens.map((item) => [item.rotulo, numeroOuNulo(item.faturamento), numeroOuNulo(item.quantidadeCupons)]);
}

function VendasPorHora({ inicio, fim }) {
  const estado = useDados(() => obterVendasPorHora({ inicio, fim }), [inicio, fim]);
  const itens = (estado.dados?.porHora ?? []).map((item) => {
    const rotulo = formatHora(item.hora);
    return { ...item, rotulo, rotuloEixo: rotulo };
  });
  const titulo = 'Vendas por hora';

  return (
    <CartaoGrafico
      titulo={titulo}
      subtitulo="Faturamento por hora do dia"
      estado={estado}
      vazio={itens.every((item) => !Number(item.faturamento))}
      mensagemVazio="Sem vendas no período."
      idVisao="hora"
      grafico={
        <GraficoBarras
          descricao="Gráfico de barras do faturamento por hora do dia. Use a opção Tabela para ver os valores."
          dados={itens}
          detalhes={DETALHE_CUPONS}
        />
      }
      tabela={
        <TabelaDados
          titulo={titulo}
          colunas={[{ chave: 'rotulo', rotulo: 'Hora' }, COLUNA_FATURAMENTO, COLUNA_CUPONS]}
          itens={itens}
          indicePico={indiceDoPico(itens.map((item) => item.faturamento))}
        />
      }
      exportacao={{
        nomeArquivo: nomeArquivo('hora', inicio, fim),
        cabecalho: ['Hora', 'Faturamento', 'Cupons'],
        linhas: linhasCsv(itens),
      }}
    />
  );
}

function VendasPorDiaSemana({ inicio, fim }) {
  const estado = useDados(() => obterVendasPorDiaSemana({ inicio, fim }), [inicio, fim]);
  const itens = (estado.dados?.porDiaSemana ?? []).map((item) => ({
    ...item,
    rotulo: item.nome,
    rotuloEixo: DIAS_ABREVIADOS[item.diaSemana] ?? String(item.nome ?? '').slice(0, 3),
  }));
  const titulo = 'Vendas por dia da semana';

  return (
    <CartaoGrafico
      titulo={titulo}
      subtitulo="Faturamento por dia da semana"
      estado={estado}
      vazio={itens.length === 0}
      idVisao="dia-semana"
      grafico={
        <GraficoBarras
          descricao="Gráfico de barras do faturamento por dia da semana. Use a opção Tabela para ver os valores."
          dados={itens}
          detalhes={DETALHE_CUPONS}
        />
      }
      tabela={
        <TabelaDados
          titulo={titulo}
          colunas={[{ chave: 'rotulo', rotulo: 'Dia da semana' }, COLUNA_FATURAMENTO, COLUNA_CUPONS]}
          itens={itens}
          indicePico={indiceDoPico(itens.map((item) => item.faturamento))}
        />
      }
      exportacao={{
        nomeArquivo: nomeArquivo('dia-semana', inicio, fim),
        cabecalho: ['Dia da semana', 'Faturamento', 'Cupons'],
        linhas: linhasCsv(itens),
      }}
    />
  );
}

function VendasPorFormaPagamento({ inicio, fim }) {
  const estado = useDados(() => obterVendasPorFormaPagamento({ inicio, fim }), [inicio, fim]);
  const itens = (estado.dados?.porFormaPagamento ?? []).map((item) => ({
    ...item,
    rotulo: item.nome || 'Não informada',
  }));
  const titulo = 'Vendas por forma de pagamento';
  const medidas = useMedidasGrafico();

  // Barras horizontais ordenadas (e não pizza): comparação precisa e rótulos legíveis.
  return (
    <CartaoGrafico
      titulo={titulo}
      subtitulo="Faturamento por forma de pagamento"
      estado={estado}
      vazio={itens.length === 0}
      idVisao="forma-pagamento"
      grafico={
        <GraficoBarras
          descricao="Gráfico de barras horizontais do faturamento por forma de pagamento. Use a opção Tabela para ver os valores."
          dados={itens}
          layout="vertical"
          altura={Math.max(medidas.alturaCompacta, itens.length * medidas.alturaPorBarraForma + medidas.alturaExtraBarras)}
          larguraRotulo={medidas.larguraEixoRotulo}
          detalhes={DETALHE_CUPONS}
          rotuloPico="Maior valor"
        />
      }
      tabela={
        <TabelaDados
          titulo={titulo}
          colunas={[{ chave: 'rotulo', rotulo: 'Forma de pagamento' }, COLUNA_FATURAMENTO, COLUNA_CUPONS]}
          itens={itens}
          indicePico={indiceDoPico(itens.map((item) => item.faturamento))}
        />
      }
      exportacao={{
        nomeArquivo: nomeArquivo('forma-pagamento', inicio, fim),
        cabecalho: ['Forma de pagamento', 'Faturamento', 'Cupons'],
        linhas: linhasCsv(itens),
      }}
    />
  );
}

function VendasPorDepartamento({ inicio, fim }) {
  const [nivel, setNivel] = useState('grupo');
  const [detalhe, setDetalhe] = useState(null); // { id, nome } do departamento aberto
  const detalheId = detalhe?.id;
  const medidas = useMedidasGrafico();

  const estado = useDados(
    () => obterVendasPorDepartamento({ inicio, fim, nivel, id: detalheId }),
    [inicio, fim, nivel, detalheId],
  );

  const emDetalhe = detalhe !== null;
  const nivelRotulo = NIVEIS.find((n) => n.valor === nivel).rotulo.toLowerCase();
  const itens = [...(estado.dados?.itens ?? [])]
    .sort((a, b) => Number(b.faturamento) - Number(a.faturamento))
    .map((item) => ({ ...item, rotulo: item.nome || 'Sem departamento' }));
  const itensGrafico = itens.slice(0, MAX_BARRAS_DEPARTAMENTO);

  function trocarNivel(novoNivel) {
    setNivel(novoNivel);
    setDetalhe(null);
  }

  function abrirDetalhe(item) {
    if (emDetalhe || !temIdValido(item?.id)) return;
    setDetalhe({ id: item.id, nome: item.rotulo ?? item.nome });
  }

  const titulo = 'Vendas por departamento';
  const seletor = (
    <div className="vendas-charts__niveis" role="radiogroup" aria-label="Nível de navegação do departamento">
      {NIVEIS.map(({ valor, rotulo }) => (
        <label key={valor} className={`vendas-charts__nivel${nivel === valor ? ' vendas-charts__nivel--ativo' : ''}`}>
          <input
            type="radio"
            name="vendas-departamento-nivel"
            value={valor}
            checked={nivel === valor}
            onChange={() => trocarNivel(valor)}
          />
          {rotulo}
        </label>
      ))}
    </div>
  );

  // Fora do estado de sucesso: o "Voltar" continua disponível se a consulta de detalhe falhar.
  const trilha = (
    <div className="vendas-charts__trilha">
      {emDetalhe ? (
        <>
          <button type="button" className="vendas-charts__voltar" onClick={() => setDetalhe(null)}>
            Voltar
          </button>
          <span>
            Produtos de <strong>{detalhe.nome}</strong> ({nivelRotulo})
          </span>
        </>
      ) : (
        <span>Por {nivelRotulo}. Selecione um departamento para ver seus produtos.</span>
      )}
    </div>
  );

  const rotuloPrimeira = emDetalhe ? 'Produto' : 'Departamento';
  const sufixoArquivo = emDetalhe ? `${nivel}-produtos-${detalheId}` : nivel;

  return (
    <CartaoGrafico
      titulo={titulo}
      estado={estado}
      vazio={itens.length === 0}
      className="vendas-charts__card--largo"
      acoes={seletor}
      topo={trilha}
      idVisao="departamento"
      grafico={
        <>
          <GraficoBarras
            descricao={`Gráfico de barras horizontais do faturamento por ${emDetalhe ? 'produto' : nivelRotulo}. Use a opção Tabela para ver os valores.`}
            dados={itensGrafico}
            layout="vertical"
            altura={Math.max(
              medidas.alturaCompacta,
              itensGrafico.length * medidas.alturaPorBarraDepartamento + medidas.alturaExtraBarras,
            )}
            larguraRotulo={medidas.larguraEixoDepartamento}
            detalhes={[
              { chave: 'quantidade', rotulo: 'Quantidade', formatar: formatQuantidade },
              { chave: 'participacaoPercentual', rotulo: 'Participação', formatar: formatPercentualSimples },
            ]}
            aoClicar={emDetalhe ? undefined : abrirDetalhe}
            rotuloPico="Maior valor"
          />
          {itens.length > MAX_BARRAS_DEPARTAMENTO && (
            <p className="vendas-charts__nota">
              O gráfico mostra os {MAX_BARRAS_DEPARTAMENTO} maiores; a tabela lista todos.
            </p>
          )}
        </>
      }
      tabela={
        <TabelaDados
          titulo={titulo}
          colunas={[
            { chave: 'rotulo', rotulo: rotuloPrimeira },
            COLUNA_FATURAMENTO,
            { chave: 'quantidade', rotulo: 'Quantidade', numerica: true, somar: true, formatar: formatQuantidade },
            {
              chave: 'participacaoPercentual',
              rotulo: 'Participação',
              numerica: true,
              formatar: formatPercentualSimples,
            },
          ]}
          itens={itens}
          indicePico={indiceDoPico(itens.map((item) => item.faturamento))}
          totalCompleto={estado.dados?.total}
          renderPrimeira={(item) =>
            !emDetalhe && temIdValido(item.id) ? (
              <button type="button" className="vendas-charts__link" onClick={() => abrirDetalhe(item)}>
                {item.rotulo}
              </button>
            ) : (
              item.rotulo
            )
          }
        />
      }
      exportacao={{
        nomeArquivo: nomeArquivo(`departamento-${sufixoArquivo}`, inicio, fim),
        cabecalho: [rotuloPrimeira, 'Faturamento', 'Quantidade', 'Participação (%)'],
        linhas: itens.map((item) => [
          item.rotulo,
          numeroOuNulo(item.faturamento),
          numeroOuNulo(item.quantidade),
          numeroOuNulo(item.participacaoPercentual),
        ]),
      }}
    />
  );
}

function VendasCharts({ inicio, fim }) {
  return (
    <div className="vendas-charts">
      <VendasPorHora inicio={inicio} fim={fim} />
      <VendasPorDiaSemana inicio={inicio} fim={fim} />
      <VendasPorFormaPagamento inicio={inicio} fim={fim} />
      <VendasPorDepartamento inicio={inicio} fim={fim} />
    </div>
  );
}

export default VendasCharts;
