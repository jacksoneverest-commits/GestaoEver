const { obterVendasPorDepartamento, NIVEIS_VALIDOS } = require('./vendasDepartamento.service');
const { ErroValidacao } = require('../../shared/queryFilters');

// GET /api/vendas/por-departamento?inicio&fim&nivel=grupo|setor|familia[&id][&limite]
async function porDepartamento(req, res) {
  const { inicio, fim, nivel, id, limite } = req.query;

  if (typeof nivel !== 'string' || !NIVEIS_VALIDOS.includes(nivel)) {
    return res.status(400).json({ erro: 'Nível de departamento inválido: use grupo, setor ou familia.' });
  }
  if (!inicio || !fim) {
    return res.status(400).json({ erro: 'Informe os parâmetros inicio e fim (AAAA-MM-DD).' });
  }

  try {
    const resultado = await obterVendasPorDepartamento({ inicio, fim, nivel, id, limite });
    return res.status(200).json(resultado);
  } catch (erro) {
    if (erro instanceof ErroValidacao) {
      return res.status(erro.status).json({ erro: erro.message });
    }
    return res.status(500).json({ erro: 'Erro interno.' });
  }
}

module.exports = { porDepartamento };
