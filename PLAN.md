# PLAN.md

## Sprint 1 — Ambiente roda ponta a ponta: backend conecta ao MariaDB, frontend builda, e um usuário consegue logar e ver o dashboard vazio

### Fase 1 — Scaffolding do backend e frontend (`npm run build` sem erros em ambos os projetos)
> Dependências: nenhuma
> Paralelismo: Task 1.1 e Task 1.2 rodam em paralelo (pastas e arquivos completamente distintos)

#### Task 1.1 — Inicializar projeto backend Node.js
- Agent: Backend Engineer
- Input: repositório vazio (apenas `spec.md`, `CLAUDE.md`, `.claudeignore`)
- Output: `backend/package.json`, `backend/src/index.js` (servidor Express, porta lida de `process.env.PORT`), `backend/.env.example`, rota `GET /health` retornando `{ status: "ok" }`
- Testes críticos:
  - [ ] `npm run dev` inicia o servidor e `GET /health` retorna status 200 com `{ status: "ok" }`
  - [ ] Ausência da variável `PORT` no ambiente não derruba o processo silenciosamente — servidor usa porta default documentada ou loga erro claro

#### Task 1.2 — Inicializar projeto frontend React
- Agent: Frontend Engineer
- Input: repositório vazio
- Output: `frontend/package.json`, `frontend/src/App.jsx` (shell da aplicação com rotas vazias), `frontend/src/index.jsx`
- Testes críticos:
  - [ ] `npm run build` retorna exit code 0 e gera a pasta de build
  - [ ] Componente `App` renderiza sem lançar exceção (teste de render básico)

### Fase 2 — Banco de dados conectado e tabelas de cache criadas (query `SHOW TABLES` no MariaDB lista as tabelas de cache)
> Dependências: Fase 1
> Paralelismo: Task 2.1 e Task 2.2 rodam em paralelo (arquivos distintos, nenhuma depende do código da outra para ser escrita)

#### Task 2.1 — Módulo de conexão MariaDB
- Agent: Backend Engineer
- Input: `backend/package.json` criado (Task 1.1)
- Output: `backend/src/db/connection.js` exportando um pool de conexão configurado por `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (variáveis em `.env`)
- Testes críticos:
  - [ ] Com credenciais válidas, `connection.js` retorna uma pool que executa `SELECT 1` com sucesso
  - [ ] Com credenciais inválidas, a função lança erro tratado com mensagem clara em vez de derrubar o processo com stack trace cru

#### Task 2.2 — Migration das tabelas de agregação/cache de período
- Agent: Database Engineer
- Input: acesso ao MariaDB do ERP (schema existente: `vendacupom`, `vendaitem`, `produto`, etc.)
- Output: `backend/src/db/migrations/001_create_cache_tables.sql` criando `vendas_periodo_cache` e `compras_periodo_cache` (colunas: `periodo_inicio`, `periodo_fim`, `faturamento_total`, `quantidade_cupons`, `atualizado_em`)
- Testes críticos:
  - [ ] Rodar a migration cria as duas tabelas com as colunas esperadas (verificável via `DESCRIBE vendas_periodo_cache`)
  - [ ] Rodar a migration uma segunda vez não corrompe dados existentes (idempotente ou falha de forma controlada com mensagem clara)

### Fase 3 — Autenticação funcional (login via `curl -X POST /api/auth/login` retorna token com credenciais válidas)
> Dependências: Fase 2
> Paralelismo: Task 3.1 e Task 3.2 rodam em paralelo (contrato de API `POST /api/auth/login` acordado antecipadamente; backend e frontend não tocam os mesmos arquivos)

#### Task 3.1 — Backend: endpoint de login (módulo Autenticação/Usuários)
- Agent: Backend Engineer
- Input: `backend/src/db/connection.js` (Task 2.1) disponível
- Output: `backend/src/modules/auth/auth.controller.js`, `backend/src/modules/auth/auth.service.js`, rota `POST /api/auth/login` recebendo `{ usuario, senha }` e retornando `{ token }`
- Testes críticos:
  - [ ] Login com credenciais válidas retorna status 200 e um token
  - [ ] Login com credenciais inválidas retorna status 401 sem revelar se o usuário existe ou não

#### Task 3.2 — Frontend: tela de login (módulo Autenticação/Usuários)
- Agent: Frontend Engineer
- Input: `frontend/src/App.jsx` (Task 1.2) disponível; contrato de `POST /api/auth/login` definido
- Output: `frontend/src/pages/Login/Login.jsx`, `frontend/src/services/authService.js`
- Testes críticos:
  - [ ] Submeter o formulário com credenciais válidas (mock da API) redireciona para o dashboard
  - [ ] Submeter credenciais inválidas exibe mensagem de erro e mantém o usuário na tela de login

> Adicionada em 2026-09-28 por pedido do usuário: tela de gestão de usuários (cadastro + troca de senha). Decisões do usuário: (1) sem diferenciação de permissão nesta fase — qualquer usuário autenticado acessa a tela; (2) troca de senha cobre os dois casos — autoatendimento (usuário troca a própria senha, exige senha atual) e reset de outro usuário (não exige senha atual). Depende das Tasks 3.1/3.2 e da migration `002_create_usuarios_gestao.sql`; a tabela `usuarios_gestao` já tem UPDATE liberado para o usuário da aplicação desde a migration `003_unique_periodo_vendas_cache.sql`.

#### Task 3.3 — Backend: cadastro de usuário e troca de senha (módulo Autenticação/Usuários)
- Agent: Backend Engineer
- Input: `backend/src/modules/auth/auth.service.js` (`hashSenha`/`verificarSenha`) e `backend/src/modules/auth/auth.middleware.js` (`autenticar`) disponíveis; tabela `usuarios_gestao` (migration 002) com UPDATE liberado (migration 003)
- Output: `backend/src/modules/auth/usuarios.controller.js`, `backend/src/modules/auth/usuarios.service.js`, `backend/src/modules/auth/usuarios.routes.js`, montadas em `app.js` como `app.use('/api/auth', autenticar, usuariosRoutes)` (login continua público em `/api/auth/login`):
  - `GET /api/auth/usuarios` — lista `id`, `usuario`, `nome`, `perfil`, `ativo` (nunca `senha_hash`)
  - `POST /api/auth/usuarios` — cria usuário a partir de `{ usuario, nome, senha, perfil }`, `senha` sempre hasheada antes de gravar
  - `PUT /api/auth/usuarios/:id/senha` — reseta a senha de qualquer usuário a partir de `{ senhaNova }`, sem exigir a senha atual
  - `PUT /api/auth/senha` — troca a própria senha (id do usuário vem do token) a partir de `{ senhaAtual, senhaNova }`, exige conferir `senhaAtual` antes de gravar
- Testes críticos:
  - [x] `POST /api/auth/usuarios` com dados válidos retorna 201, grava `senha_hash` (nunca a senha em texto puro) e não retorna o hash no corpo
  - [x] `POST /api/auth/usuarios` com `usuario` já existente retorna 400 (violação do `UNIQUE` tratada, sem vazar erro do MariaDB)
  - [x] `GET /api/auth/usuarios` e as rotas de senha sem token retornam 401
  - [x] `PUT /api/auth/senha` com `senhaAtual` incorreta retorna 400 (não 401 — a sessão/token continua válido, só o campo enviado não confere; 401 aqui derrubaria a sessão no frontend, que trata todo 401 como token expirado) e não altera `senha_hash`
  - [x] `PUT /api/auth/usuarios/:id/senha` com `senhaNova` válida altera `senha_hash` (mock do pool) sem exigir a senha atual

#### Task 3.4 — Frontend: tela de gestão de usuários (módulo Autenticação/Usuários)
- Agent: Frontend Engineer
- Input: contrato das rotas da Task 3.3 definido; `frontend/src/services/apiClient.js` disponível (adicionar `apiPost`/`apiPut` seguindo o padrão de `apiGet`)
- Output: `frontend/src/pages/Usuarios/UsuariosPage.jsx`, `frontend/src/services/usuariosService.js`, link "Usuários" em `DashboardPage.jsx`, rota `#/usuarios` em `App.jsx`. A tela cobre: lista de usuários, formulário de cadastro, reset de senha de outro usuário e troca da própria senha (com campo de senha atual)
- Testes críticos:
  - [x] A lista de usuários trata os 3 estados (carregando, erro, sucesso) sem deixar a tela em branco
  - [x] Cadastrar um novo usuário com dados válidos (mock do service) atualiza a lista exibida
  - [x] Trocar a própria senha informando a senha atual errada (mock retorna erro) exibe mensagem de erro e mantém a sessão logada

