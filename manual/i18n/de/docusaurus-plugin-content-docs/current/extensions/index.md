---
sidebar_position: 6
title: Erweiterungen
description: Erweiterungen mit Gerätevorlagen, Projektvorlagen, Materialien, Motiven und Plugins wie Generatoren, Pfadwerkzeugen und Bildfiltern installieren.
---

# Erweiterungen

Erweiterungen (`.kzp`-Dateien) fügen KizamuBeam Inhalte und Funktionen hinzu, ohne neue App-Version:

- **Inhalte**: Gerätevorlagen, Projektvorlagen, Einträge für die Materialbibliothek und Bibliothekselemente (Motive, Bilder, Gestaltungselemente).
- **Plugins**: Generatoren, die als Kacheln im Werkzeugkasten erscheinen, Pfadwerkzeuge, die die ausgewählten Formen ändern (etwa Schablonenstege), und Bildfilter, die eine neue Fassung des ausgewählten Bildes berechnen.

Auch die eingebauten Generatoren (Boxen, Zahnräder, Schubladen und die anderen) sind Plugins: Sie kommen als Kernpaket mit der App und lassen sich nicht entfernen.

## Das Fenster Erweiterungen

Öffne **Datei → Erweiterungen …** (oder **Bearbeiten → Einstellungen → Erweiterungen und Schriften**). Das Fenster hat drei Bereiche: links die Liste (**Installiert**, **Katalog** und **Updates**, mit Suche und einem Filter für **Alle**, **Inhalte** und **Plugins**), in der Mitte die ausgewählte Erweiterung und rechts ihre Details: was sie enthält, ihre Version, woher sie kommt und welche Server sie ansprechen darf. Ein Plugin kann ein eigenes Symbol und ein Vorschaubild mitbringen: Das Symbol steht vor der Erweiterung und auf ihrer Kachel im Werkzeugkasten, das Vorschaubild in den Details.

### Installieren

1. Wähle eine Erweiterung aus dem **Katalog** und klicke auf **Installieren**, oder klicke auf **Installieren …** und wähle eine `.kzp`-Datei. Du kannst eine `.kzp`-Datei auch auf die Arbeitsfläche ziehen.
2. Der Dialog zeigt, was die Erweiterung enthält und ob es ein Update ist. Bestätige die Installation. Während sie geladen und geprüft wird, zeigt eine Fortschrittsanzeige den Stand.

Eine Erweiterung mit Plugins wird erst installiert, wenn jedes Plugin gestartet ist und einmal seine Standardparameter berechnet hat; schlägt das fehl, bleibt die bisher installierte Version.

Nach der Installation:

- erscheinen Generatoren, Pfadwerkzeuge und Bildfilter im **Werkzeugkasten** unter **Aus Erweiterungen**,
- erscheinen Vorlagen unter **Datei → Neu aus Vorlage … → Aus Erweiterungen**,
- erscheinen Gerätevorlagen in der Geräteliste beim Hersteller (oder unter „Aus Erweiterungen“), mit dem Namen der Erweiterung markiert,
- werden Materialien in die Materialbibliothek übernommen,
- erscheinen Motive und Gestaltungselemente in der Bibliothek.

### Aktualisieren, ausschalten und entfernen

- **Alle aktualisieren** installiert auf einmal jede neuere Version aus dem Katalog.
- **Ausschalten** lässt eine Erweiterung installiert, blendet aber ihre Inhalte und Plugins aus; **Einschalten** holt sie zurück.
- Nach einem Update oder einer Neuinstallation stellt **Zurück auf x.y** einmal die vorherige Version wieder her.
- **Entfernen** löscht die Erweiterung und ihre Einträge. Stammen Teile des offenen Projekts von einem ihrer Plugins, sagt KizamuBeam, wie viele. Solche Teile behalten ihre Kontur, wenn die Erweiterung fehlt, und die App nennt die Erweiterung, die sie brauchen.

## Sicherheit

**Inhalte** sind nur Daten, nie Programmcode. KizamuBeam prüft jeden Eintrag vor der Installation, und Gerätevorlagen aus Erweiterungen können keine Start- oder Endskripte und keine anderen Befehle für deine Maschine mitbringen.

**Plugins** enthalten Programmcode. Er läuft abgeschottet in einem eigenen Prozess, ohne Zugriff auf deine Dateien, das Netzwerk oder das Projekt, mit Zeit- und Speichergrenze, und jedes Ergebnis wird geprüft, bevor es in die Zeichnung kommt. Trotzdem kann ein Plugin falsche Teile berechnen: Prüfe das Ergebnis vor dem ersten Job.

