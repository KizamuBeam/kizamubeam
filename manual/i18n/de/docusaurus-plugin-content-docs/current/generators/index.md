---
title: Generatoren
description: Generatoren erzeugen fertige Teile aus wenigen Maßen, etwa Boxen, Zahnräder und Steckmodelle, und halten sie bearbeitbar.
---

# Generatoren

Generatoren erzeugen fertige Teile aus wenigen Maßen, statt sie von Hand zu zeichnen. Sie stehen alle im **Werkzeugkasten** (**Werkzeuge → Werkzeugkasten …**, **Fenster → Werkzeugkasten** oder die Kachel-Schaltfläche in der Werkzeugleiste), nach Gruppen sortiert und durchsuchbar.

| Seite | Generatoren |
|---|---|
| [Zahnräder und Zahnstangen](gears.md) | Zahnrad, Zahnradpaar, Zahnstange |
| [Riemenscheiben und Nocken](pulleys-cams.md) | Riemenscheibe, Nocken |
| [Boxen mit Fingerzinken](boxes.md) | Box mit Fingerzinken, Box mit Fingerzinken und Trennwänden |
| [Box-Composer](box-composer.md) | Eine Box mit frei platzierten Innenwänden (Erweiterung) |
| [Schubladen, Einsätze und Regale](drawers-shelves.md) | Schublade, Einsatz mit Fächern, Steckregal |
| [Schicht- und Rippenmodelle](models-3d.md) | Schicht- und Rippenmodell aus einer STL- oder OBJ-Datei |
| [Scheibenkugel](disc-sphere.md) | Eine Kugel oder ein Lampenschirm aus ineinandergesteckten Scheiben |
| [Mehrlagenarbeit](multilayer.md) | Eigene Formen zu einem geschichteten Relief gestapelt |

Weitere Generatoren wie ein Puzzle, Lineale und Skalen, Spielbretter, Schichtbilder und ein Stadtplan sind [Erweiterungen](../extensions/index.md) aus dem Katalog. Installiert erscheinen sie im Werkzeugkasten unter **Aus Erweiterungen** und funktionieren wie die eingebauten.

