const crypto = require('crypto');

const VALIDADE_SEGUNDOS = 8 * 60 * 60; // 8h
const TAMANHO_MINIMO_SEGREDO = 32;

class ErroConfiguracaoAuth extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroConfiguracaoAuth';
  }
}

function lerSegredo() {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) {
    throw new ErroConfiguracaoAuth(
      'Configuração de autenticação incompleta: defina AUTH_SECRET no arquivo .env.'
    );
  }
  if (segredo.length < TAMANHO_MINIMO_SEGREDO) {
    throw new ErroConfiguracaoAuth(
      `Configuração de autenticação insegura: AUTH_SECRET deve ter no mínimo ${TAMANHO_MINIMO_SEGREDO} caracteres.`
    );
  }
  return segredo;
}

function assinar(payloadB64, segredo) {
  return crypto.createHmac('sha256', segredo).update(payloadB64).digest('base64url');
}

// Token: base64url(payload JSON) + '.' + base64url(HMAC-SHA256). `exp` em epoch segundos (UTC).
function gerarToken({ id, usuario, perfil }) {
  const segredo = lerSegredo();
  const exp = Math.floor(Date.now() / 1000) + VALIDADE_SEGUNDOS;
  const payloadB64 = Buffer.from(JSON.stringify({ sub: id, usuario, perfil, exp })).toString(
    'base64url'
  );
  return `${payloadB64}.${assinar(payloadB64, segredo)}`;
}

// Retorna o payload se o token for íntegro e não expirado; caso contrário null.
// Lança ErroConfiguracaoAuth se AUTH_SECRET estiver ausente.
function verificarToken(token) {
  const segredo = lerSegredo();
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;

  const [payloadB64, assinatura] = partes;
  const esperada = Buffer.from(assinar(payloadB64, segredo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (erro) {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { gerarToken, verificarToken, ErroConfiguracaoAuth, VALIDADE_SEGUNDOS };
