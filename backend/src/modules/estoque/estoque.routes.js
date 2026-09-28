const express = require('express');
const { niveis } = require('./estoque.controller');

const router = express.Router();

// Montado pelo orquestrador em /api/estoque
router.get('/niveis', niveis);

module.exports = router;
