const { iniciarAtualizacao, obterStatus } = require('./cache.service');
const { logarErroInesperado } = require('../../shared/logErroInesperado');

// POST /api/cache/atualizar -> 202 { situacao, iniciadoEm, finalizadoEm, ultimaAtualizacao }
// Dispara a rotina diária de agregação em segundo plano; se já houver uma rodando, devolve o status dela.
function atualizar(req, res) {
  try {
    return res.status(202).json(iniciarAtualizacao());
  } catch (erro) {
    logarErroInesperado('cache', erro);
    return res.status(500).json({ erro: 'Erro interno.' });
  }
}

// GET /api/cache/status -> 200 { situacao: 'ocioso'|'rodando'|'ok'|'falha', iniciadoEm, finalizadoEm, ultimaAtualizacao }
function status(req, res) {
  try {
    return res.status(200).json(obterStatus());
  } catch (erro) {
    logarErroInesperado('cache', erro);
    return res.status(500).json({ erro: 'Erro interno.' });
  }
}

module.exports = { atualizar, status };
