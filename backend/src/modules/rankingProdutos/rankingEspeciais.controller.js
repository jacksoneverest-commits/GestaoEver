const {
  obterProdutosParados,
  obterProdutosNovos,
  obterProdutosDemandaBaixoEstoque,
  ErroCacheIncompleto,
  ErroInternoRankingEspeciais,
} = require('./rankingEspeciais.service');
const { ErroValidacao } = require('../../shared/queryFilters');
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
      // ErroInternoRankingEspeciais já foi logado (código do banco) pelo service; qualquer outro é inesperado.
      if (!(erro instanceof ErroInternoRankingEspeciais)) logarErroInesperado('rankingProdutos', erro);
      return res.status(500).json({ erro: 'Erro interno.' });
    }
  };
}

// GET /api/ranking-produtos/parados?inicio&fim[&nivel&id][&limite]
const parados = criarHandler(obterProdutosParados);

// GET /api/ranking-produtos/novos?inicio&fim[&nivel&id][&limite] — 503 { erro } se o cache por produto não cobre o período
const novos = criarHandler(obterProdutosNovos);

// GET /api/ranking-produtos/demanda-baixo-estoque?inicio&fim[&nivel&id][&limite] — produtos com venda no período e
// (qtestoque <= qtminima ou cobertura < 7 dias), da menor cobertura para a maior.
const demandaBaixoEstoque = criarHandler(obterProdutosDemandaBaixoEstoque);

module.exports = { parados, novos, demandaBaixoEstoque };
