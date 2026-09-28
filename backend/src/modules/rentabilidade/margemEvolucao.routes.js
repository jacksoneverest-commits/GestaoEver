const express = require('express');
const { evolucao, abaixoMinimo } = require('./margemEvolucao.controller');

const router = express.Router();

// Montado pelo orquestrador em /api/rentabilidade (junto com as rotas de margem da Task 11.1).
router.get('/evolucao', evolucao);
router.get('/abaixo-minimo', abaixoMinimo);

module.exports = router;
