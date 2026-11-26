---
sidebar_position: 3
title: Snapping, guides and measuring
description: Snap to nodes and grid, use guides, measure, apply relations and draw dimensioned sketches.
---

# Snapping, guides and measuring

## Snapping

**Snap** in the status bar, or the magnet button in the main toolbar, switches snapping on and off. Objects and the pointer snap to nodes, midpoints, centres, intersections, lines and quadrant points of circles. **Grid** in the status bar snaps to the grid.

- **Ctrl** while dragging switches snapping off (or on) for the moment.
- **Alt** while dragging snaps more strongly and shows alignment guides on other objects.

How close the pointer has to come before it snaps is set under **Edit → Settings → Workspace and snapping → Snap distance (px)**, separately for normal snapping and with Alt.

Circles and arcs are also recognised inside paths, for example holes in a plate or imported DXF circles, so their true centre snaps. **View → Show centers** shows centre crosses always, for the selection only, or not at all.

## Grid

**View → Grid** shows or hides the grid. Under **Grid Settings …** you set the spacing (e.g. 25.4 for inches), subdivisions, every nth line bold, colour and opacity, and optionally use the finest spacing as the snap grid.

## Guides

Drag a guide out of the top ruler (horizontal) or the left ruler (vertical). Guides lie on their own **Guides** layer: they are never lasered or exported, and Ctrl+A, the palette and shape operations leave them alone. Drag a guide to move it, or back into the ruler to delete it. The Guides layer can be hidden and locked in the Objects window. Guides apply to all pages.

A right-click on a ruler opens a menu: add a vertical or horizontal guide at that point, show, hide or lock the guides, and switch grid and object snapping. A right-click on a guide offers **Position …** to type its exact position in mm and **Delete this guide**. In the Objects window, a double-click on a guide opens the position as well.

## Measuring

**Tools → Measure** (or the ruler button): click a start and an end point, with snapping. KizamuBeam shows length, Δx, Δy and angle; over a circle, diameter and radius. Esc clears the measurement.

## Relations

**Arrange → Relations** (or the relations button group on the tools toolbar) moves or turns one object so that it relates to another. Click the reference first (it stays), then the element of the object that should adapt.

| Relation | What it does |
|---|---|
| **Concentric** | Two circles, ellipses or polygons share a centre (also holes inside paths). |
| **Equal size** | Same radius for two circles, same length for two edges. |
| **Parallel** / **Perpendicular** | The second object turns by the smallest angle. |
| **Horizontal** / **Vertical** | Turns one edge level or upright. |
| **Tangent** | The second object moves until it touches. |
| **Distance** | Asks for a distance between edges, points or circles. |

Relations are applied once, like a command; each is one undo step.

## Sketches with dimensions

For parts that must keep exact dimensions while you change them, use **Toolbox → Sketches with relations → New sketch** (or **Convert to sketch**). In a sketch, lines, rectangles, circles and arcs keep their relations and dimensions permanently, like in a CAD program.

