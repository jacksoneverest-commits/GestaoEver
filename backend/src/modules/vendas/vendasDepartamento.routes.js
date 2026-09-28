const express = require('express');
const { porDepartamento } = require('./vendasDepartamento.controller');

const router = express.Router();

// Montado pelo orquestrador em /api/vendas -> GET /api/vendas/por-departamento
router.get('/por-departamento', porDepartamento);

module.exports = router;