### Fase 4 — Utilitários compartilhados de período e departamento (`npm test -- shared` passa no backend e no frontend)
> Dependências: Fase 3
> Paralelismo: Task 4.1 e Task 4.2 rodam em paralelo (backend e frontend, arquivos distintos)

#### Task 4.1 — Backend: query builder de período e departamento (grupo/setor/família)
- Agent: Backend Engineer
- Input: `backend/src/db/connection.js` disponível
- Output: `backend/src/shared/queryFilters.js` exportando `buildPeriodFilter(dataInicio, dataFim)` e `buildDepartmentFilter({ nivel, id })` (nivel ∈ `grupo`, `setor`, `familia`), usado por todos os módulos de dados
- Testes críticos:
  - [ ] `buildPeriodFilter` retorna cláusula SQL válida para um intervalo de datas válido
  - [ ] `buildDepartmentFilter` lança erro para `nivel` fora de `grupo`/`setor`/`familia`

#### Task 4.2 — Frontend: componente de filtro de período
- Agent: Frontend Engineer
- Input: `frontend/src/App.jsx` disponível
- Output: `frontend/src/components/PeriodFilter/PeriodFilter.jsx`, recebendo `onChange({ startDate, endDate })`
- Testes críticos:
  - [ ] Selecionar um intervalo de datas válido dispara `onChange` com as datas corretas
  - [ ] Selecionar data final anterior à data inicial exibe erro de validação e não dispara `onChange`

## Sprint 2 — Módulo de Vendas e Faturamento navegável de ponta a ponta com dados reais do MariaDB

### Fase 5 — Vendas e Faturamento: API (`npm test -- vendas` passa no backend)
> Dependências: Fase 4
> Paralelismo: Task 5.1, Task 5.2 e Task 5.3 rodam em paralelo (endpoints e arquivos independentes dentro do módulo); Task 5.4 e Task 5.5 rodam depois delas, em sequência (5.5 depende da 5.4)

#### Task 5.1 — Endpoint de faturamento e KPIs gerais
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js` disponível
- Output: `backend/src/modules/vendas/vendas.controller.js` — `GET /api/vendas/faturamento?inicio&fim` retornando `{ faturamento, ticketMedio, quantidadeCupons, itensPorCompra, comparativoPeriodoAnterior }`
- Testes críticos:
  - [ ] Para um período com vendas válidas (`flagvc.Venda = 1` e `status = 0`), o faturamento retornado é igual à soma de `vendacupom.valortotal`
  - [ ] Vendas canceladas (`status = 5`) ou com `flagvc.Venda ≠ 1` não entram no cálculo de faturamento nem de ticket médio

#### Task 5.2 — Endpoint de vendas por hora, dia da semana e forma de pagamento
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js` disponível
- Output: `backend/src/modules/vendas/vendasDimensao.controller.js` — `GET /api/vendas/por-hora`, `GET /api/vendas/por-dia-semana`, `GET /api/vendas/por-forma-pagamento`
- Testes críticos:
  - [ ] `/api/vendas/por-hora` retorna 24 buckets (0-23h) com soma de vendas válidas de um período de teste conhecido
  - [ ] `/api/vendas/por-forma-pagamento` agrupa corretamente pelo join `vendacupom.formapag = formapag.idFormaPag`

