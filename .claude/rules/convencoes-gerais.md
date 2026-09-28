---
description: Padrões universais de nomenclatura, resposta de API e processo que valem para todo o projeto GestãoEverSoftPlus.
alwaysApply: true
---

# Convenções gerais

- Termos de domínio (campos JSON, nomes de rota, variáveis de negócio) ficam em português, espelhando o vocabulário do SPEC.md (`faturamento`, `ticketMedio`, `curvaAbc`) — helpers e utilitários genéricos podem ficar em inglês.
- Toda resposta de erro da API segue `{ erro: "mensagem" }` com o status HTTP correspondente (400 validação, 401 autenticação, 500 erro interno). Dois status adicionais, sempre com o mesmo formato `{ erro }`: 501 quando o critério/rota é válido no SPEC mas ainda não tem fonte de dados mapeada (ex.: `/api/ranking-produtos/demanda-baixo-estoque` até existir a coluna de estoque); 503 quando o cache/agregação necessário ainda não cobre o período pedido (o cliente não pode corrigir a requisição; a mensagem diz qual job rodar). O frontend trata 501 e 503 como estados próprios, com mensagem específica.
- Datas em parâmetros de query e em respostas JSON sempre em ISO 8601 (`YYYY-MM-DD`).
- Não adicionar nenhuma dependência nova (`npm install`) além do que já está em `CLAUDE.md`/`package.json` sem antes confirmar com o usuário.
- Toda funcionalidade implementada precisa ser rastreável a uma task do `PLAN.md` ou a um item de "Essenciais" do `SPEC.md` — se não for, pare e pergunte antes de implementar.
