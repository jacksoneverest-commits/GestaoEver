const express = require('express');
const { listar, criar, resetar, trocarSenha } = require('./usuarios.controller');

const router = express.Router();

// Montado pelo orquestrador em app.js como app.use('/api/auth', autenticar, usuariosRoutes) —
// login continua público em /api/auth/login (authRoutes, montado antes, sem `autenticar`).
router.get('/usuarios', listar);
router.post('/usuarios', criar);
router.put('/usuarios/:id/senha', resetar);
router.put('/senha', trocarSenha);

module.exports = router;
