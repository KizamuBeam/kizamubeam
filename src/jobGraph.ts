// Job graph (issue #551): the order in which the laser works through a job, as nodes and wires.
// The sequence chain (start → steps → end) sets the order; data wires decide what a step works on
// (a layer, optionally split into inner/outer contours and with its own path order). This module is pure:
// it defines the stored format, cleans it on load, builds the default graph from the layers and compiles a
// graph into steps for the G-code build (src/gcode.ts). No DOM here.
import { t } from './i18n';
import type { Firmware } from './gcode';

export type OrderPreset = 'device' | 'shortest' | 'innerFirst' | 'ltr' | 'rtl' | 'ttb' | 'btt' | 'manual';
export const ORDER_PRESETS: OrderPreset[] = ['device', 'shortest', 'innerFirst', 'ltr', 'rtl', 'ttb', 'btt', 'manual'];

/** Settings an operation node may override for its step (the layer itself is not changed) */
export interface StepOverride {
  /** % */
  power?: number;
  /** mm/min */
  speed?: number;
  passes?: number;
}
export const OVERRIDE_KEYS = ['power', 'speed', 'passes'] as const;

interface NodeBase {
  id: string;
  x: number;
  y: number;
  /** Own name shown in the node header; empty = default name */
  name?: string;
}
export type JobNode =
  | (NodeBase & { kind: 'start' })
  | (NodeBase & { kind: 'end' })
  | (NodeBase & { kind: 'layer'; layer: number })
  | (NodeBase & { kind: 'split' })
  | (NodeBase & { kind: 'order'; preset: OrderPreset })
  | (NodeBase & { kind: 'op'; over?: StepOverride; before?: string; after?: string })
  | (NodeBase & { kind: 'pause'; message: string })
  | (NodeBase & { kind: 'gcode'; code: string })
  | (NodeBase & { kind: 'frame' });
export type JobNodeKind = JobNode['kind'];

/** A wire from an output port to an input port */
export interface JobEdge {
  from: string;
  out: string;
  to: string;
  in: string;
}

export interface JobGraph {
  v: 1;
  /** false = the graph is kept but the job uses the normal layer order */
  enabled: boolean;
  nodes: JobNode[];
  edges: JobEdge[];
}

export type PortType = 'seq' | 'data';
export interface PortDef {
  key: string;
  type: PortType;
}
const SEQ_IN: PortDef = { key: 'prev', type: 'seq' };
const SEQ_OUT: PortDef = { key: 'next', type: 'seq' };

/** Input and output ports per node kind */
export function portsOf(kind: JobNodeKind): { ins: PortDef[]; outs: PortDef[] } {
  switch (kind) {
    case 'start':
      return { ins: [], outs: [SEQ_OUT] };
    case 'end':
      return { ins: [SEQ_IN], outs: [] };
    case 'layer':
      return { ins: [], outs: [{ key: 'objs', type: 'data' }] };
    case 'split':
      return { ins: [{ key: 'objs', type: 'data' }], outs: [{ key: 'inner', type: 'data' }, { key: 'outer', type: 'data' }] };
    case 'order':
      return { ins: [{ key: 'objs', type: 'data' }], outs: [{ key: 'objs', type: 'data' }] };
    case 'op':
      return { ins: [SEQ_IN, { key: 'objs', type: 'data' }], outs: [SEQ_OUT] };
    case 'pause':
    case 'gcode':
    case 'frame':
      return { ins: [SEQ_IN], outs: [SEQ_OUT] };
  }
}

export const portType = (kind: JobNodeKind, key: string, dir: 'in' | 'out'): PortType | null =>
  (dir === 'in' ? portsOf(kind).ins : portsOf(kind).outs).find((p) => p.key === key)?.type ?? null;

// ---------- Limits and cleaning ----------

export const GRAPH_LIMITS = { nodes: 200, edges: 400, text: 2000, lines: 50, lineLen: 120 };
const KINDS: JobNodeKind[] = ['start', 'end', 'layer', 'split', 'order', 'op', 'pause', 'gcode', 'frame'];

