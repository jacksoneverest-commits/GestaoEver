# Regras do submódulo frontend

Complementa as regras gerais em `../AGENTS.md`. Escopo: `frontend/src/**`.

## Frontend
- Toda chamada HTTP passa por `frontend/src/services/` — nenhum `fetch`/requisição direta dentro de um componente de página.
- Toda tela que consome a API trata os 3 estados explicitamente: carregando, erro e sucesso — nunca deixar a tela em branco enquanto a requisição está pendente.
- Formatação de moeda (R$) e de data (`dd/mm/aaaa`) sempre via um helper compartilhado — nunca formatar manualmente dentro de cada página.
- Nome do componente de página = nome do arquivo = `<Modulo>Page.jsx` (ex: `VendasPage.jsx`), consistente com a pasta `frontend/src/pages/<Modulo>/`.

## Testes (frontend/tests/**)
- O teste é escrito antes do componente — nunca depois (regra de TDD do PLAN.md).
- Cada teste crítico listado numa task do PLAN.md vira exatamente um `it(...)`.
- Nome do arquivo de teste espelha o arquivo testado: `X.jsx` → `X.test.jsx`.
- Testes nunca fazem chamada HTTP real — mockar `frontend/src/services/`.
