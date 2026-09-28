// Vendas por departamento (Task 5.3 do PLAN.md).
//
// Schema real do ERP usado aqui (verificado em modo somente leitura):
//   vendacupom.idcupom (varchar 20) = vendaitem.idcupom (varchar 20)   -- mesmo tipo/collation
//   vendaitem.produto (int)         = produto.idProduto
//   produto.grupo / setor / familia -> grupo.idGrupo / setor.idSetor / familia.idFamilia
//   grupo/setor/familia.Descricao   -- nome do departamento
//   vendaitem.vtotal  = valor total do item (qt * punitario + valorda), DECIMAL(19,4)
//   vendaitem.qt      = quantidade vendida (DOUBLE; fracionária em itens pesáveis)
//   vendaitem NÃO tem flag/status de item cancelado: itens cancelados ficam em
//   `vendaitemcanc` (e não aparecem em vendaitem), então não há o que excluir.
//
// `vendacupom.valortotal` é por cupom e não pode ser somado por departamento
// (um cupom mistura departamentos) — o valor vem de `vendaitem.vtotal`.
//
// Contrato:
//   sem `id` -> uma linha por departamento do `nivel` (visão geral do nível);
//   com `id` -> filtra os produtos do departamento (buildDepartmentFilter) e
//               devolve o detalhamento por PRODUTO, top `limite` (padrão 50)
//               por faturamento. `total` é o faturamento de TODO o escopo
//               (não só do top N), e participacaoPercentual é sobre esse total.
// Departamentos órfãos (produto sem grupo/setor/família correspondente, ou item
// cujo produto foi removido) entram como { id: null, nome: 'Sem departamento' }.

const { getPool } = require('../../db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../../shared/timeoutConsulta');
const { buildPeriodFilter, buildDepartmentFilter, ErroValidacao } = require('../../shared/queryFilters');

const NOME_SEM_DEPARTAMENTO = 'Sem departamento';
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;

// Whitelist: nivel -> tabela de descrição e colunas. Nunca interpolar o nivel recebido.
const DEPARTAMENTOS = Object.freeze({
  grupo: Object.freeze({ tabela: 'grupo', chave: 'idGrupo', colunaProduto: 'grupo' }),
  setor: Object.freeze({ tabela: 'setor', chave: 'idSetor', colunaProduto: 'setor' }),
  familia: Object.freeze({ tabela: 'familia', chave: 'idFamilia', colunaProduto: 'familia' }),
});
const NIVEIS_VALIDOS = Object.freeze(Object.keys(DEPARTAMENTOS));

class ErroInternoVendasDepartamento extends Error {
  constructor() {
    super('Erro interno ao consultar vendas por departamento.');
    this.name = 'ErroInternoVendasDepartamento';
  }
}

function arredondar(valor, casas) {
  const fator = 10 ** casas;
  return Math.round((Number(valor) + Number.EPSILON) * fator) / fator;
}

function validarNivel(nivel) {
  if (typeof nivel !== 'string' || !Object.prototype.hasOwnProperty.call(DEPARTAMENTOS, nivel)) {
    throw new ErroValidacao('Nível de departamento inválido: use grupo, setor ou familia.');
  }
  return DEPARTAMENTOS[nivel];
}

