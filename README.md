# ASMA — generatore di carte immaginarie

Da una scacchiera 8×8 di pedine nasce una città completa: strade, isolati,
quartieri, fiumi, ponti e nomi. Il risultato si stampa su due fogli A3 — il
fronte del pieghevole e la mappa — oppure si esporta in SVG.

Le pedine sono lo **scheletro**: la città cresce intorno a loro.

---

## In tre minuti

Serve solo **Node.js 18 o superiore**. Nient'altro: il progetto non ha
dipendenze da installare, `npm install` non serve.

```bash
git clone https://github.com/LorenzoErcoli/asma-generative-maps.git
cd asma-generative-maps
npm start
```

Poi apri **http://localhost:8123** nel browser. Dentro l'interfaccia, il
pulsante **?** in alto a sinistra spiega come si usa.

Per fermare il server: `Ctrl+C` nel terminale.

### Installare Node.js

Controlla se ce l'hai già:

```bash
node --version
```

Se risponde `v18.x` o più alto sei a posto. Altrimenti:

- **macOS** — scarica l'installer LTS da [nodejs.org](https://nodejs.org),
  oppure `brew install node` se usi Homebrew.
- **Windows** — installer LTS da [nodejs.org](https://nodejs.org), scelta
  predefinita in tutti i passaggi.

Su macOS, dopo l'installazione apri un terminale **nuovo**: quello già aperto
non conosce ancora il comando.

---

## Cosa c'è dentro

| Comando | Cosa fa |
|---|---|
| `npm start` | Il generatore di carte su http://localhost:8123 — **è questo il progetto** |
| `npm run scanner` | Lo scanner con la camera, su http://localhost:8765 (facoltativo) |
| `npm test` | Verifica che il generatore funzioni su questa macchina |
| `npm run audit` | Controllo completo su 24 scacchiere, con galleria HTML dei risultati |
| `npm run setup-https` | Certificato locale, solo per usare la camera da un iPad |
| `npm run fronte` | Rigenera l'immagine della copertina dal PDF — serve solo se cambi la copertina |

Tutto gira **in locale**. Niente va su internet, tranne — se e solo se
configuri una chiave — la rilettura AI dello scanner.

L'immagine della copertina è **già nel repository**: `npm run fronte` serve
solo se sostituisci `assets/fronte.pdf`. Richiede Python con PyMuPDF
(`pip install pymupdf`), e su macOS il comando di solito è `python3`:

```bash
python3 tools/render-fronte.py
```

---

## Stampare

Il pulsante **Stampa** produce esattamente **due pagine A3 orizzontali**:

1. il fronte del pieghevole, col numero della mappa nel riquadro «N:»
2. la mappa

Nel dialogo di stampa del browser scegli **A3** e **orizzontale**, e lascia i
margini predefiniti. Se la stampante non ha l'A3, «adatta al foglio» su A4
funziona: esce più piccola ma corretta.

> Il numero è lo stesso sulle due facce, ed è ricavato dalla scacchiera: la
> stessa disposizione di pedine dà sempre la stessa città e lo stesso numero.

---

## Lo scanner con la camera (facoltativo)

Serve solo se hai la **scacchiera fisica** con le pedine colorate: una camera
la inquadra e riempie la griglia al posto tuo. Senza, si lavora benissimo a
mano — è una comodità, non un requisito.

```bash
npm run scanner
```

Poi apri **http://localhost:8765/scanner.html**.

### Dall'iPad o dal telefono

Qui serve un passaggio in più. Il browser dà accesso alla fotocamera solo in
«contesto sicuro»: `https://` oppure `http://localhost`. Dal computer stesso
localhost basta; da un altro dispositivo l'indirizzo è `http://192.168.x.x`,
che non lo è. Quindi serve un certificato locale:

```bash
npm run setup-https
npm run scanner
```

Il terminale stampa l'indirizzo da usare sull'iPad. La prima volta devi anche
fidarti del certificato:

1. sull'iPad apri `http://<ip-del-computer>:8765/certs/asma-local-ca.cer`
2. **Impostazioni → Generale → VPN e gestione dispositivo** → installa il profilo
3. **Impostazioni → Generale → Info → Certificati attendibili** → attiva
   «ASMA Local Camera CA»

Poi apri l'indirizzo `https://...` che il terminale ha stampato.

Il computer e l'iPad devono stare sulla **stessa rete Wi-Fi**. Se cambi rete,
l'indirizzo IP cambia e il certificato va rigenerato: `npm run setup-https -- --force`.

**Su macOS e Linux** il certificato è generato con `openssl`, che c'è già di
serie. **Su Windows** con gli strumenti di sistema, via PowerShell. In
entrambi i casi il comando è lo stesso.

### La rilettura AI (facoltativa nella facoltativa)

Lo scanner riconosce le pedine da solo. Una chiave OpenAI aggiunge una
rilettura assistita nei casi dubbi, ed è **a pagamento**. Senza chiave tutto
il resto funziona: camera, riconoscimento, invio alla mappa.

Per accenderla, scrivi la chiave nel file `.env.local` (creato al primo avvio
dello scanner, ed escluso da Git):

```
OPENAI_API_KEY=sk-...
```

---

## Se qualcosa non va

**«node: command not found» / «node non è riconosciuto»**
Node non è installato, o il terminale è stato aperto prima di installarlo.
Chiudilo e aprine uno nuovo.

**«EADDRINUSE» oppure la pagina non si apre**
La porta è già occupata, di solito da un avvio precedente rimasto attivo.
Chiudi l'altro terminale, oppure cambia porta — ma la sintassi non è la
stessa ovunque:

```bash
PORT=8200 npm start          # macOS, Linux, Git Bash
```
```powershell
$env:PORT=8200; npm start    # PowerShell su Windows
```

**La pagina si apre ma la scacchiera è vuota e non succede niente**
Apri la console del browser (F12, scheda Console) e guarda se ci sono errori
in rosso. Quasi sempre è una cartella spostata: `js/`, `css/`, `assets/` e
`vendor/` devono restare accanto a `index.html`.

**Il riquadro della camera dice 404**
Stai usando `npm start`, che serve solo il generatore. Lo scanner è un server
a parte: `npm run scanner`.

**La camera non parte sull'iPad**
Quasi sempre è il certificato: rifai `npm run setup-https -- --force` dopo aver
verificato che iPad e computer sono sulla stessa Wi-Fi, e ricontrolla che
«ASMA Local Camera CA» sia attivo fra i certificati attendibili.

**In stampa esce una pagina bianca di troppo**
Nel dialogo di stampa controlla che la scala sia «predefinita» e non
«personalizzata»: una scala manuale può far sforare la mappa sulla pagina
successiva.

**`npm test` segnala «strade dentro un edificio»**
È un avviso, non un errore, e non dipende dalla tua installazione: è un
difetto noto e aperto del generatore (le rampe dei ponti vengono tirate in
retta invece che instradate lungo le strade). Se il comando finisce con
`generator smoke: OK`, da te funziona tutto.

---

## Per chi mette le mani nel codice

```
index.html          la console e la scacchiera
js/                 il generatore, caricato come script classici in quest'ordine:
  geometry.js         primitive geometriche, rumore, PRNG con seme
  naming.js           i nomi dei luoghi e delle strade
  world.js            campagna, campo urbano e dell'acqua, quartieri
  tessuto.js          il motore vero: strade, isolati, edifici, ponti (il file grosso)
  render.js           da geometria a SVG
  main.js             la regia: legge la scacchiera, orchestra, compone
  ui.js               console, pennelli, scanner, stampa
serve.js            il server di sviluppo del generatore
ai-server.mjs       il server dello scanner (camera, HTTPS, AI)
tests/              harness + smoke test + audit sui 24 scenari
tools/              script di servizio (certificati, avvio scanner, copertina)
```

Niente build, niente bundler, niente dipendenze: si modifica un file e si
ricarica la pagina.

Il generatore è **deterministico**: il seme nasce dall'hash della scacchiera,
quindi la stessa disposizione di pedine produce sempre la stessa città. È
questo che rende i test possibili.

`tests/map-audit.cjs` genera 24 città e verifica gli **invarianti geometrici** —
regole che devono valere su ogni carta: nessuna strada guada il fiume fuori
dai ponti, nessuna piazza ha meno di due accessi, la rete stradale resta un
pezzo solo. Produce anche una galleria HTML per guardare i risultati. Il
percorso del file viene stampato a fine esecuzione.

Difetti noti e aperti sono elencati nei commenti del codice dove stanno, non
in una lista a parte: cerca `MAX_APPROACH` in `js/tessuto.js` per quello
principale.
