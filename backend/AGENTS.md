# Regras do submódulo backend

Complementa as regras gerais em `../AGENTS.md`. Escopo: `backend/**`.

## Backend
- Toda função `service` que acessa o banco trata erro explicitamente (`try/catch`) — nunca deixar uma promise de query rejeitada subir crua até o Express.
- Usar sempre o pool de `backend/src/db/connection.js` — nunca instanciar uma conexão MariaDB nova dentro de um módulo.
- Tratar datas recebidas em queries como UTC antes de enviar ao MariaDB, para evitar erro de fuso horário (app roda localmente no Brasil).
- Migration já aplicada nunca é editada — uma mudança de schema vira uma nova migration numerada em sequência.
- `controller` só faz validação de input + chamada ao `service` + resposta HTTP — nenhuma query SQL dentro de um `controller`.

## Testes (backend/tests/**)
- O teste é escrito antes do código de implementação — nunca depois (regra de TDD do PLAN.md).
- Cada teste crítico listado numa task do PLAN.md vira exatamente um `it(...)` — não agrupar vários comportamentos num teste só.
- Nome do arquivo de teste espelha o arquivo testado: `x.controller.js` → `x.controller.test.js`.
- Testes nunca dependem do MariaDB real de produção — mockar o pool de conexão ou usar fixtures.
