// Listagem dos itens de uma dimensão da Curva ABC (Task 9.3 do PLAN.md): alimenta o seletor de item
// ao lado do seletor de dimensão. GET /api/curva-abc/itens?agrupador&busca&limite -> [{ id, nome }].
//
// Fontes (whitelist fixa; o agrupador recebido nunca é interpolado no SQL):
//   grupo   -> grupo(idGrupo, Descricao)      setor -> setor(idSetor, Descricao)
//   familia -> familia(idFamilia, Descricao)  marca -> marca(idMarca, descricao)
//   cliente -> clifor(cod, nome) só com tipo = 1 (NUNCA outra coluna de clifor: dados pessoais)
//   produto -> produto(idProduto, descricao) só com situacao = 'A' (~16 mil: busca obrigatória, mín. 2 caracteres)
//   fornecedor não tem seleção de item (400).
//
// Regras:
//   - `busca` (opcional; obrigatória em produto) é separada em palavras (por espaços/whitespace) e o nome precisa
//     conter TODAS, em qualquer ordem: um `LIKE ?` parametrizado por palavra, unidos por AND (lista e COUNT), com %, _ e
//     a barra invertida de cada palavra escapados (o usuário busca o texto literal, não um padrão).
//     Limites: no máximo 6 palavras e 100 caracteres na busca inteira (400 acima disso).
//   - Ordem alfabética por nome (desempate por id), feita pelo banco (collation). Sem alias de agregação no
//     ORDER BY (a consulta nem agrega).
//   - `limite`: grupo/setor/familia/marca/cliente padrão e máximo 5000; produto padrão 50 e máximo 200.
//     `totalItens` = total que casa com a busca ANTES do limite (COUNT(*) numa consulta à parte).
//   - Item sem nome: "Sem nome" (produto: "Sem descrição").
//   - Falha do banco: log só do `code` e ErroInternoCurvaAbc (o controller responde 500 genérico).

const { getPool } = require('../../db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { ErroValidacao } = require('../../shared/queryFilters');
const { ErroInternoCurvaAbc } = require('./curvaAbc.service');

const LIMITE_PADRAO_CADASTROS = 5000;
const LIMITE_MAXIMO_CADASTROS = 5000;
const LIMITE_PADRAO_PRODUTO = 50;
const LIMITE_MAXIMO_PRODUTO = 200;
const BUSCA_MINIMA_PRODUTO = 2;
const BUSCA_MAXIMA_PALAVRAS = 6;
const BUSCA_MAXIMA_CARACTERES = 100;
const MENSAGEM_FORNECEDOR = 'Fornecedor não tem seleção de item.';
const MENSAGEM_AGRUPADOR = 'Agrupador inválido: use grupo, setor, familia, marca, cliente ou produto.';

function departamento(tabela, chave, descricao) {
  return Object.freeze({
    tabela,
    chave,
    descricao,
    filtroFixo: null,
    semNome: 'Sem nome',
    limitePadrao: LIMITE_PADRAO_CADASTROS,
    limiteMaximo: LIMITE_MAXIMO_CADASTROS,
    buscaObrigatoria: false,
  });
}

const FONTES = Object.freeze({
  grupo: departamento('grupo', 'idGrupo', 'Descricao'),
  setor: departamento('setor', 'idSetor', 'Descricao'),
  familia: departamento('familia', 'idFamilia', 'Descricao'),
  marca: departamento('marca', 'idMarca', 'descricao'),
  cliente: Object.freeze({
    tabela: 'clifor',
    chave: 'cod',
    descricao: 'nome',
    filtroFixo: 'clifor.tipo = 1',
    semNome: 'Sem nome',
    limitePadrao: LIMITE_PADRAO_CADASTROS,
    limiteMaximo: LIMITE_MAXIMO_CADASTROS,
    buscaObrigatoria: false,
  }),
  produto: Object.freeze({
    tabela: 'produto',
    chave: 'idProduto',
    descricao: 'descricao',
    filtroFixo: "produto.situacao = 'A'",
    semNome: 'Sem descrição',
    limitePadrao: LIMITE_PADRAO_PRODUTO,
    limiteMaximo: LIMITE_MAXIMO_PRODUTO,
    buscaObrigatoria: true,
  }),
});
const AGRUPADORES_COM_SELECAO = Object.freeze(Object.keys(FONTES));

function validarAgrupador(agrupador) {
  if (agrupador === 'fornecedor') throw new ErroValidacao(MENSAGEM_FORNECEDOR);
  if (typeof agrupador !== 'string' || !Object.prototype.hasOwnProperty.call(FONTES, agrupador)) {
    throw new ErroValidacao(MENSAGEM_AGRUPADOR);
  }
  return FONTES[agrupador];
}

// Devolve { texto, palavras } (texto já sem espaços nas pontas; palavras = partes separadas por whitespace, sem
// vazias) ou null se a busca não foi informada. Só aceita texto simples (busca repetida ou em formato de objeto
// na query string é 400).
function validarBusca(busca, fonte) {
  if (busca !== undefined && typeof busca !== 'string') {
    throw new ErroValidacao('Busca inválida: informe um único texto.');
  }
  const texto = typeof busca === 'string' ? busca.trim() : '';
  if (fonte.buscaObrigatoria && texto.length < BUSCA_MINIMA_PRODUTO) {
    throw new ErroValidacao(`Informe a busca com pelo menos ${BUSCA_MINIMA_PRODUTO} caracteres.`);
  }
  if (!texto) return null;
  if (texto.length > BUSCA_MAXIMA_CARACTERES) {
    throw new ErroValidacao(`Busca muito longa: use no máximo ${BUSCA_MAXIMA_CARACTERES} caracteres.`);
  }
  const palavras = texto.split(/\s+/).filter(Boolean);
  if (palavras.length > BUSCA_MAXIMA_PALAVRAS) {
    throw new ErroValidacao(`Busca com palavras demais: use no máximo ${BUSCA_MAXIMA_PALAVRAS} palavras.`);
  }
  return { texto, palavras };
}

function validarLimite(limite, fonte) {
  if (limite === undefined || limite === null || limite === '') return fonte.limitePadrao;
  const numero = typeof limite === 'number' ? limite : /^\d+$/.test(String(limite)) ? Number(limite) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > fonte.limiteMaximo) {
    throw new ErroValidacao(`Limite inválido: informe um inteiro entre 1 e ${fonte.limiteMaximo}.`);
  }
  return numero;
}

