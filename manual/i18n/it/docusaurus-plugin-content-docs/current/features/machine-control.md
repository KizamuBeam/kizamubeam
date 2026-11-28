---
sidebar_position: 12
title: Eseguire lavori e controllare la macchina
description: Avvia, contorna e visualizza in anteprima i lavori, scegli dove inizia un lavoro, regola potenza e velocità durante la lavorazione e configura i dispositivi.
---

# Eseguire lavori e controllare la macchina

Questa pagina descrive tutto ciò che succede dopo il progetto. Come collegare un laser la prima volta è spiegato in [Collegare un laser](../getting-started/connect-laser.md).

Le finestre della macchina stanno a destra per impostazione predefinita: **Laser** (lavoro, stato, dispositivi), **Sposta** (movimento e origine) e **Console**.

## Anteprima

**Laser → Anteprima …** (Alt+P) simula il lavoro prima che qualcosa si muova:

- riproduzione con cursore del tempo, spostamenti a vuoto e ombreggiatura secondo la potenza,
- una stima del tempo che considera accelerazione, angoli e le pause dell'impostazione [Pausa](layers.md#linea),
- lo stesso ordine del lavoro reale,
- una ripartizione del tempo stimato per livello, sotto-livello e tipo di processo, più il tempo degli spostamenti con il laser spento.

Incisione e taglio vengono riprodotti a velocità diverse (predefinite 50× e 10×). **Uniforma i tipi di processo** dà invece a ogni tipo lo stesso tempo di riproduzione, così un'incisione lunga non fa correre il taglio successivo. Con **Metti in pausa al cambio di processo** la riproduzione si ferma a ogni cambio di processo. I cambi di livello sono segni sul cursore del tempo; un clic ci salta.

### Energia e costo {#energy-and-cost}

Sotto la stima del tempo, l'anteprima mostra **Energia e costo stimati** del lavoro. Il calcolo usa i valori della scheda **Energia** delle impostazioni del dispositivo (consumo di base della macchina, potenza elettrica del laser allo 0, 50 e 100 % e utenze aggiuntive come air assist o aspiratore, con potenza e regola di funzionamento proprie). Inserisci la **tariffa elettrica** per kWh e la valuta in **Modifica → Impostazioni → Generali** per vedere il costo. È un modello, non una misura: script, movimenti Z e pause non sono inclusi. Un breve aiuto nell'anteprima spiega il calcolo.

**Inizia qui** esegue il lavoro dalla posizione del cursore del tempo, per esempio dopo un’interruzione. La testa si sposta lì con il laser spento e prosegue con potenza, velocità e air assist di quel livello.

## Frame

**Frame** percorre il rettangolo intorno al lavoro, **Frame del contorno** ne segue il contorno. Entrambi possono usare il laser a bassa potenza, così vedi il frame sul materiale. Usa il frame per verificare che il lavoro stia sul pezzo prima di iniziare.

Con **Ripeti frame** attivo (casella nella finestra Laser, oppure Laser → Ripeti frame) Frame e Frame del contorno girano in ciclo. Ogni giro viene ricalcolato dal disegno attuale: sposta gli oggetti o il pezzo e vedi il risultato già al giro successivo. Un nuovo clic sul pulsante in corso termina il ciclo dopo il giro attuale, **Arresta** subito. Il ciclo termina anche da solo dopo il tempo impostato in **Ripeti al massimo (min)** nelle impostazioni del dispositivo (scheda **Riquadro e puntatore**, predefinito 5 minuti) e quando un giro uscirebbe dall’area di lavoro.

## Avviare, mettere in pausa e fermare

**Avvia** invia il lavoro. Durante il lavoro la finestra Laser mostra avanzamento, tempo trascorso e tempo rimanente.

- **Pausa** ferma la macchina; **Riprendi** continua.
- **Arresta** interrompe il lavoro e reimposta il controller. La posizione viene mantenuta.
- **Taglia solo la grafica selezionata** lavora solo gli oggetti selezionati.
- **Blocca avvio** nelle impostazioni del dispositivo (scheda **Generali**) tiene bloccati i pulsanti Avvia e Frame finché non sblocchi lì, per esempio durante la manutenzione della macchina.

