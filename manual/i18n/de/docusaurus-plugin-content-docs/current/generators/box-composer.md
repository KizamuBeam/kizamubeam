---
sidebar_position: 4
title: Box-Composer
description: Eine Box mit Fingerzinken und frei platzierten Innenwänden, im Dialog mit der Maus geplant.
---

# Box-Composer

Der **Box-Composer** baut eine Box mit Fingerzinken und Innenwänden genau dort, wo du sie haben willst: Fächer unterschiedlicher Größe, eine L-förmige Wand, eine lange Wand mit kurzen Abzweigungen. Er ist eine Erweiterung aus dem Katalog: Installiere ihn unter **Datei → Erweiterungen …** (siehe [Erweiterungen](../extensions/index.md)); danach steht er im Werkzeugkasten unter **Aus Erweiterungen**.

Für eine Box mit einem einfachen Raster sich kreuzender Trennwände geht die [Box mit Fingerzinken und Trennwänden](boxes.md) schneller.

## Wie die Wände verbunden werden

- Innenwände treffen Außenwände und einander als **T-Stöße** (Zapfen durch Schlitze), **Ecken** (Fingerzinken), **Kreuzungen** (Überblattungen) oder **freie Enden**.
- Jede Innenwand steht mit Zähnen in Schlitzen des Bodens; ein freies Ende bekommt kurz vor seinem Ende einen Zahn.
- Jede Außenwand lässt sich weglassen (etwa eine vorne offene Box; dort übernehmen die Seitenwände oder der Boden die Ecken), der Deckel ebenso. Innenwände können niedriger sein als die Außenwände.

Alle Verbindungen kommen aus demselben Code wie das [Werkzeug Verbindung](../features/construction-3d.md#the-joint-tool), und das Spiel ist das Gesamtspiel einer Verbindung, wie bei der [Box](boxes.md): Der Schlitz ist um so viel breiter als das Brett. **Aus dem Material** übernimmt Stärke, Kerf und Schlitzspiel aus dem [kalibrierten](../features/materials-tests.md#calibrate-fit) Material des Layers und warnt, wenn der Layer ein anderes Material bekommt.

## Die Box planen

Der Dialog hat drei Schritte: **Kasten** (Außenmaße, Material, Deckel), **Plan** und **Wandmaße**. Eine neue Box beginnt nur mit den Außenwänden.

Auf dem Plan:

| Aktion | So geht's |
|---|---|
| Abschnitt auswählen | Klick auf eine Wand: Das Stück zwischen ihren Enden und Verbindungen unter dem Zeiger wird ausgewählt. Shift ergänzt weitere Stücke derselben Linie; Doppelklick oder Ctrl+Shift+Klick nimmt die ganze Wand. |
| Verschieben | Die Auswahl ziehen. Wände, die auf ihr enden, folgen. Ein Abschnitt, der aus seiner Wand gezogen wird, löst sich von ihr, sodass die Wände dahinter länger werden und mit ihm ein U bilden; zurückgeschoben verbindet er sich wieder mit seiner Wand. |
| Wand hinzufügen | Doppelklick in ein Fach setzt eine Wand quer hinein (Shift: von hinten nach vorne; nahe seiner Mitte genau in die Mitte). Mit Ctrl zeigt eine Zielmarke auf der Wand unter dem Zeiger, wo eine neue Wand beginnt: klicken setzt sie quer durch das Fach, ziehen zeichnet sie. Im leeren Raum zeichnet Ctrl+Ziehen eine freie Wand. |
| Verlängern oder kürzen | Das Ende einer Wand ziehen. |
| Löschen | Entf löscht die Auswahl, ein Rechtsklick den Abschnitt unter dem Zeiger. |
| Zoomen und verschieben | Mausrad und mittlere Maustaste; der Knopf in der Ecke passt den Plan wieder ein. |

Eine gezogene Wand bleibt nie dort stehen, wo sie nicht stehen darf. Sie rastet in der Mitte des Fachs, der Mitte der Box, der Mitte einer Wand, auf der sie endet oder die sie kreuzt, und in einer Flucht mit anderen Wänden ein. Zwei Wände, die sich auf einer Linie Ende an Ende treffen, werden eine Wand.

Der lichte Raum auf beiden Seiten und die Länge der ausgewählten Wand stehen auf dem Plan und darunter. Die Liste unter **Wandmaße** nimmt genaue Werte. Änderst du Breite oder Tiefe der Box, fragt der Dialog, ob die Wände mitwachsen oder ihre Abstände in mm behalten.

## Prüfung und Ausgabe

Der Dialog prüft die Anordnung laufend (Wände zu nah beieinander, Enden, die eine Wand fast berühren, T-Stöße von beiden Seiten, die nicht fluchten, sehr kurze freie Enden), zusammen mit der üblichen [Konstruktionsprüfung](../features/construction-3d.md#check-the-design-before-cutting). Eine Box, die größer als der Arbeitsbereich ist, wird auf mehrere Seiten verteilt; sie bleibt ein Objekt, das du per Doppelklick bearbeitest.

Sieh dir das Ergebnis vor dem Schneiden in der [3D-Ansicht](../features/construction-3d.md#3d-view) an.

## Box-Composer (erweitert)

Der experimentelle **Box-Composer (erweitert)** aus dem Katalog ändert auch den Umriss: Die Außenwände sind Wände des Plans wie die anderen. Ein hineingeschobener Abschnitt schneidet eine Ecke ab (L) oder macht eine Einbuchtung (U), herausgezogen eine Ausbuchtung; Boden und Deckel folgen dem Umriss. Entf lässt eine Außenwand oder einen Abschnitt davon offen (gestrichelt); erneutes Entf schließt sie wieder.
