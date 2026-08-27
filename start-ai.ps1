# Comodita' per Windows: doppio clic o ".\start-ai.ps1" dal terminale.
# La logica vera sta in tools/start-ai.mjs, che funziona anche su macOS e
# Linux — qui non si duplica niente, si delega soltanto.
# Equivalente multipiattaforma:  npm run scanner
node (Join-Path $PSScriptRoot 'tools\start-ai.mjs') @args
exit $LASTEXITCODE
