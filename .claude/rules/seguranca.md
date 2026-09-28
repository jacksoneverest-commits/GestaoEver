---
description: Restrições de segurança que valem para qualquer agent, em qualquer domínio do projeto.
alwaysApply: true
---

# Segurança — vale para todos os agents

- Nunca commitar `.env`, credenciais do MariaDB ou qualquer segredo em arquivo versionado — em `.env.example` só o nome da variável, nunca o valor.
- Nunca concatenar input do usuário (query params, body) direto numa string SQL — sempre queries parametrizadas do `mysql2` (`?`), inclusive nos filtros de período/departamento.
- Nunca logar no console dados sensíveis: senha, token de sessão, ou colunas de `clifor` (dados de cliente).
- Nunca expor stack trace, mensagem de erro do MariaDB ou a query SQL na resposta HTTP ao cliente — logar internamente, responder com mensagem genérica.
- Nunca desabilitar, contornar ou remover os hooks configurados em `.claude/agents/*.md` para "conseguir terminar mais rápido".
- Nunca rodar `git push`, alterar permissão de usuário, ou qualquer ação que afete o repositório remoto ou o banco de produção sem confirmação explícita do usuário nesta conversa.
