---
description: Regras específicas do frontend React, complementares ao system prompt do agent frontend-engineer.
globs:
  - "frontend/src/**"
---

# Frontend

- Toda chamada HTTP passa por `frontend/src/services/` — nenhum `fetch`/requisição direta dentro de um componente de página.
- Toda tela que consome a API trata os 3 estados explicitamente: carregando, erro e sucesso — nunca deixar a tela em branco enquanto a requisição está pendente.
- Formatação de moeda (R$) e de data (`dd/mm/aaaa`) sempre via um helper compartilhado — nunca formatar manualmente dentro de cada página.
- Nome do componente de página = nome do arquivo = `<Modulo>Page.jsx` (ex: `VendasPage.jsx`), consistente com a pasta `frontend/src/pages/<Modulo>/`.
