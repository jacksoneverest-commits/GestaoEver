#Requires -RunAsAdministrator
<#
Instalador de producao do GestaoEverSoftPlus (Windows, rede interna).

Como usar:
  1. No servidor de producao, clone o repositorio (git clone) numa pasta
     dedicada, ex: C:\GestaoEverSoftPlus.
  2. Abra o PowerShell como Administrador.
  3. Rode a partir da raiz do repositorio:
       .\backend\scripts\instalar-producao.ps1

O que este script FAZ sozinho (depois de voce confirmar cada etapa sensivel):
  - Cria backend\.env de producao, incluindo CORS_ORIGINS (nunca sobrescreve sem perguntar).
  - Gera um AUTH_SECRET novo (nunca reaproveita o de dev).
  - Roda "npm ci --omit=dev" no backend.
  - Opcionalmente roda o backfill inicial dos jobs de cache (grava no banco).
  - Opcionalmente registra as tarefas agendadas do backend e do job diario de cache.
  - Testa GET /health no final.

O que este script NUNCA faz sozinho:
  - Aplicar migrations. Cada arquivo em backend\src\db\migrations e listado e o
    script PARA esperando voce confirmar que aplicou manualmente no banco de
    producao com o cliente MariaDB de sua preferencia (regra do projeto: migration
    aplicada nunca e automatica).
  - Instalar dependencia nova (so usa o que ja esta em package.json).

O frontend NAO e instalado aqui: ele fica hospedado na Vercel e recebe a URL desta
API em runtime (campo "Servidor" na tela de login). Este script so instala a API.

Cada etapa que grava no banco ou cria tarefa agendada pede confirmacao (s/N)
antes de agir.
#>

param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"
$BackendDir = Join-Path $RepoRoot "backend"

function Confirmar($mensagem) {
  $resposta = Read-Host "$mensagem (s/N)"
  return ($resposta -eq "s" -or $resposta -eq "S")
}

function Escrever-Titulo($texto) {
  Write-Host ""
  Write-Host "=== $texto ===" -ForegroundColor Cyan
}

function Ler-ValorEnv($caminhoEnv, $chave) {
  if (-not (Test-Path $caminhoEnv)) { return $null }
  $linha = Select-String -Path $caminhoEnv -Encoding UTF8 -Pattern "^$chave=(.*)$" | Select-Object -First 1
  if ($linha) { return $linha.Matches[0].Groups[1].Value.Trim() }
  return $null
}

function Ler-CorsOrigins() {
  while ($true) {
    $entrada = Read-Host "CORS_ORIGINS (origem exata do frontend na Vercel, ex: https://seuapp.vercel.app; varias separadas por virgula)"
    if ([string]::IsNullOrWhiteSpace($entrada)) {
      Write-Host "CORS_ORIGINS vazia: NENHUM frontend conseguira usar a API (todo acesso de navegador sera bloqueado)." -ForegroundColor Yellow
      if (Confirmar "Confirma deixar CORS_ORIGINS vazia?") { return "" }
      continue
    }
    $origens = @()
    $valido = $true
    foreach ($parte in ($entrada -split ",")) {
      $item = $parte.Trim().TrimEnd("/")
      if ($item -eq "") { continue }
      if ($item -notmatch "^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$") {
        Write-Host "Origem invalida: '$item'. Use http(s)://host[:porta], sem caminho." -ForegroundColor Red
        $valido = $false
        break
      }
      $origens += $item
    }
    if ($valido -and $origens.Count -gt 0) { return ($origens -join ",") }
    if ($valido) { Write-Host "Nenhuma origem informada." -ForegroundColor Red }
  }
}

# --- 0. Pre-requisitos ----------------------------------------------------
Escrever-Titulo "Verificando pre-requisitos"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Error "Node.js nao encontrado no PATH. Instale o Node LTS antes de continuar."
  exit 1
}
Write-Host "Node encontrado: $($nodeCmd.Source) ($(node -v))"

if (-not (Test-Path $BackendDir)) {
  Write-Error "Nao encontrei backend\ a partir de $RepoRoot. Rode este script de dentro do repositorio clonado."
  exit 1
}

