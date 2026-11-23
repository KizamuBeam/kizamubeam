---
sidebar_position: 6
title: Estensioni
description: Installare estensioni con modelli di dispositivo, modelli di progetto, materiali, motivi e plugin come generatori, strumenti per percorsi e filtri immagine.
---

# Estensioni

Le estensioni (file `.kzp`) aggiungono contenuti e funzioni a KizamuBeam senza una nuova versione dell'app:

- **Contenuti**: modelli di dispositivo, modelli di progetto, voci della libreria materiali ed elementi della libreria (motivi, immagini, elementi grafici).
- **Plugin**: generatori che compaiono come riquadri nella Casella degli strumenti, strumenti per percorsi che modificano le forme selezionate (per esempio i ponti per stencil) e filtri immagine che calcolano una nuova versione dell'immagine selezionata.

Anche i generatori integrati (scatole, ingranaggi, cassetti e gli altri) sono plugin: arrivano con l'app come pacchetto di base e non si possono rimuovere.

## La finestra Estensioni

Apri **File → Estensioni …** (o **Modifica → Impostazioni → Estensioni e font**). La finestra ha tre riquadri: a sinistra l'elenco (**Installato**, **Catalogo** e **Aggiornamenti**, con una ricerca e un filtro per **Tutto**, **Contenuti** e **Plugin**), al centro l'estensione selezionata e a destra i suoi dettagli: cosa contiene, la versione, da dove viene e quali server può contattare. Un plugin può portare un'icona propria e un'immagine di anteprima: l'icona compare davanti all'estensione e sul suo riquadro nella Casella degli strumenti, l'anteprima nei dettagli.

### Installare

1. Scegli un'estensione dal **catalogo** e fai clic su **Installa**, oppure fai clic su **Installa …** e scegli un file `.kzp`. Puoi anche trascinare un file `.kzp` sull'area di lavoro.
2. La finestra mostra il contenuto dell'estensione e se si tratta di un aggiornamento. Conferma l'installazione. Un indicatore di avanzamento è visibile mentre viene scaricata e controllata.

Un'estensione con plugin viene installata solo dopo che ogni plugin si è avviato e ha calcolato una volta i suoi parametri predefiniti; se non riesce, resta la versione installata finora.

Dopo l'installazione:

- generatori, strumenti per percorsi e filtri immagine compaiono nella **Casella degli strumenti** in **Dalle estensioni**,
- i modelli compaiono in **File → Nuovo dal modello … → Dalle estensioni**,
- i modelli di dispositivo compaiono nell'elenco dei dispositivi sotto il loro produttore (o sotto «Dalle estensioni»), contrassegnati con il nome dell'estensione,
- i materiali vengono copiati nella libreria materiali,
- motivi ed elementi grafici compaiono nella libreria.

### Aggiornare, disattivare e rimuovere

- **Aggiorna tutte** installa in una volta ogni versione più recente del catalogo.
- **Disattiva** lascia installata un'estensione ma nasconde i suoi contenuti e plugin; **Attiva** li riporta.
- Dopo un aggiornamento o una reinstallazione, **Torna a x.y** ripristina una volta la versione precedente.
- **Rimuovi** elimina l'estensione e le sue voci. Se parti del progetto aperto sono state create da uno dei suoi plugin, KizamuBeam dice quante. Queste parti mantengono il loro contorno quando l'estensione manca, e l'app indica l'estensione di cui hanno bisogno.

## Sicurezza

I **contenuti** sono solo dati, mai codice. KizamuBeam controlla ogni voce prima dell'installazione, e i modelli di dispositivo delle estensioni non possono portare script di inizio o fine né altri comandi per la tua macchina.

I **plugin** contengono codice. Viene eseguito isolato in un processo proprio, senza accesso ai tuoi file, alla rete o al progetto, con un limite di tempo e di memoria, e ogni risultato viene controllato prima di arrivare nel disegno. Un plugin può comunque calcolare parti sbagliate: controlla il risultato prima del primo lavoro.

