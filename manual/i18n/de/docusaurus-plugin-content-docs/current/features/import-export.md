---
sidebar_position: 8
title: Import und Export
description: SVG-, DXF-, PDF-, Illustrator- und LightBurn-Dateien hereinholen und Entwürfe und G-Code exportieren.
---

# Import und Export

## Projekte öffnen

In der Desktop-App ist **Datei → Öffnen mit Vorschau …** (Strg+O) der Standard: Der Dialog durchsucht beliebige erreichbare Ordner — links mit Orten, Ordnerbaum und Favoriten, in der Mitte eine durchsuchbare Dateiliste — und zeigt rechts eine Vorschau des gewählten Projekts, auch mehrseitige KizamuBeam-Projekte und LightBurn-Dateien. SVG-Dateien zeigen ebenfalls eine Vorschau und werden über den normalen Vektor-Import eingefügt. Eine Dateiauswahl verändert den Editor nicht; erst **Öffnen** lädt das Projekt. Unterordner stehen oben in der Dateiliste und öffnen sich per Doppelklick oder Enter; Rücktaste oder Alt+↑ geht zum übergeordneten Ordner, Strg+F springt in die Suche. Versteckte Dateien und Ordner (etwa `.config` oder `~/Library`) bleiben ausgeblendet, bis du **Versteckte Dateien und Ordner anzeigen** anhakst. In schmalen Fenstern rutscht die Vorschau unter die Dateiliste. Der klassische Systemdialog bleibt als **Datei → Öffnen …** erhalten.

Beide Öffnen-Dialoge merken sich den zuletzt benutzten Ordner für die Sitzung. Unter **Bearbeiten → Einstellungen → Dateien** lassen sich Standardordner zum Öffnen und Speichern festlegen, auf Wunsch immer geltend.

## Importieren

**Datei → Importieren …** (Ctrl+I), Dateien auf die Arbeitsfläche ziehen oder mit Ctrl+V aus anderen Programmen einfügen funktioniert jeweils gleich. Farben werden der nächstgelegenen Palettenfarbe zugeordnet, also dem nächstgelegenen Layer, und mehrere Objekte kommen als Gruppe an.

Wie sich Importe verhalten, lässt sich unter **Bearbeiten → Einstellungen → Arbeitsfläche und Fangen → Import** ändern: ob importierte Objekte ausgewählt und gruppiert werden, ob sie in die Bettmitte gelegt werden, ob Hinweise zu übersprungenen Inhalten erscheinen, die DXF-Einheit und SVG-Auflösung, wenn eine Datei sie nicht angibt, die Toleranz zum Schließen fast geschlossener Pfade und ob versteckte SVG- und DXF-Ebenen importiert werden.

### SVG

Pfade (auch Bögen), Rechtecke, Kreise, Ellipsen, Linien, Polygone, `use`-Verweise, Transformationen, CSS-Klassen und eingebettete Bilder. Die Größe ergibt sich aus `width`, `height` und `viewBox`. **Text in SVG-Dateien wird übersprungen**: Wandle Text im Zeichenprogramm vor dem Speichern in Pfade um.

### DXF

Linien, Polylinien mit Bögen, Kreise, Bögen, Ellipsen, Splines und Blöcke, mit den in der Datei gespeicherten Einheiten und echten Farben. Einzelne Linien, die sich berühren, werden zu durchgehenden Pfaden verbunden, sodass eine aus vielen Stücken gezeichnete Kontur als eine Form geschnitten werden kann.

### PDF und Adobe Illustrator

Pfade bleiben Bézierkurven; RGB-, CMYK-, Grau- und Volltonfarben werden Layern zugeordnet; eingebettete Bilder kommen mit. Text wird aus den in der Datei eingebetteten Schriften zu Umrissen. Nicht eingebettete Schriften werden aus deinem System oder dem Schriften-Manager genommen; fehlt eine, sagt KizamuBeam, welche ersetzt wurde.

Die erste PDF-Seite landet auf der aktuellen Seite, jede weitere auf einer neuen Projektseite. Illustrator-Dateien ab Version 9 funktionieren, weil sie eine PDF-Fassung enthalten. PDFs, die nur gegen Bearbeiten geschützt sind, lassen sich importieren; Dateien, die zum Öffnen ein Passwort brauchen, nicht.

### LightBurn-Projekte

`.lbrn2`-Dateien lassen sich öffnen (**Datei → Öffnen mit Vorschau**, als neues Projekt) oder in das aktuelle Projekt importieren. Formen, Gruppen, Bilder mit ihren Anpassungen und Positionen bleiben erhalten. Layer übernehmen Name, Modus, Geschwindigkeit, Leistung, Durchgänge, Ausgabe, Reihenfolge, Füll- und Bildeinstellungen, Sub-Layer, Perforation, Anschnitte, Überschnitt, Leistungsrampe und Z-Einstellungen. Text bleibt bearbeitbarer Text, wenn die Schrift installiert ist; sonst bleiben seine Umrisse als Pfad erhalten. Was sich nicht importieren ließ, steht in der Statusleiste und in der Konstruktionsprüfung.

LightBurn-Materialbibliotheken (`.clb`) lassen sich in der Material-Bibliothek importieren.

### 3D-Modelle

STL- und OBJ-Dateien werden zu Schicht- oder Rippenmodellen aus flachen Teilen. KizamuBeam fragt, welches von beiden du möchtest; siehe [Generatoren](../generators/index.md).

