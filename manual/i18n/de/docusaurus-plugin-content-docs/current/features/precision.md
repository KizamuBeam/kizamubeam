---
sidebar_position: 3
title: Fangen, Hilfslinien und Messen
description: An Knoten und Raster fangen, Hilfslinien nutzen, messen, Beziehungen anwenden und bemaßte Skizzen zeichnen.
---

# Fangen, Hilfslinien und Messen

## Fangen

**Fang** in der Statusleiste oder der Magnet-Knopf in der Hauptleiste schaltet das Fangen ein und aus. Objekte und Zeiger fangen an Knoten, Mittelpunkten von Kanten, Zentren, Schnittpunkten, Linien und Quadrantenpunkten von Kreisen. **Raster** in der Statusleiste fängt am Raster.

- **Ctrl** beim Ziehen schaltet das Fangen vorübergehend aus (oder ein).
- **Alt** beim Ziehen fängt stärker und zeigt Ausrichtungshilfen an anderen Objekten.

Wie nah der Zeiger kommen muss, bevor er fängt, stellst du unter **Bearbeiten → Einstellungen → Arbeitsfläche und Fangen → Fangdistanz (px)** ein, getrennt für normales Fangen und mit Alt.

Kreise und Bögen werden auch innerhalb von Pfaden erkannt, etwa Löcher in einer Platte oder importierte DXF-Kreise, sodass ihr echter Mittelpunkt fängt. **Ansicht → Mittelpunkte zeigen** zeigt Mittelpunktkreuze immer, nur für die Auswahl oder gar nicht.

## Raster

**Ansicht → Raster** blendet das Raster ein und aus. Unter **Gitter einstellen …** legst du den Abstand fest (z. B. 25,4 für Zoll), Unterteilungen, jede n-te Linie fett, Farbe und Deckkraft, und wahlweise wird der feinste Abstand zum Fangraster.

## Hilfslinien

Ziehe eine Hilfslinie aus dem oberen Lineal (waagerecht) oder dem linken Lineal (senkrecht). Hilfslinien liegen auf einer eigenen Ebene **Hilfslinien**: Sie werden nie gelasert oder exportiert, und Ctrl+A, die Palette und Formoperationen lassen sie in Ruhe. Ziehe eine Hilfslinie, um sie zu verschieben, oder zurück ins Lineal, um sie zu löschen. Die Ebene Hilfslinien lässt sich im Fenster Objekte ausblenden und sperren. Hilfslinien gelten für alle Seiten.

Ein Rechtsklick auf ein Lineal öffnet ein Menü: an dieser Stelle eine senkrechte oder waagerechte Hilfslinie hinzufügen, Hilfslinien zeigen, ausblenden oder sperren und Raster- und Objektfang schalten. Ein Rechtsklick auf eine Hilfslinie bietet **Position …**, um ihre genaue Lage in mm einzugeben, und **Diese Hilfslinie löschen**. Im Fenster Objekte öffnet ein Doppelklick auf eine Hilfslinie ebenfalls die Position.

## Messen

**Werkzeuge → Messen** (oder die Lineal-Schaltfläche): Anfangs- und Endpunkt anklicken, mit Fang. KizamuBeam zeigt Länge, Δx, Δy und Winkel, über einem Kreis Durchmesser und Radius. Esc löscht die Messung.

## Beziehungen

**Anordnen → Beziehungen** (oder die Beziehungs-Gruppe in der Werkzeugleiste) verschiebt oder dreht ein Objekt so, dass es in einer Beziehung zu einem anderen steht. Klicke zuerst das Bezugselement an (es bleibt stehen), dann das Element des Objekts, das sich anpassen soll.

| Beziehung | Wirkung |
|---|---|
| **Konzentrisch** | Zwei Kreise, Ellipsen oder Polygone bekommen einen gemeinsamen Mittelpunkt (auch Löcher in Pfaden). |
| **Gleich groß** | Gleicher Radius für zwei Kreise, gleiche Länge für zwei Kanten. |
| **Parallel** / **Senkrecht** | Das zweite Objekt dreht sich um den kleinsten Winkel. |
| **Waagerecht** / **Senkrecht** | Richtet eine Kante waagerecht oder senkrecht aus. |
| **Tangential** | Das zweite Objekt rückt heran, bis es berührt. |
| **Abstand** | Fragt nach einem Abstand zwischen Kanten, Punkten oder Kreisen. |

Beziehungen werden einmalig angewendet, wie ein Befehl; jede ist ein Rückgängig-Schritt.

## Skizzen mit Bemaßung {#sketches-with-dimensions}

