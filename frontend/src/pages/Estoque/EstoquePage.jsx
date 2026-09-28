import { useEffect, useId, useState } from 'react';
import CampoQuantidade from '../../components/CampoQuantidade/CampoQuantidade.jsx';
import MensagemErro from '../../components/MensagemErro/MensagemErro.jsx';
import PeriodFilter from '../../components/PeriodFilter/PeriodFilter.jsx';
import { listarItens } from '../../services/curvaAbcService.js';
import { obterCobertura, obterNiveis, obterParados } from '../../services/estoqueService.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { formatDecimal, formatInteger, formatQuantidade } from '../../utils/formatNumber.js';
import { classificarErro } from '../../utils/erroApi.js';
import { interpretarLimite } from '../../utils/limite.js';
import { periodoUltimosDiasAteOntem } from '../../utils/periodo.js';
import './EstoquePage.css';

// Dias fechados: o período padrão termina ONTEM (o backend limita o `fim` a ontem).
const DIAS_PERIODO_PADRAO = 30;
const SEM_VALOR = '—';

// Quantidade de itens (`limite`): mesmo padrão validado do Ranking (padrão 10, debounce de 400 ms).
// O máximo espelha o backend: 1-500 nas três rotas de estoque.
const LIMITE_PADRAO = 10;
const LIMITE_MINIMO = 1;
const LIMITE_MAXIMO = 500;
const SUGESTOES_LIMITE = [10, 25, 50, 100, 250, 500];
const LIMITE_DEBOUNCE_MS = 400;

// Limite da chamada extra a /niveis que só serve para trazer o `resumo` (a lista dessa chamada é descartada).
const LIMITE_SO_RESUMO = 1;

const NIVEIS_DEPARTAMENTO = [
  { valor: 'grupo', rotulo: 'Grupo' },
  { valor: 'setor', rotulo: 'Setor' },
  { valor: 'familia', rotulo: 'Família' },
];

// `tipo` diz qual rota abastece a visão; nas visões de níveis o `valor` é a `classificacao` enviada à API.
const VISOES = [
  { valor: 'ruptura', tipo: 'niveis', rotulo: 'Ruptura', titulo: 'Produtos em ruptura' },
  { valor: 'proximo_ruptura', tipo: 'niveis', rotulo: 'Próximos da ruptura', titulo: 'Produtos próximos da ruptura' },
  { valor: 'excesso', tipo: 'niveis', rotulo: 'Excesso', titulo: 'Produtos em excesso' },
  { valor: 'cobertura', tipo: 'cobertura', rotulo: 'Cobertura em dias', titulo: 'Cobertura de estoque em dias' },
  { valor: 'parados', tipo: 'parados', rotulo: 'Parados (com estoque)', titulo: 'Produtos parados com estoque' },
];
const VISAO_PADRAO = 'ruptura';

// Cada cartão do resumo é um botão que seleciona a visão da mesma classificação.
const CARTOES = [
  { visao: 'ruptura', rotulo: 'Em ruptura', campo: 'ruptura' },
  { visao: 'proximo_ruptura', rotulo: 'Próximos da ruptura', campo: 'proximoRuptura' },
  { visao: 'excesso', rotulo: 'Em excesso', campo: 'excesso' },
];

const comValor = (valor, formatar) => (valor === null || valor === undefined ? SEM_VALOR : formatar(valor));

// Estoque negativo mostra o sinal e o selo "Negativo" (texto, não só cor).
function CelulaEstoque({ valor }) {
  if (valor === null || valor === undefined) return SEM_VALOR;
  return (
    <>
      {formatQuantidade(valor)}
      {valor < 0 && <span className="estoque__selo-alerta">Negativo</span>}
    </>
  );
}

// Cobertura 0 (estoque esgotado ou negativo) ganha o selo "Sem cobertura" (texto, não só cor).
function CelulaCobertura({ valor }) {
  if (valor === null || valor === undefined) return SEM_VALOR;
  return (
    <>
      {formatDecimal(valor)}
      {valor === 0 && <span className="estoque__selo-alerta">Sem cobertura</span>}
    </>
  );
}