- In **Select** mode, drag from an empty spot to the right to select fully enclosed elements, or to the left to include elements that cross the box. Shift adds to the selection. For keyboard selection, open **Box selection**, move with the arrow keys, and mark both corners with Insert.
- Select two lines and choose **Collinear** to put them on the same infinite line without joining their endpoints. **Relations** lists geometric relations, can filter them by the current selection, and lets you highlight or remove one without deleting its geometry.
- **Join endpoints** closes a gap between two open lines or circular arcs. Shift-select the endpoints on the canvas or use the endpoint picker. Both segments keep their dimensions. If the existing relations prevent the join, the sketch does not change.
- **Split line** previews the split point as you hover over a straight segment and snaps to the midpoint near the center. Click to create two segments. The split keeps its fractional position along the original line when you resize or rotate it, and the original dimensions remain editable.
- **Delete** lists any dimensions and relations that would be removed along with the selected geometry. Cancel to keep the geometry, relations, and selection unchanged.
- **Slot** places the two semicircle centers at any angle, then sets the width with a third point. Near horizontal or vertical, the axis snaps to that direction unless the second center snaps to an existing reference. Edit the diameter to change the slot width, or the center distance to change the straight section. A freely placed diagonal slot also has an angle dimension. Overall length is the center distance plus the width.
- When placing or selecting a point, use **[** and **]** on the canvas to cycle between nearby sketch points. The highlighted point is used for the next click.
- **Rounded rectangle**: place the center and one corner, then click inside the rectangle to set the radius. A single dimension drives all four rounds; width and height remain independently editable.
- **Polygon** creates a regular polygon with 3–24 sides. Choose the side count, then place the center and one vertex. Edit the circumradius to resize it, or snap the vertex to existing geometry and let that reference drive the size.
- **Mirror** reflects selected elements across a straight sketch line or an origin axis. The window asks for the elements and the mirror line; a single straight construction line in the selection is pre-filled. The result is a single copy with no pattern link.
- **Circular pattern** distributes the selected elements around a centre point. The window asks for the elements, the centre, the count (2–500, including the original), the total angle (up to 360°) and the alignment; numbers accept project parameters such as `n`, which stay linked. Dragging a copy is not needed: the copies follow the seeds. Double-click the pattern badge or choose **Edit sketch pattern** to change the count later; surviving copies keep their identity. **Dissolve** keeps the geometry and drops the link, **Delete** removes the copies.
- **Rectangular pattern** repeats the selected elements along one or two directions. The window asks for the elements, the optional direction lines (default: sketch X and its perpendicular), the counts (1–500 each, at most 500 copies in total) and the spacings; spacing arrows on the canvas can be dragged, dragging past zero flips the side. Counts include the original, and linked parameters such as `n` or `s` keep working after editing.
- **Contour offset** previews an inner or outer contour before you place it. It supports circles and closed convex line-and-arc contours with tangent joins (such as a slot). The result follows the source, and the offset dimension remains editable. Circle offsets use a signed dimension; mixed contours keep the chosen side and use a positive distance. The tool rejects offsets that would collapse an arc or cross existing output. Both contours remain output geometry unless you mark one as construction geometry.
  If an inward offset splits a simple, closed, straight-sided contour at a narrow neck, the tool previews all resulting cuts and asks for confirmation. The source remains unchanged. The new contours are fixed sketch lines, not linked to the source. Cancel leaves the sketch untouched.
- **Move precisely** shifts selected geometry by a local X/Y distance with a live preview. Select all connected visible elements: construction geometry follows, and the command never removes relations to the rest of the sketch.
- **Round corner** and **Chamfer** work where two straight sides meet without a branch. Point near the corner along one side and click the preview. The radius or setback stays editable; the original sides stay as construction geometry, along with their dimensions.
- **Trim**: hover over the section you want to remove, then click the highlight. Lines, circles and arcs can cut one another. For example, remove the two inner arcs of overlapping circles to leave one closed outline. For these curve cuts, the originals remain as construction geometry so their dimensions are preserved. Each click can be undone separately.
- **Extend**: hover near a line end to preview the extension to the nearest line, circle or arc, then click to apply it. If it meets an existing endpoint, both elements share that point. A dialog appears only if dimensions or relations need approval for removal.
- **Rectangle from center**: drag from the center to a corner, or click both points. The preview extends symmetrically around the center. Use **Center rectangle from coordinates** for exact numeric placement.
- Snapping to a line midpoint while placing a line, polyline, rectangle, or circular arc can create a persistent midpoint relation. For a center rectangle, snapping its corner to a sketch point lets that point drive its size instead of adding width and height dimensions.

- Relations from the bar at the top or by key: coincident (O), horizontal (H), vertical (V), parallel (P), perpendicular (N), equal (E), tangent (T), concentric (X), midpoint (M), symmetric (Y), fixed (F).
- **Dimension** (D): a line gets a length, two lines an angle, a circle a diameter, an arc a radius, two points a distance. Double-click a dimension to change it. Dimensions can be formulas with project parameters, such as `Width / 2`.
- Colours: blue = still free, dark = fully defined, red = conflict.
- Construction geometry (G) is drawn dashed and never lasered.

Double-click reopens a sketch, Enter or **Done** closes it, **Cancel** discards all changes since opening.
