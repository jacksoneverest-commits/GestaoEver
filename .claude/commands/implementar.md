---
description: Implementa uma task do PLAN.md — despacha o agent correto do módulo, enforça TDD e dispara o code-reviewer ao final.
argument-hint: "<número da task, ex: 5.1>"
allowed-tools: Read, Grep, Agent
---

Task solicitada: $ARGUMENTS

Passos:

1. Leia `PLAN.md` e localize o cabeçalho `#### Task $ARGUMENTS`. Se não existir, pare e informe ao usuário que a task não foi encontrada, sem inventar uma.

2. Extraia da task: **Agent** (backend-engineer, frontend-engineer ou database-engineer), **Input**, **Output** e **Testes críticos**. Confirme que os pré-requisitos listados em "Input" já existem (ex: se depender de uma fase anterior do PLAN.md, verifique que os arquivos dela já foram criados); se não existirem, pare e avise o usuário em vez de tentar pular a dependência.

3. Delegue a implementação para o agent indicado no campo "Agent" da task (via Agent tool, `subagent_type` correspondente), repassando o texto completo da task (Output e Testes críticos) e reforçando explicitamente: **escrever os testes críticos listados primeiro, antes de qualquer código de implementação** — isso não é opcional, é a regra de TDD do PLAN.md.

4. Depois que o agent de implementação terminar, invoque automaticamente o agent `code-reviewer` (subagent_type: "code-reviewer"), passando os arquivos criados/alterados por ele, mais `SPEC.md` e a própria task do `PLAN.md` como referência, pedindo a classificação BLOQUEANTE/IMPORTANTE/SUGESTÃO.

5. Reporte ao usuário: o que foi implementado (arquivos), o resultado dos testes do módulo, e o relatório do `code-reviewer` na íntegra. Se houver algum achado BLOQUEANTE, diga explicitamente que a task não está pronta e o que falta corrigir.
