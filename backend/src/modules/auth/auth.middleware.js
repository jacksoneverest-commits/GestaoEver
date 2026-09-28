const { verificarToken } = require('./auth.token');

// Protege rotas: exige `Authorization: Bearer <token>` válido e não expirado.
// Preenche req.usuario com o payload do token. Aplicado em app.js nas rotas de dados (ex.: /api/vendas).
function autenticar(req, res, next) {
  const cabecalho = req.headers.authorization || '';
  const [esquema, token] = cabecalho.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Autenticação necessária.' });
  }

  let payload;
  try {
    payload = verificarToken(token);
  } catch (erro) {
    console.error(`[auth] Falha ao verificar token: ${erro.message}`);
    return res.status(500).json({ erro: 'Erro interno.' });
  }

  if (!payload) {
    return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
  }

  req.usuario = payload;
  return next();
}

module.exports = { autenticar };