I cataloghi sono firmati, e ogni estensione al loro interno viene verificata con il suo checksum. Le estensioni del catalogo sono contrassegnate **Verificato (catalogo)**. Un'estensione con plugin installata da file è contrassegnata **Non verificato** e viene installata solo dopo che confermi di fidarti della sua fonte.

### Plugin che caricano dati da internet

Alcuni plugin hanno bisogno di dati da internet, per esempio la mappa stradale, che cerca luoghi e dati cartografici da OpenStreetMap. Un plugin di questo tipo indica in anticipo i suoi server; la finestra di installazione e i dettagli li mostrano. KizamuBeam chiede prima della prima richiesta e poi scarica i dati da sé, solo via HTTPS, senza cookie né accessi, mai dalla tua rete locale e solo da quei server. Nella finestra Estensioni un interruttore per plugin consente o blocca questo e mostra le richieste della sessione corrente, e **Funzionamento offline** tiene offline tutte le estensioni.

## Il catalogo

**File → Estensioni …** mostra sempre lo stato attuale del catalogo. È unito dal catalogo ufficiale di KizamuBeam e dai repository della community per [plugin](https://github.com/KizamuBeam/kizamubeam-plugins), [pacchetti di contenuti](https://github.com/KizamuBeam/kizamubeam-packs) e [modelli di dispositivo](https://github.com/KizamuBeam/kizamubeam-devices). Contiene tra l'altro:

| Estensione | Tipo | Cosa fa |
|---|---|---|
| **Compositore di scatole** | Generatore | Una scatola con giunzioni a dita e pareti interne posizionate liberamente, vedi [Compositore di scatole](../generators/box-composer.md). |
| **Compositore di scatole (avanzato)** | Generatore, sperimentale | Il compositore di scatole con un contorno sagomato: angoli tagliati, rientranze e sporgenze. |
| **Arte a strati** | Generatore | Trasforma un logo, un disegno o una foto in piastre sovrapposte, tagliate e incollate una sull'altra per dare profondità. |
| **Puzzle** | Generatore | Un puzzle di qualsiasi dimensione e numero di pezzi, con incastri classici, rotondi o quadrati, cornice opzionale e numeri dei pezzi incisi. Ogni linea interna viene tagliata una volta. |
| **Righelli e scale** | Generatore | Righelli diritti in mm, cm o pollici, goniometri e quadranti graduati con etichette proprie. |
| **Scacchiera e tavolieri** | Generatore | Tavolieri di qualsiasi dimensione con caselle scure incise o tratteggiate e coordinate. |
| **Mappa stradale** | Generatore | Una mappa incidibile di un luogo dai dati OpenStreetMap, come rettangolo o cerchio. Carica dati da internet dopo il tuo permesso; sul pezzo finito va «© OpenStreetMap contributors». |
| **Ponti per stencil** | Strumento per percorsi | Aggiunge ponti alle parti interne di testi e forme che cadrebbero da uno stencil (gli occhielli di O, A, B, 8). |
| **Piastra forata** | Generatore | Una piastra con uno schema di fori rotondi o esagonali, per griglie di altoparlanti o ventilazione; un plugin di esempio scritto in Rust. |
| **Pacchetto di esempio** | Contenuti | Un esempio per ogni tipo di contenuto, come punto di partenza per i tuoi pacchetti. I valori sono esempi, non impostazioni misurate. |

Finché le estensioni di terzi non sono nel catalogo, installale solo da fonti di cui ti fidi: KizamuBeam ne controlla il contenuto, ma non può sapere se le impostazioni sono adatte alla tua macchina.

## Creare un'estensione

Un pacchetto di contenuti è un singolo file JSON; i plugin si scrivono con il plugin SDK in JavaScript/TypeScript o Rust (WebAssembly). I formati sono descritti nella documentazione per sviluppatori: [Extension packs](https://github.com/KizamuBeam/kizamubeam/blob/main/docs/packs.md) e [Plugins](https://github.com/KizamuBeam/kizamubeam/blob/main/docs/plugins.md). Le estensioni per il catalogo si propongono con una pull request nel repository della community adatto.
