// Utilitários de datas e de argumentos compartilhados pelos jobs de cache que processam
// "por dia" (usado por vendasProdutoCache.job.js, Task 7.4). São o mesmo comportamento já
// validado em vendasPeriodoCache.job.js (Task 5.5), que mantém as suas cópias privadas.
//
// Datas ISO 'YYYY-MM-DD'; toda a aritmética é em UTC, sem depender do fuso do servidor.
const { buildPeriodFilter, ErroValidacao } = require('../shared/queryFilters');

const UM_DIA_MS = 24 * 60 * 60 * 1000;

function paraMs(dataIso) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

function paraIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function somarDias(dataIso, dias) {
  return paraIso(paraMs(dataIso) + dias * UM_DIA_MS);
}

// Dia do calendário local do servidor (dia de negócio do ERP, Brasil), em ISO.
function hojeLocalIso(agora = new Date()) {
  const dois = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

// Valida formato e calendário reutilizando o buildPeriodFilter (fonte única da regra de data).
function validarDia(valor, rotulo) {
  try {
    buildPeriodFilter(valor, valor);
  } catch (erro) {
    if (erro instanceof ErroValidacao) {
      throw new ErroValidacao(erro.message.replace(/^Data (inicial|final)/, rotulo));
    }
    throw erro;
  }
}

// Lista os dias ISO de [inicio, fim], inclusivo.
function listarDias(inicio, fim) {
  const dias = [];
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
    dias.push(dia);
  }
  return dias;
}

// Agrupa dias ordenados em trechos contíguos com no máximo `maximo` dias.
function agruparEmTrechos(diasOrdenados, maximo) {
  const trechos = [];
  let atual = null;
  for (const dia of diasOrdenados) {
    if (atual && dia === somarDias(atual.fim, 1) && atual.dias < maximo) {
      atual.fim = dia;
      atual.dias += 1;
    } else {
      atual = { inicio: dia, fim: dia, dias: 1 };
      trechos.push(atual);
    }
  }
  return trechos;
}

// Aceita apenas `--desde AAAA-MM-DD` / `--desde=AAAA-MM-DD`. O formato da data é validado
// pelo job. `uso` é a linha de ajuda anexada às mensagens de erro.
function lerArgumentosDesde(argv, uso) {
  const opcoes = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--desde') {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith('--')) {
        throw new ErroValidacao(`O argumento --desde exige uma data AAAA-MM-DD. ${uso}`);
      }
      opcoes.desde = valor;
      i += 1;
    } else if (arg.startsWith('--desde=')) {
      opcoes.desde = arg.slice('--desde='.length);
    } else {
      throw new ErroValidacao(`Argumento desconhecido: ${arg}. ${uso}`);
    }
  }
  return opcoes;
}

module.exports = {
  UM_DIA_MS,
  paraMs,
  paraIso,
  somarDias,
  hojeLocalIso,
  validarDia,
  listarDias,
  agruparEmTrechos,
  lerArgumentosDesde,
};
