---
description: Regras de teste válidas tanto para backend/tests/** quanto frontend/tests/**, complementares à seção TDD do CLAUDE.md.
globs:
  - "backend/tests/**"
  - "frontend/tests/**"
---

# Testes

- O teste é escrito antes do código de implementação — nunca depois (regra de TDD do PLAN.md).
- Cada teste crítico listado numa task do PLAN.md vira exatamente um `it(...)` — não agrupar vários comportamentos num teste só.
- Nome do arquivo de teste espelha o arquivo testado: `x.controller.js` → `x.controller.test.js`; `X.jsx` → `X.test.jsx`.
- Testes de backend nunca dependem do MariaDB real de produção — mockar o pool de conexão ou usar fixtures.
- Testes de frontend nunca fazem chamada HTTP real — mockar `frontend/src/services/`.
