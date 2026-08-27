#!/bin/bash
# Doppio clic su macOS. Il Finder lo apre nel Terminale.
# Se al posto di partire vedi "impossibile aprire: sviluppatore non
# identificato", fai clic destro sul file e scegli Apri: succede quando il
# progetto arriva come .zip scaricato invece che con git clone.

# Un .command parte dalla cartella home, non dalla propria: ci si sposta.
cd "$(dirname "$0")" || exit 1

# Terminale aperto col doppio clic non sempre eredita il PATH completo:
# si aggiungono i posti dove Node finisce di solito.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "=============================================================="
  echo "  Manca Node.js, che e' l'unica cosa che serve."
  echo "=============================================================="
  echo ""
  echo "  1. Apri  https://nodejs.org"
  echo "  2. Scarica la versione LTS e installala (sempre Continua)"
  echo "  3. Chiudi questa finestra e fai di nuovo doppio clic qui"
  echo ""
  read -r -p "Premi Invio per aprire nodejs.org, o chiudi la finestra. "
  open "https://nodejs.org"
  exit 1
fi

node "tools/avvia.mjs"
