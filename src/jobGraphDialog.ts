// Window "Laser job" (issue #551): the job graph as nodes and wires. The top chain (◆) is the order the laser
// runs; data wires (●) say what a step works on. Values come from the layer; a step may override some of them
// or add own G-code, which is always marked. The graph lives in the project (Doc.jobGraph, undo history).
import type { Editor } from './editor';
import { h } from './dom';
import { t, tn } from './i18n';
import { device, makeJob } from './laser';
import { estimate, formatDuration, FIRMWARES } from './gcode';
import { layerLabel, PALETTE } from './model';
import {
  checkCustomGcode, codeLines, compileJobGraph, defaultJobGraph, newNodeId, nodeLabel, ORDER_PRESETS, pauseSupported, portsOf, portType,
  stepDeviations, type JobGraph, type JobNode, type JobNodeKind, type OpStep, type OrderPreset, type PortDef, type StepOverride,
} from './jobGraph';

const NODE_W = 168;
const CANVAS = { w: 3000, h: 1600 };

const orderLabels = (): Record<OrderPreset, string> => ({
  device: t('Wie im Laser-Fenster'),
  shortest: t('Kürzeste Wege'),
  innerFirst: t('Innen vor außen'),
  ltr: t('Links → rechts'),
  rtl: t('Rechts → links'),
  ttb: t('Oben → unten'),
  btt: t('Unten → oben'),
  manual: t('Wie gezeichnet'),
});
const kindLabels = (): Record<JobNodeKind, string> => ({
  start: t('Start'),
  end: t('Ende'),
  layer: t('Layer'),
  split: t('Konturen teilen'),
  order: t('Reihenfolge'),
  op: t('Bearbeiten'),
  pause: t('Pause'),
  gcode: t('G-Code'),
  frame: t('Rahmen fahren'),
});
const portLabel = (key: string) => (({ objs: t('Objekte'), inner: t('innen'), outer: t('außen') }) as Record<string, string>)[key] ?? '';

/** Layers the job would run, in layer priority order */
function jobLayers(ed: Editor): number[] {
  return ed
    .usedLayers()
    .filter((i) => ed.layer(i).output)
    .sort((a, b) => (ed.layer(a).priority ?? a) - (ed.layer(b).priority ?? b) || a - b);
}

let open: HTMLDialogElement | null = null;