#### Task 5.3 — Endpoint de vendas por departamento (grupo/setor/família)
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js` disponível
- Output: `backend/src/modules/vendas/vendasDepartamento.controller.js` — `GET /api/vendas/por-departamento?nivel=grupo|setor|familia&id=`
- Testes críticos:
  - [ ] Para `nivel=setor` com um `id` válido, retorna vendas agregadas apenas dos produtos daquele setor
  - [ ] Para `nivel` inválido, retorna status 400 com mensagem de erro clara

#### Task 5.4 — Migration: chave única por dia no cache de vendas
> Adicionada após a revisão da Fase 5: nenhuma task populava `vendas_periodo_cache`, então `comparativoPeriodoAnterior` (Task 5.1) ficava sempre `null`. Decisão do usuário: cachear por dia (uma linha por dia, `periodo_inicio = periodo_fim`), o que serve a qualquer intervalo de comparação. Depende das Tasks 5.1–5.3 concluídas; 5.4 e 5.5 rodam em sequência.
- Agent: Database Engineer
- Input: migration `001_create_cache_tables.sql` já aplicada (não pode ser editada); usuário `gestao` com `UPDATE` liberado
- Output: `backend/src/db/migrations/003_unique_periodo_vendas_cache.sql` adicionando `UNIQUE (periodo_inicio, periodo_fim)` em `vendas_periodo_cache` (permite upsert por dia). O comentário da 001 que cita `flagvc.flag = 1` fica desatualizado; registrar na 003 que a regra vigente é `flagvc.Venda = 1`.
- Testes críticos:
  - [ ] A migration cria a chave única esperada em `vendas_periodo_cache` (verificável via `SHOW CREATE TABLE`)
  - [ ] Rodar a migration uma segunda vez não corrompe dados nem falha de forma obscura (idempotente ou falha controlada com mensagem clara)

#### Task 5.5 — Job de agregação diária de vendas e comparativo lendo o cache
- Agent: Backend Engineer
- Input: Task 5.4 aplicada; `backend/src/shared/vendaValida.js`, `backend/src/shared/queryFilters.js` e `backend/src/modules/vendas/vendas.service.js` disponíveis
- Output: `backend/src/jobs/vendasPeriodoCache.job.js` (função exportada + script `npm run job:cache-vendas` com `--desde YYYY-MM-DD` opcional) que, para cada dia do intervalo, agrega `faturamento_total` (soma de `vendacupom.valortotal`) e `quantidade_cupons` das vendas válidas (`JOIN_VENDA_VALIDA` + `WHERE_VENDA_VALIDA`) e grava com upsert em `vendas_periodo_cache` (`periodo_inicio = periodo_fim = dia`). Por padrão recalcula os últimos 7 dias (cupons podem ser cancelados depois) e preenche dias ainda sem linha. Ajustar `comparativoPeriodoAnterior` em `vendas.service.js` para somar as linhas diárias do período anterior; retorna `null` se o cache não cobrir todos os dias do período anterior.
- Testes críticos:
  - [ ] O job grava, por dia, faturamento e cupons apenas das vendas válidas (SQL usa `JOIN_VENDA_VALIDA` + `WHERE_VENDA_VALIDA` e período parametrizado)
  - [ ] Rodar o job duas vezes para o mesmo dia atualiza a linha existente em vez de duplicar (upsert)
  - [ ] `comparativoPeriodoAnterior` soma as linhas diárias do período anterior e devolve `null` quando falta algum dia no cache
- Observações: a frequência de execução do job (agendamento) segue como decisão em aberto no CLAUDE.md; nesta task ele roda sob demanda via script. O job escreve no banco do ERP — só executar contra o `supcardoso` com confirmação do usuário.

### Fase 6 — Vendas e Faturamento: Frontend (tela `/vendas` carrega KPIs e gráficos sem erro no console)
> Dependências: Fase 5
> Paralelismo: Task 6.1 e Task 6.2 rodam em paralelo (arquivos distintos dentro da página)

#### Task 6.1 — Tela de KPIs de Vendas e Faturamento
- Agent: Frontend Engineer
- Input: contrato de `GET /api/vendas/faturamento` definido (Task 5.1); `PeriodFilter` (Task 4.2) disponível
- Output: `frontend/src/pages/Vendas/VendasPage.jsx` exibindo faturamento, comparativo com período anterior, meta x realizado, ticket médio e quantidade de cupons
- Testes críticos:
  - [ ] Renderiza os KPIs corretamente a partir de uma resposta mock da API
  - [ ] Exibe estado de erro visível quando a API retorna falha (status ≠ 200)

#### Task 6.2 — Gráficos de vendas (hora, dia da semana, forma de pagamento, departamento)
- Agent: Frontend Engineer
- Input: contratos de `/api/vendas/por-hora`, `/por-dia-semana`, `/por-forma-pagamento`, `/por-departamento` definidos (Tasks 5.2 e 5.3)
- Output: `frontend/src/pages/Vendas/components/VendasCharts.jsx`
- Testes críticos:
  - [ ] Renderiza o gráfico de vendas por hora com os 24 pontos retornados por uma resposta mock
  - [ ] Trocar o nível de navegação de departamento (grupo/setor/família) refaz a chamada à API com o `nivel` correto

## Sprint 3 — Ranking de Produtos e Curva ABC navegáveis com dados reais

### Fase 7 — Ranking de Produtos: API (`npm test` completo passa no backend — inclui `rankingProdutos`, o job por produto, a migration 004 e `app.ranking`)
> Dependências: Fase 4
> Paralelismo: Task 7.1 e Task 7.2 rodam em paralelo (endpoints e arquivos independentes). Depois, em sequência: Task 7.3 → Task 7.4.
> Contrato vigente (definido na implementação): `inicio` e `fim` (ISO `YYYY-MM-DD`) obrigatórios; `nivel` + `id` (departamento) opcionais e sempre juntos; `limite` opcional (1–100 no ranking, 1–500 em `/parados`, `/novos` e `/demanda-baixo-estoque`). `criterio=margem` aceita `ordenarPor=lucro|margemPercentual` e sinaliza `semCusto` por produto. `crescimento`, `queda` e `/novos` leem o cache por produto (Task 7.4), consideram só dias fechados (o `fim` é limitado a ontem; a resposta traz `fim` efetivo e `fimSolicitado`; `inicio` posterior a ontem dá 400) e respondem 503 `{ erro }` quando o cache não cobre o período (em `/novos`, também quando o período começa antes da primeira venda registrada). Atenção: a API não consegue verificar se o preenchimento do histórico (`--desde` = primeira venda do ERP) foi completo; sem ele, `/novos` pode listar como "novos" produtos antigos que voltaram a vender. `/demanda-baixo-estoque` lê `produto.qtestoque`/`qtminima`/`qtmaxima` (regra na Task 7.2) e, desde a Task 13.3, lê a quantidade vendida de `vendas_produto_dia_cache` (verifica a cobertura do cache e responde 503 `{ erro }` quando faltam dias fechados), limita o `fim` a ontem e devolve `fim` efetivo e `fimSolicitado`; `inicio` e `fim` obrigatórios.

#### Task 7.1 — Endpoint de rankings (vendas, faturamento, margem, crescimento, queda)
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js` disponível
- Output: `backend/src/modules/rankingProdutos/ranking.controller.js` — `GET /api/ranking-produtos?criterio=vendas|faturamento|margem|crescimento|queda&limite=10`
- Testes críticos:
  - [x] Para `criterio=vendas`, retorna os produtos ordenados por quantidade vendida decrescente, respeitando o `limite`
  - [x] Para `criterio` fora da lista permitida, retorna status 400

