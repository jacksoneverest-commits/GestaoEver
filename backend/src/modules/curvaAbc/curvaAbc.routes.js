const express = require('express');
const { curvaAbc, itens } = require('./curvaAbc.controller');

const router = express.Router();

// Montado em app.js em /api/curva-abc (com `autenticar`)
router.get('/', curvaAbc); // GET /api/curva-abc
router.get('/itens', itens); // GET /api/curva-abc/itens (seletor de item da dimensão, Task 9.3)

module.exports = router;
