---
sidebar_position: 8
title: Importazione ed esportazione
description: Importa file SVG, DXF, PDF, Illustrator e LightBurn ed esporta progetti e G-code.
---

# Importazione ed esportazione

## Aprire progetti

Nell'app desktop, **File → Apri con anteprima …** (Ctrl+O) è lo standard: la finestra sfoglia qualsiasi cartella accessibile — a sinistra risorse, albero cartelle e preferiti, al centro un elenco file con ricerca — e mostra a destra un'anteprima del progetto selezionato, inclusi progetti KizamuBeam multipagina e file LightBurn. Anche i file SVG mostrano un'anteprima e vengono inseriti con la normale importazione vettoriale. Selezionare un file non tocca l'editor; solo **Apri** carica il progetto. Le sottocartelle compaiono in cima all'elenco file e si aprono con doppio clic o Invio; Backspace o Alt+↑ va alla cartella superiore e Ctrl+F passa alla ricerca. File e cartelle nascosti (come `.config` o `~/Library`) restano fuori vista finché non spunti **Mostra file e cartelle nascosti**. Nelle finestre strette l'anteprima scende sotto l'elenco file. La classica finestra di sistema resta disponibile come **File → Apri …**.

Entrambe le finestre di apertura ricordano l'ultima cartella usata nella sessione. In **Modifica → Impostazioni → File** si possono impostare cartelle predefinite per apertura e salvataggio, con un'opzione per usarle sempre.

## Importare

**File → Importa …** (Ctrl+I), il trascinamento dei file sull’area di lavoro o l’incolla con Ctrl+V da altri programmi funzionano allo stesso modo. I colori vengono associati al colore più vicino della tavolozza, cioè al livello più vicino, e più oggetti arrivano come gruppo.

Il comportamento dell'importazione si cambia in **Modifica → Impostazioni → Area di lavoro e aggancio → Importa**: se gli oggetti importati vengono selezionati e raggruppati, se vengono messi al centro del piano, se compaiono avvisi sui contenuti saltati, l'unità DXF e la risoluzione SVG usate quando un file non le indica, la tolleranza per chiudere i percorsi quasi chiusi e se importare i livelli SVG e DXF nascosti.

### SVG

Percorsi (anche archi), rettangoli, cerchi, ellissi, linee, poligoni, riferimenti `use`, trasformazioni, classi CSS e immagini incorporate. Le dimensioni derivano da `width`, `height` e `viewBox`. **Il testo nei file SVG viene saltato**: converti il testo in percorsi nel programma di disegno prima di salvare.

### DXF

Linee, polilinee con archi, cerchi, archi, ellissi, spline e blocchi, con le unità salvate nel file e i colori reali. Le linee singole che si toccano vengono unite in percorsi continui, così un contorno disegnato con molti segmenti si può tagliare come una sola forma.

### PDF e Adobe Illustrator

I percorsi restano curve di Bézier; i colori RGB, CMYK, grigi e spot vengono associati ai livelli; le immagini incorporate vengono importate. Il testo diventa contorni dai font incorporati nel file. I font non incorporati vengono presi dal sistema o dal gestore dei font; se ne manca uno, KizamuBeam dice quale è stato sostituito.

La prima pagina del PDF finisce nella pagina corrente, ogni pagina successiva in una nuova pagina del progetto. I file Illustrator dalla versione 9 in poi funzionano, perché contengono una versione PDF. I PDF protetti solo contro la modifica si possono importare; i file che richiedono una password per essere aperti no.

### Progetti LightBurn

I file `.lbrn2` si possono aprire (**File → Apri con anteprima**, come nuovo progetto) o importare nel progetto corrente. Forme, gruppi, immagini con le loro regolazioni e posizioni vengono mantenuti. I livelli riprendono nome, modalità, velocità, potenza, passaggi, uscita, ordine, impostazioni di riempimento e immagine, sotto-livelli, perforazione, entrate, sovrataglio, rampa di potenza e impostazioni Z. Il testo resta testo modificabile se il font è installato; altrimenti i suoi contorni restano come percorso. Gli elementi non importabili sono elencati nella barra di stato e nel controllo del progetto.

Le librerie di materiali LightBurn (`.clb`) si possono importare nella libreria dei materiali.

### Modelli 3D

I file STL e OBJ diventano modelli a strati o a nervature fatti di pezzi piani. KizamuBeam chiede quale dei due vuoi; vedi [Generatori](../generators/index.md).

### Immagini

Vedi [Immagini e ricalco](images.md).

## Esportare

**File → Esporta** (anche come pulsanti nella barra):

| Formato | Cosa viene esportato |
|---|---|
| **SVG** | La pagina corrente, con le immagini. |
| **DXF** | La pagina corrente in mm, un layer DXF per ogni livello usato con nome e colore. Le curve vengono esportate come spline esatte. Le immagini non possono andare nel DXF. |
| **PDF** | Tutte le pagine, ognuna alle dimensioni del piano 1:1, ogni livello come livello PDF proprio, livelli di riempimento riempiti, immagini incorporate. |
| **Illustrator (`.ai`)** | Lo stesso file compatibile PDF; si apre in Illustrator, Inkscape e Affinity. |

I testi vengono esportati come contorni.

## G-code

**Laser → Salva GCode …** scrive il lavoro della pagina corrente per il dispositivo selezionato, esattamente come verrebbe inviato al laser, compresi gli script G-code del dispositivo. Serve per eseguire lavori da una scheda SD o con un altro programma.

## Trasferire le impostazioni

**File → Trasferisci impostazioni …** esporta impostazioni, dispositivi, libreria dei materiali, libreria, modelli, estensioni e disposizione delle finestre in un file `.kzs`, come backup o per un altro computer. Vedi [Personalizzazione e impostazioni](customizing.md).
