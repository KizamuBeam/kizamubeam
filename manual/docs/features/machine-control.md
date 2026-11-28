---
sidebar_position: 12
title: Running jobs and machine control
description: Start, frame and preview jobs, choose where a job starts, adjust power and speed while lasering, and configure devices.
---

# Running jobs and machine control

This page covers everything that happens after the design is done. How to connect a laser for the first time is described in [Connecting a laser](../getting-started/connect-laser.md).

The machine windows sit on the right by default: **Laser** (job, status, devices), **Move** (jogging and origin) and **Console**.

## Preview

**Laser → Preview …** (Alt+P) simulates the job before anything moves:

- playback with a time slider, travel moves, and shading by power,
- a time estimate that takes acceleration, corners and the pauses of the [dwell](layers.md#line) setting into account,
- the same order as the real job,
- a breakdown of the estimated time per layer, sub-layer and process type, plus the travel time with the laser off.

Engraving and cutting play back at separate speeds (by default 50× and 10×). **Smooth process types** instead gives every type the same playback time, so a long engraving does not rush the cut that follows. Tick **Pause on process change** to stop the playback whenever the process changes. Layer changes are markers on the time slider; click one to jump there.

### Energy and cost

Below the time estimate, the preview shows the **estimated energy and cost** of the job. The calculation uses the values on the **Energy** tab of the device settings (base consumption of the machine, electrical power of the laser at 0, 50 and 100 % and additional consumers such as air assist or an extractor with their own power and operating rule). Enter the **electricity tariff** per kWh and the currency under **Edit → Settings → General** to see the cost. It is a model, not a measurement: scripts, Z moves and pauses are not included. A short help in the preview explains the calculation.

**Start Here** lasers the job from the position of the time slider, for example after an abort. The head moves there with the laser off and continues with the power, speed and air assist of that layer.

## Frame

**Frame** traces the rectangle around the job, **Contour Frame** follows its outline. Both can run with a low-power laser so you can see the frame on the material. Use framing to check that the job fits on the workpiece before you start.

With **Repeat frame** switched on (check box in the Laser window, or Laser → Repeat frame), Frame and Contour Frame run in a loop. Every lap is recomputed from the current drawing, so you can move objects or slide the workpiece and see the result on the next lap. Click the running button again to end the loop after the current lap; **Stop** ends it at once. The loop also ends by itself after the time set under **Repeat for at most (min)** in the device settings (tab **Framing & pointer**, default 5 minutes), and when a lap would leave the work area.

## Start, pause and stop

**Start** sends the job. During the job, the Laser window shows progress, elapsed and remaining time.

- **Pause** holds the machine; **Resume** continues.
- **Stop** stops the job and resets the controller. The position is kept.
- **Cut Selected Graphics** lasers only the selected objects.
- **Lock start** in the device settings (tab **General**) keeps the Start and Frame buttons locked until you release the lock there, for example while the machine is being serviced.

Before every job and every frame, KizamuBeam checks that all moves, including overscan, stay inside the work area of the machine. If the controller has not reported its origin yet (or never does, as with Marlin), a warning shows the extent of the job and must be confirmed.

## Where the job starts

The **Start From** setting in the Laser window decides where the job lands:

| Start From | Meaning |
|---|---|
| **Absolute Coords** | The job is placed exactly where it is on the workspace. The workspace is the machine bed. Needs homing. |
| **User Origin** | The job starts at an origin you set with the Move window. |
| **Current Position** | The job starts where the head is now. |

With User Origin and Current Position, the **job origin** (nine points: corners, edge centres, centre) says which point of the job sits at that position. A project remembers its job origin and the **Cut Selected Graphics** switch; new projects start with the defaults from **Edit → Settings → Workspace and snapping → Job**.

**Target after job** in the device settings (tab **General**, section **Motion**) decides where the head goes when the job is done: back to the laser start, to the origin (0,0), to a custom XY position, or it stays (**Dwell**). It applies with Absolute Coords and User Origin.

## Adjust while lasering

**Adjust** in the Laser window changes power and speed in steps of 1 and 10 % (from 10 to 200 %) and rapid moves at 25, 50 or 100 %, while the job runs. Air assist can be switched on and off at once, also during a job. This works with GRBL, grblHAL and FluidNC.

## Cut order

Layers are always lasered in the order of the layer table. Within a layer, these switches decide the order of the cuts:

| Option | Effect |
|---|---|
| **Inner shapes first** | Holes and inner contours are cut before their outer contour, so parts do not drop before their holes are cut. |
| **Reduce travel moves** | The nearest shape is cut next. When off, the stacking order from the Objects window is used (manual order). |
| **Keep groups together** | Shapes of the same object or group are preferably cut one after another. |
| **Start in corners** | Closed contours start at their sharpest corner, where the start mark is least visible. |

The switches belong to the device. **Optimization …** in the Laser window opens them together with further options: the **direction order** (left to right, right to left, top to bottom, bottom to top), **Choose the best start point**, **Choose the best direction** for open contours and **Reduce direction changes**. **Save as default** stores your choice as a personal default; **Reset to defaults** returns to it (or to the factory defaults when you have none).

To deviate for one job only, open **Cut order for this job** in the Laser window. These values are not stored; **Back to preset** returns to the device settings. If all reordering is switched off and an inner shape would be cut after its outer contour, the [design check](construction-3d.md#check-the-design-before-cutting) warns about it.

To choose where a single cut starts and in which direction, use the start point tool (see [Paths and shapes](paths.md)).

## Move window

The **Move** window jogs the head in steps, sets and clears the user origin, unlocks the machine after an alarm, homes it and moves the head:

- **Move Laser to Selection** moves the head to the selected objects.
- **Move Laser to Click**: while this button is active, every click on the workspace moves the head there with the laser off. Esc ends the mode.
- On GRBL, grblHAL, Marlin and FluidNC, **holding** a jog button moves the head continuously until you release it; a click moves one step.
- With a motorized Z axis, a **Z** section jogs the focus with its own step (default 0.1 mm) and speed. By default Z must have been homed once; the device settings can relax this.
- With a red-dot pointer, **Position with** chooses whether the red dot or the laser head lands on the target.

### Test fire

**Test fire** fires the laser at a low power for a few seconds, for example to find the focus or to check the red-dot offset. It is **off by default** and must be enabled per device under **Device Settings → Framing & pointer → Test fire in Move window**, with power and duration (defaults 1 % and 5 s). The machine must be connected and idle. It works with GRBL, grblHAL, FluidNC, Marlin and Smoothieware, not with xTool or Ruida. While the fire is active, the jog pad stays enabled so the head can be positioned with the laser on; everything else stays locked until the fire ends.

:::danger
A laser firing in one spot can set the material on fire and injure eyes. Only use test fire while you are standing at the machine with suitable eye protection and can reach its off switch. The time limit is enforced by the software only. After every test fire, check the laser at the machine and confirm that it is off before KizamuBeam accepts further commands.
:::

## Console

The **Console** shows the messages of the controller and lets you send commands, with a history. Alarms and active inputs (limit switches, door, probe) are explained in plain language.

## Saving G-code

**Laser → Save GCode …** writes the job to a file, for example to run it from an SD card or from another program. With a Ruida device, **Laser → Save .rd …** writes a Ruida job file instead.

## Devices and device settings

Each laser is a **device** with its own connection, work area and settings. Pick the device at the top of the Laser window, or manage them under **Laser → Device → Devices …**. New devices can start from templates for common lasers; the list is grouped by manufacturer, with generic templates per controller at the end. Models sold with several laser modules have one entry per module. Below the list you see the selected template's laser module, work area, equipment and where the values come from; check the work area before the first job. The laser module (type, optical power, wavelength) can also be entered later in the device settings.

**Laser → Device → Device Settings …** holds, among others:

- work area, S value for 100 % power, baud rate, network address,
- rapid speed and acceleration (**Read from Machine** fetches them from FluidNC or GRBL),
- receive buffer size, and the **DTR signal** when the USB port is opened (Auto leaves it unchanged; some controllers reset on DTR),
- **Whitespace travel (mm/min)**: a faster travel speed over empty areas of images (GRBL, grblHAL, Marlin and FluidNC; blank = rapid moves as before),
- **Material height (mm)**: warns when a Z offset would move the focus below the material,
- **Filename for controller uploads**, optionally with **Increment filename** (_2, _3 …) instead of overwriting,
- limit switches (with "None", KizamuBeam never homes by itself and asks before homing),
- motorized Z axis (for Z offsets per pass and the focus test),
- air assist command (M8 or M7),
- **G-code scripts**: commands to run before and after every job,
- **red-dot pointer**: the offset between beam and pointer, so framing and click moves can aim with the red dot,
- **Energy**: the electrical consumption of the machine for the [energy estimate](#energy-and-cost),
- **test fire** (see above),
- **FluidNC** extras (see below).

## FluidNC extras

With a FluidNC controller, **Laser → FluidNC** offers:

- **Run job from the SD card or flash**: upload the job first and run it there, so a Wi-Fi dropout does not stop it. Pause and stop work as usual.
- **Files on the controller**: list, upload, run and delete files.
- **Configuration …**: read, search and change the config.yaml, try values out or save them, and restart. Every save keeps a backup of the previous state (the last ten per device), which you can restore.
- **Outputs**: free outputs (for example a fume extractor) can be switched in the Laser window and turned on automatically during every job.

## Controllers

KizamuBeam works with FluidNC, GRBL 1.1, grblHAL, Marlin, Smoothieware, the xTool D1 family over USB and Ruida DSP controllers. Buttons for homing, jogging, origin and console adapt to the controller. See [Machine compatibility](../reference/machine-compatibility.md) for details and tested lasers.

## Rotary and remote lasers

- Engraving cylinders: see [Rotary](rotary.md).
- Running a laser that is connected to another computer: see [Remote control](remote-control.md).
- Trying everything without a laser: see [Virtual Machine](virtual-machine.md).