# --- 1. backend\.env --------------------------------------------------------
Escrever-Titulo "Configuracao do backend (.env de producao)"

$envBackendPath = Join-Path $BackendDir ".env"
$regerarEnvBackend = $true

if (Test-Path $envBackendPath) {
  Write-Host "Ja existe $envBackendPath." -ForegroundColor Yellow
  $regerarEnvBackend = Confirmar "Sobrescrever com novos valores?"
}

if ($regerarEnvBackend) {
  $dbHostValor = Read-Host "DB_HOST (host do MariaDB de producao)"
  $dbUserValor = Read-Host "DB_USER (usuario dedicado da aplicacao, nao o root do ERP)"
  $dbPasswordSecure = Read-Host "DB_PASSWORD" -AsSecureString
  $dbPasswordValor = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPasswordSecure)
  )
  $dbNameValor = Read-Host "DB_NAME (banco de producao do cliente)"
  $portValor = Read-Host "PORT (porta do backend; Enter para 3001)"
  if ([string]::IsNullOrWhiteSpace($portValor)) { $portValor = "3001" }
  $corsOriginsValor = Ler-CorsOrigins

  Write-Host "Gerando AUTH_SECRET novo (nunca reaproveita o de dev)..."
  $authSecretValor = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

  $envBackendConteudo = @"
PORT=$portValor
DB_HOST=$dbHostValor
DB_USER=$dbUserValor
DB_PASSWORD=$dbPasswordValor
DB_NAME=$dbNameValor
AUTH_SECRET=$authSecretValor
CORS_ORIGINS=$corsOriginsValor
"@
  # UTF-8 sem BOM (o BOM quebraria a primeira chave do .env).
  [System.IO.File]::WriteAllText($envBackendPath, $envBackendConteudo, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "backend\.env gravado." -ForegroundColor Green
  Write-Host "AUTH_SECRET foi gerado e gravado em backend\.env (nao e exibido no console)." -ForegroundColor Yellow
} else {
  Write-Host "Mantendo o backend\.env existente."
}

$port = Ler-ValorEnv $envBackendPath "PORT"
if ([string]::IsNullOrWhiteSpace($port)) { $port = "3001" }

# --- 2. Dependencias do backend --------------------------------------------
Escrever-Titulo "Instalando dependencias do backend (npm ci)"
Push-Location $BackendDir
npm ci --omit=dev
Pop-Location

# --- 3. Migrations (nunca automaticas) --------------------------------------
Escrever-Titulo "Migrations pendentes"
Write-Host "Este script NUNCA aplica migration sozinho (regra do projeto)." -ForegroundColor Yellow

$migrationsDir = Join-Path $BackendDir "src\db\migrations"
$migrations = Get-ChildItem -Path $migrationsDir -Filter "*.sql" | Sort-Object Name

foreach ($migracao in $migrations) {
  Write-Host ""
  Write-Host "Migration: $($migracao.FullName)"
  Write-Host "Aplique o conteudo desse arquivo no banco de producao (DB_NAME configurado acima) com seu cliente MariaDB preferido (mysql CLI, HeidiSQL, DBeaver etc). Pule se ja sabe que ela ja foi aplicada nesse banco."
  Read-Host "Pressione Enter para confirmar e seguir para a proxima" | Out-Null
}

# --- 4. Backfill inicial dos caches (grava no banco) ------------------------
Escrever-Titulo "Backfill inicial dos caches (opcional)"
if (Confirmar "Rodar o backfill dos jobs de cache agora? Isso grava no banco configurado acima") {
  $desde = Read-Host "Data de inicio do backfill (AAAA-MM-DD)"
  Push-Location $BackendDir
  node src/jobs/vendasPeriodoCache.job.js --desde $desde
  node src/jobs/vendasProdutoCache.job.js --desde $desde
  Pop-Location
} else {
  Write-Host "Pulando backfill. Rode manualmente depois a partir de backend\:"
  Write-Host "  node src/jobs/vendasPeriodoCache.job.js --desde AAAA-MM-DD"
  Write-Host "  node src/jobs/vendasProdutoCache.job.js --desde AAAA-MM-DD"
}

