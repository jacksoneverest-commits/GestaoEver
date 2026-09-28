const { obterCurvaAbc, ErroInternoCurvaAbc } = require('./curvaAbc.service');
const { obterItensDimensao } = require('./curvaAbcItens.service');
const { ErroValidacao } = require('../../shared/queryFilters');
const { logarErroInesperado } = require('../../shared/logErroInesperado');

// Traduz erros do service para a resposta HTTP. ErroValidacao -> 400 { erro }. ErroInternoCurvaAbc (falha do banco)
// já foi logado pelo service (só o código); qualquer outro erro é inesperado: loga só nome e código. Ambos -> 500 genérico.
function responderErro(res, erro) {
  if (erro instanceof ErroValidacao) {
    return res.status(erro.status).json({ erro: erro.message });
  }
  if (!(erro instanceof ErroInternoCurvaAbc)) logarErroInesperado('curvaAbc', erro);
  return res.status(500).json({ erro: 'Erro interno.' });
}

// GET /api/curva-abc?inicio&fim&agrupador=produto|grupo|setor|familia|marca|cliente[&id=N][&limite=100]
// agrupador=fornecedor devolve a curva de COMPRAS (Task 9.2); com id responde 400.
// Validação de agrupador/período/id/limite fica no service (ErroValidacao -> 400); o controller só
// confere presença de agrupador, inicio e fim e traduz erros para { erro }.
async function curvaAbc(req, res) {
  const { inicio, fim, agrupador, id, limite } = req.query;

  if (typeof agrupador !== 'string' || !agrupador) {
    return res.status(400).json({
      erro: 'Agrupador inválido: use produto, grupo, setor, familia, marca, cliente ou fornecedor.',
    });
  }
  if (!inicio || !fim) {
    return res.status(400).json({ erro: 'Informe os parâmetros inicio e fim (AAAA-MM-DD).' });
  }

  try {
    const resultado = await obterCurvaAbc({ inicio, fim, agrupador, id, limite });
    return res.status(200).json(resultado);
  } catch (erro) {
    return responderErro(res, erro);
  }
}

// GET /api/curva-abc/itens?agrupador=grupo|setor|familia|marca|cliente|produto[&busca=texto][&limite=N]
// Itens do seletor da dimensão (Task 9.3). Validação (agrupador, busca, limite) no service.
async function itens(req, res) {
  const { agrupador, busca, limite } = req.query;

  try {
    const resultado = await obterItensDimensao({ agrupador, busca, limite });
    return res.status(200).json(resultado);
  } catch (erro) {
    return responderErro(res, erro);
  }
}

module.exports = { curvaAbc, itens };
