import './core-fixtures-env';
import assert from 'node:assert/strict';
import { recognize, SHAPER_MIN_CONFIDENCE } from '../src/shaper';
import type { Pt } from '../src/model';

let count = 0;
function test(name: string, f: () => void) { f(); count++; console.log(`PASS ${name}`); }

// Deterministisches Wackeln (kein Math.random): Sinus-Mix wie Pencil-Tests
const jit = (i: number, a: number) => Math.sin(i * 12.9898) * 0.5 * a + Math.sin(i * 3.7) * 0.5 * a;

function stroke(n: number, f: (t: number) => Pt, wobble = 0.4): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = f(i / (n - 1));
    out.push({ x: p.x + jit(i, wobble), y: p.y + jit(i + 50, wobble) });
  }
  return out;
}

test('gerade Linie wird erkannt', () => {
  const m = recognize(stroke(40, (t) => ({ x: t * 100, y: t * 5 })));
  assert.ok(m && m.kind === 'line', `erwartet line, bekommen ${m?.kind ?? 'null'}`);
  assert.ok(m.confidence >= SHAPER_MIN_CONFIDENCE);
  if (m.kind === 'line') assert.ok(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) > 90);
});

test('Rechteck wird erkannt', () => {
  const per = (t: number): Pt => {
    const p = t * 4, s = 100, h = 60;
    if (p < 1) return { x: p * s, y: 0 };
    if (p < 2) return { x: s, y: (p - 1) * h };
    if (p < 3) return { x: s - (p - 2) * s, y: h };
    return { x: 0, y: h - (p - 3) * h };
  };
  const m = recognize(stroke(120, per));
  assert.ok(m && (m.kind === 'rect' || m.kind === 'roundrect'), `erwartet rect/roundrect, bekommen ${m?.kind ?? 'null'}`);
  assert.ok(m!.confidence >= SHAPER_MIN_CONFIDENCE);
});

test('Kreis wird Ellipse mit rx≈ry', () => {
  const m = recognize(stroke(100, (t) => ({ x: 50 + Math.cos(t * Math.PI * 2) * 50, y: 50 + Math.sin(t * Math.PI * 2) * 50 })));
  assert.ok(m && m.kind === 'ellipse', `erwartet ellipse, bekommen ${m?.kind ?? 'null'}`);
  if (m.kind === 'ellipse') {
    assert.ok(Math.abs(m.rx - m.ry) / Math.max(m.rx, m.ry) < 0.25, `rx=${m.rx} ry=${m.ry}`);
    assert.ok(Math.abs(m.rx - 50) < 8, `rx=${m.rx}`);
  }
});

test('Ellipse wird erkannt', () => {
  const m = recognize(stroke(100, (t) => ({ x: 60 + Math.cos(t * Math.PI * 2) * 60, y: 40 + Math.sin(t * Math.PI * 2) * 30 })));
  assert.ok(m && m.kind === 'ellipse', `erwartet ellipse, bekommen ${m?.kind ?? 'null'}`);
  if (m.kind === 'ellipse') assert.ok(m.rx > m.ry * 1.4, `rx=${m.rx} ry=${m.ry}`);
});

test('Dreieck wird Polygon mit 3 Seiten', () => {
  const v = [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 40, y: 90 }];
  const per = (t: number): Pt => {
    const p = t * 3, i = Math.min(2, Math.floor(p)), f = p - i;
    const a = v[i], b = v[(i + 1) % 3];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const m = recognize(stroke(90, per));
  assert.ok(m && m.kind === 'polygon', `erwartet polygon, bekommen ${m?.kind ?? 'null'}`);
  if (m.kind === 'polygon') assert.equal(m.sides, 3);
});

test('Kritzel ohne Form bleibt Freihand (null)', () => {
  // Deterministischer Random-Walk: keine Grundform
  let x = 0, y = 0;
  const pts: Pt[] = [];
  for (let i = 0; i < 120; i++) {
    x += Math.sin(i * 7.3) * 9 + Math.sin(i * 1.7) * 4;
    y += Math.cos(i * 5.1) * 9 + Math.cos(i * 2.3) * 4;
    pts.push({ x, y });
  }
  const m = recognize(pts);
  assert.ok(!m || m.confidence < SHAPER_MIN_CONFIDENCE, `erwartet null, bekommen ${m?.kind} @ ${m?.confidence}`);
});

test('Tap und offener Bogen werden keine Ellipse', () => {
  assert.equal(recognize([{ x: 10, y: 10 }, { x: 10, y: 10 }]), null);
  const arc = stroke(60, (t) => ({ x: 50 + Math.cos(t * Math.PI) * 50, y: 50 - Math.sin(t * Math.PI) * 50 }));
  const m = recognize(arc);
  assert.ok(!m || m.kind !== 'ellipse', `offener Bogen darf keine Ellipse sein, bekommen ${m?.kind}`);
});

console.log(`Shaper-Erkennung: ${count} Tests, Schwelle ${SHAPER_MIN_CONFIDENCE}.`);
