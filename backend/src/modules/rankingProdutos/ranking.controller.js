const { obterRanking, CRITERIOS_VALIDOS, ErroCacheIncompleto, ErroInternoRanking } = require('./ranking.service');
const { ErroValidacao } = require('../../shared/queryFilters');
const { logarErroInesperado } = require('../../shared/logErroInesperado');

// GET /api/ranking-produtos?criterio=vendas|faturamento|margem|crescimento|queda&inicio&fim[&limite=10][&nivel&id][&ordenarPor=lucro|margemPercentual (só criterio=margem)]
// crescimento|queda: 503 { erro } se o cache por produto não cobre o período e o anterior (Task 7.4)
async function ranking(req, res) {
  const { criterio, limite, inicio, fim, nivel, id, ordenarPor } = req.query;

  if (typeof criterio !== 'string' || !CRITERIOS_VALIDOS.includes(criterio)) {
    return res
      .status(400)
      .json({ erro: 'Critério inválido: use vendas, faturamento, margem, crescimento ou queda.' });
  }
  if (!inicio || !fim) {
    return res.status(400).json({ erro: 'Informe os parâmetros inicio e fim (AAAA-MM-DD).' });
  }

  try {
    const resultado = await obterRanking({ criterio, limite, inicio, fim, nivel, id, ordenarPor });
    return res.status(200).json(resultado);
  } catch (erro) {
    if (erro instanceof ErroValidacao || erro instanceof ErroCacheIncompleto) {
      return res.status(erro.status).json({ erro: erro.message });
    }
    // ErroInternoRanking já foi logado (código do banco) pelo service; qualquer outro erro é inesperado.
    if (!(erro instanceof ErroInternoRanking)) logarErroInesperado('rankingProdutos', erro);
    return res.status(500).json({ erro: 'Erro interno.' });
  }
}

module.exports = { ranking };