function validarLimite(limite) {
  if (limite === undefined || limite === null || limite === '') return LIMITE_PADRAO;
  const numero = typeof limite === 'number' ? limite : /^\d+$/.test(String(limite)) ? Number(limite) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > LIMITE_MAXIMO) {
    throw new ErroValidacao(`Limite inválido: informe um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
  }
  return numero;
}

// SELECT STRAIGHT_JOIN fixa a ordem do FROM (cupons -> itens -> produto): o período em
// vendacupom (índice em `data`) sempre conduz a consulta. Sem isso, no detalhamento por
// departamento o otimizador do MariaDB parte de produto.<nivel> e varre todo o histórico
// de vendaitem desses produtos (2-9 s em 30 dias, crescendo com o tempo).
const CORPO_VENDAS = `FROM vendacupom
${JOIN_VENDA_VALIDA}
INNER JOIN vendaitem ON vendaitem.idcupom = vendacupom.idcupom`;

// Visão geral do nível: uma linha por grupo/setor/família (LEFT JOIN para órfãos).
function montarSqlPorNivel(depto, periodo) {
  const sql = `SELECT STRAIGHT_JOIN produto.${depto.colunaProduto} AS id,
  COALESCE(${depto.tabela}.Descricao, '${NOME_SEM_DEPARTAMENTO}') AS nome,
  SUM(vendaitem.vtotal) AS faturamento,
  SUM(vendaitem.qt) AS quantidade
${CORPO_VENDAS}
LEFT JOIN produto ON produto.idProduto = vendaitem.produto
LEFT JOIN ${depto.tabela} ON ${depto.tabela}.${depto.chave} = produto.${depto.colunaProduto}
WHERE ${WHERE_VENDA_VALIDA} AND ${periodo.clause}
GROUP BY produto.${depto.colunaProduto}, ${depto.tabela}.Descricao
ORDER BY faturamento DESC`;
  return { sql, params: [...periodo.params] };
}

// Detalhamento de um departamento: produtos do grupo/setor/família, top `limite`.
function montarSqlPorProduto(periodo, departamento, limite) {
  const sql = `SELECT STRAIGHT_JOIN produto.idProduto AS id,
  COALESCE(produto.descricao, 'Sem descrição') AS nome,
  SUM(vendaitem.vtotal) AS faturamento,
  SUM(vendaitem.qt) AS quantidade
${CORPO_VENDAS}
INNER JOIN produto ON produto.idProduto = vendaitem.produto
WHERE ${WHERE_VENDA_VALIDA} AND ${periodo.clause} AND ${departamento.clause}
GROUP BY produto.idProduto, produto.descricao
ORDER BY faturamento DESC
LIMIT ?`;
  return { sql, params: [...periodo.params, ...departamento.params, limite] };
}

// Faturamento total do departamento inteiro (sem o corte do top N). O MariaDB do ERP
// é 10.1 (sem window functions), então o total vai numa consulta separada.
function montarSqlTotalDepartamento(periodo, departamento) {
  const sql = `SELECT STRAIGHT_JOIN SUM(vendaitem.vtotal) AS total
${CORPO_VENDAS}
INNER JOIN produto ON produto.idProduto = vendaitem.produto
WHERE ${WHERE_VENDA_VALIDA} AND ${periodo.clause} AND ${departamento.clause}`;
  return { sql, params: [...periodo.params, ...departamento.params] };
}

// Retorna { nivel, id, itens: [{ id, nome, faturamento, quantidade, participacaoPercentual }], total }.
// Lança ErroValidacao (400) para entrada inválida; qualquer falha de banco vira
// ErroInternoVendasDepartamento (detalhes só no log interno, sem dados sensíveis).
async function obterVendasPorDepartamento({ inicio, fim, nivel, id, limite } = {}) {
  const depto = validarNivel(nivel);
  const temId = id !== undefined && id !== null && id !== '';
  const periodo = buildPeriodFilter(inicio, fim);

  let consulta;
  let consultaTotal = null;
  let idNumerico = null;
  if (temId) {
    const departamento = buildDepartmentFilter({ nivel, id });
    idNumerico = departamento.params[0];
    consulta = montarSqlPorProduto(periodo, departamento, validarLimite(limite));
    consultaTotal = montarSqlTotalDepartamento(periodo, departamento);
  } else {
    consulta = montarSqlPorNivel(depto, periodo);
  }

  try {
    const pool = getPool();
    const [[linhas], resultadoTotal] = await Promise.all([
      pool.execute({ sql: consulta.sql, timeout: TIMEOUT_CONSULTA_MS }, consulta.params),
      consultaTotal
        ? pool.execute({ sql: consultaTotal.sql, timeout: TIMEOUT_CONSULTA_MS }, consultaTotal.params)
        : null,
    ]);
    const registros = Array.isArray(linhas) ? linhas : [];
    // sem id: total = soma de todas as linhas (nenhum corte); com id: total do departamento
    const total = consultaTotal
      ? Number(resultadoTotal[0][0] && resultadoTotal[0][0].total) || 0
      : registros.reduce((soma, linha) => soma + Number(linha.faturamento), 0);

    const itens = registros.map((linha) => {
      const faturamento = Number(linha.faturamento);
      return {
        id: linha.id === null || linha.id === undefined ? null : Number(linha.id),
        nome: linha.nome,
        faturamento: arredondar(faturamento, 2),
        quantidade: arredondar(linha.quantidade, 3),
        participacaoPercentual: total > 0 ? arredondar((faturamento / total) * 100, 2) : 0,
      };
    });

    return { nivel, id: idNumerico, itens, total: arredondar(total, 2) };
  } catch (erro) {
    console.error(
      `[vendas] Falha ao consultar vendas por departamento (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`
    );
    throw new ErroInternoVendasDepartamento();
  }
}

module.exports = {
  obterVendasPorDepartamento,
  NIVEIS_VALIDOS,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  ErroInternoVendasDepartamento,
};
