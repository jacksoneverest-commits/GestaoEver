const mysql = require('mysql2/promise');

const VARIAVEIS_OBRIGATORIAS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

class ErroConexaoBanco extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroConexaoBanco';
  }
}

let pool = null;

function lerConfiguracao() {
  const ausentes = VARIAVEIS_OBRIGATORIAS.filter((nome) => !process.env[nome]);
  if (ausentes.length > 0) {
    throw new ErroConexaoBanco(
      `Configuração do banco de dados incompleta: defina ${ausentes.join(', ')} no arquivo .env.`
    );
  }
  return {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

// Cria a pool sob demanda (lazy): importar este módulo nunca abre conexão.
function getPool() {
  if (!pool) {
    const config = lerConfiguracao();
    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 10,
      timezone: 'Z', // datas tratadas como UTC
    });
  }
  return pool;
}

// Valida a conexão com SELECT 1. Erros do driver são logados sem dados
// sensíveis e substituídos por uma mensagem genérica.
async function testConnection() {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch (erro) {
    if (erro instanceof ErroConexaoBanco) {
      throw erro;
    }
    console.error(`[db] Falha ao conectar ao banco de dados (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`);
    throw new ErroConexaoBanco(
      'Não foi possível conectar ao banco de dados. Verifique as credenciais e a disponibilidade do servidor.'
    );
  }
}

module.exports = { getPool, testConnection, ErroConexaoBanco };
