const { obterCobertura, obterProdutosParados, ErroInternoEstoqueCobertura } = require('./estoqueCobertura.service');
const { ErroValidacao } = require('../../shared/queryFilters');
const { ErroCacheIncompleto } = require('../rankingProdutos/cacheProduto');
const { logarErroInesperado } = require('../../shared/logErroInesperado');

const MENSAGEM_PARAMETROS = 'Informe os parâmetros inicio e fim (AAAA-MM-DD).';

function criarHandler(obterDados) {
  return async function handler(req, res) {
    const { inicio, fim, limite, nivel, id } = req.query;

    if (!inicio || !fim) {
      return res.status(400).json({ erro: MENSAGEM_PARAMETROS });
    }

    try {
      const resultado = await obterDados({ inicio, fim, limite, nivel, id });
      return res.status(200).json(resultado);
    } catch (erro) {
      if (erro instanceof ErroValidacao || erro instanceof ErroCacheIncompleto) {
        return res.status(erro.status).json({ erro: erro.message });
      }
      // ErroInternoEstoqueCobertura já foi logado (código do banco) pelo service; qualquer outro é inesperado.
      if (!(erro instanceof ErroInternoEstoqueCobertura)) logarErroInesperado('estoque', erro);
      return res.status(500).json({ erro: 'Erro interno.' });
    }
  };
}

// GET /api/estoque/cobertura?inicio&fim[&nivel&id][&limite] — produtos com venda no período, da menor cobertura para a maior.
// 503 { erro } se o cache por produto não cobre todos os dias fechados do período (Task 13.3).
const cobertura = criarHandler(obterCobertura);

// GET /api/estoque/parados?inicio&fim[&nivel&id][&limite] — produtos com estoque e sem venda no período, por valor parado.
// 503 { erro } se o cache por produto não cobre todos os dias fechados do período (Task 13.3).
const parados = criarHandler(obterProdutosParados);

module.exports = { cobertura, parados };
