import { useEffect, useId, useState } from 'react';
import CampoQuantidade from '../../components/CampoQuantidade/CampoQuantidade.jsx';
import MensagemErro from '../../components/MensagemErro/MensagemErro.jsx';
import PeriodFilter from '../../components/PeriodFilter/PeriodFilter.jsx';
import { listarItens, obterCurvaAbc } from '../../services/curvaAbcService.js';
import { formatCurrency } from '../../utils/format.js';
import { formatInteger, formatPercentualDuasCasas } from '../../utils/formatNumber.js';
import { classificarErro } from '../../utils/erroApi.js';
import { interpretarLimite } from '../../utils/limite.js';
import { periodoUltimosDiasAteOntem } from '../../utils/periodo.js';
import './CurvaAbcPage.css';

// Dias fechados: o período padrão termina ONTEM (mesmo padrão do Ranking de Produtos).
const DIAS_PERIODO_PADRAO = 30;
const SEM_VALOR = '—';

// Quantidade de itens (`limite`): espelha a validação do backend (1-1000, padrão 100).
const LIMITE_PADRAO = 100;
const LIMITE_MINIMO = 1;
const LIMITE_MAXIMO = 1000;
const SUGESTOES_LIMITE = [50, 100, 250, 500, 1000];
// Pausa (ms) após a última tecla antes de refazer a chamada: evita uma requisição por dígito digitado.
const DEBOUNCE_MS = 400;

// Busca de produto (~16 mil cadastros): mínimo de 2 caracteres e até 50 sugestões (regras do backend).
const BUSCA_MINIMA = 2;
const BUSCA_LIMITE = 50;

// Ordem dos botões igual à da Curva ABC do ERP; o padrão é Setor.
const DIMENSOES = [
  { valor: 'grupo', rotulo: 'Grupo' },
  { valor: 'marca', rotulo: 'Marca' },
  { valor: 'familia', rotulo: 'Família' },
  { valor: 'produto', rotulo: 'Produto' },
  { valor: 'cliente', rotulo: 'Cliente' },
  { valor: 'fornecedor', rotulo: 'Fornecedor' },
  { valor: 'setor', rotulo: 'Setor' },
];
const DIMENSAO_PADRAO = 'setor';
const DIMENSAO_SEM_ESTOQUE = 'cliente'; // estoque não se aplica a cliente
const DIMENSAO_COMPRAS = 'fornecedor'; // curva de compras: sem venda, margem nem estoque

const comValor = (valor, formatar) => (valor === null || valor === undefined ? SEM_VALOR : formatar(valor));

// Classe A/B/C sempre com o texto da letra (nunca só cor).
function Classe({ valor }) {
  if (!valor) return SEM_VALOR;
  return <span className={`curva-abc__classe curva-abc__classe--${String(valor).toLowerCase()}`}>{valor}</span>;
}

// Vende muito (A) mas dá pouca margem (C): destaque de atenção com texto.
// Com custo incompleto (semCusto) a margem é parcial/desconhecida: o selo sugeriria margem baixa sem base,
// então nesse caso só vale o aviso "Custo incompleto".
const vendeMuitoMargemBaixa = (item) =>
  !item.semCusto && item.classificacaoVenda === 'A' && item.classificacaoMargem === 'C';

const COLUNAS_VENDA = [
  { titulo: 'Faturamento (R$)', numerica: true, celula: (i) => comValor(i.faturamento, formatCurrency) },
  { titulo: '% venda', numerica: true, celula: (i) => comValor(i.participacaoVenda, formatPercentualDuasCasas) },
  { titulo: '% acumulado', numerica: true, celula: (i) => comValor(i.acumuladoVenda, formatPercentualDuasCasas) },
  { titulo: 'Classe venda', celula: (i) => <Classe valor={i.classificacaoVenda} /> },
  {
    titulo: 'Lucro (R$)',
    numerica: true,
    // semCusto: o lucro soma só os itens com custo cadastrado, então é parcial.
    celula: (i) => (
      <>
        {comValor(i.lucro, formatCurrency)}
        {i.semCusto && (
          <span className="curva-abc__selo-sem-custo" title="Lucro parcial: há itens sem custo cadastrado">
            Custo incompleto
          </span>
        )}
      </>
    ),
  },
  { titulo: 'Classe margem', celula: (i) => <Classe valor={i.classificacaoMargem} /> },
];

const COLUNAS_ESTOQUE = [
  { titulo: 'Valor em estoque (R$)', numerica: true, celula: (i) => comValor(i.valorEstoque, formatCurrency) },
  { titulo: 'Classe estoque', celula: (i) => <Classe valor={i.classificacaoEstoque} /> },
];

