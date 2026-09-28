// Curva ABC cruzada (Task 9.1 do PLAN.md): classificação ABC de venda, de margem e de estoque
// por dimensão de análise (produto, grupo, setor, familia, marca ou cliente).
// Task 9.2: agrupador=fornecedor é a curva de COMPRAS do ERP (não de vendas) — ver obterCurvaFornecedor.
//
// Schema do ERP usado aqui (o mesmo dos módulos de vendas/ranking; ver vendasDepartamento.service.js):
//   vendacupom.idcupom = vendaitem.idcupom     vendaitem.produto = produto.idProduto
//   vendaitem.vtotal (valor líquido do item), vendaitem.qt, vendaitem.pcusto (CMV gravado na venda; pode ser NULL)
//   produto.grupo / setor / familia / marca -> grupo(idGrupo, Descricao), setor(idSetor, Descricao),
//     familia(idFamilia, Descricao), marca(idMarca, descricao)
//   produto.qtestoque (estoque atual; pode ser negativo ou NULL), produto.precocusto
//   vendacupom.cliente -> clifor.cod (só clifor.nome é lido; nenhuma outra coluna de clifor)
//   compranota.fornecedor -> clifor.cod; compranota.TotalNota, compranota.data, compranota.Status (1 = ativa),
//     compranota.ES ('E' = entrada) — só para a curva de fornecedor (só clifor.cod/nome são lidos)
//
// Métricas (decisões do usuário, SPEC.md "Curva ABC"):
//   venda   = faturamento = SUM(vendaitem.vtotal) das vendas válidas do período (nunca vendacupom.valortotal)
//   margem  = lucro em R$ = SUM(vendaitem.vtotal - vendaitem.qt * vendaitem.pcusto) só dos itens COM pcusto
//             (pcusto = 0 é custo válido); semCusto = true se ALGUM item vendido da linha tem pcusto NULL
//   estoque = valorEstoque = SUM(GREATEST(COALESCE(qtestoque,0),0) * COALESCE(precocusto,0)) dos produtos da
//             linha: snapshot atual, independe do período. Não se aplica a cliente (null).
//             Produtos BLOQUEADOS (produto.situacao = 'B') NÃO entram no valor de estoque (Task 9.3); as VENDAS
//             deles continuam contando normalmente (histórico), então um produto bloqueado com venda no período
//             aparece na curva com valorEstoque 0.
//
// Linhas:
//   sem `id`: uma linha por item da dimensão (para produto: uma por produto);
//   com `id`: as linhas são os PRODUTOS daquele item (produto.<coluna> = id; cliente: só vendas daquele
//             cliente; produto: um único produto).
//   Universo = linhas com faturamento > 0 OU valorEstoque > 0 (inclui itens só com estoque, sem venda no período).
//   Item órfão (produto sem grupo/setor/família/marca, ou sem descrição) tem id 0 (COALESCE) e nome "Sem <dimensão>".
//   Cliente: agrupa por COALESCE(vendacupom.cliente, 0) (clifor entra por LEFT JOIN só para o nome, MAX(clifor.nome)).
//   O cliente 0 (ou NULL) é a venda a consumidor: linha id 0 "Venda consumidor", que participa normalmente da curva
//   e das classes (não dá para detalhar por id, que é > 0). Cliente com código > 0 sem registro/nome em clifor é
//   uma linha própria (id = o código) com o nome "Sem nome" — não se funde mais com o cliente 0 (Task 9.3).
//
// Fornecedor (Task 9.2): SUM(compranota.TotalNota) por fornecedor, só ES = 'E' e Status = 1, período em
//   compranota.data (buildPeriodFilter, parametrizado). LEFT JOIN clifor (só o nome): fornecedor sem registro
//   aparece como "Sem nome". Só entram fornecedores com valorCompras > 0 (HAVING no SQL, refeito em JS), o mesmo
//   universo da 9.1; totalItens conta só essas linhas. Consulta única e barata (índices de compranota), sem
//   cache. Itens: { id, nome, valorCompras, participacaoCompra, acumuladoCompra, classificacaoCompra }, ordenados
//   por valorCompras decrescente (desempate id); mesmas classes 80/95 (classificarMetrica) e mesmo limite/
//   totalItens da 9.1. Sem venda, margem nem estoque. Escolher um fornecedor (id) não é suportado (400).
//
// Classes (calculadas aqui em JS, por métrica): linhas ordenadas pela métrica decrescente; participação =
//   métrica / soma das métricas positivas; acumulado = soma acumulada das participações; A se o acumulado
//   ANTES de somar a linha for < 80%, B se < 95%, senão C (a linha que cruza 80% é A); métrica <= 0 (ou nula) = C.
//   A resposta traz participacaoVenda/acumuladoVenda em % (2 casas). Os itens saem ordenados por faturamento
//   decrescente (desempate valorEstoque decrescente, id) e o `limite` é aplicado DEPOIS de classificar
//   (totalItens = total de linhas antes do corte).
//
// SQL: duas agregações independentes (vendas por chave; estoque por chave a partir de produto) combinadas em JS
//   por id — mais simples e barata que um FULL JOIN (inexistente no MariaDB). Sem ORDER BY no SQL (a ordem é
//   definida no JS; evita ER_ILLEGAL_REFERENCE do MariaDB 10.1 com alias de agregação) e HAVING repete a expressão.
//   Vendas: STRAIGHT_JOIN partindo do período em vendacupom, como o ranking. Tudo parametrizado (`?`).
//   Estoque: WHERE COALESCE(produto.situacao, '') <> 'B' (fixo no SQL) + filtro do id, quando houver.
//   A listagem de itens do seletor (GET /api/curva-abc/itens) fica em curvaAbcItens.service.js.