// Escapa os curingas do LIKE (a barra invertida é o escape padrão do MariaDB) para buscar o texto literal.
function escaparLike(texto) {
  return texto.replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

// Cláusula WHERE (fixa da fonte + busca) e parâmetros. Só placeholders `?` para valores do usuário.
function montarWhere(fonte, busca) {
  const condicoes = [];
  const params = [];
  if (fonte.filtroFixo) condicoes.push(fonte.filtroFixo);
  if (busca !== null) {
    // Um LIKE por palavra (AND): o nome contém todas, em qualquer ordem.
    busca.palavras.forEach((palavra) => {
      condicoes.push(`${fonte.tabela}.${fonte.descricao} LIKE ?`);
      params.push(`%${escaparLike(palavra)}%`);
    });
  }
  return { clause: condicoes.length ? `\nWHERE ${condicoes.join(' AND ')}` : '', params };
}

function montarSqlContagem(fonte, where) {
  return { sql: `SELECT COUNT(*) AS total\nFROM ${fonte.tabela}${where.clause}`, params: [...where.params] };
}

function montarSqlLista(fonte, where, limite) {
  const chave = `${fonte.tabela}.${fonte.chave}`;
  const nome = `${fonte.tabela}.${fonte.descricao}`;
  const sql = `SELECT ${chave} AS id,
  ${nome} AS nome
FROM ${fonte.tabela}${where.clause}
ORDER BY ${nome}, ${chave}
LIMIT ?`;
  return { sql, params: [...where.params, limite] };
}

async function executar(pool, consulta) {
  const [linhas] = await pool.execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params);
  return Array.isArray(linhas) ? linhas : [];
}

// Retorna { agrupador, busca?, limite, totalItens, itens: [{ id, nome }] }.
// Lança ErroValidacao (400) ou ErroInternoCurvaAbc (banco).
async function obterItensDimensao({ agrupador, busca, limite } = {}) {
  const fonte = validarAgrupador(agrupador);
  const buscaValida = validarBusca(busca, fonte);
  const limiteValido = validarLimite(limite, fonte);

  const where = montarWhere(fonte, buscaValida);
  const consultaContagem = montarSqlContagem(fonte, where);
  const consultaLista = montarSqlLista(fonte, where, limiteValido);

  let linhasTotal;
  let linhas;
  try {
    const pool = getPool();
    [linhasTotal, linhas] = await Promise.all([executar(pool, consultaContagem), executar(pool, consultaLista)]);
  } catch (erro) {
    console.error(
      `[curvaAbc] Falha ao listar os itens da dimensão (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoCurvaAbc();
  }

  const itens = linhas.map((linha) => ({
    id: Number(linha.id) || 0,
    nome: typeof linha.nome === 'string' && linha.nome.trim() ? linha.nome : fonte.semNome,
  }));
  const resposta = { agrupador };
  if (buscaValida !== null) resposta.busca = buscaValida.texto;
  const totalItens = linhasTotal.length ? Number(linhasTotal[0].total) || 0 : 0;
  return { ...resposta, limite: limiteValido, totalItens, itens };
}

module.exports = { obterItensDimensao, AGRUPADORES_COM_SELECAO };
