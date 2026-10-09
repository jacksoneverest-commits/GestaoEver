// Testa a conexão com o MariaDB usando o backend/.env. Exit code 0 = OK. Usado pelo instalador.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { testConnection, getPool } = require('../src/db/connection');

testConnection()
  .then(() => {
    console.log('Conexão OK');
    return getPool().end();
  })
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
