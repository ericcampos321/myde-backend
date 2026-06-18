# Diagnóstico do ambiente local (PowerShell). Não aborta no primeiro erro -
# reporta cada item. Nunca imprime segredos do .env.
# Uso (PowerShell):  .\scripts\dev\check-local.ps1
$BackendRoot = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $BackendRoot
$api = "http://localhost:8000"

function Info($m) { Write-Host "[dev] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[dev] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[dev] $m" -ForegroundColor Yellow }

Write-Host "=============================================="
Write-Host " Myde/Maude - diagnostico do ambiente local"
Write-Host "=============================================="

# 1. Infra Docker
Info "Containers (docker compose ps):"
try { docker compose ps --format "  {{.Service}}: {{.State}}" } catch { Warn "  docker compose indisponivel." }

# 2. Backend /health
Write-Host ""
try {
  Invoke-RestMethod "$api/health" -TimeoutSec 3 -ErrorAction Stop | Out-Null
  Ok "backend /health: OK ($api)"
} catch {
  Warn "backend /health: FORA DO AR. Suba o backend com: npm run dev"
  Warn "Pulando checagens que dependem do backend."
  Info "Resumo: infra verificada; backend nao respondeu."
  return
}

# 3. /me
try {
  $me = Invoke-RestMethod "$api/me" -TimeoutSec 3 -ErrorAction Stop
  Ok "/me: OK (tenant: $($me.name))"
} catch {
  Warn "/me: erro. Rodou o seed? -> npm run db:seed (precisa de META_PHONE_NUMBER_ID no .env)"
}

# 4. /conversations (200 [] e estado valido)
try {
  $conv = Invoke-RestMethod "$api/conversations" -TimeoutSec 3 -ErrorAction Stop
  if ($null -eq $conv -or $conv.Count -eq 0) {
    Ok "/conversations: OK (banco sem conversas ainda; estado vazio e normal)"
  } else {
    Ok "/conversations: OK ($($conv.Count) conversa(s) persistida(s))"
  }
} catch {
  Warn "/conversations: erro ao consultar."
}

# 5. Handshake do webhook (GET) usando META_VERIFY_TOKEN do .env SEM imprimi-lo.
Write-Host ""
if (Test-Path .env) {
  $line = Select-String -Path .env -Pattern '^META_VERIFY_TOKEN=' | Select-Object -First 1
  $token = if ($line) { (($line.Line -split '=', 2)[1]).Trim() } else { "" }
  if ($token) {
    try {
      $url = "$api/webhook?hub.mode=subscribe&hub.verify_token=$token&hub.challenge=ping"
      $resp = Invoke-WebRequest $url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
      if ($resp.StatusCode -eq 200) { Ok "webhook GET handshake: OK (200) - META_VERIFY_TOKEN confere" }
      else { Warn "webhook GET handshake: HTTP $($resp.StatusCode)" }
    } catch {
      Warn "webhook GET handshake: falhou (verifique META_VERIFY_TOKEN no .env)"

      $exception = $_.Exception
      if ($null -ne $exception) {
        Warn "  excecao: $($exception.GetType().FullName)"
        if ($exception.Message) {
          Warn "  mensagem: $($exception.Message)"
        }

        $statusCode = $null
        if ($exception.PSObject.Properties.Name -contains 'Response' -and $exception.Response) {
          try {
            $statusCode = [int]$exception.Response.StatusCode
          } catch {
            $statusCode = $null
          }
        }

        if ($null -ne $statusCode) {
          Warn "  status code: $statusCode"
        }
      }
    }
  } else {
    Warn "webhook GET handshake: META_VERIFY_TOKEN vazio no .env - pulando."
  }
} else {
  Warn "webhook GET handshake: .env ausente - pulando."
}

Write-Host ""
Ok "Diagnostico concluido."
