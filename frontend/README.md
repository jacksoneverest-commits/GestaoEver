Aplicação React (dashboard) do GestãoEverSoftPlus.

## Configuração da API
A URL da API é definida em runtime no campo "Servidor" da tela de login (salva no `localStorage`). Ordem de resolução: valor salvo -> `VITE_API_URL` (opcional, ver `.env.example`; é só o padrão inicial) -> `http://localhost:3001`. Não há proxy do Vite: o backend restringe CORS por `CORS_ORIGINS`.

## Deploy na Vercel
`vercel.json` já define framework `vite`, `npm run build` e saída `dist`. O app usa rotas por hash, então não há rewrites. Importe a pasta `frontend/` como projeto na Vercel. Depois, coloque a origem exata gerada (ex.: `https://seuapp.vercel.app`) em `CORS_ORIGINS` no `backend/.env` do servidor da API.

## API em HTTP (conteúdo inseguro)
A Vercel serve o site em HTTPS e a API do cliente roda em HTTP, então o navegador bloqueia por padrão (mixed content). Em cada navegador/máquina (Chrome ou Edge):
1. Abra `chrome://settings/content/insecureContent` (Edge: `edge://settings/content/insecureContent`).
2. Em "Permitido enviar conteúdo inseguro", clique em Adicionar e informe o domínio da Vercel (ex.: `https://seuapp.vercel.app`).
3. Recarregue o app e informe a URL da API no campo "Servidor" (ex.: `http://192.168.0.10:3001`).

Riscos: o tráfego entre navegador e API (incluindo login e token) trafega em HTTP em claro na rede; e a opção do navegador pode ser removida em versões futuras.

Alternativa sem mudança de código: expor a API por um túnel HTTPS (ex.: Cloudflare Tunnel ou ngrok) e informar a URL `https://...` no campo "Servidor"; nesse caso não é preciso liberar conteúdo inseguro.

## Pendência de segurança
Rate limit no login (tentativas de senha) não está implementado; exigiria `express-rate-limit` (dependência nova, a confirmar).