#### Task 7.2 — Endpoint de produtos parados, novos e alta demanda/baixo estoque
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js` disponível
- Output: `backend/src/modules/rankingProdutos/rankingEspeciais.controller.js` — `GET /api/ranking-produtos/parados`, `/novos`, `/demanda-baixo-estoque`
- Testes críticos:
  - [x] Produtos sem nenhuma venda dentro do período aparecem em `/parados`
  - [x] Produtos com a primeira venda registrada dentro do período aparecem em `/novos`
  - [x] `/demanda-baixo-estoque` lista produtos com venda no período e (`qtestoque <= qtminima` ou cobertura < 7 dias), ordenados pela menor cobertura primeiro
- Regra de `/demanda-baixo-estoque` (decisão do usuário): estoque atual = `produto.qtestoque`, mínimo = `produto.qtminima`, máximo = `produto.qtmaxima` (`produto.Estoque` é só a sinalização S/N de controle, não a quantidade). Cobertura em dias = `qtestoque` ÷ venda média diária do período (venda válida); estoque ≤ 0 tem cobertura 0. Alta demanda = produto com venda > 0 no período. Sem filtro de `Estoque = 'S'` nem de situação. `produto.situacao`: A = ativo, B = bloqueado.

#### Task 7.3 — Migration: caches de vendas por produto e de primeira venda
> Adicionada após a revisão da Fase 7: `crescimento`/`queda` comparam períodos por produto e `/novos` precisa da primeira venda histórica, mas o único cache existente (`vendas_periodo_cache`) é agregado por dia, sem produto. Decisão do usuário: criar cache por produto. `/novos` deixa de varrer o histórico de `vendaitem`/`vendacupom` (`NOT EXISTS`).
- Agent: Database Engineer
- Input: migrations 001–003 já aplicadas (não podem ser editadas)
- Output: `backend/src/db/migrations/004_create_cache_produto.sql` com (a) uma tabela de vendas por dia e por produto (`quantidade`, `faturamento`, `custo_total`; chave única `(dia, produto)` para permitir upsert) e (b) uma tabela de primeira venda válida por produto (`produto` único, `primeira_venda`). O arquivo é criado e testado, mas **não é aplicado** ao `supcardoso` sem confirmação do usuário.
- Testes críticos:
  - [x] A migration cria as duas tabelas com as chaves únicas esperadas
  - [x] Rodar a migration duas vezes não corrompe dados nem falha de forma obscura (idempotente ou falha controlada com mensagem clara)

#### Task 7.4 — Job de agregação por produto e rankings lendo o cache
> Depende da Task 7.3 (e dos ajustes de `margem` da Task 7.1 já concluídos).
- Agent: Backend Engineer
- Input: Task 7.3 aplicada; `backend/src/jobs/vendasPeriodoCache.job.js` (padrão do job por dia), `backend/src/shared/vendaValida.js` e `backend/src/shared/queryFilters.js` disponíveis
- Output: `backend/src/jobs/vendasProdutoCache.job.js` (função exportada + script `npm run job:cache-produtos` com `--desde YYYY-MM-DD` opcional) que, por dia, grava com upsert quantidade, faturamento e custo (`vendaitem.pcusto`) por produto das vendas válidas, e mantém a primeira venda válida por produto. Ajustar `ranking.service.js` para que `criterio=crescimento|queda` compare o período com o anterior lendo o cache, e `rankingEspeciais.service.js` para que `/novos` leia a primeira venda do cache. Se o cache não cobrir o período (ou o anterior), responder erro claro em vez de resultado parcial.
- Testes críticos:
  - [x] O job grava, por dia e produto, quantidade/faturamento/custo apenas das vendas válidas (SQL usa `JOIN_VENDA_VALIDA` + `WHERE_VENDA_VALIDA` e período parametrizado)
  - [x] Rodar o job duas vezes para o mesmo dia atualiza a linha existente (upsert), sem duplicar
  - [x] `criterio=crescimento` ordena por variação positiva e `criterio=queda` por variação negativa, comparando com o período anterior a partir do cache
  - [x] `/novos` lista produtos cuja primeira venda no cache cai dentro do período, sem consultar o histórico de `vendaitem`
- Observações: o job escreve no banco do ERP — só executar contra o `supcardoso` com confirmação do usuário. O preenchimento inicial (histórico completo para a primeira venda) é uma varredura pesada e deve rodar fora do horário de uso.

### Fase 8 — Ranking de Produtos: Frontend (tela `/ranking-produtos` troca de critério sem recarregar a página)
> Dependências: Fase 7
> Paralelismo: task única nesta fase — não se aplica

#### Task 8.1 — Tela de Ranking de Produtos
- Agent: Frontend Engineer
- Input: contratos de `/api/ranking-produtos*` definidos (Tasks 7.1 e 7.2); `PeriodFilter` disponível
- Output: `frontend/src/pages/RankingProdutos/RankingProdutosPage.jsx`
- Testes críticos:
  - [x] Exibe tabela com os produtos retornados para o critério selecionado por padrão
  - [x] Trocar o critério (vendas/faturamento/margem) refaz a chamada à API e atualiza a tabela sem recarregar a página

#### Task 8.2 — Controle de quantidade de itens (limite) na tela de Ranking
> Adicionada após a revisão da Task 8.1: a tela ficou presa ao limite padrão do backend (10 no ranking, 50 em parados/novos). Decisão do usuário: mostrar 10 por padrão em todas as visões e permitir escolher ou digitar uma quantidade maior. Depende da Task 8.1.
- Agent: Frontend Engineer
- Input: `RankingProdutosPage.jsx` e `rankingProdutosService.js` (Task 8.1); o backend já aceita `limite` (1–100 no ranking; 1–500 em `/parados`, `/novos` e `/demanda-baixo-estoque`)
- Output: controle "Quantidade de itens" em `RankingProdutosPage.jsx` (padrão 10 em todas as visões; campo numérico com sugestões e validação do máximo da visão), enviando `limite` ao service
- Testes críticos:
  - [x] Por padrão a chamada à API envia `limite=10` em todas as visões (inclusive parados e novos)
  - [x] Alterar a quantidade refaz a chamada com o novo `limite` e atualiza a tabela; valor acima do máximo da visão ou inválido não dispara chamada e mostra mensagem clara

#### Task 8.3 — Visão "Alta demanda / baixo estoque" na tela de Ranking
> Adicionada após a liberação do estoque na Task 7.2: a visão só exibia "Ainda indisponível" (501). Depende das Tasks 7.2 e 8.2.
- Agent: Frontend Engineer
- Input: contrato de `GET /api/ranking-produtos/demanda-baixo-estoque?inicio&fim[&limite]` → `{ inicio, fim, limite, itens: [{ id, nome, quantidadeVendida, mediaDiaria, estoqueAtual, estoqueMinimo, estoqueMaximo, coberturaDias, motivo }] }`
- Output: tabela da visão em `RankingProdutosPage.jsx` (+ `rankingProdutosService.js` enviando `limite`), com o controle de quantidade (máx. 500)
- Testes críticos:
  - [x] A visão exibe a tabela com produto, vendido no período, média/dia, estoque atual, mínimo, cobertura em dias e o motivo, a partir de uma resposta mock
  - [x] Estoque negativo ou nulo e mínimo nulo são exibidos de forma legível (sem "NaN"/"undefined"), e a chamada envia `limite`

### Fase 9 — Curva ABC: API (`npm test` completo passa no backend — inclui `curvaAbc`)
> Dependências: Fase 4 (e Fase 7 para o custo CMV e as colunas de estoque)
> Paralelismo: Task 9.1 primeiro; Task 9.2 (fornecedor) só depois da 9.1 (mesmos arquivos); Task 9.3 (itens do seletor) depois da 9.2 e em paralelo com a Task 10.1 (contrato já definido).
> Decisões do usuário (2026-09-25, refletidas no SPEC): a curva tem **dimensão de análise selecionável** como a do ERP — `produto`, `grupo`, `setor`, `familia`, `marca`, `cliente`, `fornecedor`. Métricas: venda = faturamento (`vendaitem.vtotal`), margem = lucro em R$ com CMV (`vendaitem.pcusto`), estoque = valor em estoque (`produto.qtestoque` × `produto.precocusto`, estoque negativo conta como 0; não há outra base de custo). Classes: A = primeiros 80% do valor acumulado, B até 95%, C o restante. Seletor da dimensão com "Todos" (padrão) = todos os itens da dimensão; com um item (`id`), a curva traz os **produtos** desse item.

#### Task 9.1 — Endpoint de classificação ABC cruzada (venda, margem, estoque) por dimensão
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js`, `vendaValida.js` disponíveis; regras de custo/estoque da memória do projeto (CMV `vendaitem.pcusto`; `produto.qtestoque`)
- Output: `backend/src/modules/curvaAbc/curvaAbc.controller.js` (+ service) — `GET /api/curva-abc?inicio&fim&agrupador=produto|grupo|setor|familia|marca|cliente[&id=N]` retornando `{ agrupador, inicio, fim, id?, limite, totalItens, itens: [{ id, nome, faturamento, lucro, valorEstoque, participacaoVenda, acumuladoVenda, classificacaoVenda, classificacaoMargem, classificacaoEstoque, semCusto }] }` (ordenado por faturamento; `limite` padrão 100 e máx. 1000, aplicado depois de classificar; `totalItens` = linhas antes do limite; `id` só aparece quando enviado; `lucro` soma apenas os itens com custo e `semCusto` indica que algum item da linha não tem custo). **Contrato do frontend:** os itens de `fornecedor` são uma variante (`{ id, nome, valorCompras, participacaoCompra, acumuladoCompra, classificacaoCompra }`, ver Task 9.2) e a tabela deve ramificar por `agrupador === 'fornecedor'`; linhas com `id` 0 (Venda consumidor, "Sem grupo", "Sem setor", "Sem família", "Sem marca") não podem ser detalhadas (`id` exige inteiro positivo). Sem `id`: uma linha por item da dimensão; com `id`: as linhas são os **produtos** daquele item. Cliente: `vendacupom.cliente` → `clifor.cod` (só o nome é exibido; o cliente 0 é a venda a consumidor e aparece como a linha "Venda consumidor", que participa normalmente da curva; `valorEstoque` e `classificacaoEstoque` = null, pois estoque não se aplica a cliente). `fornecedor` fica para a Task 9.2 (curva de compras).
- Testes críticos:
  - [x] Itens responsáveis pelos primeiros 80% do faturamento acumulado no período são classificados como "A" em venda (B até 95%, C o restante)
  - [x] Item sem estoque e sem vendas no período não quebra o endpoint (retorna classificação consistente, sem erro 500)
  - [x] `agrupador` fora da lista permitida retorna status 400
  - [x] Com `agrupador=cliente`, o cliente 0 aparece como "Venda consumidor" e o estoque não é classificado (null)