const COLUNA_ESTOQUE_ATUAL = { titulo: 'Estoque atual', numerica: true, celula: (i) => <CelulaEstoque valor={i.estoqueAtual} /> };
const COLUNA_MEDIA_DIA = { titulo: 'Média/dia', numerica: true, celula: (i) => comValor(i.mediaDiaria, formatDecimal) };
const COLUNA_COBERTURA = { titulo: 'Cobertura (dias)', numerica: true, celula: (i) => <CelulaCobertura valor={i.coberturaDias} /> };

const COLUNAS = {
  niveis: [
    COLUNA_ESTOQUE_ATUAL,
    { titulo: 'Mínimo', numerica: true, celula: (i) => comValor(i.estoqueMinimo, formatQuantidade) },
    { titulo: 'Máximo', numerica: true, celula: (i) => comValor(i.estoqueMaximo, formatQuantidade) },
    { titulo: 'Vendido no período', numerica: true, celula: (i) => comValor(i.quantidadeVendida, formatQuantidade) },
    COLUNA_MEDIA_DIA,
    COLUNA_COBERTURA,
  ],
  cobertura: [
    COLUNA_ESTOQUE_ATUAL,
    { titulo: 'Vendido', numerica: true, celula: (i) => comValor(i.quantidadeVendida, formatQuantidade) },
    COLUNA_MEDIA_DIA,
    COLUNA_COBERTURA,
  ],
  parados: [
    COLUNA_ESTOQUE_ATUAL,
    { titulo: 'Custo unitário (R$)', numerica: true, celula: (i) => comValor(i.custoUnitario, formatCurrency) },
    { titulo: 'Valor parado (R$)', numerica: true, celula: (i) => comValor(i.valorParado, formatCurrency) },
  ],
};