Für Teile, die beim Ändern ihre genauen Maße behalten sollen, gibt es **Werkzeugkasten → Skizzen mit Beziehungen → Neue Skizze** (oder **In Skizze umwandeln**). In einer Skizze behalten Linien, Rechtecke, Kreise und Bögen ihre Beziehungen und Maße dauerhaft, wie in einem CAD-Programm.

- Im Auswahlmodus von einer freien Stelle nach rechts ziehen, um vollständig umschlossene Elemente zu wählen. Nach links zählen auch Elemente, die den Rahmen kreuzen. Umschalt ergänzt die Auswahl. Per Tastatur: **Rahmenauswahl** öffnen, den Zeiger mit den Pfeiltasten bewegen und beide Ecken mit Einfg markieren.
- Zwei Linien auswählen und **Auf derselben Geraden** wählen, um sie auszurichten, ohne ihre Endpunkte zu verbinden. Unter **Beziehungen** können geometrische Beziehungen nach Auswahl gefiltert, angezeigt und entfernt werden, ohne die zugehörige Geometrie zu löschen.
- **Endpunkte verbinden** schließt eine Lücke zwischen zwei offenen Geraden oder Kreisbögen. Wähle die beiden Endpunkte mit Umschalt oder über die Endpunktliste. Beide Segmente und ihre Maße bleiben erhalten. Lassen die bestehenden Beziehungen keine Verbindung zu, bleibt die Skizze unverändert.
- **Aufteilen** zeigt den Teilpunkt beim Zeigen auf eine Gerade. In der Nähe der Mitte rastet er am Mittelpunkt ein. Ein Klick erzeugt zwei Segmente. Der Teilpunkt behält seine relative Lage auf der Ursprungslinie, auch wenn du deren Länge oder Richtung änderst. Die ursprünglichen Maße bleiben bearbeitbar.
- **Löschen** zeigt vorab, welche Maße und Beziehungen mit der gewählten Geometrie verloren gehen würden. Beim Abbrechen bleiben Geometrie, Beziehungen und Auswahl unverändert.
- **Langloch** platziert die beiden Halbkreis-Mittelpunkte in beliebiger Richtung. Der dritte Punkt legt die Breite fest. Nahe der Waagrechten oder Senkrechten rastet die Achse ein, sofern der zweite Mittelpunkt nicht an einer bestehenden Referenz gefangen ist. Durchmesser und Mittelpunktsabstand steuern Breite und geraden Teil; ein frei platziertes schräges Langloch hat zusätzlich ein Winkelmaß. Die Gesamtlänge ist die Summe aus Mittelpunktsabstand und Breite.
- Mit **[** und **]** wechselst du auf der Zeichenfläche zwischen nahe beieinanderliegenden Skizzenpunkten. Der hervorgehobene Punkt wird beim nächsten Klick verwendet.
- **Rundrechteck**: Setze den Mittelpunkt, danach eine Ecke und zuletzt den Radius durch einen Klick innerhalb des Rechtecks. Ein gemeinsames Radiusmaß steuert alle vier Rundungen; Breite und Höhe bleiben unabhängig bearbeitbar.
- **Polygon** erzeugt ein regelmäßiges Vieleck mit 3 bis 24 Seiten. Wähle die Seitenzahl und setze Mittelpunkt und Eckpunkt. Ändere den Umkreisradius, um die Größe anzupassen. Wenn du den Eckpunkt an vorhandener Geometrie fängst, bestimmt stattdessen diese Referenz die Größe.
- **Spiegeln** spiegelt ausgewählte Elemente an einer geraden Skizzenlinie oder einer Ursprungsachse. Das Fenster fragt Elemente und Spiegellinie; genau eine gerade Hilfslinie in der Auswahl ist vorbelegt. Das Ergebnis ist eine einzelne Kopie ohne Musterverknüpfung.
- **Konturversatz** zeigt die innere oder äußere Kontur vor dem Platzieren. Er funktioniert mit Kreisen und geschlossenen konvexen Linien-/Bogenkonturen mit tangentialen Übergängen (z. B. einem Langloch). Der Versatz folgt der Ursprungskontur und das Maß bleibt bearbeitbar. Bei Kreisen hat das Maß ein Vorzeichen; bei gemischten Konturen bleibt die gewählte Seite erhalten und der Abstand ist positiv. Das Werkzeug weist Versätze ab, die einen Bogen kollabieren lassen oder vorhandene Ausgabegeometrie kreuzen. Beide Konturen bleiben Ausgabegeometrie, sofern du keine davon als Hilfsgeometrie markierst.
  Teilt ein Innenversatz eine einfache, geschlossene Kontur aus Geraden an einer Engstelle, zeigt das Werkzeug alle entstehenden Schnitte und verlangt eine Bestätigung. Das Original bleibt unverändert. Die neuen Konturen bestehen aus fixierten Skizzenlinien und sind nicht mit dem Original verknüpft. Abbrechen lässt die Skizze unverändert.
