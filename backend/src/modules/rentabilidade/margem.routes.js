const express = require('express');
const { margem } = require('./margem.controller');

const router = express.Router();

// Montado pelo orquestrador em /api/rentabilidade (junto com margemEvolucao.routes, Task 11.2)
router.get('/margem', margem); // GET /api/rentabilidade/margem

module.exports = router;
