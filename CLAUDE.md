# GestãoEverSoftPlus
> Dashboard web que substitui o relatório lento e desatualizado do ERP, dando ao gestor uma visão ampla e visual do negócio (vendas, ranking de produtos, curva ABC, rentabilidade e estoque).

## Stack
| Camada | Tecnologia |
|--------|------------|
| Backend | Node.js |
| Frontend | React |
| Banco de dados | MariaDB (banco já existente do ERP) |
| Gráficos | a definir (ECharts, Recharts ou Chart.js — decisão em aberto no SPEC) |

## Estrutura de pastas
> Scaffold criado (Sprint 1, Fase 1 do PLAN.md). Cada pasta tem um `README.md` de uma linha descrevendo sua responsabilidade.

```
Gestao/
├── backend/                 # API Node.js
│   ├── src/
│   │   ├── app.js            # cria a app Express e a rota /health
│   │   ├── index.js           # ponto de entrada — sobe o servidor
│   │   ├── modules/         # um diretório por módulo do SPEC: auth, vendas, rankingProdutos, curvaAbc, rentabilidade, estoque
│   │   ├── db/               # conexão MariaDB e queries
│   │   └── jobs/              # rotinas de agregação/cache: vendasPeriodoCache.job.js (por dia) e vendasProdutoCache.job.js (por dia e produto); rodar com npm run job:cache-vendas / job:cache-produtos
│   └── tests/                # espelha src/ — health.test.js cobre a rota /health
├── frontend/                 # aplicação React (dashboard)
│   ├── src/
│   │   ├── main.jsx           # ponto de entrada React
│   │   ├── App.jsx            # layout base
│   │   ├── pages/             # uma tela por módulo (Vendas, Ranking, Curva ABC, Rentabilidade, Estoque)
│   │   ├── components/        # componentes reutilizáveis (gráficos, filtros de período, etc.)
│   │   └── services/          # chamadas à API do backend
│   └── tests/                 # espelha src/ — App.test.jsx cobre o layout base
└── spec.md                    # especificação do projeto
```

## Como rodar localmente
> Comandos exatos ainda não definidos no SPEC (projeto greenfield). Abaixo, convenção padrão para a stack Node.js + React; nomes de scripts, variáveis de ambiente e porta são "a definir".

**Backend**
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Variáveis de ambiente do backend (`backend/.env`, ver `.env.example`): `PORT` (porta do servidor Express). Credenciais do MariaDB (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`) serão adicionadas quando o módulo de conexão for implementado (PLAN.md, Fase 2).

## Padrões de código
- Nomenclatura de arquivos: backend em kebab-case/lowerCamelCase por responsabilidade (ex: `auth.controller.js`, `auth.service.js`); componentes React em PascalCase (ex: `VendasPage.jsx`)
- Nomenclatura de variáveis e funções: camelCase em todo o projeto (JS/JSX)
- Estrutura de endpoints: REST sob `/api/<modulo>` (ex: `/api/auth/login`, `/api/vendas/faturamento`), um `controller` por módulo em `backend/src/modules/<modulo>/`
- Estrutura de componentes: uma pasta por tela em `frontend/src/pages/<Modulo>/`, componentes reutilizáveis em `frontend/src/components/`
- Tipagem: JavaScript puro (sem TypeScript) — decisão tomada na criação do scaffold para manter simplicidade; SPEC não exigia TypeScript

## TDD
- Framework backend: Jest + Supertest (decisão tomada na criação do scaffold — SPEC não especificava)
- Framework frontend: Vitest + React Testing Library (decisão tomada na criação do scaffold — pareia nativamente com Vite)
- Onde ficam os testes: `backend/tests/` (espelha `backend/src/`) e `frontend/tests/` (espelha `frontend/src/`)
- Regra: a definir (cobertura mínima não definida no SPEC)
- Testes críticos deste projeto:
  - [ ] Login funciona e dá acesso ao dashboard para os 3 perfis (dono, gestor, gerente de loja)
  - [ ] Apenas vendas com `flagvc.Venda = 1` (join por `vendacupom.Flag = flagvc.flag`) e `vendacupom.status = 0` (ativa) entram nos indicadores de venda
  - [ ] Comparativos entre períodos usam a tabela de histórico/cache, não consultam diretamente as tabelas transacionais completas
  - [ ] Filtro de período funciona em todos os módulos essenciais (Vendas, Ranking de Produtos, Curva ABC, Rentabilidade, Estoque)
  - [ ] Vendas/estoque por departamento permitem navegar por grupo, setor e família

## Nunca fazer
- Nunca considerar como venda válida um registro com `flagvc.Venda ≠ 1` ou `vendacupom.status = 5` (cancelada)
- Nunca consultar diretamente as tabelas transacionais completas (`vendacupom`, `vendaitem`) para montar comparativos com períodos anteriores — usar a tabela de agregação/cache
- Nunca implementar funcionalidades fora do escopo definido no SPEC (central de alertas, IA de reposição, previsão de vendas, promoções inteligentes, clientes, cesta de compras, fornecedores, perdas, operadores/caixas, mapa de calor, assistente do gestor, índice de saúde) sem antes atualizar o SPEC. Exceção decidida pelo usuário (2026-09-25, já no SPEC): as dimensões Cliente, Fornecedor e Marca existem **somente** como dimensão de análise da Curva ABC — nada além disso desses módulos; dados de `clifor` só aparecem como nome exibido (nunca em log)
- Nunca implementar edição de preço de produto pelo gestor nesta fase (fora de escopo)
- Nunca implementar diferenciação de permissões entre os perfis (dono/gestor/gerente de loja) nesta fase — todos têm o mesmo acesso por decisão explícita

## Decisões em aberto
- [ ] Biblioteca de gráficos definitiva (ECharts, Recharts ou Chart.js)
- [ ] Diferenciação de permissões entre dono, gestor e gerente de loja (fase futura)
- [ ] Edição de preço de produto pelo próprio gestor (fase futura)
- [ ] Número exato de usuários simultâneos esperados
- [ ] Detalhamento técnico da estratégia de agregação/cache (frequência do job, estrutura das tabelas)