const fin = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const str = (v: unknown, max = GRAPH_LIMITS.text) => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanOverride(v: unknown): StepOverride | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: StepOverride = {};
  if (fin(o.power)) out.power = Math.min(100, Math.max(0, o.power));
  if (fin(o.speed)) out.speed = Math.min(100000, Math.max(1, o.speed));
  if (fin(o.passes)) out.passes = Math.min(100, Math.max(1, Math.round(o.passes)));
  return Object.keys(out).length ? out : undefined;
}

function cleanNode(v: unknown): JobNode | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const kind = o.kind as JobNodeKind;
  if (!KINDS.includes(kind) || typeof o.id !== 'string' || !o.id || o.id.length > 40) return null;
  const base: NodeBase = { id: o.id, x: fin(o.x) ? o.x : 0, y: fin(o.y) ? o.y : 0 };
  const name = str(o.name, 60);
  if (name) base.name = name;
  switch (kind) {
    case 'layer':
      return Number.isInteger(o.layer) ? { ...base, kind, layer: o.layer as number } : null;
    case 'order':
      return { ...base, kind, preset: ORDER_PRESETS.includes(o.preset as OrderPreset) ? (o.preset as OrderPreset) : 'device' };
    case 'op': {
      const n: JobNode = { ...base, kind };
      const over = cleanOverride(o.over);
      if (over) n.over = over;
      const before = str(o.before),
        after = str(o.after);
      if (before) n.before = before;
      if (after) n.after = after;
      return n;
    }
    case 'pause':
      return { ...base, kind, message: str(o.message, 200) };
    case 'gcode':
      return { ...base, kind, code: str(o.code) };
    default:
      return { ...base, kind } as JobNode;
  }
}

/** Read a stored graph (project file): unknown parts are dropped, wires must join existing ports of the right type */
export function cleanJobGraph(v: unknown): JobGraph | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.nodes)) return undefined;
  const nodes: JobNode[] = [];
  const ids = new Set<string>();
  for (const raw of o.nodes.slice(0, GRAPH_LIMITS.nodes)) {
    const n = cleanNode(raw);
    if (n && !ids.has(n.id)) (ids.add(n.id), nodes.push(n));
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: JobEdge[] = [];
  for (const raw of Array.isArray(o.edges) ? o.edges.slice(0, GRAPH_LIMITS.edges) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const a = byId.get(String(e.from)),
      b = byId.get(String(e.to));
    if (!a || !b || a === b) continue;
    const ta = portType(a.kind, String(e.out), 'out'),
      tb = portType(b.kind, String(e.in), 'in');
    if (!ta || ta !== tb) continue;
    const edge = { from: a.id, out: String(e.out), to: b.id, in: String(e.in) };
    // One wire per input; a sequence output leads to one step only
    if (edges.some((x) => (x.to === edge.to && x.in === edge.in) || (ta === 'seq' && x.from === edge.from && x.out === edge.out))) continue;
    edges.push(edge);
  }
  return { v: 1, enabled: o.enabled !== false, nodes, edges };
}

// ---------- Building ----------

