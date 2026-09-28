const express = require('express');
const cors = require('cors');
const authRoutes = require('./modules/auth/auth.routes');
const usuariosRoutes = require('./modules/auth/usuarios.routes');
const { autenticar } = require('./modules/auth/auth.middleware');
const vendasRoutes = require('./modules/vendas/vendas.routes');
const vendasDimensaoRoutes = require('./modules/vendas/vendasDimensao.routes');
const vendasDepartamentoRoutes = require('./modules/vendas/vendasDepartamento.routes');
const rankingRoutes = require('./modules/rankingProdutos/ranking.routes');
const rankingEspeciaisRoutes = require('./modules/rankingProdutos/rankingEspeciais.routes');
const curvaAbcRoutes = require('./modules/curvaAbc/curvaAbc.routes');
const estoqueRoutes = require('./modules/estoque/estoque.routes');
const estoqueCoberturaRoutes = require('./modules/estoque/estoqueCobertura.routes');
const margemRoutes = require('./modules/rentabilidade/margem.routes');
const margemEvolucaoRoutes = require('./modules/rentabilidade/margemEvolucao.routes');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes);

  // Cadastro de usuário e troca de senha exigem token válido; login (acima) continua público.
  app.use('/api/auth', autenticar, usuariosRoutes);

  // Módulo Vendas: todas as rotas exigem token válido.
  app.use('/api/vendas', autenticar, vendasRoutes, vendasDimensaoRoutes, vendasDepartamentoRoutes);

  // Módulo Ranking de Produtos: todas as rotas exigem token válido.
  app.use('/api/ranking-produtos', autenticar, rankingRoutes, rankingEspeciaisRoutes);

  // Módulo Curva ABC: todas as rotas exigem token válido.
  app.use('/api/curva-abc', autenticar, curvaAbcRoutes);

  // Módulo Estoque Inteligente: todas as rotas exigem token válido.
  app.use('/api/estoque', autenticar, estoqueRoutes, estoqueCoberturaRoutes);

  // Módulo Rentabilidade: todas as rotas exigem token válido.
  app.use('/api/rentabilidade', autenticar, margemRoutes, margemEvolucaoRoutes);

  // Error handler final: nunca expõe stack trace nem mensagem interna ao cliente.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err && Number(err.status || err.statusCode);
    if (err && (err.type === 'entity.parse.failed' || (status >= 400 && status < 500))) {
      return res.status(400).json({ erro: 'Requisição inválida.' });
    }
    console.error(`[app] Erro não tratado (código: ${err && err.code ? err.code : 'desconhecido'}).`);
    return res.status(500).json({ erro: 'Erro interno.' });
  });

  return app;
}

module.exports = createApp;
