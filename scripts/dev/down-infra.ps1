# Para a infraestrutura local PRESERVANDO os dados (volumes mantidos).
# NUNCA usa `down -v` — isso apagaria banco e conversas reais.
# Uso (PowerShell):  .\scripts\dev\down-infra.ps1
$ErrorActionPreference = "Stop"
$BackendRoot = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $BackendRoot

Write-Host "[dev] Parando containers (docker compose down)..." -ForegroundColor Cyan
docker compose down

Write-Host ""
Write-Host "[dev] Infra parada. Volumes PRESERVADOS (myde_pg_data / redis intactos)." -ForegroundColor Green
Write-Host "[dev] NAO use 'docker compose down -v': APAGA o banco e todas as conversas." -ForegroundColor Yellow
