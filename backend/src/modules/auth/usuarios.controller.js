// Controller: só valida input, chama o service e responde HTTP — nenhuma query SQL aqui.
const {
  listarUsuarios,
  criarUsuario,
  resetarSenha,
  trocarPropriaSenha,
  ErroInternoUsuarios,
  ErroUsuarioDuplicado,
  ErroUsuarioNaoEncontrado,
  ErroSenhaAtualIncorreta,
} = require('./usuarios.service');
const { PERFIS_VALIDOS } = require('../../db/scripts/criar-usuario');
const { logarErroInesperado } = require('../../shared/logErroInesperado');

const TAMANHO_MINIMO_SENHA = 8;
// Mesmos limites das colunas `usuario VARCHAR(50)` e `nome VARCHAR(100)` da migration 002_create_usuarios_gestao.sql.
const TAMANHO_MAXIMO_USUARIO = 50;
const TAMANHO_MAXIMO_NOME = 100;
const MENSAGEM_CAMPOS_CRIAR = `Informe usuário (até ${TAMANHO_MAXIMO_USUARIO} caracteres), nome (até ${TAMANHO_MAXIMO_NOME} caracteres), senha (mín. ${TAMANHO_MINIMO_SENHA} caracteres) e perfil (${PERFIS_VALIDOS.join(', ')}).`;
const MENSAGEM_SENHA_NOVA = `Informe senhaNova com ao menos ${TAMANHO_MINIMO_SENHA} caracteres.`;

function respostaErroInterno(res, erro, jaLogadoPeloService) {
  if (!jaLogadoPeloService) logarErroInesperado('usuarios', erro);
  return res.status(500).json({ erro: 'Erro interno.' });
}

function textoValido(valor) {
  return typeof valor === 'string' && valor.trim().length > 0;
}

function idValido(valorBruto) {
  const id = Number(valorBruto);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/auth/usuarios — lista id, usuario, nome, perfil, ativo (nunca senha_hash).
async function listar(req, res) {
  try {
    const usuarios = await listarUsuarios();
    return res.status(200).json({ usuarios });
  } catch (erro) {
    return respostaErroInterno(res, erro, erro instanceof ErroInternoUsuarios);
  }
}

// POST /api/auth/usuarios — { usuario, nome, senha, perfil }.
async function criar(req, res) {
  const { usuario, nome, senha, perfil } = req.body || {};

  if (
    !textoValido(usuario) ||
    usuario.trim().length > TAMANHO_MAXIMO_USUARIO ||
    !textoValido(nome) ||
    nome.trim().length > TAMANHO_MAXIMO_NOME ||
    typeof senha !== 'string' ||
    senha.length < TAMANHO_MINIMO_SENHA ||
    typeof perfil !== 'string' ||
    !PERFIS_VALIDOS.includes(perfil)
  ) {
    return res.status(400).json({ erro: MENSAGEM_CAMPOS_CRIAR });
  }

  try {
    const criado = await criarUsuario({ usuario: usuario.trim(), nome: nome.trim(), senha, perfil });
    return res.status(201).json(criado);
  } catch (erro) {
    if (erro instanceof ErroUsuarioDuplicado) {
      return res.status(400).json({ erro: erro.message });
    }
    return respostaErroInterno(res, erro, erro instanceof ErroInternoUsuarios);
  }
}

// PUT /api/auth/usuarios/:id/senha — { senhaNova }; reseta a senha de qualquer usuário, sem exigir a senha atual.
async function resetar(req, res) {
  const id = idValido(req.params.id);
  const { senhaNova } = req.body || {};

  if (!id) {
    return res.status(400).json({ erro: 'Id de usuário inválido.' });
  }
  if (typeof senhaNova !== 'string' || senhaNova.length < TAMANHO_MINIMO_SENHA) {
    return res.status(400).json({ erro: MENSAGEM_SENHA_NOVA });
  }

  try {
    await resetarSenha(id, senhaNova);
    return res.status(200).json({ ok: true });
  } catch (erro) {
    if (erro instanceof ErroUsuarioNaoEncontrado) {
      return res.status(404).json({ erro: erro.message });
    }
    return respostaErroInterno(res, erro, erro instanceof ErroInternoUsuarios);
  }
}

// PUT /api/auth/senha — { senhaAtual, senhaNova }; troca a PRÓPRIA senha (id vem do token, nunca de um parâmetro).
async function trocarSenha(req, res) {
  const { senhaAtual, senhaNova } = req.body || {};

  if (typeof senhaAtual !== 'string' || !senhaAtual) {
    return res.status(400).json({ erro: 'Informe senhaAtual e senhaNova.' });
  }
  if (typeof senhaNova !== 'string' || senhaNova.length < TAMANHO_MINIMO_SENHA) {
    return res.status(400).json({ erro: MENSAGEM_SENHA_NOVA });
  }

  try {
    await trocarPropriaSenha(req.usuario.sub, senhaAtual, senhaNova);
    return res.status(200).json({ ok: true });
  } catch (erro) {
    if (erro instanceof ErroSenhaAtualIncorreta) {
      // 400 (não 401): a sessão do token continua válida, só o campo senhaAtual enviado não confere.
      // Usar 401 aqui faria o apiClient do frontend encerrar a sessão a cada tentativa errada (ele
      // trata qualquer 401 como token inválido/expirado e desloga).
      return res.status(400).json({ erro: erro.message });
    }
    if (erro instanceof ErroUsuarioNaoEncontrado) {
      return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
    }
    return respostaErroInterno(res, erro, erro instanceof ErroInternoUsuarios);
  }
}

module.exports = { listar, criar, resetar, trocarSenha };
