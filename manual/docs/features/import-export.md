---
sidebar_position: 8
title: Import and export
description: Bring in SVG, DXF, PDF, Illustrator and LightBurn files, and export designs and G-code.
---

# Import and export

## Opening projects

In the desktop app, **File → Open with preview …** (Ctrl+O) is the default: it browses any accessible folder — with places, a folder tree and favourites on the left, a searchable file list in the middle — and shows a preview of the selected project on the right, including multi-page KizamuBeam projects and LightBurn files. SVG files show a preview as well and are inserted through the regular vector import. Selecting a file never touches the editor; only **Open** loads the project. The classic system dialog is still available as **File → Open …**.

Both open dialogs remember the last used folder for the session. Under **Edit → Settings → Files** you can set default folders for opening and saving, with an option to always use them.

## Importing

**File → Import …** (Ctrl+I), dragging files onto the workspace, or pasting with Ctrl+V from other programs all work the same way. Colours are mapped to the nearest palette colour, which means the nearest layer, and several objects arrive as a group.

How imports behave can be changed under **Edit → Settings → Workspace and snapping → Import**: whether imported objects are selected and grouped, whether they are placed at the centre of the bed, whether notices about skipped content appear, the DXF unit and SVG resolution used when a file does not specify them, the tolerance for closing nearly closed paths, and whether hidden SVG and DXF layers are imported.

### SVG

Paths (including arcs), rectangles, circles, ellipses, lines, polygons, `use` references, transforms, CSS classes and embedded images. The size comes from `width`, `height` and `viewBox`. **Text in SVG files is skipped**: convert text to paths in your drawing program before saving.

### DXF

Lines, polylines with arcs, circles, arcs, ellipses, splines and blocks, with the units stored in the file and true colours. Single lines that touch are joined into continuous paths, so a contour drawn from many segments can be cut as one shape.

### PDF and Adobe Illustrator

Paths stay Bézier curves; RGB, CMYK, grey and spot colours map to layers; embedded images come along. Text becomes outlines from the fonts embedded in the file. Fonts that are not embedded are taken from your system or the font manager; if one is missing, KizamuBeam says which one was replaced.

The first PDF page lands on the current page, every further page on a new project page. Illustrator files from version 9 onwards work, because they contain a PDF version. PDFs that are only protected against editing can be imported; files that need a password to open cannot.

### LightBurn projects

`.lbrn2` files can be opened (**File → Open with preview**, as a new project) or imported into the current project. Shapes, groups, images with their adjustments and positions are kept. Layers take over name, mode, speed, power, passes, output, order, fill and image settings, sub-layers, perforation, lead-ins, overcut, power ramp and Z settings. Text stays editable text when the font is installed; otherwise its outlines are kept as a path. Elements that could not be imported are listed in the status bar and in the design check.

LightBurn material libraries (`.clb`) can be imported in the material library.

### 3D models

STL and OBJ files become layered or rib models made of flat parts. KizamuBeam asks which one you want; see [Generators](../generators/index.md).

### Images

See [Images and tracing](images.md).

## Exporting

**File → Export** (also as toolbar buttons):

| Format | What is exported |
|---|---|
| **SVG** | The current page, with images. |
| **DXF** | The current page in mm, one DXF layer per used layer with name and colour. Curves are exported as exact splines. Images cannot go into DXF. |
| **PDF** | All pages, each at bed size 1:1, every layer as its own PDF layer, fill layers filled, images embedded. |
| **Illustrator (`.ai`)** | The same PDF-compatible file; opens in Illustrator, Inkscape and Affinity. |

Texts are exported as outlines.

## G-code

**Laser → Save GCode …** writes the job of the current page for the selected device, exactly as it would be sent to the laser, including custom G-code scripts of the device. Use this to run jobs from an SD card or another sender.

## Transferring settings

**File → Transfer Settings …** exports settings, devices, material library, library, templates, extensions and window layout into one `.kzs` file, as a backup or for another computer. See [Customizing and settings](customizing.md).
