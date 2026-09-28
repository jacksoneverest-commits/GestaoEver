const { getPool } = require('../../db/connection');
const { hashSenha, verificarSenha } = require('./auth.crypto');
const { gerarToken, ErroConfiguracaoAuth } = require('./auth.token');

class ErroInternoAuth extends Error {
  constructor() {
    super('Erro interno de autenticação.');
    this.name = 'ErroInternoAuth';
  }
}

// Hash descartável usado quando o usuário não existe, para que o tempo de resposta
// não revele a existência do usuário (a verificação scrypt sempre é executada).
let hashFalso = null;
function obterHashFalso() {
  if (!hashFalso) {
    // Se a geração falhar, limpa o cache para que a próxima tentativa refaça o hash.
    hashFalso = hashSenha('senha-descartavel-para-timing').catch((erro) => {
      hashFalso = null;
      throw erro;
    });
  }
  return hashFalso;
}

// Retorna { token } com credenciais válidas de usuário ativo; retorna null em qualquer
// outro caso (inexistente, senha errada, inativo) — sem distinguir o motivo.
// Erros de banco/configuração viram ErroInternoAuth (detalhes só no log interno).
async function autenticarUsuario(usuario, senha) {
  try {
    const [linhas] = await getPool().execute(
      'SELECT id, usuario, nome, senha_hash, perfil, ativo FROM usuarios_gestao WHERE usuario = ? LIMIT 1',
      [usuario]
    );
    const registro = linhas && linhas[0];

    const hash = registro ? registro.senha_hash : await obterHashFalso();
    const senhaConfere = await verificarSenha(senha, hash);

    if (!registro || !senhaConfere || Number(registro.ativo) !== 1) {
      return null;
    }
    return { token: gerarToken({ id: registro.id, usuario: registro.usuario, perfil: registro.perfil }) };
  } catch (erro) {
    if (erro instanceof ErroConfiguracaoAuth) {
      console.error(`[auth] ${erro.message}`);
    } else {
      console.error(`[auth] Falha ao autenticar (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`);
    }
    throw new ErroInternoAuth();
  }
}

module.exports = { autenticarUsuario, ErroInternoAuth, hashSenha, verificarSenha };
