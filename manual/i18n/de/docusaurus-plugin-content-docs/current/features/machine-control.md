---
sidebar_position: 12
title: Jobs ausführen und Maschine steuern
description: Jobs starten, umfahren und in der Vorschau ansehen, festlegen, wo ein Job beginnt, Leistung und Geschwindigkeit beim Lasern anpassen und Geräte einrichten.
---

# Jobs ausführen und Maschine steuern

Diese Seite beschreibt alles, was nach dem Entwurf passiert. Wie du einen Laser zum ersten Mal verbindest, steht unter [Laser verbinden](../getting-started/connect-laser.md).

Die Maschinenfenster liegen standardmäßig rechts: **Laser** (Job, Status, Geräte), **Verschieben** (Verfahren und Ursprung) und **Konsole**.

## Vorschau

**Laser → Vorschau …** (Alt+P) simuliert den Job, bevor sich etwas bewegt:

- Wiedergabe mit Zeitregler, Leerwegen und Schattierung nach Leistung,
- eine Zeitschätzung, die Beschleunigung, Ecken und die Pausen der Einstellung [Pause](layers.md#linie) berücksichtigt,
- dieselbe Reihenfolge wie der echte Job,
- eine Aufstellung der geschätzten Zeit je Layer, Sub-Layer und Prozessart sowie der Leerfahrzeit ohne Laser.

Gravieren und Schneiden laufen in der Wiedergabe unterschiedlich schnell (Vorgabe 50× und 10×). **Prozessarten angleichen** gibt stattdessen jeder Art dieselbe Wiedergabezeit, damit eine lange Gravur den folgenden Schnitt nicht hetzt. Mit **Bei Prozesswechsel pausieren** hält die Wiedergabe bei jedem Prozesswechsel an. Layerwechsel sind Markierungen auf dem Zeitregler; ein Klick springt dorthin.

### Energie und Kosten {#energy-and-cost}

Unter der Zeitschätzung zeigt die Vorschau **Geschätzte Energie und Kosten** des Jobs. Die Rechnung nutzt die Werte im Tab **Energie** der Geräteeinstellungen (Grundverbrauch der Maschine, elektrische Leistung des Lasers bei 0, 50 und 100 % und zusätzliche Verbraucher wie Air Assist oder eine Absaugung mit eigener Leistung und Betriebsregel). Trage unter **Bearbeiten → Einstellungen → Allgemein** den **Stromtarif** je kWh und die Währung ein, um die Kosten zu sehen. Es ist ein Modell, keine Messung: Skripte, Z-Bewegungen und Pausen sind nicht enthalten. Eine kurze Hilfe in der Vorschau erklärt die Rechnung.

**Hier starten** lasert den Job ab der Position des Zeitreglers, etwa nach einem Abbruch. Der Kopf fährt mit ausgeschaltetem Laser dorthin und macht mit Leistung, Geschwindigkeit und Air Assist dieses Layers weiter.

## Rahmen

**Rahmen** fährt das Rechteck um den Job ab, **Kontur-Rahmen** folgt seinem Umriss. Beides kann mit schwachem Laser laufen, damit du den Rahmen auf dem Material siehst. Prüfe mit dem Rahmen vor dem Start, ob der Job auf das Werkstück passt.

Mit **Rahmen wiederholen** (Häkchen im Laser-Fenster oder Laser → Rahmen wiederholen) laufen Rahmen und Kontur-Rahmen in einer Schleife. Jede Runde wird aus der aktuellen Zeichnung neu berechnet: Verschiebe Objekte oder das Werkstück und sieh das Ergebnis gleich in der nächsten Runde. Ein erneuter Klick auf den laufenden Knopf beendet die Schleife nach der aktuellen Runde, **Stopp** sofort. Die Schleife endet auch von selbst nach der Zeit unter **Wiederholen höchstens (min)** in den Geräteeinstellungen (Tab **Rahmen & Zeiger**, Standard 5 Minuten) und wenn eine Runde den Arbeitsbereich verlassen würde.

## Starten, pausieren und stoppen

**Start** schickt den Job ab. Währenddessen zeigt das Fenster Laser Fortschritt, vergangene und verbleibende Zeit.

- **Pause** hält die Maschine an, **Weiter** macht weiter.
- **Stopp** bricht den Job ab und setzt die Steuerung zurück. Die Position bleibt erhalten.
- **Nur Auswahl** lasert nur die ausgewählten Objekte.
- **Start sperren** in den Geräteeinstellungen (Tab **Allgemein**) hält die Knöpfe Start und Rahmen gesperrt, bis du die Sperre dort aufhebst, etwa während die Maschine gewartet wird.

Vor jedem Job und jedem Rahmen prüft KizamuBeam, ob alle Bewegungen samt Überfahrweg im Arbeitsbereich der Maschine bleiben. Hat die Steuerung ihren Ursprung noch nicht gemeldet (oder tut das nie, wie Marlin), zeigt eine Warnung die Ausdehnung des Jobs, die du bestätigen musst.

## Wo der Job beginnt

Die Einstellung **Starten ab** im Fenster Laser entscheidet, wo der Job landet:

| Starten ab | Bedeutung |
|---|---|
| **Absolute Koordinaten** | Der Job liegt genau dort, wo er auf der Arbeitsfläche liegt. Die Arbeitsfläche ist das Maschinenbett. Braucht eine Referenzfahrt. |
| **Benutzer-Ursprung** | Der Job beginnt an einem Ursprung, den du im Fenster Verschieben setzt. |
| **Aktuelle Position** | Der Job beginnt dort, wo der Kopf gerade steht. |

Bei Benutzer-Ursprung und Aktueller Position legt der **Job-Ursprung** (neun Punkte: Ecken, Kantenmitten, Mitte) fest, welcher Punkt des Jobs an dieser Stelle liegt. Ein Projekt merkt sich seinen Job-Ursprung und den Schalter **Nur Auswahl**; neue Projekte starten mit den Vorgaben aus **Bearbeiten → Einstellungen → Arbeitsfläche und Fangen → Auftrag**.

**Ziel nach dem Job** in den Geräteeinstellungen (Tab **Allgemein**, Abschnitt **Bewegung**) legt fest, wohin der Kopf nach dem Job fährt: zurück zum Laserstart, zum Ursprung (0,0), zu einer eigenen XY-Position, oder er bleibt stehen (**Verweilen**). Das gilt bei Absoluten Koordinaten und Benutzer-Ursprung.

## Beim Lasern nachsteuern

**Nachsteuern** im Fenster Laser ändert Leistung und Geschwindigkeit in Schritten von 1 und 10 % (von 10 bis 200 %) und Eilgänge auf 25, 50 oder 100 %, während der Job läuft. Air Assist lässt sich sofort ein- und ausschalten, auch während eines Jobs. Das funktioniert mit GRBL, grblHAL und FluidNC.

## Schnittreihenfolge

Die Layer werden immer in der Reihenfolge der Layer-Tabelle gelasert. Innerhalb eines Layers bestimmen diese Schalter die Reihenfolge der Schnitte:

| Option | Wirkung |
|---|---|
| **Innere Formen zuerst** | Löcher und Innenkonturen werden vor ihrer Außenkontur geschnitten, damit Teile nicht herausfallen, bevor ihre Löcher geschnitten sind. |
| **Leerwege verkürzen** | Die nächstgelegene Form wird als nächste geschnitten. Ist die Option aus, gilt die Reihenfolge aus dem Fenster Objekte (manuelle Reihenfolge). |
| **Gruppen zusammenhalten** | Formen desselben Objekts oder derselben Gruppe werden bevorzugt nacheinander geschnitten. |
| **In Ecken beginnen** | Geschlossene Konturen beginnen an ihrer schärfsten Ecke, wo die Einstichstelle am wenigsten auffällt. |

Die Schalter gehören zum Gerät. **Optimierung …** im Fenster Laser öffnet sie zusammen mit weiteren Optionen: der **Richtungsreihenfolge** (links nach rechts, rechts nach links, oben nach unten, unten nach oben), **Besten Startpunkt wählen**, **Beste Richtung wählen** für offene Konturen und **Richtungswechsel reduzieren**. **Als Vorgabe speichern** speichert deine Wahl als persönliche Vorgabe; **Auf Standard zurücksetzen** kehrt zu ihr zurück (oder zur Werksvorgabe, wenn du keine hast).

Um nur für einen Job abzuweichen, öffne **Schnittreihenfolge für diesen Job** im Fenster Laser. Diese Werte werden nicht gespeichert; **Zurück zum Preset** kehrt zu den Geräteeinstellungen zurück. Ist alles Umsortieren ausgeschaltet und würde eine innere Form nach ihrer Außenkontur geschnitten, warnt die [Konstruktionsprüfung](construction-3d.md#check-the-design-before-cutting).

Wo ein einzelner Schnitt beginnt und in welche Richtung er läuft, legst du mit dem Startpunkt-Werkzeug fest (siehe [Pfade und Formen](paths.md)).

## Fenster Verschieben

Das Fenster **Verschieben** verfährt den Kopf in Schritten, setzt und löscht den Benutzer-Ursprung, entsperrt die Maschine nach einem Alarm, macht eine Referenzfahrt und fährt den Kopf:

- **Laser zur Auswahl** fährt den Kopf zu den ausgewählten Objekten.
- **Laser zur Klickposition**: Solange die Schaltfläche aktiv ist, fährt jeder Klick auf die Arbeitsfläche den Kopf mit ausgeschaltetem Laser dorthin. Esc beendet den Modus.
- Bei GRBL, grblHAL, Marlin und FluidNC fährt der Kopf, solange du einen Verfahrknopf **gedrückt hältst**, durchgehend, bis du loslässt; ein Klick fährt einen Schritt.
- Mit motorisierter Z-Achse verfährt ein Abschnitt **Z** den Fokus mit eigener Schrittweite (Vorgabe 0,1 mm) und Geschwindigkeit. Standardmäßig muss Z einmal referenziert sein; die Geräteeinstellungen können das lockern.
- Mit Rotpunkt-Zeiger wählt **Positionieren mit**, ob der rote Punkt oder der Laserkopf auf dem Ziel landet.

### Testfeuer {#test-fire}

**Testfeuer** schaltet den Laser bei stehendem Kopf für einige Sekunden mit geringer Leistung ein, etwa um den Fokus zu finden oder den Versatz des Rotpunkt-Zeigers zu prüfen. Es ist **standardmäßig aus** und muss je Gerät unter **Geräteeinstellungen → Rahmen & Zeiger → Testfeuer im Bewegen-Fenster** freigegeben werden, mit Leistung und Dauer (Vorgabe 1 % und 5 s). Die Maschine muss verbunden und im Leerlauf sein. Es funktioniert mit GRBL, grblHAL, FluidNC, Marlin und Smoothieware, nicht mit xTool oder Ruida.

:::danger
Ein Laser, der auf eine Stelle feuert, kann das Material entzünden und Augen verletzen. Nutze Testfeuer nur, wenn du mit geeignetem Augenschutz an der Maschine stehst und ihren Ausschalter erreichst. Die Zeitgrenze setzt nur die Software durch. Prüfe nach jedem Testfeuer den Laser an der Maschine und bestätige, dass er aus ist, bevor KizamuBeam weitere Befehle annimmt.
:::

## Konsole

Die **Konsole** zeigt die Meldungen der Steuerung und lässt dich Befehle senden, mit Verlauf. Alarme und aktive Eingänge (Endschalter, Tür, Taster) werden verständlich erklärt.

## G-Code speichern

**Laser → G-Code speichern …** schreibt den Job in eine Datei, etwa um ihn von einer SD-Karte oder mit einem anderen Programm auszuführen. Bei einem Ruida-Gerät schreibt **Laser → .rd speichern …** stattdessen eine Ruida-Jobdatei.

## Geräte und Geräteeinstellungen

Jeder Laser ist ein **Gerät** mit eigener Verbindung, eigenem Arbeitsbereich und eigenen Einstellungen. Wähle das Gerät oben im Fenster Laser oder verwalte die Geräte unter **Laser → Gerät → Geräte …**. Neue Geräte können von Vorlagen für verbreitete Laser ausgehen; die Liste ist nach Hersteller gruppiert, allgemeine Vorlagen je Steuerung stehen am Ende. Modelle mit mehreren Lasermodulen haben einen Eintrag je Modul. Unter der Liste stehen Lasermodul, Arbeitsbereich, Ausstattung und Herkunft der Werte der gewählten Vorlage; prüfe den Arbeitsbereich vor dem ersten Job. Das Lasermodul (Art, optische Leistung, Wellenlänge) lässt sich auch später in den Geräteeinstellungen eintragen.

**Laser → Gerät → Geräteeinstellungen …** enthält unter anderem:

- Arbeitsbereich, S-Wert für 100 % Leistung, Baudrate, Netzwerkadresse,
- Eilganggeschwindigkeit und Beschleunigung (**Von der Maschine lesen** holt sie von FluidNC oder GRBL),
- Größe des Empfangspuffers und das **DTR-Signal** beim Öffnen der USB-Schnittstelle (Auto lässt es unverändert; manche Steuerungen starten bei DTR neu),
- **Leerfahrt über Leeres (mm/min)**: eine schnellere Verfahrgeschwindigkeit über leeren Bildbereichen (GRBL, grblHAL, Marlin und FluidNC; leer = Eilgang wie bisher),
- **Materialhöhe (mm)**: warnt, wenn ein Z-Versatz den Fokus unter das Material fahren würde,
- **Dateiname für Controller-Uploads**, wahlweise mit **Dateiname hochzählen** (_2, _3 …) statt Überschreiben,
- Endschalter (mit „Keine“ macht KizamuBeam nie von selbst eine Referenzfahrt und fragt vorher nach),
- motorisierte Z-Achse (für Z-Versatz je Durchgang und den Fokustest),
- Befehl für Air Assist (M8 oder M7),
- **G-Code-Skripte**: Befehle, die vor und nach jedem Job laufen,
- **Rotpunkt-Zeiger**: der Versatz zwischen Laserstrahl und Zeiger, damit Rahmen und Klickfahrten mit dem roten Punkt zielen können,
- **Energie**: der elektrische Verbrauch der Maschine für die [Energieschätzung](#energy-and-cost),
- **Testfeuer** (siehe oben),
- **FluidNC**-Extras (siehe unten).

## FluidNC-Extras

Mit einer FluidNC-Steuerung bietet **Laser → FluidNC**:

- **Job von SD-Karte oder Flash ausführen**: den Job zuerst hochladen und dort ausführen, sodass ein WLAN-Aussetzer ihn nicht stoppt. Pause und Stopp funktionieren wie gewohnt.
- **Dateien auf der Steuerung**: Dateien auflisten, hochladen, ausführen und löschen.
- **Konfiguration …**: die config.yaml lesen, durchsuchen und ändern, Werte ausprobieren oder speichern und neu starten. Jedes Speichern sichert den vorherigen Stand (die letzten zehn je Gerät), den du wiederherstellen kannst.
- **Ausgänge**: Freie Ausgänge (etwa eine Absaugung) lassen sich im Fenster Laser schalten und während jedes Jobs automatisch einschalten.

## Steuerungen

KizamuBeam arbeitet mit FluidNC, GRBL 1.1, grblHAL, Marlin, Smoothieware, der xTool-D1-Familie über USB und Ruida-DSP-Steuerungen. Die Schaltflächen für Referenzfahrt, Verfahren, Ursprung und Konsole passen sich der Steuerung an. Einzelheiten und getestete Laser stehen unter [Maschinenkompatibilität](../reference/machine-compatibility.md).

## Drehachse und entfernte Laser

- Zylinder gravieren: siehe [Drehachse](rotary.md).
- Einen Laser nutzen, der an einem anderen Rechner hängt: siehe [Fernsteuerung](remote-control.md).
- Alles ohne Laser ausprobieren: siehe [Virtuelle Maschine](virtual-machine.md).
