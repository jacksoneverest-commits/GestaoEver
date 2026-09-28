// Timeout (ms) aplicado às consultas de vendas via a opção `timeout` do mysql2:
//   pool.execute({ sql, timeout: TIMEOUT_CONSULTA_MS }, valores)
// Fica fora de db/connection.js para poder ser importado mesmo quando esse módulo é mockado.
const TIMEOUT_CONSULTA_MS = 30000;

module.exports = { TIMEOUT_CONSULTA_MS };
