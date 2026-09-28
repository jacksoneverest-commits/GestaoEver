// Controllers de GET /api/rentabilidade/evolucao e /abaixo-minimo (Task 11.2 do PLAN.md).
// Só validação de presença dos parâmetros + chamada ao service + resposta HTTP — nenhuma query SQL aqui
// (regra do projeto; a validação de formato/negócio fica no service, via ErroValidacao).
const { obterEvolucaoMargem, obterProdutosAbaixoMinimo, ErroInternoMargemEvolucao } = require('./margemEvolucao.service');
const { ErroValidacao } = require('../../shared/queryFilters');
const { ErroCacheIncompleto } = require('../rankingProdutos/cacheProduto');
const { logarErroInesperado } = require('../../shared/logErroInesperado');

const MENSAGEM_PARAMETROS = 'Informe os parâmetros inicio e fim (AAAA-MM-DD).';

// ErroValidacao/ErroCacheIncompleto já vêm com { status, message } prontos para a resposta { erro }.
// ErroInternoMargemEvolucao já foi logado (só o código) pelo service; qualquer outro erro é inesperado
// e é logado aqui (nome + código, nunca mensagem/pilha/SQL — logErroInesperado.js).
async function tratar(res, chamada) {
  try {
    const resultado = await chamada();
    return res.status(200).json(resultado);
  } catch (erro) {
    if (erro instanceof ErroValidacao || erro instanceof ErroCacheIncompleto) {
      return res.status(erro.status).json({ erro: erro.message });
    }
    if (!(erro instanceof ErroInternoMargemEvolucao)) logarErroInesperado('rentabilidade', erro);
    return res.status(500).json({ erro: 'Erro interno.' });
  }
}

// GET /api/rentabilidade/evolucao?inicio&fim[&nivel=grupo|setor|familia&id=N]
async function evolucao(req, res) {
  const { inicio, fim, nivel, id } = req.query;
  if (!inicio || !fim) return res.status(400).json({ erro: MENSAGEM_PARAMETROS });
  return tratar(res, () => obterEvolucaoMargem({ inicio, fim, nivel, id }));
}

// GET /api/rentabilidade/abaixo-minimo?inicio&fim&minimo=N[&nivel&id][&limite]
async function abaixoMinimo(req, res) {
  const { inicio, fim, minimo, nivel, id, limite } = req.query;
  if (!inicio || !fim) return res.status(400).json({ erro: MENSAGEM_PARAMETROS });
  return tratar(res, () => obterProdutosAbaixoMinimo({ inicio, fim, minimo, nivel, id, limite }));
}

module.exports = { evolucao, abaixoMinimo };
