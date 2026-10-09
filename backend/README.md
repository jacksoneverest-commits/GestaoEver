API Node.js do GestãoEverSoftPlus — expõe os endpoints consumidos pelo frontend.

## Variáveis de ambiente (`.env`, ver `.env.example`)
`PORT`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `AUTH_SECRET` e `CORS_ORIGINS`.

`CORS_ORIGINS` lista as origens exatas do frontend, separadas por vírgula (ex.: `https://seuapp.vercel.app`). Origem não listada não recebe `Access-Control-Allow-Origin`; o preflight responde `Access-Control-Allow-Private-Network: true`.

## Instalação em produção
O instalador único é o Inno Setup (`installer/GestaoEverSoftPlus.iss`; gere com `installer/preparar-pacote.ps1`). Ele leva o Node e as dependências embutidos, pergunta banco/porta/`CORS_ORIGINS`, grava o `.env`, aplica as migrations (opcional, marcado por padrão), cria o primeiro usuário, registra as tarefas agendadas e libera a porta no firewall. O frontend não é instalado no servidor: fica na Vercel. Ao final, informe a URL da API para digitar no campo "Servidor" do login. A API roda em HTTP, então o navegador precisa liberar conteúdo inseguro para o domínio da Vercel (passo a passo em `frontend/README.md`; alternativa: túnel HTTPS).

## Pendência de segurança
Rate limit no login (exigiria `express-rate-limit`, dependência nova).
