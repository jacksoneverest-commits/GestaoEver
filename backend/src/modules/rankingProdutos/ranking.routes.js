const express = require('express');
const { ranking } = require('./ranking.controller');

const router = express.Router();

// Montado pelo orquestrador em /api/ranking-produtos -> GET /api/ranking-produtos
router.get('/', ranking);

module.exports = router;