const { getPool } = require('../../db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { buildPeriodFilter, buildDepartmentFilter, ErroValidacao } = require('../../shared/queryFilters');

const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 1000;
const CORTE_CLASSE_A = 0.8;
const CORTE_CLASSE_B = 0.95;
const AGRUPADOR_FORNECEDOR = 'fornecedor';
const MENSAGEM_FORNECEDOR_COM_ID = 'Escolher um fornecedor específico não é suportado nesta curva.';
const NOME_VENDA_CONSUMIDOR = 'Venda consumidor';
const NOME_SEM_NOME = 'Sem nome';
const NOME_SEM_DESCRICAO = 'Sem descrição';

// Whitelist: agrupador -> definição fixa. Nunca interpolar o agrupador recebido.
//   colunaProduto: coluna de `produto` (chave da dimensão); tabela/chave/descricao: onde está o nome;
//   nivelFiltro: nível aceito por buildDepartmentFilter (grupo/setor/familia); rotulo: nome do item órfão.
const DIMENSOES = Object.freeze({
  produto: Object.freeze({ tipo: 'produto', colunaProduto: 'idProduto' }),
  grupo: Object.freeze({
    tipo: 'departamento', colunaProduto: 'grupo', tabela: 'grupo', chave: 'idGrupo', descricao: 'Descricao',
    nivelFiltro: 'grupo', rotulo: 'grupo',
  }),
  setor: Object.freeze({
    tipo: 'departamento', colunaProduto: 'setor', tabela: 'setor', chave: 'idSetor', descricao: 'Descricao',
    nivelFiltro: 'setor', rotulo: 'setor',
  }),
  familia: Object.freeze({
    tipo: 'departamento', colunaProduto: 'familia', tabela: 'familia', chave: 'idFamilia', descricao: 'Descricao',
    nivelFiltro: 'familia', rotulo: 'família',
  }),
  marca: Object.freeze({
    tipo: 'departamento', colunaProduto: 'marca', tabela: 'marca', chave: 'idMarca', descricao: 'descricao',
    nivelFiltro: null, rotulo: 'marca',
  }),
  cliente: Object.freeze({ tipo: 'cliente' }),
});
// Dimensões da curva de VENDAS (o fornecedor é a curva de compras, tratada à parte: AGRUPADOR_FORNECEDOR).
const AGRUPADORES_DE_VENDA = Object.freeze(Object.keys(DIMENSOES));

const VALOR_ESTOQUE_SQL = 'SUM(GREATEST(COALESCE(produto.qtestoque, 0), 0) * COALESCE(produto.precocusto, 0))';
// COALESCE: NULL <> 'B' daria NULL e um cadastro sem situação sumiria do estoque em silêncio.
const SITUACAO_NAO_BLOQUEADO_SQL = "COALESCE(produto.situacao, '') <> 'B'";
const LUCRO_SQL = 'SUM(IF(vendaitem.pcusto IS NULL, 0, vendaitem.vtotal - vendaitem.qt * vendaitem.pcusto))';
const SEM_CUSTO_SQL = 'MAX(vendaitem.pcusto IS NULL)';

class ErroInternoCurvaAbc extends Error {
  constructor() {
    super('Erro interno ao consultar a curva ABC.');
    this.name = 'ErroInternoCurvaAbc';
  }
}

function arredondar(valor, casas) {
  const fator = 10 ** casas;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round((numero + Number.EPSILON) * fator) / fator : 0;
}

function validarAgrupador(agrupador) {
  const reconhecido =
    typeof agrupador === 'string' &&
    (Object.prototype.hasOwnProperty.call(DIMENSOES, agrupador) || agrupador === AGRUPADOR_FORNECEDOR);
  if (!reconhecido) {
    throw new ErroValidacao(
      'Agrupador inválido: use produto, grupo, setor, familia, marca, cliente ou fornecedor.'
    );
  }
  return agrupador;
}

// id opcional: inteiro positivo; devolve o número ou null.
function validarId(id) {
  if (id === undefined || id === null || id === '') return null;
  const numero = typeof id === 'number' ? id : /^\d+$/.test(String(id)) ? Number(id) : NaN;
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new ErroValidacao('Identificador inválido: informe um número inteiro positivo.');
  }
  return numero;
}