Prima di ogni lavoro e di ogni frame, KizamuBeam verifica che tutti i movimenti, overscan compreso, restino nell’area di lavoro della macchina. Se il controller non ha ancora comunicato la sua origine (o non lo fa mai, come Marlin), un avviso mostra l’estensione del lavoro, che devi confermare.

## Dove inizia il lavoro

L’impostazione **Inizia da** nella finestra Laser decide dove finisce il lavoro:

| Inizia da | Significato |
|---|---|
| **Coordinate assolute** | Il lavoro sta esattamente dove si trova nell’area di lavoro. L’area di lavoro è il piano della macchina. Richiede l’azzeramento. |
| **Origine utente** | Il lavoro inizia in un’origine che imposti con la finestra Sposta. |
| **Posizione attuale** | Il lavoro inizia dove si trova ora la testa. |

Con Origine utente e Posizione attuale, l’**origine del lavoro** (nove punti: angoli, centri dei lati, centro) indica quale punto del lavoro si trova in quella posizione. Un progetto ricorda la sua origine del lavoro e l'interruttore **Taglia solo la grafica selezionata**; i nuovi progetti partono con i valori predefiniti di **Modifica → Impostazioni → Area di lavoro e aggancio → Lavoro**.

**Destinazione dopo il lavoro** nelle impostazioni del dispositivo (scheda **Generali**, sezione **Movimento**) decide dove va la testa a lavoro finito: all'avvio laser, all'origine (0,0), a una posizione XY personalizzata, oppure resta ferma (**Resta fermo**). Vale con Coordinate assolute e Origine utente.

## Regolare durante la lavorazione

**Regola** nella finestra Laser cambia potenza e velocità a passi di 1 e 10 % (da 10 a 200 %) e i movimenti rapidi al 25, 50 o 100 %, mentre il lavoro è in corso. L’air assist si attiva e disattiva subito, anche durante un lavoro. Funziona con GRBL, grblHAL e FluidNC.

## Ordine di taglio

I livelli vengono sempre lavorati nell’ordine della tabella dei livelli. All'interno di un livello, questi interruttori decidono l'ordine dei tagli:

| Opzione | Effetto |
|---|---|
| **Prima le forme interne** | Fori e contorni interni vengono tagliati prima del loro contorno esterno, così i pezzi non cadono prima che i fori siano tagliati. |
| **Riduci gli spostamenti a vuoto** | Viene tagliata per prima la forma più vicina. Se disattivata, vale l’ordine della finestra Oggetti (ordine manuale). |
| **Mantieni uniti i gruppi** | Le forme dello stesso oggetto o gruppo vengono tagliate preferibilmente una dopo l’altra. |
| **Inizia negli angoli** | I contorni chiusi iniziano nel loro angolo più acuto, dove il segno d'ingresso si nota meno. |

Gli interruttori appartengono al dispositivo. **Ottimizzazione…** nella finestra Laser li apre insieme ad altre opzioni: l'**ordine di direzione** (da sinistra a destra, da destra a sinistra, dall'alto in basso, dal basso in alto), **Scegli il punto di partenza migliore**, **Scegli la direzione migliore** per i contorni aperti e **Riduci i cambi di direzione**. **Salva come predefinito** memorizza la tua scelta come predefinito personale; **Ripristina predefiniti** torna a quello (o ai valori di fabbrica se non ne hai).

