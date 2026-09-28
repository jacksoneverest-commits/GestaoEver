# Regras gerais — GestãoEverSoftPlus

Aplicam-se a qualquer agent, em qualquer domínio do projeto. Ver também `SPEC.md`, `CLAUDE.md` e `PLAN.md` para contexto completo.

## Segurança
- Nunca commitar `.env`, credenciais do MariaDB ou qualquer segredo em arquivo versionado — em `.env.example` só o nome da variável, nunca o valor.
- Nunca concatenar input do usuário (query params, body) direto numa string SQL — sempre queries parametrizadas do `mysql2` (`?`), inclusive nos filtros de período/departamento.
- Nunca logar no console dados sensíveis: senha, token de sessão, ou colunas de `clifor` (dados de cliente).
- Nunca expor stack trace, mensagem de erro do MariaDB ou a query SQL na resposta HTTP ao cliente — logar internamente, responder com mensagem genérica.
- Nunca desabilitar, contornar ou remover os hooks/guard-rails configurados para os agents "para conseguir terminar mais rápido".
- Nunca rodar `git push`, alterar permissão de usuário, ou qualquer ação que afete o repositório remoto ou o banco de produção sem confirmação explícita do usuário.

## Convenções gerais
- Termos de domínio (campos JSON, nomes de rota, variáveis de negócio) ficam em português, espelhando o vocabulário do SPEC.md (`faturamento`, `ticketMedio`, `curvaAbc`) — helpers/utilitários genéricos podem ficar em inglês.
- Toda resposta de erro da API segue `{ erro: "mensagem" }` com o status HTTP correspondente (400 validação, 401 autenticação, 500 erro interno).
- Datas em parâmetros de query e em respostas JSON sempre em ISO 8601 (`YYYY-MM-DD`).
- Não adicionar nenhuma dependência nova (`npm install`) além do que já está em `CLAUDE.md`/`package.json` sem antes confirmar com o usuário.
- Toda funcionalidade implementada precisa ser rastreável a uma task do `PLAN.md` ou a um item de "Essenciais" do `SPEC.md` — se não for, pare e pergunte antes de implementar.