const COLUNAS_COMPRAS = [
  { titulo: 'Valor comprado (R$)', numerica: true, celula: (i) => comValor(i.valorCompras, formatCurrency) },
  { titulo: '% compras', numerica: true, celula: (i) => comValor(i.participacaoCompra, formatPercentualDuasCasas) },
  { titulo: '% acumulado', numerica: true, celula: (i) => comValor(i.acumuladoCompra, formatPercentualDuasCasas) },
  { titulo: 'Classe', celula: (i) => <Classe valor={i.classificacaoCompra} /> },
];

function colunasDaDimensao(dimensao) {
  if (dimensao === DIMENSAO_COMPRAS) return COLUNAS_COMPRAS;
  if (dimensao === DIMENSAO_SEM_ESTOQUE) return COLUNAS_VENDA;
  return [...COLUNAS_VENDA, ...COLUNAS_ESTOQUE];
}

// Item da dimensão (grupo/setor/família/marca/cliente): <select> com "Todos" + cadastros vindos de /itens.
// Montado com `key={dimensao}`: trocar a dimensão recarrega a lista e descarta o estado da anterior.
function SelectItem({ dimensao, rotulo, item, onSelecionar }) {
  const id = useId();
  const [lista, setLista] = useState({ carregando: true, itens: [], erro: null });

  useEffect(() => {
    let cancelado = false;
    listarItens({ agrupador: dimensao })
      .then((resposta) => {
        if (cancelado) return;
        // Só ids positivos são detalháveis na curva (id 0 = "Venda consumidor", "Sem setor"... o backend recusa).
        const itens = ((resposta && resposta.itens) || []).filter((i) => Number.isInteger(i.id) && i.id > 0);
        setLista({ carregando: false, itens, erro: null });
      })
      .catch((e) => {
        if (cancelado) return;
        setLista({ carregando: false, itens: [], erro: (e && e.message) || 'Erro ao carregar os itens.' });
      });
    return () => {
      cancelado = true;
    };
  }, [dimensao]);

  const escolher = (valor) => {
    const escolhido = lista.itens.find((i) => String(i.id) === valor);
    onSelecionar(escolhido ? { id: escolhido.id, nome: escolhido.nome } : null);
  };

  return (
    <div className="curva-abc__campo">
      <label htmlFor={id}>{`Item de ${rotulo}`}</label>
      <select
        id={id}
        value={item ? String(item.id) : ''}
        disabled={lista.carregando}
        onChange={(e) => escolher(e.target.value)}
      >
        <option value="">Todos</option>
        {lista.itens.map((i) => (
          <option key={i.id} value={String(i.id)}>{i.nome}</option>
        ))}
      </select>
      {lista.carregando && <p role="status" aria-live="polite" className="curva-abc__campo-dica">Carregando itens...</p>}
      {lista.erro && <p role="alert" className="curva-abc__campo-erro">{lista.erro}</p>}
    </div>
  );
}

// Fornecedor não tem seleção de item (a curva é de compras): só "Todos", desabilitado.
function SelectFornecedor() {
  const id = useId();
  return (
    <div className="curva-abc__campo">
      <label htmlFor={id}>Item de Fornecedor</label>
      <select id={id} value="" disabled onChange={() => {}}>
        <option value="">Todos</option>
      </select>
      <p className="curva-abc__campo-dica">Fornecedor não tem seleção de item.</p>
    </div>
  );
}

