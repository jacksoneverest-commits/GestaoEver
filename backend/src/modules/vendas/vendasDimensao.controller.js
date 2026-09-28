const { buildPeriodFilter, ErroValidacao } = require('../../shared/queryFilters');
const {
  obterVendasPorHora,
  obterVendasPorDiaSemana,
  obterVendasPorFormaPagamento,
} = require('./vendasDimensao.service');

// Cria um handler GET ?inicio&fim: valida o período (400 { erro }), chama o service
// e responde { [chaveResposta]: dados }. Nenhum SQL aqui.
function criarHandler(chaveResposta, buscar) {
  return async function handler(req, res) {
    let periodo;
    try {
      periodo = buildPeriodFilter(req.query.inicio, req.query.fim);
    } catch (erro) {
      if (erro instanceof ErroValidacao) {
        return res.status(erro.status).json({ erro: erro.message });
      }
      return res.status(500).json({ erro: 'Erro interno.' });
    }

    try {
      const dados = await buscar(periodo);
      return res.status(200).json({ [chaveResposta]: dados });
    } catch (erro) {
      // O service já logou o motivo (sem dados sensíveis); nada do banco vai ao cliente.
      return res.status(500).json({ erro: 'Erro interno.' });
    }
  };
}

const porHora = criarHandler('porHora', obterVendasPorHora);
const porDiaSemana = criarHandler('porDiaSemana', obterVendasPorDiaSemana);
const porFormaPagamento = criarHandler('porFormaPagamento', obterVendasPorFormaPagamento);

module.exports = { porHora, porDiaSemana, porFormaPagamento };
