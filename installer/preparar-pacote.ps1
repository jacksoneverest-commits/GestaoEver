<#
Monta installer\staging (backend + node_modules de producao + node.exe) e compila o
instalador com o Inno Setup (ISCC.exe). Rode na maquina de desenvolvimento:
  .\installer\preparar-pacote.ps1
Requisitos: Node LTS (64 bits) e Inno Setup 6.3+ (https://jrsoftware.org/isinfo.php).
O PC do cliente NAO precisa de Node nem de npm: o instalador leva o node.exe junto.
#>
param(
  [string]$Versao = "1.0.0"
)
$ErrorActionPreference = "Stop"
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Staging = Join-Path $PSScriptRoot "staging"

$nodeCmd = Get-Command node -ErrorAction Stop
if ((node -p "process.arch") -ne "x64") { throw "Use um Node de 64 bits (x64)." }

if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
$bk = Join-Path $Staging "backend"
New-Item -ItemType Directory -Force (Join-Path $bk "scripts") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Staging "node") | Out-Null

Copy-Item (Join-Path $Raiz "backend\src") (Join-Path $bk "src") -Recurse
Copy-Item (Join-Path $Raiz "backend\package.json"), (Join-Path $Raiz "backend\package-lock.json") $bk
foreach ($f in "iniciar-backend.cmd", "gerar-segredo.js", "testar-conexao.js", "aplicar-migrations.js", "aguardar-api.js") {
  Copy-Item (Join-Path $Raiz "backend\scripts\$f") (Join-Path $bk "scripts")
}
Copy-Item $nodeCmd.Source (Join-Path $Staging "node\node.exe")

Push-Location $bk
npm ci --omit=dev
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm ci falhou" }
Pop-Location

$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "ISCC.exe nao encontrado. Instale o Inno Setup 6.3+." }

& $iscc "/DVersao=$Versao" (Join-Path $PSScriptRoot "GestaoEverSoftPlus.iss")
if ($LASTEXITCODE -ne 0) { throw "Compilacao do instalador falhou" }
Write-Host "Instalador gerado em installer\Output" -ForegroundColor Green