Verbindungen zwischen eigenen Formen, das Deckelscharnier, Biegeschnitte und Schlitze sind Werkzeuge, keine Generatoren: siehe [Verbindungen, Scharniere und 3D-Ansicht](../features/construction-3d.md). Jigs stehen unter [Print and Cut und Jigs](../features/print-and-cut.md#jigs), bemaßte Skizzen unter [Fangen, Hilfslinien und Messen](../features/precision.md#sketches-with-dimensions).

## Mit Generatoren arbeiten

Alle Generatoren, auch die eingebauten, laufen als Plugins in einem eigenen Prozess. Der Editor bleibt bedienbar, während ein großes Teil berechnet wird, und eine lange Berechnung lässt sich abbrechen.

### Der Generator-Dialog

Jeder Generator-Dialog zeigt eine Live-Vorschau und prüft die Werte schon beim Tippen; Probleme erscheinen rot oder orange neben den Feldern. Selten gebrauchte Einstellungen stehen unter **Erweitert**. Die Vorschau lässt sich mit dem Mausrad zoomen und mit der mittleren Maustaste verschieben; der Dialog lässt sich mit dem Griff unten rechts vergrößern, und die Vorschau wächst mit. Manche Generatoren haben mehrere Schritte, Listen oder eine Zeichenfläche, auf der du mit der Maus etwas platzierst (etwa der [Box-Composer](box-composer.md)). Hilfe, Felder und Meldungen stehen in der rechten Spalte.

Generatoren, die Material oder Arbeitsbereich brauchen, nehmen sie vom aktuellen Layer und Gerät, etwa Stärke, Kerf und Spiel eines [kalibrierten](../features/materials-tests.md#calibrate-fit) Materials. Manche können auch von der aktuellen Auswahl ausgehen, etwa von einem Bild für Schichtbilder.

### Erstellen und Hinzufügen

- **Erstellen** erzeugt das Teil und schließt den Dialog.
- **Hinzufügen** erzeugt das Teil und lässt den Dialog offen, sodass du gleich das nächste mit anderen Werten einrichten kannst. Bearbeitest du ein vorhandenes Teil, legt Hinzufügen ein neues an und lässt das bearbeitete unverändert.

Neue Teile kommen an die erste freie Stelle der Seite, ab unten links, 2 mm voneinander und 3 mm vom Rand entfernt. Alle Objekte auf der Seite werden umgangen, und eine Baugruppe (etwa eine Box) behält ihre Anordnung. Ist die Seite voll, kommt das Teil auf eine neue Seite. Eine Baugruppe, die größer als der Arbeitsbereich ist, kann ihre Teile auf mehrere Seiten verteilen und bleibt trotzdem ein Objekt, das du in einem Schritt bearbeitest, speicherst und rückgängig machst. Ein Teil, das größer als der Arbeitsbereich ist, fragt nach: **Trotzdem erstellen** in der Mitte, zurück oder abbrechen. Jedes Erstellen oder Hinzufügen ist ein Rückgängig-Schritt.

### Ein Teil später ändern

Generatoren erzeugen **parametrische Teile**: Sie behalten ihre Parameter im Projekt. Ein **Doppelklick** auf ein Teil öffnet seinen Dialog wieder. Die Kontur wird neu berechnet, Lage und Drehung bleiben. Bei einer Baugruppe wie einer Box bearbeitet ein Doppelklick auf irgendeine Wand die ganze Box; Teile, die nicht mehr gebraucht werden, verschwinden, und neue (etwa ein Deckel) kommen hinzu.

Manche Änderungen würden die Parameter zerstören: Skalieren, Knotenbearbeitung oder eine boolesche Operation ohne „Originale behalten“. KizamuBeam fragt dann, ob das Teil in gewöhnliche Pfade umgewandelt oder stattdessen seine Parameter bearbeitet werden sollen. **In Pfad umwandeln** macht die Umwandlung absichtlich.

### Formeln und Parameter

Jedes Zahlenfeld nimmt einen [Projektparameter](../features/templates-library.md#parameters) oder eine Formel an, etwa `{Dicke}` oder `{Breite} - 2 * {Dicke}`. Auswahl- und Ja/Nein-Felder bekommen einen Parameter über die ƒ-Schaltfläche. So folgt eine Box in einer Vorlage den ausgefüllten Werten, und eine an einer Stelle geänderte Materialdicke aktualisiert jedes Teil.

### Schnittfuge und Spiel

Die meisten Generatoren haben ein Feld **Schnittfuge (Kerf)**: die Breite des Laserschnitts. Konturen werden um die Hälfte nach außen versetzt, Löcher und Schlitze werden kleiner, sodass die Teile ihr Nennmaß haben. Ein Kerf-Versatz des Layers kommt noch dazu; stelle die Schnittfuge also nur an einer Stelle ein.

Steckteile haben außerdem ein **Steckspiel**: wie viel Luft jede Verbindung bekommt (negative Werte ergeben eine Presspassung). Ist das Material des Layers [kalibriert](../features/materials-tests.md#calibrate-fit), übernehmen neue Teile Dicke, Kerf und Spiel aus der Kalibrierung, und vorhandene Teile bieten eine Schaltfläche zum Übernehmen an.

### Das Ergebnis prüfen

Die [3D-Ansicht](../features/construction-3d.md#3d-view) zeigt Baugruppen zusammengesetzt und markiert Kollisionen rot. Die [Konstruktionsprüfung](../features/construction-3d.md#check-the-design-before-cutting) prüft die Passung jeder Verbindung und ob sich die Teile in irgendeiner Reihenfolge zusammenbauen lassen.
