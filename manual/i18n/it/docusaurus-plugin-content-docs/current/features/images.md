---
sidebar_position: 7
title: Immagini e ricalco
description: Incidi foto con il dithering e altre modalità immagine, regolale, rimuovi lo sfondo, ritaglia e maschera e ricalca le immagini in vettori.
---

# Immagini e ricalco

## Importare immagini

**File → Importa** (Ctrl+I), trascina e rilascia o incolla (Ctrl+V) per portare dentro immagini PNG, JPG, BMP, GIF, WebP e TIFF. Le dimensioni derivano dalla risoluzione salvata nel file (254 DPI se non è indicata); le immagini troppo grandi vengono ridotte alle dimensioni del piano.

Un’immagine sta su un livello come ogni altro oggetto. Velocità, potenza, passaggi, intervallo tra le linee e le altre impostazioni laser vengono dal livello; un doppio clic sull’immagine apre le impostazioni del livello con la sezione **Immagine**.

## Modalità immagine

Ogni immagine ha la propria **Modalità immagine**, che decide come i toni di grigio diventano punti laser. L’area di lavoro mostra il risultato alla risoluzione del laser.

| Modalità | Adatta a |
|---|---|
| **Soglia** | Loghi e disegni al tratto: viene lavorato tutto ciò che è più scuro della soglia. |
| **Ordinato** | Motivo di punti uniforme e regolare. |
| **Floyd-Steinberg**, **Atkinson**, **Stucki**, **Jarvis** | Foto. Dithering a diffusione d’errore con caratteri diversi; Atkinson conserva più contrasto, Stucki e Jarvis danno passaggi più fini. |
| **Carta da giornale** | Un punto rotondo per cella del retino, la cui dimensione segue la luminosità, con celle per pollice e angolo del retino regolabili. |
| **Mezzatinta** | Classico effetto mezzatinta. |
| **Schizzo** | Trasforma i bordi in tratti scuri e lascia vuote le aree uniformi. |
| **Scala di grigi** | Varia la potenza tra potenza min e max del livello; per materiali che scuriscono in modo uniforme. |

**Immagine negativa** inverte l’immagine, per esempio per materiali scuri che diventano chiari quando vengono incisi.

## Regolare le immagini

**Strumenti → Immagine → Modifica immagine …** imposta luminosità, contrasto, gamma, nitidezza (con raggio) e riduzione del rumore, con anteprima, confronto con l’originale e vista 1:1. Regolazioni e modalità immagine si possono salvare come preimpostazioni con nome.

**Salva bitmap elaborato …** salva l’immagine come PNG esattamente come verrebbe lavorata.

## Modificare le immagini {#editing-images}

**Modifica immagine …** (in **Strumenti → Immagine**, nella barra degli strumenti o nel menu contestuale, con esattamente un'immagine selezionata) ritaglia, raddrizza e arrotonda un'immagine senza perdere nulla: i pixel originali e tutti i valori restano nel progetto e puoi cambiarli in seguito.

- **Ritaglio**: trascina le maniglie dei bordi e del centro sull'area di lavoro, oppure inserisci i valori in mm o %.
- **Prospettiva**: trascina i quattro angoli sugli angoli di qualcosa fotografato di sbieco (un cartello, una pagina); l'immagine viene raddrizzata. **Prima ritaglia** sceglie l'area nell'immagine originale, **Prima la prospettiva** ritaglia il risultato raddrizzato.
- **Arrotondamento angoli**: un raggio per tutti gli angoli visibili o uno per ogni angolo. I raggi sono millimetri sull'area di lavoro e restano uguali quando ridimensioni l'immagine. Trascina le maniglie sull'area di lavoro; Maiusc trascina tutti gli angoli insieme.

La finestra mostra un'anteprima dal vivo che si può ingrandire e spostare (**Livello di zoom**, **Adatta**, **Ripristina vista**). **Applica** è un unico passo di annullamento; Esc annulla. Per ritagliare l'immagine lungo il suo nuovo contorno, attiva il [taglio immagine](layers.md#images-and-image-cut) del suo livello.

## Rimuovere lo sfondo

**Strumenti → Immagine → Rimuovi sfondo …** (o **Rimuovi sfondo …** nella barra) lavora in locale, senza servizi cloud. I colori dello sfondo vengono presi dal bordo dell’immagine, oppure li clicchi nell’anteprima (Maiusc+clic ne aggiunge altri). I colori entro la tolleranza diventano trasparenti e non vengono lavorati. La pulizia elimina piccole macchie e riempie piccoli buchi; **Ritaglia al soggetto** rifila l’immagine.

## Ritagliare e mascherare

Seleziona un’immagine e una o più forme chiuse:

- **Strumenti → Immagine → Ritaglia immagine** rifila l’immagine al riquadro di delimitazione della forma.
- **Strumenti → Immagine → Applica maschera all’immagine** mantiene solo l’interno delle forme (funziona anche con il testo); il resto diventa trasparente.

L’immagine mantiene posizione e risoluzione; Ctrl+Z annulla entrambe le operazioni.

## Ricalcare le immagini

**Strumenti → Immagine → Ricalca immagine …** (Alt+T) trasforma un’immagine in percorsi vettoriali, con anteprima dal vivo. Imposta la soglia, ignora le macchie piccole e scegli la levigatura. Il risultato sono percorsi di Bézier con angoli conservati.

Il tipo **Linee centrali** ricalca i tratti lungo il loro centro come percorsi aperti. È la scelta giusta per scrittura a mano, firme e disegni al tratto da marcare come linea singola invece di tagliarci intorno.

Dopo il ricalco, [Semplifica / smussa percorsi](paths.md#simplifying-paths) riduce il numero di nodi se serve.