function validarLimite(limite) {
  if (limite === undefined || limite === null || limite === '') return LIMITE_PADRAO;
  const numero = typeof limite === 'number' ? limite : /^\d+$/.test(String(limite)) ? Number(limite) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > LIMITE_MAXIMO) {
    throw new ErroValidacao(`Limite inválido: informe um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
  }
  return numero;
}

// Filtro do `id` (sem id: null). Grupo/setor/família usam buildDepartmentFilter; marca/produto, a coluna da
// whitelist; cliente filtra o cupom.
function montarFiltroId(dimensao, id) {
  if (id === null) return null;
  if (dimensao.tipo === 'cliente') return { clause: 'vendacupom.cliente = ?', params: [id] };
  if (dimensao.nivelFiltro) return buildDepartmentFilter({ nivel: dimensao.nivelFiltro, id });
  return { clause: `produto.${dimensao.colunaProduto} = ?`, params: [id] };
}

// Como as linhas são formadas: 'produto' (dimensão produto, ou qualquer dimensão com id), 'departamento'
// (uma linha por grupo/setor/família/marca) ou 'cliente' (uma linha por cliente).
function tipoDasLinhas(dimensao, id) {
  if (dimensao.tipo === 'produto' || id !== null) return 'produto';
  return dimensao.tipo;
}

// Consulta de vendas. Placeholders: período -> filtro do id.
function montarSqlVendas(dimensao, tipoLinha, periodo, filtro) {
  let chave;
  let nome;
  let joins;
  if (tipoLinha === 'cliente') {
    // agrupa por vendacupom.cliente (não por clifor.cod): o cliente 0 (consumidor) e os códigos sem registro
    // em clifor ficam em linhas separadas; clifor entra só para o nome.
    chave = 'COALESCE(vendacupom.cliente, 0)';
    nome = 'MAX(clifor.nome)';
    joins = 'LEFT JOIN clifor ON clifor.cod = vendacupom.cliente';
  } else if (tipoLinha === 'departamento') {
    chave = `COALESCE(produto.${dimensao.colunaProduto}, 0)`;
    nome = `MAX(${dimensao.tabela}.${dimensao.descricao})`;
    joins = `LEFT JOIN produto ON produto.idProduto = vendaitem.produto
LEFT JOIN ${dimensao.tabela} ON ${dimensao.tabela}.${dimensao.chave} = produto.${dimensao.colunaProduto}`;
  } else {
    chave = 'vendaitem.produto';
    nome = 'MAX(produto.descricao)';
    joins = 'LEFT JOIN produto ON produto.idProduto = vendaitem.produto';
  }
  const filtroId = filtro ? ` AND ${filtro.clause}` : '';
  const sql = `SELECT STRAIGHT_JOIN ${chave} AS id,
  ${nome} AS nome,
  SUM(vendaitem.vtotal) AS faturamento,
  ${LUCRO_SQL} AS lucro,
  ${SEM_CUSTO_SQL} AS semCusto
FROM vendacupom
${JOIN_VENDA_VALIDA}
INNER JOIN vendaitem ON vendaitem.idcupom = vendacupom.idcupom
${joins}
WHERE ${WHERE_VENDA_VALIDA} AND ${periodo.clause}${filtroId}
GROUP BY ${chave}`;
  return { sql, params: [...periodo.params, ...(filtro ? filtro.params : [])] };
}

// Consulta de estoque (snapshot atual, a partir de produto; não usa o período). Só linhas com valor > 0.
function montarSqlEstoque(dimensao, tipoLinha, filtro) {
  let chave;
  let nome;
  let joins = '';
  if (tipoLinha === 'departamento') {
    chave = `COALESCE(produto.${dimensao.colunaProduto}, 0)`;
    nome = `MAX(${dimensao.tabela}.${dimensao.descricao})`;
    joins = `\nLEFT JOIN ${dimensao.tabela} ON ${dimensao.tabela}.${dimensao.chave} = produto.${dimensao.colunaProduto}`;
  } else {
    chave = 'produto.idProduto';
    nome = 'MAX(produto.descricao)';
  }
  // Produto bloqueado (situacao = 'B') não entra no valor de estoque (as vendas dele continuam contando).
  const where = `\nWHERE ${SITUACAO_NAO_BLOQUEADO_SQL}${filtro ? ` AND ${filtro.clause}` : ''}`;
  const sql = `SELECT ${chave} AS id,
  ${nome} AS nome,
  ${VALOR_ESTOQUE_SQL} AS valorEstoque
FROM produto${joins}${where}
GROUP BY ${chave}
HAVING ${VALOR_ESTOQUE_SQL} > 0`;
  return { sql, params: filtro ? [...filtro.params] : [] };
}

// Classifica uma métrica: recebe os valores na ordem das linhas e devolve, na mesma ordem,
// { classe, participacao (%), acumulado (%) }. Valores <= 0 (ou não numéricos) são "C" com participação 0.
function classificarMetrica(valores) {
  const positivos = valores.map((valor) => {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : 0;
  });
  const total = positivos.reduce((soma, valor) => soma + valor, 0);
  const resultado = valores.map(() => ({ classe: 'C', participacao: 0, acumulado: total > 0 ? 100 : 0 }));
  if (total <= 0) return resultado;

  // Tolerância para que somas em ponto flutuante não desloquem um acumulado que cai exatamente em 80%/95%.
  const tolerancia = total * 1e-9;
  const ordem = positivos
    .map((valor, indice) => indice)
    .filter((indice) => positivos[indice] > 0)
    .sort((a, b) => positivos[b] - positivos[a] || a - b);

  let acumulado = 0;
  ordem.forEach((indice) => {
    const antes = acumulado;
    let classe = 'C';
    if (antes < total * CORTE_CLASSE_A - tolerancia) classe = 'A';
    else if (antes < total * CORTE_CLASSE_B - tolerancia) classe = 'B';
    acumulado += positivos[indice];
    resultado[indice] = {
      classe,
      participacao: arredondar((positivos[indice] / total) * 100, 2),
      acumulado: arredondar((acumulado / total) * 100, 2),
    };
  });
  return resultado;
}

function nomeDaLinha(tipoLinha, dimensao, id, nome) {
  if (tipoLinha === 'cliente' && id === 0) return NOME_VENDA_CONSUMIDOR;
  if (typeof nome === 'string' && nome.trim()) return nome;
  if (tipoLinha === 'produto') return NOME_SEM_DESCRICAO;
  if (tipoLinha === 'cliente') return NOME_SEM_NOME;
  return `Sem ${dimensao.rotulo}`;
}

// Junta vendas e estoque por id no universo faturamento > 0 OU valorEstoque > 0.
function unirLinhas(tipoLinha, dimensao, linhasVendas, linhasEstoque) {
  const porId = new Map();
  const obter = (id) => {
    if (!porId.has(id)) {
      porId.set(id, { id, nome: null, faturamento: 0, lucro: 0, valorEstoque: 0, semCusto: false });
    }
    return porId.get(id);
  };
  linhasVendas.forEach((linha) => {
    const item = obter(Number(linha.id) || 0);
    item.nome = linha.nome;
    item.faturamento += Number(linha.faturamento) || 0;
    item.lucro += Number(linha.lucro) || 0;
    item.semCusto = item.semCusto || Number(linha.semCusto) > 0;
  });
  linhasEstoque.forEach((linha) => {
    const item = obter(Number(linha.id) || 0);
    if (item.nome === null || item.nome === undefined) item.nome = linha.nome;
    item.valorEstoque += Number(linha.valorEstoque) || 0;
  });
  return [...porId.values()]
    .filter((item) => item.faturamento > 0 || item.valorEstoque > 0)
    .map((item) => ({ ...item, nome: nomeDaLinha(tipoLinha, dimensao, item.id, item.nome) }))
    .sort((a, b) => b.faturamento - a.faturamento || b.valorEstoque - a.valorEstoque || a.id - b.id);
}

async function executar(pool, consulta) {
  const [linhas] = await pool.execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
  return Array.isArray(linhas) ? linhas : [];
}

// Consulta de compras por fornecedor (Task 9.2). Placeholders: período (compranota.data). Status e ES são fixos.
// Sem ORDER BY no SQL: a ordem é definida no JS (evita ER_ILLEGAL_REFERENCE do MariaDB 10.1).
function montarSqlCompras(periodo) {
  const sql = `SELECT compranota.fornecedor AS id,
  MAX(clifor.nome) AS nome,
  SUM(compranota.TotalNota) AS valorCompras
FROM compranota
LEFT JOIN clifor ON compranota.fornecedor = clifor.cod
WHERE ${periodo.clause} AND compranota.Status = 1 AND compranota.ES = 'E'
GROUP BY compranota.fornecedor
HAVING SUM(compranota.TotalNota) > 0`;
  return { sql, params: [...periodo.params] };
}

// Curva de compras por fornecedor. Lança ErroInternoCurvaAbc em falha do banco.
async function obterCurvaFornecedor({ inicio, fim, periodo, limite }) {
  let linhasCompras;
  try {
    linhasCompras = await executar(getPool(), montarSqlCompras(periodo));
  } catch (erro) {
    console.error(
      `[curvaAbc] Falha ao consultar a curva de fornecedores (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoCurvaAbc();
  }

  const linhas = linhasCompras
    .map((linha) => ({
      id: Number(linha.id) || 0,
      nome: typeof linha.nome === 'string' && linha.nome.trim() ? linha.nome : NOME_SEM_NOME,
      valorCompras: Number(linha.valorCompras) || 0,
    }))
    .filter((linha) => linha.valorCompras > 0) // mesmo universo da 9.1 (o HAVING já descarta no SQL)
    .sort((a, b) => b.valorCompras - a.valorCompras || a.id - b.id);
  const compras = classificarMetrica(linhas.map((linha) => linha.valorCompras));

  const itens = linhas.slice(0, limite).map((linha, indice) => ({
    id: linha.id,
    nome: linha.nome,
    valorCompras: arredondar(linha.valorCompras, 2),
    participacaoCompra: compras[indice].participacao,
    acumuladoCompra: compras[indice].acumulado,
    classificacaoCompra: compras[indice].classe,
  }));
  return { agrupador: AGRUPADOR_FORNECEDOR, inicio, fim, limite, totalItens: linhas.length, itens };
}

// Retorna { agrupador, inicio, fim, id?, limite, totalItens,
//   itens: [{ id, nome, faturamento, lucro, valorEstoque, participacaoVenda, acumuladoVenda,
//             classificacaoVenda, classificacaoMargem, classificacaoEstoque, semCusto }] }.
// Para agrupador=fornecedor devolve a curva de compras (ver obterCurvaFornecedor).
// Lança ErroValidacao (400) ou ErroInternoCurvaAbc (banco).
async function obterCurvaAbc({ inicio, fim, agrupador, id, limite } = {}) {
  validarAgrupador(agrupador);
  const fornecedor = agrupador === AGRUPADOR_FORNECEDOR;
  // fornecedor filtra compranota.data; as demais dimensões, vendacupom.data
  const periodo = fornecedor ? buildPeriodFilter(inicio, fim, 'compranota.data') : buildPeriodFilter(inicio, fim);
  const idNumerico = validarId(id);
  const limiteValido = validarLimite(limite);
  if (fornecedor) {
    if (idNumerico !== null) throw new ErroValidacao(MENSAGEM_FORNECEDOR_COM_ID);
    return obterCurvaFornecedor({ inicio, fim, periodo, limite: limiteValido });
  }

  const dimensao = DIMENSOES[agrupador];
  const tipoLinha = tipoDasLinhas(dimensao, idNumerico);
  const estoqueSeAplica = dimensao.tipo !== 'cliente';
  const filtro = montarFiltroId(dimensao, idNumerico);
  const consultaVendas = montarSqlVendas(dimensao, tipoLinha, periodo, filtro);
  const consultaEstoque = estoqueSeAplica ? montarSqlEstoque(dimensao, tipoLinha, filtro) : null;

  let linhasVendas;
  let linhasEstoque;
  try {
    const pool = getPool();
    [linhasVendas, linhasEstoque] = await Promise.all([
      executar(pool, consultaVendas),
      consultaEstoque ? executar(pool, consultaEstoque) : [],
    ]);
  } catch (erro) {
    console.error(
      `[curvaAbc] Falha ao consultar a curva ABC (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoCurvaAbc();
  }

  const linhas = unirLinhas(tipoLinha, dimensao, linhasVendas, linhasEstoque);
  const venda = classificarMetrica(linhas.map((linha) => linha.faturamento));
  const margem = classificarMetrica(linhas.map((linha) => linha.lucro));
  const estoque = estoqueSeAplica ? classificarMetrica(linhas.map((linha) => linha.valorEstoque)) : null;

  const itens = linhas.slice(0, limiteValido).map((linha, indice) => ({
    id: linha.id,
    nome: linha.nome,
    faturamento: arredondar(linha.faturamento, 2),
    lucro: arredondar(linha.lucro, 2),
    valorEstoque: estoqueSeAplica ? arredondar(linha.valorEstoque, 2) : null,
    participacaoVenda: venda[indice].participacao,
    acumuladoVenda: venda[indice].acumulado,
    classificacaoVenda: venda[indice].classe,
    classificacaoMargem: margem[indice].classe,
    classificacaoEstoque: estoque ? estoque[indice].classe : null,
    semCusto: linha.semCusto,
  }));

  const resposta = { agrupador, inicio, fim };
  if (idNumerico !== null) resposta.id = idNumerico;
  return { ...resposta, limite: limiteValido, totalItens: linhas.length, itens };
}

module.exports = {
  obterCurvaAbc,
  classificarMetrica,
  AGRUPADORES_DE_VENDA,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  ErroInternoCurvaAbc,
};
