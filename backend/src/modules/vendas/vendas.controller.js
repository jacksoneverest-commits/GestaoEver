const { buildPeriodFilter, ErroValidacao } = require('../../shared/queryFilters');
const { obterFaturamento } = require('./vendas.service');

// GET /api/vendas/faturamento?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
async function faturamento(req, res) {
  const { inicio, fim } = req.query;

  try {
    // Valida presença, formato ISO, data real e ordem (lança ErroValidacao -> 400).
    // Valores não-string (ex.: ?inicio=a&inicio=b vira array) também são rejeitados.
    buildPeriodFilter(inicio, fim);
  } catch (erro) {
    if (erro instanceof ErroValidacao) {
      return res.status(erro.status).json({ erro: erro.message });
    }
    return res.status(500).json({ erro: 'Erro interno.' });
  }

  try {
    const resultado = await obterFaturamento(inicio, fim);
    return res.status(200).json(resultado);
  } catch (erro) {
    if (erro instanceof ErroValidacao) {
      return res.status(erro.status).json({ erro: erro.message });
    }
    return res.status(500).json({ erro: 'Erro interno.' });
  }
}

module.exports = { faturamento };
