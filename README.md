# GestãoEverSoftPlus

Dashboard web que substitui o relatório lento e desatualizado do ERP, dando ao gestor uma visão ampla e visual do negócio: vendas, ranking de produtos, curva ABC, rentabilidade e estoque.

## Problema

O ERP atual possui um relatório de gestão lento e tecnologicamente desatualizado (sem gráficos, sem dashboards interativos). O objetivo deste projeto é substituir esse relatório por um dashboard web com indicadores visuais, dando ao gestor uma central de decisão sobre o que está acontecendo no negócio.

## Stack

| Camada | Tecnologia |
|--------|------------|
| Backend | Node.js + Express |
| Frontend | React + Vite |
| Banco de dados | MariaDB (banco já existente do ERP) |
| Gráficos | Recharts |
| Testes (backend) | Jest + Supertest |
| Testes (frontend) | Vitest + React Testing Library |

## Módulos

- **Vendas** — faturamento, comparativo com período anterior, ticket médio, vendas por hora/dia da semana/departamento/forma de pagamento
- **Ranking de produtos** — mais vendidos, maior margem, maior crescimento/queda, parados sem venda, alta demanda com baixo estoque
- **Curva ABC** — classificação cruzada de vendas, margem e estoque por produto, com dimensão de análise selecionável (grupo, marca, família, produto, cliente, fornecedor, setor)
- **Rentabilidade** — margem bruta, por produto e por categoria
- **Estoque** — cobertura e indicadores de estoque por departamento

Detalhamento completo das regras de negócio em [SPEC.md](SPEC.md).

## Estrutura de pastas

```
Gestao/
├── backend/                 # API Node.js
│   ├── src/
│   │   ├── modules/          # um diretório por módulo: auth, vendas, rankingProdutos, curvaAbc, rentabilidade, estoque
│   │   ├── db/                # conexão MariaDB e migrations
│   │   └── jobs/               # rotinas de agregação/cache (rodam diariamente)
│   └── tests/                 # espelha src/
├── frontend/                  # aplicação React (dashboard)
│   ├── src/
│   │   ├── pages/              # uma tela por módulo
│   │   ├── components/         # componentes reutilizáveis (gráficos, filtros de período, etc.)
│   │   └── services/            # chamadas à API do backend
│   └── tests/                  # espelha src/
└── spec.md                     # especificação do projeto
```

## Como rodar localmente

### Backend

```bash
cd backend
npm install
cp .env.example .env   # preencher credenciais do MariaDB
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Testes

```bash
cd backend && npm test
cd frontend && npm test
```

## Jobs de agregação/cache

Os indicadores de comparação entre períodos usam tabelas de cache, atualizadas por jobs diários (não consultam as tabelas transacionais completas do ERP):

```bash
cd backend
npm run job:cache-vendas
npm run job:cache-produtos
```
