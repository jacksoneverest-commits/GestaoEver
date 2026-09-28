const express = require('express');
const { parados, novos, demandaBaixoEstoque } = require('./rankingEspeciais.controller');

const router = express.Router();

// Montado pelo orquestrador em /api/ranking-produtos
router.get('/parados', parados);
router.get('/novos', novos);
router.get('/demanda-baixo-estoque', demandaBaixoEstoque);

module.exports = router;
