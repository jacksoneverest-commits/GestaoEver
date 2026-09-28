// Construtores de filtros SQL compartilhados por todos os módulos de dados.
// Funções puras: não acessam o banco. Retornam { clause, params } — a cláusula
// usa apenas placeholders `?` e os valores vão em `params`, para o service
// compor com `getPool().execute(sql, params)` (nunca concatenar valores).
//
// Schema real do MariaDB do ERP (verificado em modo somente leitura):
//   vendacupom.data      DATETIME — data da venda. Na prática guarda só o dia
//                        (00:00:00); a hora fica em vendacupom.hora (VARCHAR).
//                        É a coluna padrão do filtro de período.
//   produto.grupo   INT  -> grupo.idGrupo
//   produto.setor   INT  -> setor.idSetor
//   produto.familia INT  -> familia.idFamilia
//   Os três vínculos são colunas diretas e independentes em `produto` (não há
//   hierarquia grupo > setor > família garantida pelo schema); cada nível é um
//   eixo de navegação próprio, como pede o SPEC.
//
// Datas: entrada em ISO `YYYY-MM-DD`, tratadas como UTC. O intervalo é
// inclusivo nas duas pontas, mas gerado como semi-aberto
// (`>= inicio 00:00:00 AND < fim+1 00:00:00`), o que funciona com DATETIME.

class ErroValidacao extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroValidacao';
    this.status = 400; // o controller responde 400 { erro: err.message }
  }
}

const COLUNA_DATA_PADRAO = 'vendacupom.data';
const ALIAS_PRODUTO_PADRAO = 'produto';

// Whitelist: nivel recebido -> coluna fixa de `produto`. Nunca interpolar o nivel.
const COLUNA_POR_NIVEL = Object.freeze({
  grupo: 'grupo',
  setor: 'setor',
  familia: 'familia',
});

const REGEX_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const REGEX_IDENTIFICADOR = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REGEX_COLUNA = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

// Converte 'YYYY-MM-DD' em timestamp UTC (ms); valida formato e calendário real.
function parseDataIso(valor, rotulo) {
  const partes = typeof valor === 'string' ? REGEX_DATA_ISO.exec(valor) : null;
  if (!partes) {
    throw new ErroValidacao(`${rotulo} inválida: use o formato AAAA-MM-DD.`);
  }
  const [ano, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const ms = Date.UTC(ano, mes - 1, dia);
  const data = new Date(ms);
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    throw new ErroValidacao(`${rotulo} inválida: a data ${valor} não existe no calendário.`);
  }
  return ms;
}

function formatarInicioDoDia(ms) {
  return `${new Date(ms).toISOString().slice(0, 10)} 00:00:00`;
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

// Limite do intervalo (dias inclusivos): períodos de anos disparam varreduras pesadas
// em vendacupom/vendaitem no banco de produção do ERP.
const DIAS_MAXIMOS_PERIODO = 366;

function buildPeriodFilter(dataInicio, dataFim, coluna = COLUNA_DATA_PADRAO) {
  if (typeof coluna !== 'string' || !REGEX_COLUNA.test(coluna)) {
    throw new ErroValidacao('Coluna de data inválida para o filtro de período.');
  }
  const inicioMs = parseDataIso(dataInicio, 'Data inicial');
  const fimMs = parseDataIso(dataFim, 'Data final');
  if (fimMs < inicioMs) {
    throw new ErroValidacao('A data final não pode ser anterior à data inicial.');
  }
  const diasNoPeriodo = Math.round((fimMs - inicioMs) / UM_DIA_MS) + 1;
  if (diasNoPeriodo > DIAS_MAXIMOS_PERIODO) {
    throw new ErroValidacao(`O período máximo permitido é de ${DIAS_MAXIMOS_PERIODO} dias.`);
  }
  return {
    clause: `${coluna} >= ? AND ${coluna} < ?`,
    params: [formatarInicioDoDia(inicioMs), formatarInicioDoDia(fimMs + UM_DIA_MS)],
  };
}

function buildDepartmentFilter({ nivel, id } = {}, aliasProduto = ALIAS_PRODUTO_PADRAO) {
  const colunaNivel = Object.prototype.hasOwnProperty.call(COLUNA_POR_NIVEL, nivel)
    ? COLUNA_POR_NIVEL[nivel]
    : null;
  if (!colunaNivel) {
    throw new ErroValidacao('Nível de departamento inválido: use grupo, setor ou familia.');
  }
  if (typeof aliasProduto !== 'string' || !REGEX_IDENTIFICADOR.test(aliasProduto)) {
    throw new ErroValidacao('Alias de tabela inválido para o filtro de departamento.');
  }
  const idNumerico =
    typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(idNumerico) || idNumerico <= 0) {
    throw new ErroValidacao('Identificador de departamento inválido: informe um número inteiro positivo.');
  }
  return {
    clause: `${aliasProduto}.${colunaNivel} = ?`,
    params: [idNumerico],
  };
}

module.exports = { buildPeriodFilter, buildDepartmentFilter, ErroValidacao, DIAS_MAXIMOS_PERIODO };