#### Task 9.2 — Curva ABC por Fornecedor (compras, como no ERP)
> Decisão do usuário (2026-09-26): a curva por fornecedor do ERP é a de **compras**, não a de vendas atribuídas ao fornecedor do produto — `SUM(compranota.TotalNota)` por fornecedor, `compranota.ES = 'E'` e `compranota.Status = 1` no período, com `compranota.fornecedor` → `clifor.cod` (só `clifor.nome` é lido). A consulta usa índices de `compranota` e roda em milissegundos (validada no banco de dev), então não há tabela de cache nem job (a antiga migration 005 e o job "fornecedor atual do produto" foram descartados; a 005 nunca foi aplicada). Escolher um fornecedor no seletor não é suportado por ora. Margem e estoque não se aplicam a fornecedor.
- Agent: Backend Engineer
- Input: Task 9.1 concluída
- Output: `agrupador=fornecedor` em `GET /api/curva-abc` (mesmo controller/service da 9.1) devolvendo `{ agrupador, inicio, fim, limite, totalItens, itens: [{ id, nome, valorCompras, participacaoCompra, acumuladoCompra, classificacaoCompra }] }` ordenado por valor comprado; classes A/B/C pelo mesmo corte 80/95 do acumulado. `agrupador=fornecedor` com `id` responde 400 `{ erro }` claro (escolha de fornecedor não suportada).
- Testes críticos:
  - [x] Com `agrupador=fornecedor`, o valor comprado soma `compranota.TotalNota` por fornecedor (apenas `ES = 'E'` e `Status = 1` no período, parametrizado) e as classes A/B/C seguem o acumulado
  - [x] `agrupador=fornecedor` com `id` retorna status 400 com mensagem clara

