const { autenticarUsuario } = require('./auth.service');

async function login(req, res) {
  const { usuario, senha } = req.body || {};

  if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario.trim() || !senha) {
    return res.status(400).json({ erro: 'Informe usuário e senha.' });
  }

  try {
    const resultado = await autenticarUsuario(usuario.trim(), senha);
    if (!resultado) {
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }
    return res.status(200).json({ token: resultado.token });
  } catch (erro) {
    return res.status(500).json({ erro: 'Erro interno.' });
  }
}

module.exports = { login };
