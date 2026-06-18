# Sobe APENAS a infraestrutura local: PostgreSQL + Redis.
# NÃO sobe mock-meta (isolado atrás do profile "mock").
# Uso (PowerShell):  .\scripts\dev\up-infra.ps1
$ErrorActionPreference = "Stop"
$BackendRoot = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $BackendRoot

Write-Host "[dev] Subindo Postgres + Redis (sem mock-meta)..." -ForegroundColor Cyan
docker compose up -d postgres redis

Write-Host ""
docker compose ps

Write-Host ""
Write-Host "[dev] Infra no ar. Postgres :5432  ·  Redis :6380 (externo)." -ForegroundColor Green
Write-Host "[dev] mock-meta e LEGADO/OPCIONAL e NAO sobe aqui." -ForegroundColor Cyan
Write-Host "[dev] Sob demanda: docker compose --profile mock up -d mock-meta" -ForegroundColor Cyan
Write-Host "[dev] Proximo: backend (npm run dev), worker (npm run dev:worker), frontend." -ForegroundColor Cyan
