const express = require('express');
const { faturamento } = require('./vendas.controller');

const router = express.Router();

router.get('/faturamento', faturamento);

module.exports = router;
