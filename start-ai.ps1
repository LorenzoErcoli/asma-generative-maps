$blockedProxy = @($env:HTTPS_PROXY, $env:ALL_PROXY, $env:HTTP_PROXY) | Where-Object { $_ -match '^https?://(?:127\.0\.0\.1|localhost):9/?$' } | Select-Object -First 1
if ($blockedProxy) {
  Write-Host ''
  Write-Host 'Questo terminale ha ereditato il proxy bloccante 127.0.0.1:9.' -ForegroundColor Yellow
  Write-Host 'Chiudi questa finestra, apri Windows PowerShell dal menu Start e rilancia lo stesso comando.' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

if (-not (Test-Path (Join-Path $PSScriptRoot 'certs\asma-local.pfx'))) {
  & (Join-Path $PSScriptRoot 'setup-https.ps1')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$envFile = Join-Path $PSScriptRoot '.env.local'
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $PSScriptRoot '.env.example') $envFile
}
$configured = Select-String -Path $envFile -Pattern '^\s*OPENAI_API_KEY\s*=\s*sk-[A-Za-z0-9_.-]{20,}\s*$' -Quiet
if (-not $configured) {
  Write-Host ''
  Write-Host "Inserisci la chiave nel file: $envFile" -ForegroundColor Yellow
  Write-Host 'La riga deve essere: OPENAI_API_KEY=sk-...' -ForegroundColor Yellow
  Write-Host 'Il file e escluso da Git.' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

node "$PSScriptRoot\ai-server.mjs"
