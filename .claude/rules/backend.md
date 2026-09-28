---
description: Regras específicas do backend Node.js, complementares ao system prompt do agent backend-engineer.
globs:
  - "backend/**/*.js"
---

# Backend

- Toda função `service` que acessa o banco trata erro explicitamente (`try/catch`) — nunca deixar uma promise de query rejeitada subir crua até o Express.
- Usar sempre o pool de `backend/src/db/connection.js` — nunca instanciar uma conexão MariaDB nova dentro de um módulo.
- Tratar datas recebidas em queries como UTC antes de enviar ao MariaDB, para evitar erro de fuso horário (app roda localmente no Brasil).
- Migration já aplicada nunca é editada — uma mudança de schema vira uma nova migration numerada em sequência.
- `controller` só faz validação de input + chamada ao `service` + resposta HTTP — nenhuma query SQL dentro de um `controller`.
