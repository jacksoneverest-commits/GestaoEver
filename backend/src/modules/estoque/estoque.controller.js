const { obterNiveisEstoque, ErroInternoEstoque } = require('./estoque.service');
const { ErroValidacao } = require('../../shared/queryFilters');
const { ErroCacheIncompleto } = require('../rankingProdutos/cacheProduto');
const { logarErroInesperado } = require('../../shared/logErroInesperado');

const MENSAGEM_PARAMETROS = 'Informe os parâmetros inicio e fim (AAAA-MM-DD).';

// GET /api/estoque/niveis?inicio&fim[&nivel&id][&classificacao=ruptura|proximo_ruptura|excesso][&limite]
// 503 { erro } se o cache por produto não cobre todos os dias fechados do período (Task 13.3)
async function niveis(req, res) {
  const { inicio, fim, nivel, id, classificacao, limite } = req.query;

  if (!inicio || !fim) {
    return res.status(400).json({ erro: MENSAGEM_PARAMETROS });
  }

  try {
    const resultado = await obterNiveisEstoque({ inicio, fim, nivel, id, classificacao, limite });
    return res.status(200).json(resultado);
  } catch (erro) {
    if (erro instanceof ErroValidacao || erro instanceof ErroCacheIncompleto) {
      return res.status(erro.status).json({ erro: erro.message });
    }
    // ErroInternoEstoque já foi logado (código do banco) pelo service; qualquer outro é inesperado.
    if (!(erro instanceof ErroInternoEstoque)) logarErroInesperado('estoque', erro);
    return res.status(500).json({ erro: 'Erro interno.' });
  }
}

module.exports = { niveis };
