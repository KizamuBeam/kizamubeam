---
sidebar_position: 6
title: Extensions
description: Install extensions with device presets, templates, materials, motifs and plugins such as generators, path tools and image filters.
---

# Extensions

Extensions (`.kzp` files) add content and functions to KizamuBeam without a new version of the app:

- **Content**: device presets, templates, material library entries and library items (motifs, images, design elements).
- **Plugins**: generators that appear as tiles in the Toolbox, path tools that change the selected shapes (for example stencil bridges) and image filters that compute a new version of the selected image.

The built-in generators (boxes, gears, drawers and the others) are plugins too: they come with the app as a core pack and cannot be removed.

## The Extensions window

Open **File → Extensions …** (or **Edit → Settings → Extensions and fonts**). The window has three panes: the list on the left (**Installed**, **Catalogue** and **Updates**, with a search and a filter for **All**, **Content** and **Plugins**), the selected extension in the middle and its details on the right: what it contains, its version, where it comes from and which servers it may contact. A plugin can bring its own icon and a preview picture: the icon appears in front of the extension and on its tile in the Toolbox, the preview in the details.

### Installing

1. Pick an extension from the **catalogue** and click **Install**, or click **Install …** and choose a `.kzp` file. You can also drag a `.kzp` file onto the workspace.
2. The dialog lists what the extension contains and whether it is an update. Confirm to install. A progress indicator shows while it is downloaded and checked.

An extension with plugins is only installed after each plugin has started and computed its default parameters once; if that fails, the previously installed version stays.

After installing:

- generators, path tools and image filters appear in the **Toolbox** under **From extensions**,
- templates appear under **File → New from template … → From extensions**,
- device presets appear in the device list under their manufacturer (or under “From extensions”), marked with the extension's name,
- materials are copied into the material library,
- motifs and design elements appear in the library.

### Updating, switching off and removing

- **Update all** installs every newer version from the catalogue at once.
- **Switch off** keeps an extension installed but hides its content and plugins; **Switch on** brings them back.
- After an update or reinstall, **Back to x.y** restores the previous version once.
- **Remove** deletes the extension and its entries. If parts of the open project were made by one of its plugins, KizamuBeam tells you how many. Such parts keep their outline when the extension is missing, and the app names the extension they need.

## Safety

**Content** is data only, never program code. KizamuBeam checks every entry before installing, and device presets from extensions cannot bring start or end scripts or any other commands for your machine.

**Plugins** contain program code. It runs isolated in its own process, without access to your files, the network or the project, with a time and memory limit, and every result is checked before it reaches the drawing. Still, a plugin can compute wrong parts: check the result before the first job.

The catalogues are signed, and every extension in them is checked against its checksum. Extensions from the catalogue are marked **Verified (catalogue)**. A plugin extension installed from a file is marked **Unverified** and is only installed after you confirm that you trust its source.

### Plugins that load data from the internet

Some plugins need data from the internet, for example the street map, which looks up places and map data from OpenStreetMap. Such a plugin names its servers in advance; the install dialog and the details pane show them. KizamuBeam asks before the first request and then fetches the data itself, over HTTPS only, without cookies or sign-ins, never from your local network and only from those servers. In the Extensions window, a switch per plugin allows or blocks this and lists the requests of the current session, and **Offline operation** keeps all extensions offline.

## The catalogue

**File → Extensions …** always shows the current state of the catalogue. It is merged from the official KizamuBeam catalogue and the community repositories for [plugins](https://github.com/KizamuBeam/kizamubeam-plugins), [content packs](https://github.com/KizamuBeam/kizamubeam-packs) and [device presets](https://github.com/KizamuBeam/kizamubeam-devices). It contains, among others:

| Extension | Kind | What it does |
|---|---|---|
| **Box composer** | Generator | A finger-jointed box with freely placed inner walls, see [Box composer](../generators/box-composer.md). |
| **Box composer (advanced)** | Generator, experimental | The box composer with a shaped outline: corners cut away, notches and bays. |
| **Layered art** | Generator | Turns a logo, drawing or photo into stacked plates that are cut and glued on top of each other for depth. |
| **Jigsaw puzzle** | Generator | A puzzle of any size and number of pieces, with classic, round or square tabs, optional frame and engraved piece numbers. Every inner line is cut once. |
| **Rulers and scales** | Generator | Straight rulers in mm, cm or inch, protractors and scale dials with your own labels. |
| **Chessboard and game boards** | Generator | Boards of any size with engraved or hatched dark squares and coordinates. |
| **Street map** | Generator | An engravable map of a place from OpenStreetMap data, as a rectangle or circle. Loads data from the internet after you allow it; put “© OpenStreetMap contributors” on the finished piece. |
| **Stencil bridges** | Path tool | Adds bridges to the inner parts of text and shapes that would fall out of a stencil (the counters of O, A, B, 8). |
| **Hole plate** | Generator | A plate with a pattern of round or hexagonal holes, for speaker grilles or ventilation; an example plugin written in Rust. |
| **Example pack** | Content | One of each kind of content, as a starting point for your own packs. The values are examples, not measured settings. |

Until third-party extensions are listed in the catalogue, install them only from sources you trust: KizamuBeam checks their content, but cannot tell whether settings suit your machine.

## Making your own extension

A content pack is a single JSON file; plugins are written in JavaScript/TypeScript or Rust (WebAssembly) with the plugin SDK. The formats are described in the developer documentation: [Extension packs](https://github.com/KizamuBeam/kizamubeam/blob/main/docs/packs.md) and [Plugins](https://github.com/KizamuBeam/kizamubeam/blob/main/docs/plugins.md). Extensions for the catalogue are submitted as a pull request to the matching community repository.