Per cambiare solo un lavoro, apri **Ordine di taglio per questo lavoro** nella finestra Laser. Questi valori non vengono salvati; **Torna al preset** ritorna alle impostazioni del dispositivo. Se tutto il riordino è disattivato e una forma interna verrebbe tagliata dopo il suo contorno esterno, la [verifica del progetto](construction-3d.md#check-the-design-before-cutting) avvisa.

Per scegliere dove inizia un singolo taglio e in che direzione, usa lo strumento del punto iniziale (vedi [Percorsi e forme](paths.md)).

## Finestra Sposta

La finestra **Sposta** muove la testa a passi, imposta e cancella l’origine utente, sblocca la macchina dopo un allarme, esegue l’azzeramento e sposta la testa:

- **Sposta il laser alla selezione** porta la testa agli oggetti selezionati.
- **Sposta laser al clic**: finché il pulsante è attivo, ogni clic sull’area di lavoro porta lì la testa con il laser spento. Esc termina la modalità.
- Con GRBL, grblHAL, Marlin e FluidNC, **tenendo premuto** un pulsante di movimento la testa si muove di continuo finché non lo rilasci; un clic muove di un passo.
- Con un asse Z motorizzato, una sezione **Z** muove il fuoco con passo (predefinito 0,1 mm) e velocità propri. Di norma Z deve essere stato azzerato una volta; le impostazioni del dispositivo possono allentare questa regola.
- Con un puntatore a punto rosso, **Posiziona con** sceglie se sul bersaglio arriva il punto rosso o la testa laser.

### Prova di accensione {#test-fire}

La **Prova di accensione** accende il laser a bassa potenza per qualche secondo, per esempio per trovare il fuoco o controllare l'offset del punto rosso. È **disattivata per impostazione predefinita** e va abilitata per ogni dispositivo in **Impostazioni dispositivo → Riquadro e puntatore → Prova di accensione nella finestra Sposta**, con potenza e durata (predefinite 1 % e 5 s). La macchina deve essere connessa e inattiva. Funziona con GRBL, grblHAL, FluidNC, Marlin e Smoothieware, non con xTool o Ruida. Mentre la prova è attiva, il pad di spostamento resta abilitato così la testa può essere posizionata con il laser acceso; tutto il resto resta bloccato fino alla fine della prova.

:::danger
Un laser che spara in un punto può incendiare il materiale e ferire gli occhi. Usa la prova di accensione solo se sei alla macchina con una protezione per gli occhi adatta e puoi raggiungere il suo interruttore di spegnimento. Il limite di tempo è imposto solo dal software. Dopo ogni prova controlla il laser sulla macchina e conferma che è spento prima che KizamuBeam accetti altri comandi.
:::

### Macro {#macros}

Le **macro** sono sequenze G-code personali come pulsanti, ad esempio per tastare un asse Z motorizzato, portarsi all'altezza di fuoco o attivare l'air assist. Appartengono al dispositivo e si trovano in **Impostazioni dispositivo → Macro** (nome, tooltip facoltativo, un comando per riga). Compaiono come fila di pulsanti nella finestra **Sposta** e nella **Console**. **+ Macro** ne aggiunge una, il clic destro su un pulsante la modifica. **Scegli un esempio …** offre macro pronte per il controller scelto, ad esempio **Tasta Z** per GRBL, grblHAL e FluidNC:

```gcode
G91                            ; modalità relativa
G38.2 Z-{probeMax} F{probeFeed}  ; scende finché il tastatore scatta
G10 L20 P1 Z0                  ; il punto di contatto diventa Z pezzo = 0
G0 Z{focusLift}                ; risale alla distanza di fuoco
G90                            ; di nuovo modalità assoluta
```

Le parole tra parentesi graffe sono **variabili**. I loro valori si impostano per dispositivo nella stessa scheda, una riga `nome = valore` per variabile (l'esempio aggiunge `probeMax = 40`, `probeFeed = 150`, `focusLift = 7`). `{materialThickness}` è l'altezza materiale delle impostazioni del dispositivo. Una macro con una variabile senza valore non parte.

Una macro viene eseguita solo se la macchina è connessa e ferma. KizamuBeam invia una riga alla volta e attende l'`ok` del controller. Se il controller segnala un errore o un allarme (ad esempio quando il tastatore non scatta mai), le righe restanti non vengono inviate e il messaggio indica la riga. Se una macro termina in modalità relativa (`G91`), KizamuBeam invia poi `G90`, perché lavori e spostamenti si aspettano coordinate assolute. Un clic su una macro in esecuzione la ferma dopo la riga corrente.

:::warning
Le macro che accendono il laser (`M3` o `M4` con potenza sopra 0) chiedono prima conferma. Il G-code è nel tooltip del pulsante. Prima di eseguire una macro controlla cosa fa e tieni a portata di mano l'interruttore della macchina.
:::

## Console

La **Console** mostra i messaggi del controller e permette di inviare comandi, con cronologia. Allarmi e ingressi attivi (finecorsa, sportello, sonda) vengono spiegati in modo comprensibile.

## Salvare il G-code

**Laser → Salva GCode …** scrive il lavoro in un file, per esempio per eseguirlo da una scheda SD o con un altro programma. Con un dispositivo Ruida, **Laser → Salva .rd …** scrive invece un file di lavoro Ruida.

## Dispositivi e impostazioni del dispositivo

Ogni laser è un **dispositivo** con connessione, area di lavoro e impostazioni proprie. Scegli il dispositivo in cima alla finestra Laser o gestisci i dispositivi in **Laser → Dispositivo → Dispositivi …**. I nuovi dispositivi possono partire da modelli per i laser più diffusi; l’elenco è raggruppato per produttore, con i modelli generici per controller in fondo. I modelli venduti con più moduli laser hanno una voce per modulo. Sotto l’elenco compaiono modulo laser, area di lavoro, dotazione e provenienza dei valori del modello scelto; controlla l’area di lavoro prima del primo lavoro. Il modulo laser (tipo, potenza ottica, lunghezza d’onda) si può inserire anche in seguito nelle impostazioni del dispositivo.

**Laser → Dispositivo → Impostazioni dispositivo …** contiene, tra l’altro:

- area di lavoro, valore S per il 100 % di potenza, baud rate, indirizzo di rete,
- velocità dei movimenti rapidi e accelerazione (**Leggi dalla macchina** le legge da FluidNC o GRBL),
- dimensione del buffer di ricezione e il **segnale DTR** all'apertura della porta USB (Auto lo lascia invariato; alcuni controller si riavviano con DTR),
- **Spostamento sul vuoto (mm/min)**: una velocità di spostamento più alta sulle aree vuote delle immagini (GRBL, grblHAL, Marlin e FluidNC; vuoto = movimenti rapidi come prima),
- **Altezza materiale (mm)**: avvisa se un offset Z porterebbe il fuoco sotto il materiale,
- **Nome file per i caricamenti sul controller**, eventualmente con **Incrementa nome file** (_2, _3 …) invece di sovrascrivere,
- finecorsa (con “Nessuna”, KizamuBeam non esegue mai l’azzeramento da solo e chiede prima di farlo),
- asse Z motorizzato (per l’offset Z per passaggio e il test del fuoco),
- comando dell’air assist (M8 o M7),
- **Script G-code**: comandi da eseguire prima e dopo ogni lavoro,
- **Macro**: pulsanti G-code personali per la finestra Sposta e la console (vedi [Macro](#macros)),
- **Puntatore punto rosso**: lo spostamento tra raggio e puntatore, così frame e spostamenti con clic possono mirare con il punto rosso,
- **Energia**: il consumo elettrico della macchina per la [stima dell'energia](#energy-and-cost),
- **prova di accensione** (vedi sopra),
- funzioni extra **FluidNC** (vedi sotto).

## Funzioni extra FluidNC

Con un controller FluidNC, **Laser → FluidNC** offre:

- **Eseguire il lavoro dalla scheda SD o dalla flash**: carica prima il lavoro ed eseguilo lì, così un’interruzione del Wi-Fi non lo ferma. Pausa e arresto funzionano come al solito.
- **File sul controller**: elencare, caricare, eseguire ed eliminare file.
- **Configurazione …**: leggere, cercare e modificare il config.yaml, provare valori o salvarli e riavviare. Ogni salvataggio conserva una copia dello stato precedente (le ultime dieci per dispositivo), che puoi ripristinare.
- **Uscite**: le uscite libere (per esempio un aspiratore) si possono attivare nella finestra Laser e accendere automaticamente durante ogni lavoro.

## Controller

KizamuBeam funziona con FluidNC, GRBL 1.1, grblHAL, Marlin, Smoothieware, la famiglia xTool D1 via USB e i controller Ruida DSP. I pulsanti per azzeramento, movimento, origine e console si adattano al controller. Dettagli e laser provati in [Compatibilità delle macchine](../reference/machine-compatibility.md).

## Asse rotante e laser remoti

- Incidere cilindri: vedi [Asse rotante](rotary.md).
- Usare un laser collegato a un altro computer: vedi [Controllo remoto](remote-control.md).
- Provare tutto senza laser: vedi [Macchina virtuale](virtual-machine.md).