// Produto (~16 mil): busca por digitação com debounce, sugestões acessíveis e volta a "Todos".
function BuscaProduto({ item, onSelecionar }) {
  const id = useId();
  const idDica = `${id}-dica`;
  const [busca, setBusca] = useState('');
  const [resultado, setResultado] = useState(null); // { termo, itens, totalItens, erro } da última busca concluída

  const termo = busca.trim();
  const buscaValida = termo.length >= BUSCA_MINIMA;

  useEffect(() => {
    if (!buscaValida) return undefined;
    let cancelado = false;
    const temporizador = setTimeout(() => {
      listarItens({ agrupador: 'produto', busca: termo, limite: BUSCA_LIMITE })
        .then((resposta) => {
          if (!cancelado) setResultado({
              termo,
              itens: (resposta && resposta.itens) || [],
              totalItens: resposta ? resposta.totalItens : undefined,
              erro: null,
            });
        })
        .catch((e) => {
          if (!cancelado) setResultado({ termo, itens: [], erro: (e && e.message) || 'Erro ao buscar produtos.' });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [buscaValida, termo]);

  // O resultado só vale para o texto que o originou (evita sugestões de uma busca anterior).
  const atual = buscaValida && resultado && resultado.termo === termo ? resultado : null;
  const buscando = buscaValida && !atual;

  const escolher = (produto) => {
    setBusca('');
    onSelecionar({ id: produto.id, nome: produto.nome });
  };

  return (
    <div className="curva-abc__campo curva-abc__campo--busca">
      <label htmlFor={id}>Buscar produto</label>
      <input
        id={id}
        type="search"
        autoComplete="off"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        aria-describedby={idDica}
      />
      <p id={idDica} className="curva-abc__campo-dica">
        {buscaValida ? 'Escolha um produto da lista.' : `Digite ao menos ${BUSCA_MINIMA} caracteres para buscar.`}
      </p>
      {buscando && <p role="status" aria-live="polite" className="curva-abc__campo-dica">Buscando produtos...</p>}
      {atual && atual.erro && <p role="alert" className="curva-abc__campo-erro">{atual.erro}</p>}
      {atual && !atual.erro && atual.itens.length === 0 && (
        <p className="curva-abc__campo-dica">Nenhum produto encontrado para a busca.</p>
      )}
      {atual && atual.totalItens > atual.itens.length && (
        <p className="curva-abc__campo-dica">
          {`Mostrando ${atual.itens.length} de ${atual.totalItens} produtos; refine a busca`}
        </p>
      )}
      {atual && atual.itens.length > 0 && (
        <ul aria-label="Sugestões de produtos" className="curva-abc__sugestoes">
          {atual.itens.map((produto) => (
            <li key={produto.id}>
              <button type="button" onClick={() => escolher(produto)}>{produto.nome}</button>
            </li>
          ))}
        </ul>
      )}
      <p className="curva-abc__selecionado">
        Item selecionado: <strong>{item ? item.nome : 'Todos'}</strong>
        {item && (
          <button type="button" className="curva-abc__limpar" onClick={() => onSelecionar(null)}>
            Voltar para Todos
          </button>
        )}
      </p>
    </div>
  );
}

function SeletorItem({ dimensao, rotulo, item, onSelecionar }) {
  if (dimensao === 'produto') return <BuscaProduto item={item} onSelecionar={onSelecionar} />;
  if (dimensao === DIMENSAO_COMPRAS) return <SelectFornecedor />;
  return <SelectItem key={dimensao} dimensao={dimensao} rotulo={rotulo} item={item} onSelecionar={onSelecionar} />;
}

function TabelaCurva({ dimensao, titulo, itens }) {
  const colunas = colunasDaDimensao(dimensao);
  const compras = dimensao === DIMENSAO_COMPRAS;
  return (
    <div className="curva-abc__tabela-wrapper" role="region" aria-label="Tabela da Curva ABC" tabIndex={0}>
      <table className="curva-abc__tabela">
        <caption className="curva-abc__legenda">{titulo}</caption>
        <thead>
          <tr>
            <th scope="col" className="curva-abc__col-posicao">Posição</th>
            <th scope="col">{compras ? 'Fornecedor' : 'Nome'}</th>
            {colunas.map((coluna) => (
              <th key={coluna.titulo} scope="col" className={coluna.numerica ? 'curva-abc__numero' : undefined}>
                {coluna.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((item, indice) => {
            const atencao = !compras && vendeMuitoMargemBaixa(item);
            const classesLinha = [
              atencao ? 'curva-abc__linha--atencao' : '',
              !compras && item.semCusto ? 'curva-abc__linha--sem-custo' : '',
            ].filter(Boolean).join(' ');
            return (
              <tr key={item.id} className={classesLinha || undefined}>
                {/* A lista já vem ordenada (por faturamento / valor comprado): a posição é o índice. */}
                <td className="curva-abc__col-posicao">{indice + 1}</td>
                <th scope="row" className="curva-abc__nome">
                  {item.nome}
                  {atencao && <span className="curva-abc__selo-atencao">Vende muito, margem baixa</span>}
                </th>
                {colunas.map((coluna) => (
                  <td key={coluna.titulo} className={coluna.numerica ? 'curva-abc__numero' : undefined}>
                    {coluna.celula(item)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CurvaAbcPage({ onLogout }) {
  const [periodo, setPeriodo] = useState(() => periodoUltimosDiasAteOntem(DIAS_PERIODO_PADRAO));
  const [dimensao, setDimensao] = useState(DIMENSAO_PADRAO);
  const [item, setItem] = useState(null); // { id, nome } do item escolhido; null = "Todos"
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  // `campoLimite` é o texto digitado; `limite` é o valor VÁLIDO já aplicado (o único que vai à API).
  const [campoLimite, setCampoLimite] = useState(String(LIMITE_PADRAO));
  const [limite, setLimite] = useState(LIMITE_PADRAO);

  const limiteDigitado = interpretarLimite(campoLimite, LIMITE_MAXIMO, LIMITE_MINIMO);
  const limiteInvalido = limiteDigitado === null;

  // Valor válido e diferente do aplicado: refaz a chamada só após uma pausa na digitação.
  // Valor inválido: não chama a API e mantém a tabela anterior visível.
  useEffect(() => {
    if (limiteDigitado === null || limiteDigitado === limite) return undefined;
    const temporizador = setTimeout(() => setLimite(limiteDigitado), DEBOUNCE_MS);
    return () => clearTimeout(temporizador);
  }, [limiteDigitado, limite]);

  // Trocar a dimensão volta o item para "Todos" (na mesma atualização, para haver uma única chamada à API).
  const trocarDimensao = (novaDimensao) => {
    setDimensao(novaDimensao);
    setItem(null);
  };

  const idItem = item ? item.id : undefined;
  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    const parametros = { inicio: periodo.inicio, fim: periodo.fim, agrupador: dimensao, limite };
    if (idItem !== undefined) parametros.id = idItem;
    obterCurvaAbc(parametros)
      .then((resposta) => {
        if (cancelado) return;
        setResultado({ dimensao, resposta });
        setCarregando(false);
      })
      .catch((e) => {
        if (cancelado) return;
        setResultado(null);
        setErro(classificarErro(e, 'Erro ao carregar a curva ABC.'));
        setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [dimensao, idItem, periodo.inicio, periodo.fim, limite]);

  // Só usa a resposta se ela pertence à dimensão atual: evita renderizar um frame com dados de outra dimensão
  // (colunas incompatíveis) entre a troca do seletor e a nova resposta da API.
  const dados = resultado && resultado.dimensao === dimensao ? resultado.resposta : null;
  const itens = (dados && dados.itens) || [];
  const totalItens = dados && dados.totalItens;
  const listaLimitada = Boolean(dados) && totalItens > itens.length;

  const rotuloDimensao = DIMENSOES.find((d) => d.valor === dimensao).rotulo;
  let titulo = `Curva ABC por ${rotuloDimensao}`;
  if (dimensao === DIMENSAO_COMPRAS) titulo = 'Curva ABC de compras por Fornecedor';
  else if (item) titulo = `Curva ABC dos produtos de ${rotuloDimensao}: ${item.nome}`;

  return (
    <div className="curva-abc">
      <header className="curva-abc__topo">
        <div>
          <a className="curva-abc__voltar" href="#/">Voltar ao painel</a>
          <h1 className="curva-abc__titulo">Curva ABC</h1>
        </div>
        <button type="button" className="curva-abc__sair" onClick={onLogout}>Sair</button>
      </header>

      <main className="curva-abc__conteudo">
        <section aria-labelledby="curva-abc-filtros" className="curva-abc__filtros">
          <h2 id="curva-abc-filtros" className="curva-abc__secao-titulo">Filtros</h2>
          <div className="curva-abc__filtros-campos">
            <fieldset className="curva-abc__dimensoes">
              <legend>Analisar por</legend>
              {DIMENSOES.map((d) => (
                <label key={d.valor} className="curva-abc__dimensao">
                  <input
                    type="radio"
                    name="curva-abc-dimensao"
                    value={d.valor}
                    checked={dimensao === d.valor}
                    onChange={() => trocarDimensao(d.valor)}
                  />
                  {d.rotulo}
                </label>
              ))}
            </fieldset>
            <SeletorItem dimensao={dimensao} rotulo={rotuloDimensao} item={item} onSelecionar={setItem} />
            <CampoQuantidade
              prefixo="curva-abc"
              minimo={LIMITE_MINIMO}
              maximo={LIMITE_MAXIMO}
              sugestoes={SUGESTOES_LIMITE}
              valor={campoLimite}
              onChange={setCampoLimite}
              erro={limiteInvalido}
            />
          </div>
          <PeriodFilter
            startDate={periodo.inicio}
            endDate={periodo.fim}
            onChange={({ startDate, endDate }) => setPeriodo({ inicio: startDate, fim: endDate })}
          />
        </section>

        <section aria-labelledby="curva-abc-resultado">
          <h2 id="curva-abc-resultado" className="curva-abc__secao-titulo">{titulo}</h2>

          {carregando && (
            <p role="status" aria-live="polite" className="curva-abc__carregando">Carregando curva ABC...</p>
          )}
          {erro && <MensagemErro prefixo="curva-abc" erro={erro} />}

          {!carregando && !erro && dados && (
            <>
              {dimensao === DIMENSAO_SEM_ESTOQUE && (
                <p className="curva-abc__detalhe">Estoque não se aplica à curva por cliente.</p>
              )}
              {listaLimitada && (
                <p className="curva-abc__detalhe">{`Exibindo os ${formatInteger(itens.length)} de ${formatInteger(totalItens)} itens`}</p>
              )}
              {itens.length === 0 ? (
                <p className="curva-abc__vazio">Nenhum dado no período</p>
              ) : (
                <TabelaCurva dimensao={dimensao} titulo={titulo} itens={itens} />
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default CurvaAbcPage;
