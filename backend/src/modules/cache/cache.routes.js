const express = require('express');
const { atualizar, status } = require('./cache.controller');

const router = express.Router();

// Montado pelo orquestrador em /api/cache
router.post('/atualizar', atualizar);
router.get('/status', status);

module.exports = router;