#### Task 9.3 — Listagem de itens da dimensão (seletor da Curva ABC) e ajustes da revisão
> Decisões do usuário (2026-09-26): o seletor de item lista os cadastros reais da dimensão; **produto** só com `produto.situacao = 'A'` (~16 mil, então com busca por digitação); **fornecedor** não tem seleção; produtos bloqueados (`situacao = 'B'`) não entram no **valor de estoque** (as vendas deles continuam contando); cliente com código inexistente em `clifor` deixa de se fundir com o cliente 0 (vira um item próprio "Sem nome"). Da revisão: fornecedor com `LEFT JOIN clifor` ("Sem nome") e só com `valorCompras > 0`; log do código do erro inesperado (nunca mensagem/pilha/SQL) nos controllers.
- Agent: Backend Engineer
- Input: Task 9.1 e 9.2 concluídas
- Output: `GET /api/curva-abc/itens?agrupador=grupo|setor|familia|marca|cliente|produto[&busca=texto][&limite=N]` → `{ agrupador, busca?, limite, totalItens, itens: [{ id, nome }] }` em ordem alfabética por nome. grupo/setor/familia/marca: todos os cadastros (`busca` opcional filtra por trecho do nome; limite padrão 5000); cliente: `clifor` com `tipo = 1` (só `cod` e `nome`); produto: apenas `situacao = 'A'`, `busca` obrigatória (mínimo 2 caracteres, senão 400), limite padrão 50 e máx. 200; `fornecedor` → 400 claro (sem seleção); agrupador inválido → 400. Mais: os ajustes listados acima (estoque sem `situacao = 'B'`, cliente órfão separado, fornecedor `LEFT JOIN` + `valorCompras > 0`, log do erro inesperado).
- Testes críticos:
  - [x] `/itens` lista os cadastros da dimensão em ordem alfabética (grupo/setor/familia/marca/cliente) e, para `produto`, só `situacao = 'A'` e exige `busca` de ao menos 2 caracteres
  - [x] `/itens?agrupador=fornecedor` (ou inválido) retorna 400 com mensagem clara
  - [x] O valor de estoque da curva ignora produtos com `situacao = 'B'` e as vendas deles continuam contando
  - [ ] `busca` com várias palavras casa os itens cujo nome contém TODAS as palavras, em qualquer ordem (ex.: "arroz 5kg" encontra "ARROZ PILECCO SUPER ECCO 5KG T1"); máx. 6 palavras e 100 caracteres de busca (acima disso, 400)

### Fase 10 — Curva ABC: Frontend (tela `/curva-abc` exibe as três classificações por dimensão)
> Dependências: Fase 9
> Paralelismo: task única nesta fase — não se aplica

#### Task 10.1 — Tela de Curva ABC
- Agent: Frontend Engineer
- Input: contratos de `GET /api/curva-abc` (Tasks 9.1 e 9.2) e de `GET /api/curva-abc/itens` (Task 9.3) definidos; `PeriodFilter` disponível
- Output: `frontend/src/pages/CurvaAbc/CurvaAbcPage.jsx` com seletor de dimensão (Grupo, Marca, Família, Produto, Cliente, Fornecedor, Setor) e, ao lado, seletor do item da dimensão com a opção "Todos" (padrão)
- Testes críticos:
  - [x] Tabela exibe a classificação A/B/C de venda, margem e estoque para cada item retornado
  - [x] Itens com classificação "A" em venda e "C" em margem recebem destaque visual (ex.: badge de atenção)
  - [x] Trocar a dimensão refaz a chamada com o `agrupador` correto e escolher um item envia o `id`

## Sprint 4 — Módulo de Rentabilidade navegável com dados reais

### Fase 11 — Rentabilidade: API (`npm test` completo passa no backend — inclui `rentabilidade`)
> Dependências: Fase 4 (e Fase 7 para o custo CMV já mapeado e o cache por produto)
> Paralelismo: Task 11.1 e Task 11.2 rodam em paralelo (endpoints e arquivos independentes)
> Decisões do usuário (2026-09-27): "margem por categoria" do SPEC vira `agrupador=grupo|setor|familia` (as três dimensões, no mesmo padrão da Curva ABC — sem `id`: uma linha por item da dimensão; com `id`: as linhas viram os PRODUTOS daquele item); `agrupador=fornecedor` fica **adiado** (sem rota) até haver uma fonte de dados barata que ligue produto a fornecedor — a Curva ABC de Fornecedor é a de compras, não a de margem por produto vendido. Critério de margem: como a Curva ABC — soma o lucro só dos itens com custo (CMV, `vendaitem.pcusto`) e sinaliza `semCusto`, sem anular o valor. Margem mínima de `/abaixo-minimo` é digitada pelo usuário na hora (parâmetro `minimo`, obrigatório), não uma configuração fixa. As duas rotas leem `vendas_produto_dia_cache` (nunca `vendaitem`/`vendacupom`/`flagvc`), com `resolverPeriodoFechado` (fim limitado a ontem) e `verificarCobertura` (503 quando o cache não cobre o período), no mesmo padrão da Fase 13.

#### Task 11.1 — Endpoint de margem por produto, grupo, setor ou família
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js`, `backend/src/modules/rankingProdutos/cacheProduto.js` (`resolverPeriodoFechado`, `verificarCobertura`, `montarQuantidadeVendidaDoCache` como referência de leitura do cache) disponíveis
- Output: `backend/src/modules/rentabilidade/margem.controller.js` (+ service e routes) — `GET /api/rentabilidade/margem?inicio&fim&agrupador=produto|grupo|setor|familia[&id=N][&ordenarPor=faturamento|lucro|margemPercentual][&limite=N]` → `{ inicio, fim, fimSolicitado, agrupador, id?, ordenarPor, limite, totalItens, resumo: { faturamento, custoTotal, lucro, margemPercentual, semCusto }, itens: [{ id, nome, faturamento, custoTotal, lucro, margemPercentual, semCusto }] }`. `resumo` = margem bruta agregada de TODO o filtro (sem limite); `ordenarPor` padrão `faturamento` desc (cobre "produtos que mais geram faturamento"; `lucro` cobre "produtos que mais geram lucro"). `agrupador=fornecedor` (ou qualquer valor fora da whitelist) → 400.
- Testes críticos:
  - [x] Margem por produto é calculada corretamente a partir de `vendaitem.vtotal` e do custo (CMV, `vendaitem.pcusto`), agregada por `agrupador` (soma só os itens com custo; `semCusto` sinaliza quando falta)
  - [x] `agrupador` fora da lista permitida (`produto`, `grupo`, `setor`, `familia`) retorna status 400

#### Task 11.2 — Endpoint de evolução da margem e produtos abaixo do mínimo
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js`, `cacheProduto.js` disponíveis
- Output: `backend/src/modules/rentabilidade/margemEvolucao.controller.js` (+ service e routes) — `GET /api/rentabilidade/evolucao?inicio&fim[&nivel=grupo|setor|familia&id=N]` → `{ inicio, fim, fimSolicitado, itens: [{ periodo: 'AAAA-MM', faturamento, custoTotal, lucro, margemPercentual, semCusto }] }` em ordem cronológica (um item por mês do intervalo); `GET /api/rentabilidade/abaixo-minimo?inicio&fim&minimo=N[&nivel&id][&limite]` → `{ inicio, fim, fimSolicitado, minimo, limite, totalItens, itens: [{ id, nome, faturamento, custoTotal, lucro, margemPercentual, semCusto }] }` ordenado por `margemPercentual` ascendente, só produtos com `margemPercentual < minimo`; `minimo` ausente ou inválido → 400.
- Testes críticos:
  - [x] `/evolucao` retorna a margem agregada por período (por mês) em ordem cronológica
  - [x] `/abaixo-minimo` lista apenas produtos cuja margem calculada é inferior ao `minimo` informado pelo usuário