- **Kreismuster** verteilt die ausgewählten Elemente um einen Mittelpunkt. Das Fenster fragt Elemente, Mittelpunkt, Anzahl (2–500, einschließlich des Originals), Gesamtwinkel (bis 360°) und Ausrichtung; Zahlen verstehen Projektparameter wie `n`, die verlinkt bleiben. Doppelklick auf die Musterplakette oder **Skizzenmuster bearbeiten** ändert die Anzahl nachträglich; überlebende Kopien behalten ihre Identität. **Auflösen** behält die Geometrie und löst die Verknüpfung, **Entfernen** löscht die Kopien.
- **Rechteckmuster** wiederholt die ausgewählten Elemente entlang einer oder zwei Richtungen. Das Fenster fragt Elemente, optionale Richtungslinien (Standard: Skizzen-X und Senkrechte), Anzahlen (je 1–500, höchstens 500 Kopien) und Abstände; Abstandspfeile auf der Zeichenfläche lassen sich ziehen, Ziehen über Null kippt die Seite. Anzahlen schließen das Original ein, verlinkte Parameter wie `n` oder `s` wirken auch nach dem Bearbeiten.
- **Präzise verschieben** versetzt ausgewählte Geometrie um einen X/Y-Abstand in Skizzenkoordinaten und zeigt eine Vorschau. Wähle alle verbundenen sichtbaren Elemente aus. Hilfsgeometrie folgt; Beziehungen zur übrigen Skizze werden nicht gelöst.
- **Abrunden** und **Fasen** bearbeiten die Ecke zwischen zwei geraden Kanten ohne Abzweigung. Zeige in der Nähe der Ecke auf eine Kante und klicke auf die Vorschau. Radius oder Rücksprung bleiben bearbeitbar; die ursprünglichen Kanten bleiben mit ihren Maßen als Hilfsgeometrie erhalten.
- **Trimmen**: Zeige auf den Abschnitt, den du entfernen willst, und klicke auf die Markierung. Geraden, Kreise und Kreisbögen lassen sich gegeneinander trimmen. Entferne zum Beispiel die beiden inneren Bögen überlappender Kreise, um einen geschlossenen Außenumriss zu erhalten. Beim Trimmen von Kurven bleiben die Ursprungsformen als Hilfsgeometrie erhalten, damit ihre Maße erhalten bleiben. Jeder Klick lässt sich einzeln rückgängig machen.
- **Verlängern**: Zeige auf ein Linienende, um die Verlängerung bis zur nächsten Geraden, zum nächsten Kreis oder Kreisbogen zu sehen, und klicke zur Übernahme. Trifft die Verlängerung einen vorhandenen Endpunkt, teilen sich beide Elemente diesen Punkt. Ein Dialog erscheint nur, wenn Maße oder Beziehungen zur Entfernung freigegeben werden müssen.
- **Rechteck vom Mittelpunkt**: vom Mittelpunkt zu einer Ecke ziehen oder beide Punkte anklicken. Die Vorschau wächst symmetrisch um den Mittelpunkt. Für die exakte Zahleneingabe gibt es **Mittelpunkt-Rechteck über Koordinaten**.
- Der Fang an einer Linienmitte bleibt beim Setzen von Linien, Polylinien, Rechtecken und Kreisbögen als Beziehung erhalten. Fängst du die Ecke eines Mittelpunkt-Rechtecks an einem Skizzenpunkt, steuert dieser Punkt die Größe, statt zusätzliche Breiten- und Höhenmaße anzulegen.

- Beziehungen über die Leiste oben oder per Taste: deckungsgleich (O), waagerecht (H), senkrecht (V), parallel (P), rechtwinklig (N), gleich (E), tangential (T), konzentrisch (X), Mittelpunkt (M), symmetrisch (Y), fest (F).
- **Bemaßen** (D): Eine Linie bekommt eine Länge, zwei Linien einen Winkel, ein Kreis einen Durchmesser, ein Bogen einen Radius, zwei Punkte einen Abstand. Ein Doppelklick auf ein Maß ändert es. Maße können Formeln mit Projektparametern sein, etwa `Breite / 2`.
- Farben: blau = noch frei, dunkel = vollständig bestimmt, rot = Widerspruch.
- Hilfsgeometrie (G) wird gestrichelt gezeichnet und nie gelasert.

Ein Doppelklick öffnet eine Skizze wieder, Enter oder **Fertig** schließt sie, **Abbrechen** verwirft alle Änderungen seit dem Öffnen.