# --- 5. Tarefa agendada do backend (inicia com o Windows) -------------------
Escrever-Titulo "Tarefa agendada do backend (inicia com o Windows)"
if (Confirmar "Criar a tarefa agendada do backend agora?") {
  $nomeTarefaBackend = "GestaoEverSoftPlus - Backend"
  $indexPath = Join-Path $BackendDir "src\index.js"
  schtasks /create /tn "$nomeTarefaBackend" /tr "`"$($nodeCmd.Source)`" `"$indexPath`"" /sc onstart /rl highest /f
  Write-Host "Tarefa '$nomeTarefaBackend' criada (dispara ao iniciar o Windows)." -ForegroundColor Green
  Write-Host "Teste agora sem reiniciar o servidor: schtasks /run /tn `"$nomeTarefaBackend`""
  Write-Host "Se quiser que rode mesmo sem ninguem logado, configure isso pela interface grafica (taskschd.msc -> Propriedades -> 'Executar estando o usuario conectado ou nao'), pois exige senha de um usuario e o schtasks por linha de comando nao deveria guardar isso num script."
} else {
  Write-Host "Pulando registro da tarefa agendada do backend."
}

# --- 6. Tarefa agendada do job diario de cache -------------------------------
Escrever-Titulo "Tarefa agendada do job diario de cache (01:00)"
if (Confirmar "Criar a tarefa agendada do job diario agora?") {
  $nomeTarefaJob = "GestaoEverSoftPlus - Cache diario"
  $jobPath = Join-Path $BackendDir "src\jobs\agendarJobsDiarios.js"
  schtasks /create /tn "$nomeTarefaJob" /tr "`"$($nodeCmd.Source)`" `"$jobPath`"" /sc daily /st 01:00 /rl highest /f
  Write-Host "Tarefa '$nomeTarefaJob' criada." -ForegroundColor Green
  Write-Host "Configure 'Executar a tarefa assim que possivel apos uma inicializacao agendada perdida' pela interface grafica (taskschd.msc) - ver backend\scripts\agendar-tarefa-windows.md para o passo a passo completo."
} else {
  Write-Host "Pulando. Siga backend\scripts\agendar-tarefa-windows.md manualmente depois."
}

# --- 7. Teste de fumaca -------------------------------------------------------
Escrever-Titulo "Teste de fumaca"
if (Confirmar "O backend ja esta rodando agora (tarefa iniciada ou 'npm start' manual)? Testar GET /health?") {
  try {
    $resposta = Invoke-WebRequest -Uri "http://localhost:$port/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "GET /health -> $($resposta.StatusCode) $($resposta.Content)" -ForegroundColor Green
  } catch {
    Write-Host "Falha ao chamar /health: $($_.Exception.Message)" -ForegroundColor Red
  }
}

# --- 8. Checklist final --------------------------------------------------------
Escrever-Titulo "Checklist final"
Write-Host "- Confirme que backend\.env NAO esta sob controle de versao."
Write-Host "- O AUTH_SECRET esta somente em backend\.env; faca backup seguro desse arquivo e nao reaproveite o segredo em outro ambiente."
Write-Host "- Confirme que o usuario MariaDB da aplicacao tem privilegio minimo (sem DROP/ALTER)."
Write-Host "- Libere no firewall apenas a porta $port para a rede do cliente."
Write-Host ""
Write-Host "URL da API para digitar no campo 'Servidor' da tela de login do frontend (Vercel):" -ForegroundColor Cyan
Write-Host "  http://<ip-ou-nome-deste-servidor>:$port"
Write-Host ""
Write-Host "IMPORTANTE: como a API roda em HTTP e o frontend em HTTPS, em cada navegador (Chrome/Edge) libere" -ForegroundColor Yellow
Write-Host "'Conteudo inseguro' para o dominio da Vercel: chrome://settings/content/insecureContent -> Permitir -> adicionar o dominio." -ForegroundColor Yellow
Write-Host "- Abra o frontend na Vercel, informe a URL da API em 'Servidor' e faca login com um usuario real."