### Fase 12 — Rentabilidade: Frontend (tela `/rentabilidade` exibe margem e evolução sem erro no console)
> Dependências: Fase 11
> Paralelismo: task única nesta fase — não se aplica

#### Task 12.1 — Tela de Rentabilidade
- Agent: Frontend Engineer
- Input: contratos de `/api/rentabilidade/margem`, `/evolucao` e `/abaixo-minimo` definidos (Tasks 11.1 e 11.2); "margem por fornecedor" fica fora por decisão do usuário
- Output: `frontend/src/pages/Rentabilidade/RentabilidadePage.jsx`
- Testes críticos:
  - [ ] Exibe margem bruta e gráfico de evolução da margem ao longo do tempo a partir de uma resposta mock
  - [ ] Lista produtos com margem abaixo do mínimo com destaque visual

## Sprint 5 — Módulo de Estoque Inteligente navegável com dados reais

### Fase 13 — Estoque Inteligente: API (`npm test` completo passa no backend — inclui `estoque`)
> Dependências: Fase 4 e Fase 7 (colunas de estoque e cobertura já mapeadas)
> Paralelismo: Task 13.1 e Task 13.2 rodam em paralelo (endpoints e arquivos independentes; a montagem em `app.js` é feita pelo orquestrador depois das duas).
> Decisões do usuário (2026-09-26): estoque atual = `produto.qtestoque`, mínimo = `produto.qtminima`, máximo = `produto.qtmaxima` (`produto.Estoque` é só a flag S/N). **Produtos bloqueados (`produto.situacao = 'B'`) e produtos que não controlam estoque (`produto.Estoque = 'N'`) ficam fora de tudo** nas rotas de estoque (listas, contagens e somas; decisão de 2026-09-26 — o filtro de `Estoque` NÃO vale para `/api/ranking-produtos/demanda-baixo-estoque`). Ruptura: `qtestoque <= 0`, **somente de produtos com venda válida no período** (os demais com estoque aparecem em "parados"). Próximo da ruptura: produto com venda no período e (`0 < qtestoque <= qtminima` ou cobertura < 7 dias). Excesso: `qtestoque > qtmaxima` só quando `qtmaxima > 0` (qualquer produto, com ou sem venda). Cobertura em dias = `qtestoque` ÷ venda média diária do período (estoque <= 0 tem cobertura 0). Parados: `qtestoque > 0` e nenhuma venda válida no período; valor parado = `qtestoque` × `produto.precocusto`. O período segue a regra dos dias fechados: o `fim` é limitado a ontem (`resolverPeriodoFechado`); a resposta traz `fim` efetivo e `fimSolicitado`; `inicio` posterior a ontem → 400. Venda válida = `JOIN_VENDA_VALIDA` + `WHERE_VENDA_VALIDA`. Filtro de departamento opcional `nivel=grupo|setor|familia` + `id` (`buildDepartmentFilter`). **Fora desta fase por decisão do usuário: "produtos próximos do vencimento" (`/api/estoque/vencimento`) — sem rota; a fonte de dados (`comprarast.dVal`/`produto.validade`) não foi confirmada e está vazia no dev.**

