@echo off
rem Inicia a API gravando a saida em backend\estado-jobs\backend.log.
rem Uso: iniciar-backend.cmd "<caminho do node.exe>"
set "BACKEND=%~dp0.."
if not exist "%BACKEND%\estado-jobs" mkdir "%BACKEND%\estado-jobs"
cd /d "%BACKEND%"
"%~1" src\index.js >> "estado-jobs\backend.log" 2>&1