Die Kataloge sind signiert, und jede Erweiterung darin wird gegen ihre Prüfsumme geprüft. Erweiterungen aus dem Katalog sind als **Geprüft (Katalog)** markiert. Eine Erweiterung mit Plugins aus einer Datei ist als **Ungeprüft** markiert und wird erst installiert, wenn du bestätigst, dass du ihrer Quelle vertraust.

### Plugins, die Daten aus dem Internet laden

Manche Plugins brauchen Daten aus dem Internet, etwa der Stadtplan, der Orte und Kartendaten von OpenStreetMap abruft. Ein solches Plugin nennt seine Server vorab; der Installationsdialog und die Details zeigen sie. KizamuBeam fragt vor der ersten Anfrage und holt die Daten dann selbst, nur über HTTPS, ohne Cookies oder Anmeldungen, nie aus deinem lokalen Netzwerk und nur von diesen Servern. Im Fenster Erweiterungen erlaubt oder sperrt ein Schalter je Plugin das und listet die Anfragen der laufenden Sitzung, und **Offline-Betrieb** hält alle Erweiterungen offline.

## Der Katalog

**Datei → Erweiterungen …** zeigt immer den aktuellen Stand des Katalogs. Er wird aus dem offiziellen KizamuBeam-Katalog und den Community-Repositories für [Plugins](https://github.com/KizamuBeam/kizamubeam-plugins), [Inhaltspakete](https://github.com/KizamuBeam/kizamubeam-packs) und [Gerätevorlagen](https://github.com/KizamuBeam/kizamubeam-devices) zusammengeführt. Er enthält unter anderem:

| Erweiterung | Art | Was sie tut |
|---|---|---|
| **Box-Composer** | Generator | Eine Box mit Fingerzinken und frei platzierten Innenwänden, siehe [Box-Composer](../generators/box-composer.md). |
| **Box-Composer (erweitert)** | Generator, experimentell | Der Box-Composer mit geformtem Umriss: abgeschnittene Ecken, Einbuchtungen und Ausbuchtungen. |
| **Schichtbild** | Generator | Macht aus einem Logo, einer Zeichnung oder einem Foto gestapelte Platten, die geschnitten und für Tiefe aufeinandergeklebt werden. |
| **Puzzle** | Generator | Ein Puzzle in beliebiger Größe und Teilezahl, mit klassischen, runden oder eckigen Nasen, optionalem Rahmen und gravierten Teilenummern. Jede innere Linie wird einmal geschnitten. |
| **Lineale und Skalen** | Generator | Gerade Lineale in mm, cm oder Zoll, Winkelmesser und Skalenscheiben mit eigenen Beschriftungen. |
| **Schachbrett und Spielbretter** | Generator | Bretter in beliebiger Größe mit gravierten oder schraffierten dunklen Feldern und Koordinaten. |
| **Stadtplan** | Generator | Eine gravierbare Karte eines Orts aus OpenStreetMap-Daten, als Rechteck oder Kreis. Lädt nach deiner Erlaubnis Daten aus dem Internet; auf das fertige Stück gehört „© OpenStreetMap contributors“. |
| **Schablonenstege** | Pfadwerkzeug | Setzt Stege an die Innenteile von Text und Formen, die aus einer Schablone herausfallen würden (die Innenräume von O, A, B, 8). |
| **Lochplatte** | Generator | Eine Platte mit einem Muster aus runden oder sechseckigen Löchern, für Lautsprechergitter oder Lüftung; ein Beispiel-Plugin in Rust. |
| **Beispielpaket** | Inhalte | Von jeder Inhaltsart ein Beispiel, als Ausgangspunkt für eigene Pakete. Die Werte sind Beispiele, keine gemessenen Einstellungen. |

Solange Erweiterungen von Dritten nicht im Katalog stehen, installiere sie nur aus Quellen, denen du vertraust: KizamuBeam prüft ihren Inhalt, kann aber nicht beurteilen, ob Einstellungen zu deiner Maschine passen.

## Eine eigene Erweiterung erstellen

Ein Inhaltspaket ist eine einzelne JSON-Datei; Plugins werden mit dem Plugin-SDK in JavaScript/TypeScript oder Rust (WebAssembly) geschrieben. Die Formate beschreibt die Entwicklerdokumentation: [Extension packs](https://github.com/KizamuBeam/kizamubeam/blob/main/docs/packs.md) und [Plugins](https://github.com/KizamuBeam/kizamubeam/blob/main/docs/plugins.md). Erweiterungen für den Katalog werden als Pull Request im passenden Community-Repository eingereicht.