### Bilder

Siehe [Bilder und Nachzeichnen](images.md).

## Exportieren

**Datei → Exportieren** (auch als Schaltflächen in der Leiste):

| Format | Was exportiert wird |
|---|---|
| **SVG** | Die aktuelle Seite, mit Bildern. |
| **DXF** | Die aktuelle Seite in mm, ein DXF-Layer pro verwendetem Layer mit Name und Farbe. Kurven werden als exakte Splines exportiert. Bilder können nicht in DXF. |
| **PDF** | Alle Seiten, jede in Bettgröße 1:1, jeder Layer als eigene PDF-Ebene, Füll-Layer gefüllt, Bilder eingebettet. Optionen im Export-Dialog, siehe unten. |
| **Illustrator (`.ai`)** | Dieselbe PDF-kompatible Datei; öffnet in Illustrator, Inkscape und Affinity. Mehrere Seiten liegen nebeneinander als Zeichenflächen. |

In SVG und DXF werden Texte als Umrisse exportiert.

### Optionen beim PDF- und Illustrator-Export

PDF- und Illustrator-Export öffnen zuerst einen Dialog. Er merkt sich die letzten Einstellungen; **Zurücksetzen** stellt die Standardwerte wieder her. Unter **Bearbeiten → Einstellungen → Dateien** lässt sich das Merken abschalten.

**Grundeinstellungen**

- **Umfang:** alle Seiten, die aktuelle Seite oder nur die ausgewählten Objekte.
- **Layer ohne Ausgabe:** mitnehmen, ausgeschaltet mitnehmen oder weglassen. **Ausgeblendete Layer mitnehmen** legt ausgeblendete Layer als PDF-Ebenen an, die beim Öffnen ausgeschaltet sind.
- **Seitengröße:** Bettgröße, auf Inhalt zugeschnitten (mit Rand), A4, A3 oder US Letter. Papierformate drehen sich passend zum Inhalt, der Inhalt liegt mittig.
- **Bilder:** einbetten, nur Rahmen oder weglassen. Eingebettete Bilder lassen sich auf eine Auflösung (dpi) begrenzen und als Original oder **so, wie sie gelasert werden** (gerastert im Zeilenabstand des Layers) ausgeben.
- **Text als Text exportieren (Schrift einbetten):** Text bleibt markier-, durchsuch- und kopierbar, und Illustrator, Inkscape oder Affinity öffnen ihn als bearbeitbaren Text, wenn die Schrift dort installiert ist. Das Ergebnis sieht genau wie die Umrisse aus. TrueType-Schriften werden als Teilmenge mit nur den benutzten Buchstaben eingebettet, OpenType-Schriften mit CFF-Konturen ganz. Standardmäßig aus, weil Umrisse für Laser-Dienste und Rechner ohne die Schrift sicherer sind. Manche Texte werden immer zu Umrissen, mit Hinweis: geschweißter Text, Text mit fehlender Schrift (eine Ersatzschrift sprang ein) und Schriften, deren Lizenz das Einbetten verbietet. Text auf Pfad wird Buchstabe für Buchstabe gesetzt; Illustrator zeigt dann Einzelbuchstaben statt Pfadtext.
- **Hilfslinien** und **Projekt-Notizen** können als Ebenen mitkommen, die nicht gedruckt werden.

**Erweitert**

- **Farben:** Layerfarben, alles schwarz oder nach Bearbeitung (Schneiden rot, Ritzen blau, Gravieren schwarz).
- **Linien:** Haarlinie (0,01 mm, verlangen viele Laser- und Plotter-Dienste), sichtbar (0,1 mm) oder eigene Stärke.
- **Füllungen:** wie im Layer oder alles als Kontur.

**Print and Cut**

- **Passermarken ausgeben:** drei Marken um das Design, so wie der Assistent für [Print and Cut](print-and-cut.md) sie setzt. Seiten mit eigenen Marken behalten ihre.
- **Schnittlinien als Schmuckfarbe „CutContour“** für Schneideplotter und Druckdienste, die Konturen an dieser Farbe erkennen.

**Dokument:** Titel (Standard: Projektname), Autor, Thema und Stichwörter.

**Illustrator:** Illustrator öffnet von einer mehrseitigen Datei nur die erste Seite. Bei `.ai` liegen deshalb alle Seiten nebeneinander auf einer Seite, jede mit einem Rahmen auf der nicht druckenden Ebene „Zeichenflächen“. In Illustrator diese Rahmen auswählen und **Objekt → Zeichenflächen → In Zeichenflächen konvertieren** wählen, dann hat jede Seite ihre eigene Zeichenfläche.

Das MCP-Werkzeug `save_document` nimmt dieselben Optionen im Feld `pdf`.

## G-Code

**Laser → G-Code speichern …** schreibt den Job der aktuellen Seite für das gewählte Gerät, genau so, wie er an den Laser ginge, einschließlich der G-Code-Skripte des Geräts. So lassen sich Jobs von einer SD-Karte oder mit einem anderen Programm ausführen.

## Einstellungen übertragen

**Datei → Einstellungen übertragen …** exportiert Einstellungen, Geräte, Material-Bibliothek, Bibliothek, Vorlagen, Erweiterungen und Fensteranordnung in eine `.kzs`-Datei, als Sicherung oder für einen anderen Rechner. Siehe [Anpassen und Einstellungen](customizing.md).
