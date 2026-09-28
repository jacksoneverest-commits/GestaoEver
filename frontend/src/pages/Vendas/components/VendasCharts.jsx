import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import { formatCurrency } from '../../../utils/format.js';
import {
  formatCurrencyCompact,
  formatHora,
  formatInteger,
  formatPercentualSimples,
  formatQuantidade,
} from '../../../utils/formatNumber.js';
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
const ESTILO_EIXO = { fill: 'var(--vc-texto-suave)', fontSize: 12 };

function temIdValido(id) {
  return id !== null && id !== undefined && id !== 0 && id !== '0' && id !== '';
}

// Carrega dados de um gráfico de forma independente (carregando / erro / sucesso).
// Respostas obsoletas (período trocado antes da resposta chegar) são ignoradas.
function useDados(carregar, dependencias) {
  const [estado, setEstado] = useState({ status: 'carregando', dados: null, erro: '' });

  useEffect(() => {
    let ativo = true;
    setEstado({ status: 'carregando', dados: null, erro: '' });
    (async () => {
      try {
        const dados = await carregar();
        if (ativo) setEstado({ status: 'sucesso', dados, erro: '' });
      } catch (e) {
        if (ativo) {
          setEstado({
            status: 'erro',
            dados: null,
            erro: e?.message || 'Não foi possível carregar este gráfico.',
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

function TooltipValores({ active, payload, detalhes }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0].payload;
  return (
    <div className="vendas-charts__tooltip">
      <strong>{linha.rotulo}</strong>
      <div>Faturamento: {formatCurrency(linha.faturamento)}</div>
      {detalhes.map(({ chave, rotulo, formatar }) => (
        <div key={chave}>
          {rotulo}: {formatar(linha[chave])}
        </div>
      ))}
    </div>
  );
}

const DETALHE_CUPONS = [{ chave: 'quantidadeCupons', rotulo: 'Cupons', formatar: formatInteger }];

// Cartão de um gráfico: título, estados (carregando/erro/vazio) e conteúdo em sucesso.
// `topo` é renderizado em qualquer estado (ex.: trilha com "Voltar" do drill-down).
function CartaoGrafico({
  titulo,
  estado,
  vazio,
  mensagemVazio = 'Sem dados para o período selecionado.',
  className = '',
  acoes,
  topo,
  children,
}) {
  return (
    <section className={`vendas-charts__card ${className}`.trim()} aria-label={titulo}>
      <div className="vendas-charts__cabecalho">
        <h2 className="vendas-charts__titulo">{titulo}</h2>
        {acoes}
      </div>
      {topo}
      {estado.status === 'carregando' && (
        <p className="vendas-charts__estado" aria-live="polite">
          Carregando...
        </p>
      )}
      {estado.status === 'erro' && (
        <p role="alert" className="vendas-charts__erro">
          {estado.erro}
        </p>
      )}
      {estado.status === 'sucesso' && vazio && (
        <p className="vendas-charts__estado">{mensagemVazio}</p>
      )}
      {estado.status === 'sucesso' && !vazio && children}
    </section>
  );
}

// Alternativa acessível (e testável) ao gráfico: os mesmos dados em uma tabela.
function TabelaDados({ titulo, colunas, linhas }) {
  return (
    <details className="vendas-charts__detalhes">
      <summary>Ver como tabela</summary>
      <div className="vendas-charts__tabela-wrap">
        <table className="vendas-charts__tabela" aria-label={`${titulo} (tabela)`}>
          <thead>
            <tr>
              {colunas.map((coluna) => (
                <th key={coluna.chave} scope="col" className={coluna.numerica ? 'num' : undefined}>
                  {coluna.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{linhas}</tbody>
        </table>
      </div>
    </details>
  );
}

function GraficoBarras({ descricao, dados, layout = 'horizontal', altura = 280, larguraRotulo = 80, detalhes, aoClicar }) {
  const vertical = layout === 'vertical'; // barras horizontais, categorias no eixo Y
  return (
    <div className="vendas-charts__grafico" role="img" aria-label={descricao}>
      <ResponsiveContainer width="100%" height={altura}>
        <BarChart
          data={dados}
          layout={layout}
          margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
        >
          <CartesianGrid stroke="var(--vc-grade)" strokeDasharray="3 3" horizontal={!vertical} vertical={vertical} />
          {vertical ? (
            <>
              <XAxis type="number" tick={ESTILO_EIXO} tickFormatter={formatCurrencyCompact} tickCount={4} stroke="var(--vc-grade)" />
              <YAxis type="category" dataKey="rotulo" width={larguraRotulo} tick={ESTILO_EIXO} stroke="var(--vc-grade)" />
            </>
          ) : (
            <>
              <XAxis dataKey="rotuloEixo" tick={ESTILO_EIXO} interval="preserveStartEnd" stroke="var(--vc-grade)" />
              <YAxis type="number" width={larguraRotulo} tick={ESTILO_EIXO} tickFormatter={formatCurrencyCompact} stroke="var(--vc-grade)" />
            </>
          )}
          <Tooltip
            cursor={{ fill: 'var(--vc-cursor)' }}
            content={<TooltipValores detalhes={detalhes} />}
          />
          <Bar
            dataKey="faturamento"
            name="Faturamento"
            fill={COR_SERIE}
            radius={vertical ? [0, 3, 3, 0] : [3, 3, 0, 0]}
            cursor={aoClicar ? 'pointer' : undefined}
            onClick={aoClicar ? (barra) => aoClicar(barra?.payload ?? barra) : undefined}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function VendasPorHora({ inicio, fim }) {
  const estado = useDados(() => obterVendasPorHora({ inicio, fim }), [inicio, fim]);
  const itens = (estado.dados?.porHora ?? []).map((item) => {
    const rotulo = formatHora(item.hora);
    return { ...item, rotulo, rotuloEixo: rotulo };
  });

  return (
    <CartaoGrafico
      titulo="Vendas por hora"
      estado={estado}
      vazio={itens.every((item) => !Number(item.faturamento))}
      mensagemVazio="Sem vendas no período."
    >
      <GraficoBarras
        descricao="Gráfico de barras do faturamento por hora do dia. Os valores também estão na tabela abaixo."
        dados={itens}
        detalhes={DETALHE_CUPONS}
      />
      <TabelaDados
        titulo="Vendas por hora"
        colunas={[
          { chave: 'hora', rotulo: 'Hora' },
          { chave: 'faturamento', rotulo: 'Faturamento', numerica: true },
          { chave: 'quantidadeCupons', rotulo: 'Cupons', numerica: true },
        ]}
        linhas={itens.map((item) => (
          <tr key={item.hora}>
            <th scope="row">{item.rotulo}</th>
            <td className="num">{formatCurrency(item.faturamento)}</td>
            <td className="num">{formatInteger(item.quantidadeCupons)}</td>
          </tr>
        ))}
      />
    </CartaoGrafico>
  );
}

function VendasPorDiaSemana({ inicio, fim }) {
  const estado = useDados(() => obterVendasPorDiaSemana({ inicio, fim }), [inicio, fim]);
  const itens = (estado.dados?.porDiaSemana ?? []).map((item) => ({
    ...item,
    rotulo: item.nome,
    rotuloEixo: DIAS_ABREVIADOS[item.diaSemana] ?? String(item.nome ?? '').slice(0, 3),
  }));

  return (
    <CartaoGrafico titulo="Vendas por dia da semana" estado={estado} vazio={itens.length === 0}>
      <GraficoBarras
        descricao="Gráfico de barras do faturamento por dia da semana. Os valores também estão na tabela abaixo."
        dados={itens}
        detalhes={DETALHE_CUPONS}
      />
      <TabelaDados
        titulo="Vendas por dia da semana"
        colunas={[
          { chave: 'nome', rotulo: 'Dia da semana' },
          { chave: 'faturamento', rotulo: 'Faturamento', numerica: true },
          { chave: 'quantidadeCupons', rotulo: 'Cupons', numerica: true },
        ]}
        linhas={itens.map((item) => (
          <tr key={item.diaSemana}>
            <th scope="row">{item.rotulo}</th>
            <td className="num">{formatCurrency(item.faturamento)}</td>
            <td className="num">{formatInteger(item.quantidadeCupons)}</td>
          </tr>
        ))}
      />
    </CartaoGrafico>
  );
}

function VendasPorFormaPagamento({ inicio, fim }) {
  const estado = useDados(() => obterVendasPorFormaPagamento({ inicio, fim }), [inicio, fim]);
  const itens = (estado.dados?.porFormaPagamento ?? []).map((item) => ({
    ...item,
    rotulo: item.nome || 'Não informada',
  }));

  // Barras horizontais ordenadas (e não pizza): comparação precisa e rótulos legíveis.
  return (
    <CartaoGrafico titulo="Vendas por forma de pagamento" estado={estado} vazio={itens.length === 0}>
      <GraficoBarras
        descricao="Gráfico de barras horizontais do faturamento por forma de pagamento. Os valores também estão na tabela abaixo."
        dados={itens}
        layout="vertical"
        altura={Math.max(160, itens.length * 40 + 40)}
        larguraRotulo={130}
        detalhes={DETALHE_CUPONS}
      />
      <TabelaDados
        titulo="Vendas por forma de pagamento"
        colunas={[
          { chave: 'nome', rotulo: 'Forma de pagamento' },
          { chave: 'faturamento', rotulo: 'Faturamento', numerica: true },
          { chave: 'quantidadeCupons', rotulo: 'Cupons', numerica: true },
        ]}
        linhas={itens.map((item, indice) => (
          <tr key={item.formaPagamentoId ?? `sem-forma-${indice}`}>
            <th scope="row">{item.rotulo}</th>
            <td className="num">{formatCurrency(item.faturamento)}</td>
            <td className="num">{formatInteger(item.quantidadeCupons)}</td>
          </tr>
        ))}
      />
    </CartaoGrafico>
  );
}

function VendasPorDepartamento({ inicio, fim }) {
  const [nivel, setNivel] = useState('grupo');
  const [detalhe, setDetalhe] = useState(null); // { id, nome } do departamento aberto
  const detalheId = detalhe?.id;

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

  return (
    <CartaoGrafico
      titulo={titulo}
      estado={estado}
      vazio={itens.length === 0}
      className="vendas-charts__card--largo"
      acoes={seletor}
      topo={trilha}
    >
      <GraficoBarras
        descricao={`Gráfico de barras horizontais do faturamento por ${emDetalhe ? 'produto' : nivelRotulo}. Os valores também estão na tabela abaixo.`}
        dados={itensGrafico}
        layout="vertical"
        altura={Math.max(160, itensGrafico.length * 36 + 40)}
        larguraRotulo={160}
        detalhes={[
          { chave: 'quantidade', rotulo: 'Quantidade', formatar: formatQuantidade },
          { chave: 'participacaoPercentual', rotulo: 'Participação', formatar: formatPercentualSimples },
        ]}
        aoClicar={emDetalhe ? undefined : abrirDetalhe}
      />
      {itens.length > MAX_BARRAS_DEPARTAMENTO && (
        <p className="vendas-charts__nota">
          O gráfico mostra os {MAX_BARRAS_DEPARTAMENTO} maiores; a tabela lista todos.
        </p>
      )}
      <TabelaDados
        titulo={titulo}
        colunas={[
          { chave: 'nome', rotulo: emDetalhe ? 'Produto' : 'Departamento' },
          { chave: 'faturamento', rotulo: 'Faturamento', numerica: true },
          { chave: 'quantidade', rotulo: 'Quantidade', numerica: true },
          { chave: 'participacaoPercentual', rotulo: 'Participação', numerica: true },
        ]}
        linhas={itens.map((item, indice) => {
          const navegavel = !emDetalhe && temIdValido(item.id);
          return (
            <tr key={`${item.id ?? 'sem-id'}-${indice}`}>
              <th scope="row">
                {navegavel ? (
                  <button type="button" className="vendas-charts__link" onClick={() => abrirDetalhe(item)}>
                    {item.rotulo}
                  </button>
                ) : (
                  item.rotulo
                )}
              </th>
              <td className="num">{formatCurrency(item.faturamento)}</td>
              <td className="num">{formatQuantidade(item.quantidade)}</td>
              <td className="num">{formatPercentualSimples(item.participacaoPercentual)}</td>
            </tr>
          );
        })}
      />
    </CartaoGrafico>
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
