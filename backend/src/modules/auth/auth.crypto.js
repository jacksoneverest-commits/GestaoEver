const crypto = require('crypto');

const PREFIXO = 'scrypt';
const TAMANHO_SALT = 16;
const TAMANHO_HASH = 64;

function derivarChave(senha, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(senha, salt, TAMANHO_HASH, (erro, chave) => {
      if (erro) reject(erro);
      else resolve(chave);
    });
  });
}

// Formato armazenado: scrypt$<saltHex>$<hashHex>
async function hashSenha(senha) {
  const salt = crypto.randomBytes(TAMANHO_SALT);
  const chave = await derivarChave(String(senha), salt);
  return `${PREFIXO}$${salt.toString('hex')}$${chave.toString('hex')}`;
}

async function verificarSenha(senha, hashArmazenado) {
  if (typeof senha !== 'string' || typeof hashArmazenado !== 'string') return false;
  const partes = hashArmazenado.split('$');
  if (partes.length !== 3 || partes[0] !== PREFIXO) return false;
  if (!/^[0-9a-f]+$/i.test(partes[1]) || !/^[0-9a-f]+$/i.test(partes[2])) return false;

  const salt = Buffer.from(partes[1], 'hex');
  const esperado = Buffer.from(partes[2], 'hex');
  if (salt.length === 0 || esperado.length !== TAMANHO_HASH) return false;

  const calculado = await derivarChave(senha, salt);
  return crypto.timingSafeEqual(calculado, esperado);
}

module.exports = { hashSenha, verificarSenha };