export function openJobGraphDialog(ed: Editor) {
  if (open) return open.showModal();
  let sel: string | null = null;
  let selEdge: number | null = null;
  /** Times per step from the last estimate, by node id */
  let times = new Map<string, number>();
  let jobWarnings: string[] = [];
  let total = 0;

  const graph = () => ed.doc.jobGraph;
  const layerName = (i: number) => `${layerLabel(i)} ${ed.layer(i).name ?? ''}`.trim();
  /** Change the graph as one undo step; `merge` adds to the last step (typing in the same field) */
  const edit = (label: string, fn: (g: JobGraph) => void, merge = false) => {
    const g = graph();
    if (!g) return;
    if (!merge) ed.snapshot(label);
    fn(g);
    ed.emit('doc');
  };

  // ---------- Layout ----------
  const enabled = h('input', { type: 'checkbox', onchange: () => edit(t('Laser-Ablauf ein/aus'), (g) => (g.enabled = enabled.checked)) }) as HTMLInputElement;
  const addSel = h('select', { class: 'jg-add', title: t('Knoten hinzufügen') }) as HTMLSelectElement;
  addSel.addEventListener('change', () => {
    const v = addSel.value;
    addSel.value = '';
    if (v) addNode(v);
  });
  const rebuild = h('button', { class: 'btn', onclick: () => fromLayers() }, t('Aus Layern erzeugen'));
  const del = h('button', { class: 'btn', onclick: () => removeSelected() }, t('Löschen'));
  const status = h('span', { class: 'jg-status' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'jg-wires');
  svg.setAttribute('width', String(CANVAS.w));
  svg.setAttribute('height', String(CANVAS.h));
  const nodesEl = h('div', { class: 'jg-nodes' });
  const plane = h('div', { class: 'jg-plane', style: `width:${CANVAS.w}px;height:${CANVAS.h}px` }, svg, nodesEl);
  const canvas = h('div', { class: 'jg-canvas', tabindex: 0 }, plane);
  const inspector = h('div', { class: 'jg-inspector' });
  const strip = h('div', { class: 'jg-steps' });
  const empty = h('div', { class: 'jg-empty' },
    h('p', {}, t('Mit einem eigenen Ablauf legst du fest, in welcher Reihenfolge der Laser arbeitet, was jeder Schritt bearbeitet und wo Pausen oder eigener G-Code hinkommen.')),
    h('p', { class: 'muted' }, t('Ohne Ablauf läuft der Job wie bisher nach der Layer-Reihenfolge.')),
    h('button', { class: 'btn primary', onclick: () => fromLayers() }, t('Ablauf aus den Layern erzeugen')),
  );
  const body = h('div', { class: 'jg-body' }, canvas, inspector);
  const dlg = h('dialog', { class: 'jg-dialog' },
    h('h3', {}, t('Laser-Ablauf')),
    h('div', { class: 'jg-bar' }, h('label', { class: 'jg-toggle' }, enabled, t('Eigener Ablauf')), addSel, rebuild, del, status),
    empty,
    body,
    strip,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen'))),
  ) as HTMLDialogElement;

  // ---------- Graph edits ----------
  function fromLayers() {
    const had = !!graph();
    ed.snapshot(t('Laser-Ablauf aus Layern erzeugen'));
    ed.doc.jobGraph = defaultJobGraph(jobLayers(ed));
    if (had) ed.doc.jobGraph.enabled = graph()?.enabled ?? true;
    sel = null;
    ed.emit('doc');
  }
  function addNode(v: string) {
    const g = graph();
    if (!g) return;
    const [kind, arg] = v.split(':') as [JobNodeKind, string?];
    const x = canvas.scrollLeft + 40 + Math.round(Math.random() * 40),
      y = canvas.scrollTop + 40 + Math.round(Math.random() * 40);
    const base = { id: newNodeId(kind), x, y };
    let n: JobNode;
    if (kind === 'layer') n = { ...base, kind, layer: Number(arg) };
    else if (kind === 'order') n = { ...base, kind, preset: 'shortest' };
    else if (kind === 'pause') n = { ...base, kind, message: '' };
    else if (kind === 'gcode') n = { ...base, kind, code: '' };
    else n = { ...base, kind } as JobNode;
    edit(t('Knoten hinzufügen'), (g) => g.nodes.push(n));
    sel = n.id;
    render();
  }
  function removeSelected() {
    const g = graph();
    if (!g) return;
    if (selEdge !== null) {
      const k = selEdge;
      selEdge = null;
      edit(t('Verbindung löschen'), (g) => g.edges.splice(k, 1));
      return;
    }
    if (!sel) return;
    const id = sel;
    sel = null;
    edit(t('Knoten löschen'), (g) => {
      g.nodes = g.nodes.filter((n) => n.id !== id);
      g.edges = g.edges.filter((e) => e.from !== id && e.to !== id);
    });
  }
  function connect(from: string, out: string, to: string, inn: string) {
    const g = graph();
    if (!g || from === to) return;
    const a = g.nodes.find((n) => n.id === from),
      b = g.nodes.find((n) => n.id === to);
    if (!a || !b) return;
    const ta = portType(a.kind, out, 'out');
    if (!ta || ta !== portType(b.kind, inn, 'in')) return;
    edit(t('Verbinden'), (g) => {
      g.edges = g.edges.filter((e) => !(e.to === to && e.in === inn) && !(ta === 'seq' && e.from === from && e.out === out));
      g.edges.push({ from, out, to, in: inn });
    });
  }

  // ---------- Drawing ----------
  /** Port element centres relative to the plane, by "node/dir/key" */
  const portPos = new Map<string, { x: number; y: number }>();
  let tempWire: SVGPathElement | null = null;

  const wirePath = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const k = Math.max(40, Math.abs(b.x - a.x) * 0.5, b.x < a.x ? Math.abs(b.y - a.y) * 0.6 : 0);
    return `M${a.x} ${a.y} C${a.x + k} ${a.y} ${b.x - k} ${b.y} ${b.x} ${b.y}`;
  };

  function summary(n: JobNode): string[] {
    switch (n.kind) {
      case 'start':
        return [FIRMWARES[device.fw].label];
      case 'end':
        return [t('Danach wie in den Geräteeinstellungen')];
      case 'layer': {
        const L = ed.layer(n.layer);
        return [`${Math.round(L.speed)} mm/min · ${L.power} %`, L.output ? '' : t('Ausgabe aus')].filter(Boolean);
      }
      case 'split':
        return [t('nach innen / außen')];
      case 'order':
        return [orderLabels()[n.preset]];
      case 'op': {
        const out: string[] = [];
        const o = n.over ?? {};
        const st = stepOf(n.id);
        if (st) {
          const L = ed.layer(st.layer);
          out.push(`${Math.round(o.speed ?? L.speed)} mm/min · ${o.power ?? L.power} %${(o.passes ?? L.passes) > 1 ? ` · ${o.passes ?? L.passes}×` : ''}`);
        } else out.push(t('noch ohne Objekte'));
        if (codeLines(n.before).length || codeLines(n.after).length) out.push(t('mit eigenem G-Code'));
        return out;
      }
      case 'pause':
        return [n.message || t('wartet auf Weiter')];
      case 'gcode':
        return codeLines(n.code).slice(0, 3);
      case 'frame':
        return [t('um den nächsten Schritt, Laser aus')];
    }
  }

  /** Compiled steps of the current graph, by node id (refreshed on every render) */
  let compiled = new Map<string, OpStep>();
  const stepOf = (id: string) => compiled.get(id);
  const opTitle = (id: string) => {
    const st = stepOf(id);
    if (!st) return kindLabels().op;
    const verb = ed.layer(st.layer).mode === 'line' ? t('Schneiden') : t('Gravieren');
    return `${verb} ${layerLabel(st.layer)}${st.part === 'inner' ? t(' innen') : st.part === 'outer' ? t(' außen') : ''}`;
  };

  function deviates(n: JobNode) {
    return stepDeviations({ v: 1, enabled: true, nodes: [n], edges: [] }).length > 0;
  }

  function render(withInspector = true) {
    const g = graph();
    empty.hidden = !!g;
    body.hidden = !g;
    strip.hidden = !g;
    rebuild.hidden = !g;
    del.hidden = !g;
    addSel.hidden = !g;
    enabled.parentElement!.hidden = !g;
    if (!g) {
      status.textContent = '';
      return;
    }
    enabled.checked = g.enabled;
    compiled = new Map(compileJobGraph(g).steps.filter((x): x is OpStep => x.kind === 'op').map((x) => [x.node, x]));
    if (sel && !g.nodes.some((n) => n.id === sel)) sel = null;
    if (selEdge !== null && !g.edges[selEdge]) selEdge = null;

    // add menu: kinds and one entry per layer in use
    addSel.replaceChildren(
      h('option', { value: '' }, t('＋ Knoten …')),
      ...(['op', 'pause', 'gcode', 'frame', 'split', 'order', 'start', 'end'] as JobNodeKind[]).map((k) => h('option', { value: k }, kindLabels()[k])),
      h('optgroup', { label: t('Layer') }, ...ed.usedLayers().map((i) => h('option', { value: `layer:${i}` }, layerName(i)))),
    );

    // nodes
    nodesEl.replaceChildren();
    portPos.clear();
    for (const n of g.nodes) {
      const { ins, outs } = portsOf(n.kind);
      const seqIn = ins.find((p) => p.type === 'seq'),
        seqOut = outs.find((p) => p.type === 'seq');
      const dataIns = ins.filter((p) => p.type === 'data'),
        dataOuts = outs.filter((p) => p.type === 'data');
      const swatch = n.kind === 'layer' ? h('i', { class: 'jg-swatch', style: `background:${PALETTE[n.layer] ?? '#888'}` }) : null;
      const title = n.kind === 'op' && !n.name ? opTitle(n.id) : nodeLabel(n, layerName);
      const head = h('div', { class: 'jg-head' }, swatch, h('b', {}, title), title !== kindLabels()[n.kind] ? h('small', {}, kindLabels()[n.kind]) : null);
      const el = h('div', { class: `jg-node jg-${n.kind}${n.id === sel ? ' sel' : ''}`, style: `left:${n.x}px;top:${n.y}px;width:${NODE_W}px` }, head,
        h('div', { class: 'jg-sum' }, ...summary(n).map((l) => h('div', {}, l))));
      if (deviates(n)) el.append(h('span', { class: 'jg-badge', title: t('Dieser Schritt weicht von den Layer-Einstellungen ab.') }, n.kind === 'gcode' ? t('⚠ eigener G-Code') : t('⚠ überschreibt Layer')));
      const rows = Math.max(dataIns.length, dataOuts.length);
      if (rows) {
        const ports = h('div', { class: 'jg-ports' });
        for (let r = 0; r < rows; r++) {
          const pi = dataIns[r],
            po = dataOuts[r];
          ports.append(h('div', { class: 'jg-prow' },
            pi ? portEl(n, pi, 'in') : h('span'),
            h('span', { class: 'jg-plabel' }, pi ? portLabel(pi.key) : ''),
            h('span', { class: 'jg-plabel right' }, po ? portLabel(po.key) : ''),
            po ? portEl(n, po, 'out') : h('span')));
        }
        el.append(ports);
      }
      if (seqIn) head.prepend(portEl(n, seqIn, 'in'));
      if (seqOut) head.append(portEl(n, seqOut, 'out'));
      el.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.jg-port')) return;
        startDrag(e, n);
      });
      nodesEl.append(el);
    }
    requestAnimationFrame(drawWires);
    if (withInspector) renderInspector();
    renderStatus();
  }

  function portEl(n: JobNode, p: PortDef, dir: 'in' | 'out') {
    const el = h('span', { class: `jg-port ${p.type} ${dir}`, title: p.type === 'seq' ? t('Reihenfolge') : portLabel(p.key) });
    el.dataset.key = `${n.id}/${dir}/${p.key}`;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const g = graph();
      if (!g) return;
      if (dir === 'in') {
        // click on a wired input: take the wire off it
        const k = g.edges.findIndex((x) => x.to === n.id && x.in === p.key);
        if (k >= 0) edit(t('Verbindung löschen'), (g) => g.edges.splice(k, 1));
        return;
      }
      startWire(e, n, p);
    });
    return el;
  }

  function measure() {
    portPos.clear();
    const pr = plane.getBoundingClientRect();
    nodesEl.querySelectorAll<HTMLElement>('.jg-port').forEach((el) => {
      const r = el.getBoundingClientRect();
      portPos.set(el.dataset.key!, { x: r.left + r.width / 2 - pr.left, y: r.top + r.height / 2 - pr.top });
    });
  }

  function drawWires() {
    const g = graph();
    if (!g) return;
    measure();
    svg.replaceChildren();
    g.edges.forEach((e, k) => {
      const a = portPos.get(`${e.from}/out/${e.out}`),
        b = portPos.get(`${e.to}/in/${e.in}`);
      if (!a || !b) return;
      const type = portType(g.nodes.find((n) => n.id === e.from)!.kind, e.out, 'out');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', wirePath(a, b));
      p.setAttribute('class', `jg-wire ${type}${k === selEdge ? ' sel' : ''}`);
      p.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        selEdge = k;
        sel = null;
        render();
      });
      svg.append(p);
    });
    if (tempWire) svg.append(tempWire);
  }

  const planePt = (e: PointerEvent) => {
    const pr = plane.getBoundingClientRect();
    return { x: e.clientX - pr.left, y: e.clientY - pr.top };
  };

  function startWire(e: PointerEvent, n: JobNode, p: PortDef) {
    const a = portPos.get(`${n.id}/out/${p.key}`) ?? planePt(e);
    tempWire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempWire.setAttribute('class', `jg-wire ${p.type} temp`);
    svg.append(tempWire);
    const move = (ev: PointerEvent) => tempWire!.setAttribute('d', wirePath(a, planePt(ev)));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      tempWire?.remove();
      tempWire = null;
      const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.jg-port.in');
      const key = target?.dataset.key?.split('/');
      if (key) connect(n.id, p.key, key[0], key[2]);
      else drawWires();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startDrag(e: PointerEvent, n: JobNode) {
    if (e.button !== 0) return;
    const sx = e.clientX,
      sy = e.clientY;
    const ox = n.x,
      oy = n.y;
    let moved = false;
    if (sel !== n.id || selEdge !== null) {
      sel = n.id;
      selEdge = null;
      render();
    }
    const el = nodesEl.querySelector<HTMLElement>(`.jg-node.sel`);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx,
        dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      if (!moved) ed.snapshot(t('Knoten verschieben'));
      moved = true;
      const g = graph();
      const node = g?.nodes.find((x) => x.id === n.id);
      if (!node) return;
      node.x = Math.max(0, Math.min(CANVAS.w - NODE_W, Math.round(ox + dx)));
      node.y = Math.max(0, Math.min(CANVAS.h - 60, Math.round(oy + dy)));
      if (el) (el.style.left = `${node.x}px`), (el.style.top = `${node.y}px`);
      drawWires();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) ed.emit('doc');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------- Inspector ----------
  function field(label: string, input: HTMLElement, note?: HTMLElement | null) {
    return h('div', { class: 'jg-field' }, h('label', {}, label), input, note ?? null);
  }
  function codeNote(code: string): HTMLElement | null {
    const lines = codeLines(code);
    if (!lines.length) return null;
    const bad = checkCustomGcode(lines, device.sMax);
    if (device.fw === 'ruida') return h('div', { class: 'jg-warn' }, t('Eigener G-Code entfällt bei Ruida.'));
    return bad.length ? h('div', { class: 'jg-error' }, ...bad.map((b) => h('div', {}, b))) : h('div', { class: 'jg-warn' }, t('⚠ Eigener G-Code: Er läuft so, wie er hier steht. Bitte zuerst in der Vorschau oder ohne Material prüfen.'));
  }
  /** Input that edits one node field; typing merges into one undo step per focus */
  function nodeText(n: JobNode, key: 'name' | 'message' | 'code' | 'before' | 'after', area: boolean, label: string, placeholder = '') {
    const cur = ((n as unknown as Record<string, string | undefined>)[key] ?? '') as string;
    let first = true;
    const note = h('div', {});
    const el = h(area ? 'textarea' : 'input', { placeholder, rows: area ? 4 : undefined, spellcheck: false, class: area ? 'mono' : '' }) as HTMLInputElement;
    el.value = cur;
    el.addEventListener('focus', () => (first = true));
    el.addEventListener('input', () => {
      edit(t('Knoten bearbeiten'), (g) => {
        const node = g.nodes.find((x) => x.id === n.id) as unknown as Record<string, string | undefined>;
        if (!node) return;
        if (el.value) node[key] = el.value;
        else delete node[key];
      }, !first);
      first = false;
      if (key === 'code' || key === 'before' || key === 'after') note.replaceChildren(codeNote(el.value) ?? '');
    });
    if (key === 'code' || key === 'before' || key === 'after') note.replaceChildren(codeNote(cur) ?? '');
    return field(label, el, note);
  }

  function renderInspector() {
    const g = graph();
    inspector.replaceChildren();
    if (!g) return;
    const n = g.nodes.find((x) => x.id === sel);
    if (!n) {
      inspector.append(
        h('h4', {}, t('So geht’s')),
        h('p', { class: 'muted' }, t('Die obere Kette (◆) legt die Reihenfolge fest: vom Start bis zum Ende. Die Verbindungen mit ● sagen, was ein Schritt bearbeitet.')),
        h('p', { class: 'muted' }, t('Ziehe von einem Ausgang (rechts) auf einen Eingang (links), um zu verbinden. Ein Klick auf einen belegten Eingang löst die Verbindung.')),
        h('p', { class: 'muted' }, t('Leistung und Geschwindigkeit kommen vom Layer. Ein Schritt darf sie überschreiben; das wird immer angezeigt.')),
      );
      return;
    }
    inspector.append(h('h4', {}, kindLabels()[n.kind]));
    if (n.kind !== 'start' && n.kind !== 'end') inspector.append(nodeText(n, 'name', false, t('Name'), n.kind === 'op' ? opTitle(n.id) : nodeLabel({ ...n, name: undefined }, layerName)));
    if (n.kind === 'layer') {
      const s = h('select', {
        onchange: () => edit(t('Knoten bearbeiten'), (g) => {
          const node = g.nodes.find((x) => x.id === n.id);
          if (node?.kind === 'layer') node.layer = Number(s.value);
        }),
      }, ...[...new Set([...ed.usedLayers(), n.layer])].map((i) => h('option', { value: String(i), selected: i === n.layer }, layerName(i)))) as HTMLSelectElement;
      inspector.append(field(t('Layer'), s));
    } else if (n.kind === 'order') {
      const s = h('select', {
        onchange: () => edit(t('Knoten bearbeiten'), (g) => {
          const node = g.nodes.find((x) => x.id === n.id);
          if (node?.kind === 'order') node.preset = s.value as OrderPreset;
        }),
      }, ...ORDER_PRESETS.map((p) => h('option', { value: p, selected: p === n.preset }, orderLabels()[p]))) as HTMLSelectElement;
      inspector.append(field(t('Reihenfolge'), s), h('p', { class: 'muted' }, t('Gilt für die Objekte, die durch diesen Knoten laufen.')));
    } else if (n.kind === 'split') {
      inspector.append(h('p', { class: 'muted' }, t('Innen sind Konturen, die ganz in einer anderen Kontur desselben Layers liegen (Löcher). Bilder und offene Linien zählen zu außen.')));
    } else if (n.kind === 'pause') {
      inspector.append(nodeText(n, 'message', false, t('Meldung'), t('z. B. Material wenden')));
      inspector.append(h('p', { class: pauseSupported(device.fw) ? 'muted' : 'jg-warn' },
        pauseSupported(device.fw)
          ? t('Der Laser geht aus und die Maschine hält an (M0). Weiter geht es mit „Fortsetzen“ im Laser-Fenster.')
          : t('Pausen gehen mit {fw} nicht und werden übersprungen.', { fw: FIRMWARES[device.fw].label })));
    } else if (n.kind === 'gcode') {
      inspector.append(nodeText(n, 'code', true, t('G-Code'), 'G4 P5 ; abkühlen'));
      inspector.append(h('p', { class: 'muted' }, t('Nicht erlaubt: Referenzfahrt, Systembefehle ($), Einheiten- und Koordinatenwechsel, Programmende, Leistung über dem Gerätehöchstwert.')));
    } else if (n.kind === 'frame') {
      inspector.append(h('p', { class: 'muted' }, t('Fährt mit ausgeschaltetem Laser um den Bereich des nächsten Bearbeiten-Schritts und zurück. Mit einer Pause danach kannst du die Lage prüfen.')));
    } else if (n.kind === 'op') inspector.append(...opInspector(g, n));
    inspector.append(h('div', { class: 'jg-ibuttons' }, h('button', { class: 'btn', onclick: () => removeSelected() }, t('Knoten löschen'))));
  }

  function opInspector(g: JobGraph, n: Extract<JobNode, { kind: 'op' }>): HTMLElement[] {
    const out: HTMLElement[] = [];
    const step = compileJobGraph(g).steps.find((s) => s.node === n.id);
    if (!step || step.kind !== 'op') {
      out.push(h('p', { class: 'jg-warn' }, t('Dieser Schritt hat noch keine Objekte oder liegt nicht in der Kette vom Start aus. Verbinde einen Layer mit dem Eingang „Objekte“.')));
    }
    const L = step?.kind === 'op' ? ed.layer(step.layer) : null;
    if (L && step?.kind === 'op') {
      const partText = step.part === 'all' ? '' : step.part === 'inner' ? t(' · nur innen') : t(' · nur außen');
      out.push(h('div', { class: 'jg-src' },
        h('i', { class: 'jg-swatch', style: `background:${PALETTE[step.layer] ?? '#888'}` }),
        h('b', {}, layerName(step.layer) + partText),
        h('span', { class: 'muted' }, step.order ? orderLabels()[step.order] : '')));
    }
    out.push(h('h5', {}, t('Werte vom Layer')));
    const over = n.over ?? {};
    const rows: [keyof StepOverride, string, number | undefined, string][] = [
      ['power', t('Leistung'), L?.power, '%'],
      ['speed', t('Geschwindigkeit'), L?.speed, 'mm/min'],
      ['passes', t('Durchgänge'), L?.passes, ''],
    ];
    for (const [key, label, layerVal, unit] of rows) {
      const on = over[key] !== undefined;
      const inp = h('input', { type: 'number', value: String(on ? over[key] : layerVal ?? ''), disabled: !on, step: key === 'passes' ? 1 : 'any', min: key === 'power' ? 0 : 1, max: key === 'power' ? 100 : undefined }) as HTMLInputElement;
      let first = true;
      inp.addEventListener('focus', () => (first = true));
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        if (!isFinite(v) || inp.value === '') return;
        edit(t('Wert überschreiben'), (g) => {
          const node = g.nodes.find((x) => x.id === n.id);
          if (node?.kind === 'op') node.over = { ...node.over, [key]: key === 'passes' ? Math.max(1, Math.round(v)) : key === 'power' ? Math.min(100, Math.max(0, v)) : Math.max(1, v) };
        }, !first);
        first = false;
        renderStatus();
      });
      const cb = h('input', {
        type: 'checkbox',
        checked: on,
        title: t('Für diesen Schritt überschreiben'),
        onchange: () =>
          edit(cb.checked ? t('Wert überschreiben') : t('Layer-Wert wiederherstellen'), (g) => {
            const node = g.nodes.find((x) => x.id === n.id);
            if (node?.kind !== 'op') return;
            const o = { ...node.over };
            if (cb.checked) o[key] = layerVal ?? (key === 'passes' ? 1 : 0);
            else delete o[key];
            if (Object.keys(o).length) node.over = o;
            else delete node.over;
          }),
      }) as HTMLInputElement;
      out.push(h('div', { class: `jg-orow${on ? ' over' : ''}` }, cb, h('span', {}, label), inp, h('span', { class: 'muted' }, unit),
        on && layerVal !== undefined ? h('s', { class: 'muted', title: t('Wert des Layers') }, String(layerVal)) : h('span')));
    }
    if (Object.keys(over).length)
      out.push(h('div', { class: 'jg-warn' }, t('⚠ Dieser Schritt überschreibt Layer-Einstellungen. Der Layer selbst bleibt unverändert; Sub-Layer behalten ihre Werte.')));
    out.push(h('h5', {}, t('Eigener G-Code')));
    out.push(nodeText(n, 'before', true, t('Vor dem Schritt'), 'M7'));
    out.push(nodeText(n, 'after', true, t('Nach dem Schritt'), 'G4 P5'));
    const time = times.get(n.id);
    if (time !== undefined) out.push(h('p', { class: 'muted' }, t('Zeit (geschätzt): {t}', { t: formatDuration(time) })));
    return out;
  }

  // ---------- Status and steps ----------
  function renderStatus() {
    const g = graph();
    if (!g) return;
    const cg = compileJobGraph(g);
    const dev = stepDeviations(g).length;
    status.className = `jg-status${cg.errors.length ? ' error' : cg.warnings.length || dev ? ' warn' : ''}`;
    status.textContent = cg.errors.length
      ? cg.errors.join(' ')
      : [!g.enabled ? t('Ausgeschaltet: Der Job läuft nach der Layer-Reihenfolge.') : '', ...cg.warnings,
          dev ? tn('⚠ {n} Schritt weicht von den Layer-Einstellungen ab.', '⚠ {n} Schritte weichen von den Layer-Einstellungen ab.', dev) : '']
          .filter(Boolean).join(' ') || t('✓ Ablauf vollständig.');
    // the step strip
    strip.replaceChildren(h('h5', {}, t('So fährt der Laser')));
    const row = h('div', { class: 'jg-strow' });
    let k = 0;
    for (const st of cg.steps) {
      const n = g.nodes.find((x) => x.id === st.node)!;
      const time = times.get(st.node);
      const sub = st.kind === 'op' ? `${layerName(st.layer)}${st.part === 'all' ? '' : st.part === 'inner' ? t(' · innen') : t(' · außen')}` : summary(n)[0] ?? '';
      row.append(h('div', { class: `jg-st jg-${st.kind}${st.node === sel ? ' sel' : ''}${deviates(n) ? ' dev' : ''}`, onclick: () => ((sel = st.node), (selEdge = null), render()) },
        h('span', { class: 'jg-stn' }, String(++k)),
        h('b', {}, n.kind === 'op' && !n.name ? opTitle(n.id) : nodeLabel(n, layerName)),
        h('div', { class: 'muted' }, sub),
        h('div', { class: 'muted' }, time !== undefined ? formatDuration(time) : ' ')));
    }
    strip.append(row);
    const warn = jobWarnings.filter((w) => w.startsWith(t('Laser-Ablauf')));
    strip.append(h('div', { class: 'jg-total' },
      h('span', { class: warn.length ? 'jg-warn' : 'muted' }, warn.join(' ')),
      h('span', {}, total ? t('Gesamt {t}', { t: formatDuration(total) }) : ''),
      h('button', { class: 'btn', onclick: () => void refreshTimes() }, t('Zeiten berechnen'))));
  }

  async function refreshTimes() {
    const g = graph();
    if (!g) return;
    try {
      // times as the graph would run, even while it is switched off
      const was = g.enabled;
      g.enabled = true;
      let job;
      try {
        job = await makeJob(ed, false);
      } finally {
        g.enabled = was;
      }
      const est = estimate(job.moves, device);
      times = new Map();
      for (const s of job.steps ?? []) {
        const t0 = s.from ? est.t[s.from - 1] : 0,
          t1 = s.to ? est.t[s.to - 1] : 0;
        times.set(s.node, (times.get(s.node) ?? 0) + Math.max(0, t1 - t0));
      }
      total = est.total;
      jobWarnings = job.warnings;
    } catch (e) {
      times = new Map();
      total = 0;
      jobWarnings = [(e as Error).message];
    }
    renderStatus();
    renderInspector();
  }

  // ---------- Events ----------
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas && e.target !== plane && e.target !== svg && e.target !== nodesEl) return;
    if (sel || selEdge !== null) {
      sel = null;
      selEdge = null;
      render();
    }
  });
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const tag = (e.target as HTMLElement).tagName;
    if ((e.key === 'Delete' || e.key === 'Backspace') && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      e.preventDefault();
      removeSelected();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      e.preventDefault();
      if (e.shiftKey) ed.doRedo();
      else ed.doUndo();
    }
  });
  let timer = 0;
  const onDoc = (what: 'doc' | 'sel' | 'view' | 'tool') => {
    if (what !== 'doc' || !dlg.isConnected) return;
    // keep focus while typing in the inspector: only redraw the canvas and status then
    render(!inspector.contains(document.activeElement));
    clearTimeout(timer);
    timer = window.setTimeout(() => void refreshTimes(), 600);
  };
  ed.on(onDoc);
  dlg.addEventListener('close', () => {
    clearTimeout(timer);
    ed.off(onDoc);
    open = null;
    dlg.remove();
  });
  document.body.append(dlg);
  open = dlg;
  render();
  dlg.showModal();
  void refreshTimes();
}
