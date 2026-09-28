# Agendar os jobs diários de cache (Windows)

Este guia registra a tarefa do Agendador de Tarefas do Windows que roda
`npm run job:diario` (backend/src/jobs/agendarJobsDiarios.js) todo dia às 01:00.
Esse script roda em sequência `job:cache-vendas` e `job:cache-produtos`,
decide sozinho se precisa de `--desde` (quando percebe que ficou 2+ dias sem
rodar com sucesso) e grava um log em `backend/estado-jobs/jobs-diarios.log`.

**Este arquivo só documenta o comando — ninguém o executa automaticamente.**
Rode-o você mesmo, no PowerShell, como administrador (ou usuário com permissão
de criar tarefas agendadas). Escreve no banco configurado em `backend/.env`
(no MariaDB, via os dois jobs), então confirme antes que o `.env` aponta para
o banco certo (dev ou produção).

## Comando (ajuste os caminhos se o projeto estiver em outro lugar)

```powershell
schtasks /create `
  /tn "GestaoEverSoftPlus - Cache diario" `
  /tr "\"C:\Program Files\nodejs\node.exe\" \"F:\dev\Gestao\backend\src\jobs\agendarJobsDiarios.js\"" `
  /sc daily `
  /st 01:00 `
  /rl highest `
  /f
```

- `/sc daily /st 01:00`: roda todo dia às 01:00 (depois da meia-noite, para o
  dia anterior poder fechar; ver o cabeçalho do job de produto para o porquê
  de não rodar perto da meia-noite).
- `/rl highest`: evita falha por permissão ao escrever no log/estado.
- `/f`: sobrescreve sem perguntar se a tarefa já existir (rodar de novo é
  seguro, é a mesma definição).
- O comando usa o diretório de trabalho padrão do Agendador (não é
  `F:\dev\Gestao\backend`), mas isso não importa: o script resolve todos os
  caminhos (`.env`, log, estado) a partir da própria localização do arquivo
  (`__dirname`), nunca do diretório corrente.

## Depois de criar, configure a recuperação de horário perdido

O `schtasks /create` não tem uma flag direta para "rodar assim que possível
se perdeu o horário" (computador desligado às 01:00). Configure isso pela
interface gráfica, uma vez:

1. Abra o **Agendador de Tarefas** (`taskschd.msc`).
2. Encontre "GestãoEverSoftPlus - Cache diario" na lista.
3. Clique com o botão direito → **Propriedades** → aba **Configurações**.
4. Marque **"Executar a tarefa assim que possível após uma inicialização
   agendada perdida"**.
5. OK.

Isso não é essencial (o script já se recupera sozinho pedindo `--desde` na
próxima vez que rodar, mesmo que seja horas ou dias depois), mas evita ficar
mais tempo do que o necessário com o cache desatualizado.

## Testar sem esperar até amanhã

```powershell
schtasks /run /tn "GestaoEverSoftPlus - Cache diario"
```

Depois confira `backend\estado-jobs\jobs-diarios.log` e
`backend\estado-jobs\ultima-execucao.json`.

## Remover a tarefa

```powershell
schtasks /delete /tn "GestaoEverSoftPlus - Cache diario" /f
```

## Antes de agendar em produção

- Confira o fuso do MariaDB alvo: `SELECT @@time_zone, NOW();` (a migration
  004 explica por que isso importa para o critério de "dia fechado").
- Confirme que a migration 004 está aplicada nesse banco.
- O primeiro run pode ser mais lento se `--desde` cobrir muito histórico
  (varredura pesada) — considere rodar manualmente uma vez fora do horário de
  uso antes de deixar o agendamento cuidar do resto.
