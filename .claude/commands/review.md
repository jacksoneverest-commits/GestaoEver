---
description: Revisa código do GestãoEverSoftPlus contra SPEC.md e PLAN.md via o agent code-reviewer, classificando achados em BLOQUEANTE, IMPORTANTE e SUGESTÃO.
argument-hint: "[task do PLAN.md, caminho de arquivo/pasta, ou vazio para revisar o diff atual]"
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Agent
---

Escopo pedido pelo usuário: $ARGUMENTS

Passos:

1. Se `$ARGUMENTS` estiver vazio, rode `git diff` (e `git diff --stat`) para identificar o que mudou desde o último commit. Se `$ARGUMENTS` referenciar uma task do PLAN.md (ex: "5.1"), localize essa task em `PLAN.md` e use o campo "Output" para saber quais arquivos revisar. Se for um caminho de arquivo/pasta, use esse escopo diretamente.

2. Leia `SPEC.md` (seções "Módulos", "Regras de negócio identificadas" e "Fora do escopo") e `PLAN.md` (a task correspondente ao escopo, com seu "Output" e "Testes críticos").

3. Invoque o agent `code-reviewer` (via Agent tool, `subagent_type: "code-reviewer"`), passando:
   - os arquivos/diff a revisar;
   - o trecho relevante de SPEC.md e PLAN.md coletado no passo 2;
   - instrução explícita para classificar cada achado em BLOQUEANTE, IMPORTANTE ou SUGESTÃO, no formato definido no system prompt dele.

4. Apresente ao usuário o relatório do `code-reviewer` na íntegra, sem resumir ou omitir nenhum item BLOQUEANTE. Se houver algum BLOQUEANTE, deixe claro no início da resposta que a task não deve ser considerada concluída até resolver.