let seq = 0;
export const newNodeId = (kind: JobNodeKind) => `${kind}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * The graph that does what the normal job does: one step per layer with output, in layer priority order.
 * `layers` must already be sorted the way the job runs them.
 */
export function defaultJobGraph(layers: number[]): JobGraph {
  const nodes: JobNode[] = [{ id: 'start', kind: 'start', x: 20, y: 40 }];
  const edges: JobEdge[] = [];
  let prev = 'start';
  layers.forEach((li, k) => {
    const op = `op-${li}`,
      ln = `layer-${li}`;
    // layer nodes below and left of their step, so the data wire runs forward and up
    nodes.push({ id: op, kind: 'op', x: 220 + k * 220, y: 40 }, { id: ln, kind: 'layer', layer: li, x: 20 + k * 220, y: 230 });
    edges.push({ from: prev, out: 'next', to: op, in: 'prev' }, { from: ln, out: 'objs', to: op, in: 'objs' });
    prev = op;
  });
  nodes.push({ id: 'end', kind: 'end', x: 220 + layers.length * 220, y: 40 });
  edges.push({ from: prev, out: 'next', to: 'end', in: 'prev' });
  return { v: 1, enabled: true, nodes, edges };
}

// ---------- Compiling ----------

export type JobPart = 'all' | 'inner' | 'outer';
export interface OpStep {
  kind: 'op';
  node: string;
  layer: number;
  part: JobPart;
  /** Path order of this step; null = the job's order */
  order: OrderPreset | null;
  over: StepOverride;
  before: string[];
  after: string[];
}
export type JobStep =
  | OpStep
  | { kind: 'pause'; node: string; message: string }
  | { kind: 'gcode'; node: string; lines: string[] }
  | { kind: 'frame'; node: string };

export interface CompiledGraph {
  steps: JobStep[];
  /** Problems that keep the graph from running as drawn (translated) */
  errors: string[];
  /** Hints that don't stop the job (translated) */
  warnings: string[];
}

/** Lines of a G-code text: trimmed, empty lines dropped */
export const codeLines = (s: string | undefined): string[] => (s ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function nodeLabel(n: JobNode, layerName?: (i: number) => string): string {
  if (n.name) return n.name;
  switch (n.kind) {
    case 'start':
      return t('Start');
    case 'end':
      return t('Ende');
    case 'layer':
      return layerName ? layerName(n.layer) : t('Layer {n}', { n: String(n.layer).padStart(2, '0') });
    case 'split':
      return t('Konturen teilen');
    case 'order':
      return t('Reihenfolge');
    case 'op':
      return t('Bearbeiten');
    case 'pause':
      return t('Pause');
    case 'gcode':
      return t('G-Code');
    case 'frame':
      return t('Rahmen fahren');
  }
}

/** Follow the data wire into an operation back to its layer: split and order nodes on the way set part and order */
function traceData(g: JobGraph, byId: Map<string, JobNode>, opId: string): { layer: number; part: JobPart; order: OrderPreset | null } | null {
  let to = opId,
    port = 'objs';
  let part: JobPart = 'all';
  let order: OrderPreset | null = null;
  for (let guard = 0; guard < GRAPH_LIMITS.nodes; guard++) {
    const e = g.edges.find((x) => x.to === to && x.in === port);
    if (!e) return null;
    const n = byId.get(e.from);
    if (!n) return null;
    if (n.kind === 'layer') return { layer: n.layer, part, order };
    if (n.kind === 'order') order ??= n.preset;
    else if (n.kind === 'split') {
      if (part !== 'all' && part !== e.out) return { layer: -1, part, order }; // inner of outer: nothing
      part = e.out as JobPart;
    } else return null;
    to = n.id;
    port = 'objs';
  }
  return null;
}

/** Turn a graph into the steps the job runs, in order */
export function compileJobGraph(g: JobGraph): CompiledGraph {
  const errors: string[] = [];
  const warnings: string[] = [];
  const steps: JobStep[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const starts = g.nodes.filter((n) => n.kind === 'start');
  if (starts.length !== 1) {
    errors.push(starts.length ? t('Der Ablauf hat mehr als einen Start.') : t('Der Ablauf hat keinen Start.'));
    return { steps, errors, warnings };
  }
  const seen = new Set<string>();
  let cur: JobNode = starts[0];
  let ended = false;
  for (;;) {
    seen.add(cur.id);
    const e = g.edges.find((x) => x.from === cur.id && x.out === 'next');
    if (!e) break;
    const n = byId.get(e.to);
    if (!n) break;
    if (seen.has(n.id)) {
      errors.push(t('Der Ablauf läuft im Kreis.'));
      break;
    }
    if (n.kind === 'end') {
      ended = true;
      break;
    }
    const name = nodeLabel(n);
    if (n.kind === 'op') {
      const src = traceData(g, byId, n.id);
      if (!src) warnings.push(t('Schritt „{name}“ hat keine Objekte und wird übersprungen.', { name }));
      else if (src.layer >= 0)
        steps.push({ kind: 'op', node: n.id, layer: src.layer, part: src.part, order: src.order, over: { ...n.over }, before: codeLines(n.before), after: codeLines(n.after) });
    } else if (n.kind === 'pause') steps.push({ kind: 'pause', node: n.id, message: n.message });
    else if (n.kind === 'gcode') {
      const lines = codeLines(n.code);
      if (lines.length) steps.push({ kind: 'gcode', node: n.id, lines });
    } else if (n.kind === 'frame') steps.push({ kind: 'frame', node: n.id });
    cur = n;
  }
  if (!ended && !errors.length) warnings.push(t('Der Ablauf endet nicht mit „Ende“: Es zählen die Schritte bis zum letzten verbundenen.'));
  return { steps, errors, warnings };
}

/** Steps whose settings or G-code differ from their layer (for the notice before a job starts) */
export function stepDeviations(g: JobGraph): JobNode[] {
  return g.nodes.filter((n) => (n.kind === 'op' && (n.over && Object.keys(n.over).length || codeLines(n.before).length || codeLines(n.after).length)) || (n.kind === 'gcode' && codeLines(n.code).length));
}

// ---------- Custom G-code checks ----------

/** Firmware where a pause (M0) works while streaming; elsewhere the pause node is skipped with a warning */
export const pauseSupported = (fw: Firmware) => fw === 'fluidnc' || fw === 'grbl' || fw === 'grblhal' || fw === 'marlin';

/**
 * Check user G-code against machine safety rules. Returns the problems (translated); empty = OK.
 * Not allowed: homing and unlock, system commands, unit or coordinate-system changes, program end,
 * relative mode left on, and spindle power above the device maximum.
 */
export function checkCustomGcode(lines: string[], sMax: number): string[] {
  const out: string[] = [];
  if (lines.length > GRAPH_LIMITS.lines) out.push(t('Höchstens {n} Zeilen eigener G-Code je Knoten.', { n: GRAPH_LIMITS.lines }));
  let relative = false;
  for (const raw of lines) {
    if (raw.length > GRAPH_LIMITS.lineLen) {
      out.push(t('Zeile zu lang: „{line}“', { line: raw.slice(0, 40) + '…' }));
      continue;
    }
    const code = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim().toUpperCase();
    if (!code) continue;
    const bad = (why: string) => out.push(t('„{line}“: {why}', { line: raw, why }));
    if (code.startsWith('$') || code.startsWith('[') || /[^A-Z0-9 .\-+]/.test(code)) {
      bad(t('Systembefehle sind nicht erlaubt.'));
      continue;
    }
    const words = code.match(/[A-Z][-+]?[0-9.]*/g) ?? [];
    for (const w of words) {
      const L = w[0],
        v = parseFloat(w.slice(1));
      if (L === 'G' && [28, 30, 20, 92, 10, 53, 54, 55, 56, 57, 58, 59].includes(v)) bad(t('Referenzfahrt, Einheiten- und Koordinatenwechsel sind nicht erlaubt.'));
      else if (L === 'M' && [2, 30, 0, 1].includes(v)) bad(t('Programmende und Pausen bitte über eigene Knoten.'));
      else if (L === 'G' && v === 91) relative = true;
      else if (L === 'G' && v === 90) relative = false;
      else if (L === 'S' && isFinite(v) && v > sMax) bad(t('Leistung über dem Höchstwert des Geräts (S{max}).', { max: sMax }));
    }
  }
  if (relative) out.push(t('Nach G91 muss der Block mit G90 enden.'));
  return out;
}