#### Task 13.1 — Endpoint de níveis de estoque (atual, mínimo, máximo, ruptura, próximo da ruptura, excesso)
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js`, `vendaValida.js` e `backend/src/modules/rankingProdutos/cacheProduto.js` (`resolverPeriodoFechado`) disponíveis
- Output: `backend/src/modules/estoque/estoque.controller.js` (+ service e routes) — `GET /api/estoque/niveis?inicio&fim[&nivel=grupo|setor|familia&id=N][&classificacao=ruptura|proximo_ruptura|excesso][&limite=N]` → `{ inicio, fim, fimSolicitado, classificacao, limite, totalItens, resumo: { ruptura, proximoRuptura, excesso }, itens: [{ id, nome, estoqueAtual, estoqueMinimo, estoqueMaximo, quantidadeVendida, mediaDiaria, coberturaDias, classificacao }] }`. `classificacao` padrão `ruptura`; `resumo` traz as três contagens (do filtro de departamento, sem limite). Ordenação: ruptura por quantidadeVendida desc; próximo da ruptura por menor cobertura; excesso por maior excesso (`qtestoque - qtmaxima`). `limite` padrão 50, máx. 500.
- Testes críticos:
  - [x] Produtos com estoque atual menor ou igual a 0 e venda no período aparecem classificados como ruptura (produtos sem venda no período não entram)
  - [x] Produtos com estoque atual acima do máximo configurado (com `qtmaxima > 0`) aparecem classificados como excesso
  - [x] Produtos bloqueados (`situacao = 'B'`) não entram em nenhuma classificação nem no `resumo`
  - [x] Produtos que não controlam estoque (`produto.Estoque = 'N'`) não entram em nenhuma classificação nem no `resumo`

#### Task 13.2 — Endpoint de cobertura de estoque e produtos parados (com valor parado)
- Agent: Backend Engineer
- Input: `backend/src/shared/queryFilters.js`, `vendaValida.js` e `cacheProduto.js` (`resolverPeriodoFechado`) disponíveis
- Output: `backend/src/modules/estoque/estoqueCobertura.controller.js` (+ service e routes) — `GET /api/estoque/cobertura?inicio&fim[&nivel&id][&limite]` → itens `{ id, nome, estoqueAtual, quantidadeVendida, mediaDiaria, coberturaDias }` de produtos com venda no período, ordenados pela menor cobertura; `GET /api/estoque/parados?inicio&fim[&nivel&id][&limite]` → `{ ..., totalItens, valorTotalParado, itens: [{ id, nome, estoqueAtual, custoUnitario, valorParado }] }` ordenado por valor parado desc (`valorTotalParado` = soma de todos os parados do filtro, não só da página). `limite` padrão 50, máx. 500. **`/vencimento` não é implementado nesta fase.**
- Testes críticos:
  - [x] Cobertura em dias é calculada como estoque atual dividido pela média diária de vendas do período, para um produto com histórico conhecido
  - [x] Produto com estoque positivo e sem vendas registradas no período aparece em `/parados` e entra no `valorTotalParado` (estoque × custo)
  - [x] Produtos bloqueados (`situacao = 'B'`) não aparecem em cobertura nem em parados
  - [x] Produtos que não controlam estoque (`produto.Estoque = 'N'`) não aparecem em cobertura nem em parados (nem no `valorTotalParado`)

#### Task 13.3 — Rotas de estoque (e alta demanda) lendo o cache por produto
> Adicionada após a validação da Fase 13 no banco de dev: a primeira consulta de um período de 12 meses agregando `vendaitem`/`vendacupom` levou 41–51 s (limite de 30 s) e as repetidas ~1–4 s (dados fora da memória do banco na primeira leitura). Decisão do usuário: somar a quantidade vendida a partir de `vendas_produto_dia_cache` (Task 7.3/7.4), como já fazem `crescimento`, `queda` e `/novos`. Depende das Tasks 13.1, 13.2 e 7.2.
- Agent: Backend Engineer
- Input: `vendas_produto_dia_cache` populada pelo job `job:cache-produtos`; `cacheProduto.js` (`verificarCobertura`, `ErroCacheIncompleto`, `resolverPeriodoFechado`)
- Output: `GET /api/estoque/niveis`, `/cobertura`, `/parados` e `GET /api/ranking-produtos/demanda-baixo-estoque` passam a obter a quantidade vendida por produto no período de `vendas_produto_dia_cache` (`SUM(quantidade)`, ignorando o produto 0 da sentinela), sem consultar `vendaitem`, `vendacupom` nem `flagvc`; antes de consultar, verificam a cobertura do cache nos dias do período efetivo e respondem 503 `{ erro }` claro quando faltam dias fechados (o mesmo padrão de `crescimento`/`queda`); `quantidadeVendida` arredondada a 3 casas. Regras de negócio, contratos e filtros das rotas não mudam.
- Testes críticos:
  - [x] As rotas de estoque e a de alta demanda somam a quantidade vendida a partir de `vendas_produto_dia_cache`, sem consultar `vendaitem`, `vendacupom` nem `flagvc`
  - [x] Quando o cache não cobre todos os dias fechados do período, essas rotas respondem 503 com mensagem clara
  - [x] `quantidadeVendida` sai arredondada a 3 casas (sem ruído de ponto flutuante como 16,689999999999998)

### Fase 14 — Estoque Inteligente: Frontend (tela `/estoque` exibe rupturas e permite filtrar por departamento)
> Dependências: Fase 13
> Paralelismo: task única nesta fase — não se aplica

#### Task 14.1 — Tela de Estoque Inteligente
- Agent: Frontend Engineer
- Input: contratos de `/api/estoque/niveis`, `/cobertura` e `/parados` definidos (Tasks 13.1 e 13.2); vencimento fica fora por ora
- Output: `frontend/src/pages/Estoque/EstoquePage.jsx` (+ `frontend/src/services/estoqueService.js`, rota `#/estoque` e link no painel), com: resumo (contagens de ruptura, próximo da ruptura e excesso — não exclusivas —, que também selecionam a lista), listas de níveis (ruptura, próximos da ruptura, excesso), cobertura em dias e produtos parados com o valor total parado; filtro de departamento (Grupo, Setor ou Família + item com "Todos", reaproveitando `GET /api/curva-abc/itens`), `PeriodFilter` (padrão: 30 dias terminando ontem), controle de quantidade de itens (padrão 10, máx. 500), aviso de período ajustado (`fim` ≠ `fimSolicitado`) e estados próprios para 503 (cache do período ainda não preparado). "Próximos do vencimento" fica fora por decisão do usuário.
- Testes críticos:
  - [x] Exibe lista de produtos em ruptura e próximos da ruptura a partir de uma resposta mock
  - [x] Trocar o filtro de departamento (grupo/setor/família) refaz a chamada à API com o parâmetro correto

---

## Resumo de paralelismo e agents

**Tasks que rodam em paralelo (mesma fase, arquivos independentes):**
- Fase 1: Task 1.1 + Task 1.2
- Fase 2: Task 2.1 + Task 2.2
- Fase 3: Task 3.1 + Task 3.2
- Fase 4: Task 4.1 + Task 4.2
- Fase 5: Task 5.1 + Task 5.2 + Task 5.3 (depois, em sequência: Task 5.4 → Task 5.5)
- Fase 6: Task 6.1 + Task 6.2
- Fase 7: Task 7.1 + Task 7.2 (depois, em sequência: Task 7.3 → Task 7.4)
- Fase 9: Task 9.1 (depois: Task 9.2, depois Task 9.3)
- Fase 11: Task 11.1 + Task 11.2
- Fase 13: Task 13.1 + Task 13.2 (depois: Task 13.3)

Fases 8, 9, 10, 12 e 14 têm task única (sem paralelismo interno).

**Agents necessários:**
- **Backend Engineer** — executa todas as tasks de API/backend (Tasks 1.1, 2.1, 3.1, 4.1, 5.1-5.3, 5.5, 7.1-7.2, 7.4, 9.1-9.3, 11.1-11.2, 13.1-13.3)
- **Frontend Engineer** — executa todas as tasks de UI/frontend (Tasks 1.2, 3.2, 4.2, 6.1-6.2, 8.1, 10.1, 12.1, 14.1)
- **Database Engineer** — executa as tasks de migration (Tasks 2.2, 5.4 e 7.3)

Total: **3 papéis de agent distintos**. Para explorar o paralelismo máximo dentro de uma única fase, o pico é a Fase 5 (3 tasks de Backend Engineer em paralelo), o que exigiria 3 instâncias do agent Backend Engineer rodando simultaneamente; nas demais fases, no máximo 1 Backend Engineer + 1 Frontend Engineer (ou 1 Database Engineer) simultâneos são suficientes.