// Item do departamento (grupo/setor/família): <select> com "Todos" + cadastros vindos de /api/curva-abc/itens.
// Montado com `key={nivel}`: trocar o nível recarrega a lista e descarta o estado da anterior.
function SelectItemDepartamento({ nivel, rotulo, item, onSelecionar }) {
  const id = useId();
  const [lista, setLista] = useState({ carregando: true, itens: [], erro: null });

  useEffect(() => {
    let cancelado = false;
    listarItens({ agrupador: nivel })
      .then((resposta) => {
        if (cancelado) return;
        // Só ids positivos filtram o estoque (id 0 = "Sem setor"/"Sem grupo"...: o backend recusa).
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
  }, [nivel]);

  const escolher = (valor) => {
    const escolhido = lista.itens.find((i) => String(i.id) === valor);
    onSelecionar(escolhido ? { id: escolhido.id, nome: escolhido.nome } : null);
  };

  return (
    <div className="estoque__campo">
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
      {lista.carregando && <p role="status" aria-live="polite" className="estoque__campo-dica">Carregando itens...</p>}
      {lista.erro && <p role="alert" className="estoque__campo-erro">{lista.erro}</p>}
    </div>
  );
}

function TabelaEstoque({ tipo, titulo, itens }) {
  const colunas = COLUNAS[tipo];
  return (
    <div className="estoque__tabela-wrapper" role="region" aria-label="Tabela de estoque" tabIndex={0}>
      <table className="estoque__tabela">
        <caption className="estoque__legenda">{titulo}</caption>
        <thead>
          <tr>
            <th scope="col">Produto</th>
            {colunas.map((coluna) => (
              <th key={coluna.titulo} scope="col" className={coluna.numerica ? 'estoque__numero' : undefined}>
                {coluna.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((item) => (
            <tr key={item.id}>
              <th scope="row" className="estoque__produto">{item.nome}</th>
              {colunas.map((coluna) => (
                <td key={coluna.titulo} className={coluna.numerica ? 'estoque__numero' : undefined}>
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

// Só usa nivel+id quando um item foi escolhido (nível sozinho = sem filtro).
function buscarLista({ visao, filtros }) {
  if (visao.tipo === 'cobertura') return obterCobertura(filtros);
  if (visao.tipo === 'parados') return obterParados(filtros);
  return obterNiveis({ ...filtros, classificacao: visao.valor });
}

function EstoquePage({ onLogout }) {
  const [periodo, setPeriodo] = useState(() => periodoUltimosDiasAteOntem(DIAS_PERIODO_PADRAO));
  const [nivel, setNivel] = useState(null); // 'grupo' | 'setor' | 'familia' | null (sem filtro)
  const [item, setItem] = useState(null); // { id, nome } do item escolhido; null = "Todos"
  const [visaoValor, setVisaoValor] = useState(VISAO_PADRAO);
  const [resultado, setResultado] = useState(null); // { visao, resposta } da última lista concluída
  // Contagens do resumo, com a chave do filtro (período + departamento) a que pertencem.
  const [resumo, setResumo] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  // `campoLimite` é o texto digitado; `limite` é o valor VÁLIDO já aplicado (o único que vai à API).
  const [campoLimite, setCampoLimite] = useState(String(LIMITE_PADRAO));
  const [limite, setLimite] = useState(LIMITE_PADRAO);

  const visaoAtual = VISOES.find((v) => v.valor === visaoValor);
  const visaoDeNiveis = visaoAtual.tipo === 'niveis';

  const limiteDigitado = interpretarLimite(campoLimite, LIMITE_MAXIMO, LIMITE_MINIMO);
  const limiteInvalido = limiteDigitado === null;

  // Valor válido e diferente do aplicado: refaz a chamada só após uma pausa na digitação.
  // Valor inválido: não chama a API e mantém a tabela anterior visível.
  useEffect(() => {
    if (limiteDigitado === null || limiteDigitado === limite) return undefined;
    const temporizador = setTimeout(() => setLimite(limiteDigitado), LIMITE_DEBOUNCE_MS);
    return () => clearTimeout(temporizador);
  }, [limiteDigitado, limite]);

  // Trocar o nível volta o item para "Todos" (na mesma atualização, para haver uma única chamada à API).
  const trocarNivel = (novoNivel) => {
    setNivel(novoNivel);
    setItem(null);
  };

  const idItem = item ? item.id : undefined;
  const nivelEfetivo = item ? nivel : undefined;
  const chaveFiltro = `${periodo.inicio}|${periodo.fim}|${nivelEfetivo || ''}|${idItem === undefined ? '' : idItem}`;

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    const filtros = { inicio: periodo.inicio, fim: periodo.fim, limite };
    if (idItem !== undefined) {
      filtros.nivel = nivelEfetivo;
      filtros.id = idItem;
    }
    buscarLista({ visao: visaoAtual, filtros })
      .then((resposta) => {
        if (cancelado) return;
        setResultado({ visao: visaoValor, resposta });
        if (visaoDeNiveis && resposta && resposta.resumo) setResumo({ chave: chaveFiltro, valores: resposta.resumo });
        setCarregando(false);
      })
      .catch((e) => {
        if (cancelado) return;
        setResultado(null);
        setErro(classificarErro(e, 'Erro ao carregar o estoque.'));
        setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [visaoValor, chaveFiltro, limite]);

  // As contagens do resumo só vêm de /niveis. Nas visões Cobertura e Parados o resumo é mantido enquanto o
  // filtro (período + departamento) for o mesmo; se o filtro mudou, busca /niveis em paralelo à lista, só para
  // o resumo (limite mínimo). Falha nessa chamada não é erro de tela: os cartões mostram "—".
  const chaveDoResumo = resumo ? resumo.chave : null;
  useEffect(() => {
    if (visaoDeNiveis || chaveDoResumo === chaveFiltro) return undefined;
    let cancelado = false;
    const parametros = { inicio: periodo.inicio, fim: periodo.fim, classificacao: VISAO_PADRAO, limite: LIMITE_SO_RESUMO };
    if (idItem !== undefined) {
      parametros.nivel = nivelEfetivo;
      parametros.id = idItem;
    }
    obterNiveis(parametros)
      .then((resposta) => {
        if (!cancelado && resposta && resposta.resumo) setResumo({ chave: chaveFiltro, valores: resposta.resumo });
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [visaoDeNiveis, chaveFiltro, chaveDoResumo]);

  // Só usa a resposta se ela pertence à visão atual: evita renderizar um frame com dados de outra visão
  // (colunas incompatíveis) entre a troca da visão e a nova resposta da API.
  const dados = resultado && resultado.visao === visaoValor ? resultado.resposta : null;
  const itens = (dados && dados.itens) || [];
  const totalItens = dados && dados.totalItens;
  const listaLimitada = Boolean(dados) && totalItens > itens.length;
  const periodoAjustado = Boolean(dados) && dados.fimSolicitado && dados.fim !== dados.fimSolicitado;
  const contagens = resumo && resumo.chave === chaveFiltro ? resumo.valores : null;

  const rotuloNivel = nivel ? NIVEIS_DEPARTAMENTO.find((n) => n.valor === nivel).rotulo : '';

  return (
    <div className="estoque">
      <header className="estoque__topo">
        <div>
          <a className="estoque__voltar" href="#/">Voltar ao painel</a>
          <h1 className="estoque__titulo">Estoque Inteligente</h1>
        </div>
        <button type="button" className="estoque__sair" onClick={onLogout}>Sair</button>
      </header>

      <main className="estoque__conteudo">
        <section aria-labelledby="estoque-filtros" className="estoque__filtros">
          <h2 id="estoque-filtros" className="estoque__secao-titulo">Filtros</h2>
          <div className="estoque__filtros-campos">
            <fieldset className="estoque__niveis">
              <legend>Departamento</legend>
              {NIVEIS_DEPARTAMENTO.map((n) => (
                <label key={n.valor} className="estoque__opcao">
                  <input
                    type="radio"
                    name="estoque-departamento"
                    value={n.valor}
                    checked={nivel === n.valor}
                    onChange={() => trocarNivel(n.valor)}
                  />
                  {n.rotulo}
                </label>
              ))}
            </fieldset>
            {nivel && (
              <SelectItemDepartamento key={nivel} nivel={nivel} rotulo={rotuloNivel} item={item} onSelecionar={setItem} />
            )}
            <CampoQuantidade
              prefixo="estoque"
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

        <section aria-labelledby="estoque-resumo">
          <h2 id="estoque-resumo" className="estoque__secao-titulo">Resumo</h2>
          <div className="estoque__cartoes">
            {CARTOES.map((c) => (
              <button
                key={c.visao}
                type="button"
                className="estoque__cartao"
                aria-pressed={visaoValor === c.visao}
                onClick={() => setVisaoValor(c.visao)}
              >
                <span className="estoque__cartao-rotulo">{c.rotulo}</span>
                <span className="estoque__cartao-valor">{contagens ? formatInteger(contagens[c.campo]) : SEM_VALOR}</span>
              </button>
            ))}
          </div>
          <p className="estoque__detalhe">Um produto pode aparecer em mais de uma contagem.</p>
        </section>

        <section aria-labelledby="estoque-resultado">
          <fieldset className="estoque__visoes">
            <legend>Visão</legend>
            {VISOES.map((v) => (
              <label key={v.valor} className="estoque__opcao">
                <input
                  type="radio"
                  name="estoque-visao"
                  value={v.valor}
                  checked={visaoValor === v.valor}
                  onChange={() => setVisaoValor(v.valor)}
                />
                {v.rotulo}
              </label>
            ))}
          </fieldset>

          <h2 id="estoque-resultado" className="estoque__secao-titulo">{visaoAtual.titulo}</h2>

          {carregando && <p role="status" aria-live="polite" className="estoque__carregando">Carregando estoque...</p>}
          {erro && <MensagemErro prefixo="estoque" erro={erro} />}

          {!carregando && !erro && dados && (
            <>
              {periodoAjustado && (
                <p role="status" className="estoque__aviso estoque__aviso--atencao">
                  {`Período ajustado até ${formatDate(dados.fim)}: só dias encerrados`}
                </p>
              )}
              {visaoAtual.tipo === 'cobertura' && (
                <p className="estoque__detalhe">Só produtos que tiveram venda no período.</p>
              )}
              {visaoAtual.tipo === 'parados' && (
                <>
                  <p className="estoque__detalhe">Produtos com estoque positivo e nenhuma venda no período.</p>
                  <div className="estoque__destaque">
                    <p className="estoque__destaque-valor">
                      {`Valor total parado em estoque: ${comValor(dados.valorTotalParado, formatCurrency)}`}
                    </p>
                    <p className="estoque__destaque-detalhe">
                      {`${formatInteger(totalItens)} ${totalItens === 1 ? 'produto parado' : 'produtos parados'}`}
                    </p>
                  </div>
                </>
              )}
              {listaLimitada && (
                <p className="estoque__detalhe">{`Exibindo os ${formatInteger(itens.length)} de ${formatInteger(totalItens)} itens`}</p>
              )}
              {itens.length === 0 ? (
                <p className="estoque__vazio">Nenhum produto encontrado no período</p>
              ) : (
                <TabelaEstoque tipo={visaoAtual.tipo} titulo={visaoAtual.titulo} itens={itens} />
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default EstoquePage;
