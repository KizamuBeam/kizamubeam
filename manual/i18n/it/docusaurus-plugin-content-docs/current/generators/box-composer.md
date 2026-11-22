---
sidebar_position: 4
title: Compositore di scatole
description: Una scatola con giunzioni a dita e pareti interne posizionate liberamente, progettata nella finestra con il mouse.
---

# Compositore di scatole

Il **Compositore di scatole** costruisce una scatola con giunzioni a dita e pareti interne esattamente dove le vuoi: scomparti di dimensioni diverse, una parete a L, una parete lunga con pareti corte che si diramano. È un'estensione del catalogo: installala da **File → Estensioni …** (vedi [Estensioni](../extensions/index.md)); poi compare nella Casella degli strumenti in **Dalle estensioni**.

Per una scatola con una semplice griglia di divisori incrociati, la [scatola con giunti a pettine e divisori](boxes.md) è più rapida.

## Come vengono unite le pareti

- Le pareti interne incontrano le pareti esterne e tra loro come **giunti a T** (tenoni nelle asole), **angoli** (giunzioni a dita), **incroci** (giunti a mezzo legno) o **estremità libere**.
- Ogni parete interna sta con dei denti nelle asole del fondo; un'estremità libera riceve un dente poco prima della fine.
- Ogni parete esterna si può omettere (per esempio una scatola aperta davanti; lì gli angoli li prendono le pareti laterali o il fondo), anche il coperchio. Le pareti interne possono essere più basse di quelle esterne.

Tutte le giunzioni vengono dallo stesso codice dello [strumento Giunzione](../features/construction-3d.md#the-joint-tool), e il gioco è il gioco totale di una giunzione, come per la [scatola](boxes.md): l'asola è più larga della tavola di quella quantità. **Dal materiale** prende spessore, kerf e gioco dell'asola dal materiale [calibrato](../features/materials-tests.md#calibrate-fit) del livello e avvisa quando il livello riceve un altro materiale.

## Progettare la scatola

La finestra ha tre passi: **Scatola** (dimensioni esterne, materiale, coperchio), **Pianta** e **Misure delle pareti**. Una nuova scatola parte solo con le pareti esterne.

Sulla pianta:

| Azione | Come |
|---|---|
| Selezionare un tratto | Clic su una parete: viene selezionato il pezzo tra le sue estremità e giunzioni sotto il puntatore. Maiusc aggiunge altri pezzi della stessa linea; doppio clic o Ctrl+Maiusc+clic prende tutta la parete. |
| Spostare | Trascina la selezione. Le pareti che terminano su di essa la seguono. Un tratto trascinato fuori dalla sua parete se ne stacca, così le pareti dietro si allungano e formano con esso una U; riportato indietro, si ricongiunge alla sua parete. |
| Aggiungere una parete | Un doppio clic in uno scomparto aggiunge una parete di traverso (Maiusc: da dietro in avanti; vicino al centro, esattamente al centro). Con Ctrl un bersaglio sulla parete sotto il puntatore mostra dove inizia una nuova parete: clic per aggiungerla attraverso lo scomparto, trascina per disegnarla. In uno spazio vuoto, Ctrl+trascina disegna una parete libera. |
| Allungare o accorciare | Trascina l'estremità di una parete. |
| Eliminare | Canc elimina la selezione, un clic destro il tratto sotto il puntatore. |
| Zoom e spostamento | Rotellina del mouse e tasto centrale; il pulsante nell'angolo riadatta la pianta. |

Una parete trascinata non si ferma mai dove non può stare. Si aggancia al centro dello scomparto, al centro della scatola, al centro di una parete su cui termina o che incrocia, e in linea con altre pareti. Due pareti che si incontrano testa a testa sulla stessa linea diventano una parete sola.

Lo spazio libero da entrambi i lati e la lunghezza della parete selezionata sono mostrati sulla pianta e sotto di essa. L'elenco in **Misure delle pareti** accetta valori esatti. Cambiando larghezza o profondità della scatola, la finestra chiede se le pareti si scalano con essa o mantengono le distanze in mm.

## Controlli e risultato

La finestra controlla la disposizione mentre lavori (pareti troppo vicine, estremità che quasi toccano una parete, giunti a T da entrambi i lati non allineati, estremità libere molto corte), insieme alla consueta [verifica del progetto](../features/construction-3d.md#check-the-design-before-cutting). Una scatola più grande dell'area di lavoro viene distribuita su più pagine; resta un unico oggetto da modificare con un doppio clic.

Prima di tagliare, guarda il risultato nella [vista 3D](../features/construction-3d.md#3d-view).

## Compositore di scatole (avanzato)

Lo sperimentale **Compositore di scatole (avanzato)** del catalogo cambia anche il contorno: le pareti esterne sono pareti della pianta come le altre. Un tratto spinto all'interno taglia via un angolo (L) o crea una rientranza (U), tirato fuori crea una sporgenza; fondo e coperchio seguono il contorno. Canc lascia aperta una parete esterna o un suo tratto (tratteggiato); un altro Canc la richiude.
