---
sidebar_position: 4
title: Box composer
description: A finger-jointed box with freely placed inner walls, planned in the dialog with the mouse.
---

# Box composer

The **Box composer** builds a finger-jointed box with inner walls exactly where you want them: compartments of different sizes, an L-shaped wall, a long wall with short ones branching off. It is an extension from the catalogue: install it under **File → Extensions …** (see [Extensions](../extensions/index.md)); it then appears in the Toolbox under **From extensions**.

For a box with a simple grid of crossing dividers, the [Finger Joint Box with Dividers](boxes.md) is quicker.

## How the walls are joined

- Inner walls meet the outer walls and each other as **T joints** (tenons through slots), **corners** (finger joints), **crossings** (lap joints) or **free ends**.
- Every inner wall stands with teeth in slots of the floor; a free end gets a tooth just before its end.
- Each outer wall can be left out (a box open at the front, for example; the side walls or the floor take over the corners there), the lid too. Inner walls can be lower than the outer ones.

All joints come from the same code as the [Joint tool](../features/construction-3d.md#the-joint-tool), and the play is the total play of a joint, as for the [box](boxes.md): the slot is that much wider than the board. **From material** takes thickness, kerf and slot play from the [calibrated](../features/materials-tests.md#calibrate-fit) material of the layer, and warns when the layer gets another material.

## Planning the box

The dialog has three steps: **Box** (outer size, material, lid), **Plan** and **Wall sizes**. A new box starts with the outer walls only.

On the plan:

| Action | How |
|---|---|
| Select a stretch | Click a wall: the piece between its ends and joints under the pointer is selected. Shift adds more of the same line; a double-click or Ctrl+Shift+click takes the whole wall. |
| Move | Drag the selection. Walls that end on it follow. A stretch dragged out of its wall leaves it, so the walls behind get longer and form a U with it; moved back, it joins its wall again. |
| Add a wall | Double-click in a compartment adds a wall across it (Shift: from back to front; near its middle, exactly in the middle). With Ctrl, a target on the wall under the pointer shows where a new wall starts: click to add it across the compartment, or drag to draw it. In an empty space, Ctrl-drag draws a free wall. |
| Lengthen or shorten | Drag the end of a wall. |
| Delete | Delete removes the selection, a right-click the stretch under the pointer. |
| Zoom and pan | Mouse wheel and middle mouse button; the button in the corner fits the plan again. |

A dragged wall never stops where it may not stand. It snaps to the middle of the compartment, the middle of the box, the middle of a wall it ends on or crosses, and into line with other walls. Two walls that meet end to end on one line become one wall.

The clear space on both sides and the length of the selected wall are shown on the plan and below it. The list under **Wall sizes** takes exact values. Changing the width or depth of the box asks whether the walls scale with it or keep their distances in mm.

## Checks and output

The dialog checks the layout as you go (walls too close to each other, ends that almost touch a wall, T joints from both sides that do not line up, very short free ends) together with the usual [design check](../features/construction-3d.md#check-the-design-before-cutting). A box larger than the work area is spread over several pages; it stays one object you can double-click to edit.

Look at the result in the [3D view](../features/construction-3d.md#3d-view) before cutting.

## Box composer (advanced)

The experimental **Box composer (advanced)** from the catalogue also changes the outline: the outer walls are walls of the plan like the others. A stretch pushed in cuts a corner away (L) or makes a notch (U), pulled out it makes a bay; floor and lid follow the outline. Delete leaves an outer wall or a stretch of it open (dashed); Delete again closes it.
