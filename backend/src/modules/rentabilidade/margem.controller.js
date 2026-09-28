const { obterMargem, ErroInternoMargem } = require('./margem.service');
const { ErroValidacao } = require('../../shared/queryFilters');
const { ErroCacheIncompleto } = require('../rankingProdutos/cacheProduto');
const { logarErroInesperado } = require('../../shared/logErroInesperado');

const MENSAGEM_PARAMETROS = 'Informe os parâmetros inicio e fim (AAAA-MM-DD).';
const MENSAGEM_AGRUPADOR = 'Agrupador inválido: use produto, grupo, setor ou familia.';

// Traduz erros do service para a resposta HTTP. ErroValidacao -> 400 { erro }; ErroCacheIncompleto
// (cache por produto não cobre o período) -> 503 { erro }, sem log (não é inesperado). ErroInternoMargem
// já foi logado (só o código) pelo service; qualquer outro erro é inesperado: loga só nome e código.
function responderErro(res, erro) {
  if (erro instanceof ErroValidacao || erro instanceof ErroCacheIncompleto) {
    return res.status(erro.status).json({ erro: erro.message });
  }
  if (!(erro instanceof ErroInternoMargem)) logarErroInesperado('rentabilidade', erro);
  return res.status(500).json({ erro: 'Erro interno.' });
}

// GET /api/rentabilidade/margem?inicio&fim&agrupador=produto|grupo|setor|familia[&id=N]
//   [&ordenarPor=faturamento|lucro|margemPercentual][&limite=N]
// Validação de agrupador/id/ordenarPor/limite/período fica no service (ErroValidacao -> 400); o
// controller só confere a presença de agrupador, inicio e fim e traduz erros para { erro }.
async function margem(req, res) {
  const { inicio, fim, agrupador, id, ordenarPor, limite } = req.query;

  if (typeof agrupador !== 'string' || !agrupador) {
    return res.status(400).json({ erro: MENSAGEM_AGRUPADOR });
  }
  if (!inicio || !fim) {
    return res.status(400).json({ erro: MENSAGEM_PARAMETROS });
  }

  try {
    const resultado = await obterMargem({ inicio, fim, agrupador, id, ordenarPor, limite });
    return res.status(200).json(resultado);
  } catch (erro) {
    return responderErro(res, erro);
  }
}

module.exports = { margem };
