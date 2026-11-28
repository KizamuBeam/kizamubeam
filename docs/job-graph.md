# Job graph: node-based job order (proposal)

Status: **proposal, not implemented.** This page describes a node-based way to set the order in which the laser
works through a job, and which settings each step uses. It is a design basis for discussion before any code is
written.

![Mockup of the Laser job window](screenshots/job-graph-mockup.png)

## Problem

Today the job order is implicit. `src/gcode.ts` builds it from fixed rules:

1. layers sorted by `priority`,
2. within a layer, the layer itself and then its enabled sub-layers,
3. per entry, all of its passes,
4. path optimization (`OrderOpts`: inner first, shortest travel, group, direction, best start, …), set per device
   and overridable per job (`OrderOverride`).

That works, but users can't see or easily change the order. Common wishes need workarounds today: "engrave, pause
so I can check, then cut inner holes before the outline", "cut left to right, but only for the outlines", "frame
before this step only".

## Idea

A **Laser job** window shows the job as a graph that the user can rewire:

- **Sequence chain (◆ ports):** the steps in the order the laser runs them, left to right.
- **Selection nodes (● ports):** decide *what* a step works on: a layer, a color, inner or outer contours, a group,
  a page. Filters split a set (for example inner/outer).
- **Operation nodes:** engrave, fill or cut a selection.
- **Order nodes:** path optimization for one selection (shortest travel, left to right, inner before outer, start
  corner, direction).
- **Control nodes:** start, run frame, pause with a message, air assist on/off, Z step, repeat n times, end (go home).
- **Check node:** lists objects that no step uses, so nothing is silently left out.

The bottom strip ("How the laser runs") lists the resulting steps with estimated time per step and in total, and a
small preview marks where each step lies on the workpiece.

## Key decision: values stay on the layer

Recommendation: **an operation node points to a layer and does not hold its own speed or power.** The layer
remains the only source of cut settings, in line with the existing rule that objects always use the layer
settings. The graph only decides order, selection and flow. The node inspector shows the layer's values read-only,
with a button to open the layer.

Node-only settings are limited to things that are about flow, not material: tabs for this step, "run frame before
this step", "passes per contour vs. per step", show as its own step in progress.

## Architecture

- **Data model:** `Doc.jobGraph` (optional) with nodes, typed ports and edges, saved in the project file and in
  undo history.
- **Compiler:** turns the graph into the list of entries that the G-code build already processes (layer/sub-layer
  entries with passes and `OrderOpts`) plus control inserts. Path generation stays unchanged.
- **Default graph:** without a custom graph, the app derives one from the layers. With no custom graph the output
  must be **byte-identical** to today's, checked by tests.
- **Estimate and preview** follow the compiled order, so time per step comes from the existing estimator.
- **MCP:** a command to read and set the job graph, with the same machine rules as other agent commands.
- **UI:** a dockable window opened from the Laser menu. Native DOM like the rest of the app, no new framework.

## Stages

1. Data model, compiler and default graph from layers, view only. Tests prove identical output.
2. Editable graph: selection, filter, order and operation nodes; check node.
3. Control nodes (frame, pause, air, Z, repeat), per-step estimate and preview, MCP command, saved graph templates.

## Risks and open questions

- Two views of the same thing (layer table and graph) must never disagree.
- Pause support differs by firmware. Whether `M0` pauses on FluidNC needs a hardware test; firmware without it gets
  a warning or no pause node.
- `.lbrn2` import has to map cleanly onto the default graph.
- Node editors can scare beginners. The window stays optional and ships ready-made graphs.
