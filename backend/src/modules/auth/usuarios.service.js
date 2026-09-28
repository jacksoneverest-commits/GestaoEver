// Cadastro de usuário e troca de senha (PLAN.md, Task 3.3).
// Reaproveita hashSenha/verificarSenha (scrypt) de auth.crypto.js — nunca reimplementa hashing.
// Sempre usa o pool de db/connection.js; nunca abre conexão própria.

const { getPool } = require('../../db/connection');
const { hashSenha, verificarSenha } = require('./auth.crypto');

class ErroInternoUsuarios extends Error {
  constructor() {
    super('Erro interno ao processar usuários.');
    this.name = 'ErroInternoUsuarios';
  }
}

class ErroUsuarioDuplicado extends Error {
  constructor() {
    super('Já existe um usuário com esse login.');
    this.name = 'ErroUsuarioDuplicado';
  }
}

class ErroUsuarioNaoEncontrado extends Error {
  constructor() {
    super('Usuário não encontrado.');
    this.name = 'ErroUsuarioNaoEncontrado';
  }
}

class ErroSenhaAtualIncorreta extends Error {
  constructor() {
    super('Senha atual incorreta.');
    this.name = 'ErroSenhaAtualIncorreta';
  }
}

function codigoDoErro(erro) {
  return erro && erro.code ? erro.code : 'desconhecido';
}

// GET /api/auth/usuarios — nunca inclui senha_hash.
async function listarUsuarios() {
  try {
    const [linhas] = await getPool().execute(
      'SELECT id, usuario, nome, perfil, ativo FROM usuarios_gestao ORDER BY nome'
    );
    return (linhas || []).map((linha) => ({
      id: Number(linha.id),
      usuario: linha.usuario,
      nome: linha.nome,
      perfil: linha.perfil,
      ativo: Number(linha.ativo),
    }));
  } catch (erro) {
    console.error(`[usuarios] Falha ao listar usuários (código: ${codigoDoErro(erro)}).`);
    throw new ErroInternoUsuarios();
  }
}

// POST /api/auth/usuarios — hasheia a senha antes de gravar; nunca grava texto puro.
// `usuario`, `nome`, `senha` e `perfil` já validados/normalizados pelo controller.
async function criarUsuario({ usuario, nome, senha, perfil }) {
  const senhaHash = await hashSenha(senha);
  try {
    const [resultado] = await getPool().execute(
      'INSERT INTO usuarios_gestao (usuario, nome, senha_hash, perfil) VALUES (?, ?, ?, ?)',
      [usuario, nome, senhaHash, perfil]
    );
    return { id: Number(resultado.insertId), usuario, nome, perfil, ativo: 1 };
  } catch (erro) {
    if (erro && (erro.code === 'ER_DUP_ENTRY' || erro.errno === 1062)) {
      throw new ErroUsuarioDuplicado();
    }
    console.error(`[usuarios] Falha ao criar usuário (código: ${codigoDoErro(erro)}).`);
    throw new ErroInternoUsuarios();
  }
}

// PUT /api/auth/usuarios/:id/senha — reseta a senha de qualquer usuário pelo id, sem exigir a senha atual
// (decisão do usuário: sem diferenciação de permissão nesta fase).
async function resetarSenha(id, senhaNova) {
  const senhaHash = await hashSenha(senhaNova);
  try {
    const [resultado] = await getPool().execute('UPDATE usuarios_gestao SET senha_hash = ? WHERE id = ?', [
      senhaHash,
      id,
    ]);
    if (!resultado || resultado.affectedRows === 0) {
      throw new ErroUsuarioNaoEncontrado();
    }
  } catch (erro) {
    if (erro instanceof ErroUsuarioNaoEncontrado) throw erro;
    console.error(`[usuarios] Falha ao resetar senha (código: ${codigoDoErro(erro)}).`);
    throw new ErroInternoUsuarios();
  }
}

// PUT /api/auth/senha — troca a própria senha; confere senhaAtual antes de gravar.
// Se não conferir, lança ErroSenhaAtualIncorreta e NÃO altera senha_hash.
async function trocarPropriaSenha(id, senhaAtual, senhaNova) {
  try {
    const [linhas] = await getPool().execute('SELECT senha_hash FROM usuarios_gestao WHERE id = ? LIMIT 1', [id]);
    const registro = linhas && linhas[0];
    if (!registro) {
      throw new ErroUsuarioNaoEncontrado();
    }

    const senhaConfere = await verificarSenha(senhaAtual, registro.senha_hash);
    if (!senhaConfere) {
      throw new ErroSenhaAtualIncorreta();
    }

    const senhaHash = await hashSenha(senhaNova);
    await getPool().execute('UPDATE usuarios_gestao SET senha_hash = ? WHERE id = ?', [senhaHash, id]);
  } catch (erro) {
    if (erro instanceof ErroUsuarioNaoEncontrado || erro instanceof ErroSenhaAtualIncorreta) throw erro;
    console.error(`[usuarios] Falha ao trocar a própria senha (código: ${codigoDoErro(erro)}).`);
    throw new ErroInternoUsuarios();
  }
}

module.exports = {
  listarUsuarios,
  criarUsuario,
  resetarSenha,
  trocarPropriaSenha,
  ErroInternoUsuarios,
  ErroUsuarioDuplicado,
  ErroUsuarioNaoEncontrado,
  ErroSenhaAtualIncorreta,
};
