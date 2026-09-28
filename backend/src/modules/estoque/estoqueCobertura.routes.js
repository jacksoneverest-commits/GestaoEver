const express = require('express');
const { cobertura, parados } = require('./estoqueCobertura.controller');

const router = express.Router();

// Montado pelo orquestrador em /api/estoque (junto com as rotas de níveis da Task 13.1).
// /vencimento não existe nesta fase (adiado por decisão do usuário).
router.get('/cobertura', cobertura);
router.get('/parados', parados);

module.exports = router;
