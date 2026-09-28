---
description: Roda a verificação de encerramento do projeto — testes, checkboxes do PLAN.md, prontidão para clone — e gera o relatório de próximos passos.
allowed-tools: Read, Grep, Glob, Bash
---

Passos:

1. **Testes** — rode o mesmo check dos hooks de `Stop` dos agents de implementação: `cd backend && npm test`, depois `cd frontend && npm test`. Reporte se cada um passou ou falhou (não prossiga para "pronto para clonar" se algum estiver falhando).

2. **Progresso do PLAN.md** — leia `PLAN.md` e conte, por Sprint/Fase, quantos itens `- [ ]` (testes críticos) estão marcados como feitos (`- [x]`) vs. pendentes (`- [ ]`). Liste quais Sprints/Fases estão 100% concluídas e quais têm pendências, citando a task específica.

3. **Prontidão para clone** — verifique, sem assumir nada:
   - `backend/.env.example` e `frontend/.env.example` (se existir) cobrem todas as variáveis realmente usadas no código (procure por `process.env.` no backend e confira contra o `.env.example`);
   - `.gitignore` cobre `node_modules/`, `.env` e artefatos de build;
   - `cd backend && npm install && npm test` e `cd frontend && npm install && npm test` funcionam a partir de uma instalação limpa (pode reusar o `node_modules` já instalado, mas confirme que `package.json`/`package-lock.json` estão presentes e consistentes);
   - `CLAUDE.md` (seção "Como rodar localmente") reflete os comandos reais do projeto.
   Se algo estiver incompleto ou desatualizado, liste como pendência — não declare "pronto para clonar" com pendências abertas.

4. **Relatório final** — gere um relatório com estas seções:
   - **Testes**: resultado de backend e frontend.
   - **Progresso**: % de tasks concluídas por Sprint, com o que falta.
   - **Prontidão para clone**: SIM/NÃO, com a lista de pendências se houver.
   - **Próximos passos**: as próximas tasks do PLAN.md a fazer (em ordem), e as "Decisões em aberto" do SPEC.md/CLAUDE.md ainda não resolvidas.
