// Grava um AUTH_SECRET aleatório (96 hex) no arquivo informado. Usado pelo instalador.
// Uso: node scripts/gerar-segredo.js <arquivoDeSaida>
const fs = require('fs');
const crypto = require('crypto');

const destino = process.argv[2];
if (!destino) {
  console.error('Uso: node scripts/gerar-segredo.js <arquivoDeSaida>');
  process.exit(1);
}
fs.writeFileSync(destino, crypto.randomBytes(48).toString('hex'));
