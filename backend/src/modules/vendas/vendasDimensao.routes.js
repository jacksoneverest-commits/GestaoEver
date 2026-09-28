const express = require('express');
const { porHora, porDiaSemana, porFormaPagamento } = require('./vendasDimensao.controller');

// Montado pelo orquestrador em /api/vendas (com o middleware `autenticar`).
const router = express.Router();

router.get('/por-hora', porHora);
router.get('/por-dia-semana', porDiaSemana);
router.get('/por-forma-pagamento', porFormaPagamento);

module.exports = router;
