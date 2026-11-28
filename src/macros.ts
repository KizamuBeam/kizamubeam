// Custom macro buttons per device (issue #506): named G-code sequences that run with one click
// from the Move tab or the console. Pure helpers (parsing, placeholders, laser check, runner)
// stay free of DOM and machine imports so scripts/macros-test.ts can cover them.
import { t } from './i18n';
import type { Device, Firmware } from './gcode';

export interface Macro {
  id: string;
  name: string;
  /** G-code, one command per line; `;` and `( … )` comments and blank lines are ignored */
  gcode: string;
  /** Optional hint shown in the tooltip above the G-code */
  tip?: string;
}

/** Placeholder names: letters, digits and underscore, starting with a letter, e.g. {probeMax} */
const VAR_RE = /\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g;
export const VAR_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
export const MAX_MACROS = 24;
export const MAX_MACRO_LINES = 200;

export const newMacroId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Remove comments and surrounding blanks; empty result = nothing to send */
export function stripComment(line: string): string {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
}

/** Placeholders used in a macro, in order of first appearance */
export function macroVarNames(gcode: string): string[] {
  const out: string[] = [];
  for (const m of gcode.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Variables a macro can use: the device's own values plus a few derived from device settings */
export function macroVars(d: Pick<Device, 'macroVars' | 'zMaterial'>): Record<string, number> {
  const vars: Record<string, number> = {};
  if (d.zMaterial !== undefined && d.zMaterial > 0) vars.materialThickness = d.zMaterial;
  for (const [k, v] of Object.entries(d.macroVars ?? {})) if (VAR_NAME_RE.test(k) && Number.isFinite(v)) vars[k] = v;
  return vars;
}

const fmt = (v: number) => String(Math.round(v * 10000) / 10000);

export interface ExpandedMacro {
  lines: string[];
  /** Placeholders without a value; the macro must not run while this is non-empty */
  missing: string[];
}

/** Fill placeholders and drop comments and blank lines */
export function expandMacro(gcode: string, vars: Record<string, number>): ExpandedMacro {
  const missing: string[] = [];
  const lines: string[] = [];
  for (const raw of gcode.split(/\r?\n/)) {
    const line = stripComment(raw).replace(VAR_RE, (all, name: string) => {
      if (name in vars) return fmt(vars[name]);
      if (!missing.includes(name)) missing.push(name);
      return all;
    });
    if (line) lines.push(line);
  }
  return { lines, missing };
}

/**
 * Lines that switch the laser on: M3/M4 with S > 0, or M3/M4 without S (the modal S value may be
 * anything). `M3 S0` / `M4 S0` (laser mode armed but dark) is not counted.
 */
export function laserOnLines(lines: string[]): string[] {
  return lines.filter((l) => {
    const u = l.toUpperCase();
    if (!/(^|[^A-Z0-9.])M0*[34](?![0-9])/.test(u)) return false;
    const s = /S\s*(-?[\d.]+)/.exec(u);
    return !s || Number(s[1]) > 0;
  });
}

/** Distance mode after the macro: true when it leaves the controller in relative mode (G91) */
export function endsRelative(lines: string[]): boolean {
  let rel = false;
  for (const l of lines) {
    // $J= jog lines carry their own mode and do not change the modal state
    if (l.startsWith('$')) continue;
    for (const m of l.toUpperCase().matchAll(/G\s*0*(90|91)(?![0-9.])/g)) rel = m[1] === '91';
  }
  return rel;
}

/** Tooltip: optional hint, then the G-code exactly as stored */
export function macroTitle(m: Macro): string {
  return [m.tip?.trim(), m.gcode.trim()].filter(Boolean).join('\n\n');
}

/** Clean macros from storage or a sync: drops broken entries, keeps the order */
export function normalizeMacros(raw: unknown): Macro[] {
  if (!Array.isArray(raw)) return [];
  const out: Macro[] = [];
  const ids = new Set<string>();
  for (const r of raw.slice(0, MAX_MACROS)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.gcode !== 'string') continue;
    let id = typeof o.id === 'string' && o.id ? o.id : newMacroId();
    while (ids.has(id)) id = newMacroId();
    ids.add(id);
    const m: Macro = { id, name: typeof o.name === 'string' ? o.name.slice(0, 60) : '', gcode: o.gcode };
    if (typeof o.tip === 'string' && o.tip.trim()) m.tip = o.tip.slice(0, 300);
    out.push(m);
  }
  return out;
}

export function normalizeMacroVars(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (VAR_NAME_RE.test(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

/** Variables as editable text, one `name = value` per line */
export function varsToText(vars: Record<string, number>): string {
  return Object.entries(vars).map(([k, v]) => `${k} = ${fmt(v)}`).join('\n');
}

/** Parse `name = value` lines; returns the variables and the lines that could not be read */
export function varsFromText(text: string): { vars: Record<string, number>; bad: string[] } {
  const vars: Record<string, number> = {};
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z][A-Za-z0-9_]{0,31})\s*[=:]\s*(-?\d+(?:[.,]\d+)?)$/.exec(line);
    if (m) vars[m[1]] = Number(m[2].replace(',', '.'));
    else bad.push(raw.trim());
  }
  return { vars, bad };
}

// ---------- Examples per firmware profile ----------

export interface MacroPreset {
  key: string;
  name: string;
  tip: string;
  gcode: string;
  /** Default values for placeholders the example uses (added only when the device has none yet) */
  vars?: Record<string, number>;
}

const PROBE_VARS = { probeMax: 40, probeFeed: 150, focusLift: 7 };

/** Examples to add with one click. Air assist uses the device's own air command. */
export function macroPresets(fw: Firmware, airCmd: Device['airCmd']): MacroPreset[] {
  if (fw === 'ruida') return [];
  const air: MacroPreset[] = [
    { key: 'air-on', name: t('Air Assist an'), tip: t('Schaltet Air Assist ein.'), gcode: airCmd },
    { key: 'air-off', name: t('Air Assist aus'), tip: t('Schaltet Air Assist aus.'), gcode: 'M9' },
  ];
  const focus: MacroPreset = {
    key: 'focus', name: t('Z auf Fokushöhe'), tip: t('Fährt Z auf die Fokushöhe über dem Werkstück-Nullpunkt (z. B. nach „Z antasten“).'),
    gcode: 'G90\nG0 Z{focusLift}', vars: { focusLift: PROBE_VARS.focusLift },
  };
  if (fw === 'fluidnc' || fw === 'grbl' || fw === 'grblhal') {
    return [
      {
        key: 'probe-z', name: t('Z antasten'),
        tip: t('Fährt Z bis zum Taster nach unten, setzt dort Werkstück-Z = 0 und hebt auf Fokushöhe an. Braucht einen Z-Taster.'),
        gcode: [
          'G91                         ; relative mode',
          'G38.2 Z-{probeMax} F{probeFeed}  ; probe down until the pin triggers',
          'G10 L20 P1 Z0               ; trigger point = work Z 0 (G54)',
          'G0 Z{focusLift}             ; lift to focus distance',
          'G90                         ; back to absolute mode',
        ].join('\n'),
        vars: PROBE_VARS,
      },
      focus,
      ...air,
    ];
  }
  if (fw === 'marlin') return [focus, ...air, { key: 'pos', name: t('Position melden'), tip: t('Fragt die aktuelle Position ab (M114).'), gcode: 'M114' }];
  // Smoothieware and xTool: no probing cycle assumed
  return fw === 'xtool' ? air : [focus, ...air];
}

// ---------- Runner ----------

export interface MacroIo {
  /** Send one line (resolves when it was handed to the controller connection) */
  send(line: string): Promise<void>;
  /** Subscribe to controller replies and state; returns the unsubscribe function */
  listen(fn: (e: { line?: string; alarm?: boolean; lost?: boolean }) => void): () => void;
}

export type MacroResult =
  | { ok: true; sent: number }
  | { ok: false; sent: number; line: string; reason: 'error' | 'alarm' | 'timeout' | 'lost' | 'stopped'; reply?: string };

/** Probing and dwell commands can take long: they answer only after the motion ends */
const longLine = (l: string) => /G\s*38|G\s*0*4(?![0-9])|\$H/i.test(l);

/**
 * Send macro lines one at a time and wait for each `ok`. Stops at the first `error`, alarm, lost
 * connection or timeout and does not send the remaining lines. When the macro leaves the
 * controller in relative mode (or stops after G91), `G90` is sent afterwards, because jobs and
 * moves assume absolute mode.
 */
export async function runMacroLines(lines: string[], io: MacroIo, opts: { timeoutMs?: number; longTimeoutMs?: number; stopped?: () => boolean } = {}): Promise<MacroResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const longMs = opts.longTimeoutMs ?? 180_000;
  let result: MacroResult = { ok: true, sent: 0 };
  let sent = 0;
  for (const line of lines) {
    if (opts.stopped?.()) { result = { ok: false, sent, line, reason: 'stopped' }; break; }
    const reply = await new Promise<{ kind: 'ok' | 'error' | 'alarm' | 'timeout' | 'lost'; text?: string }>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (kind: 'ok' | 'error' | 'alarm' | 'timeout' | 'lost', text?: string) => {
        if (timer !== undefined) clearTimeout(timer);
        off();
        resolve({ kind, text });
      };
      const off = io.listen((e) => {
        if (e.lost) return finish('lost');
        if (e.alarm) return finish('alarm');
        const l = e.line?.trim();
        if (!l) return;
        if (/^ok\b/i.test(l)) finish('ok');
        else if (/^error/i.test(l)) finish('error', l);
        else if (/^alarm/i.test(l)) finish('alarm', l);
      });
      timer = setTimeout(() => finish('timeout'), longLine(line) ? longMs : timeoutMs);
      io.send(line).catch(() => finish('lost'));
    });
    if (reply.kind !== 'ok') {
      result = { ok: false, sent, line, reason: reply.kind, reply: reply.text };
      break;
    }
    sent++;
  }
  result.sent = sent;
  const done = result.ok ? lines : lines.slice(0, sent + 1);
  if (endsRelative(done) && !(!result.ok && result.reason === 'lost')) await io.send('G90').catch(() => {});
  return result;
}

/** Message for a failed run */
export function macroFailText(name: string, r: Extract<MacroResult, { ok: false }>): string {
  const base = { name, line: r.line };
  switch (r.reason) {
    case 'alarm': return t('Makro „{name}“ abgebrochen: Alarm bei „{line}“. Restliche Zeilen nicht gesendet. Alarm prüfen, dann entsperren oder Referenzfahrt.', base);
    case 'error': return t('Makro „{name}“ abgebrochen: Steuerung meldet {reply} bei „{line}“. Restliche Zeilen nicht gesendet.', { ...base, reply: r.reply ?? 'error' });
    case 'timeout': return t('Makro „{name}“ abgebrochen: keine Antwort auf „{line}“. Restliche Zeilen nicht gesendet.', base);
    case 'lost': return t('Makro „{name}“ abgebrochen: Verbindung getrennt.', base);
    default: return t('Makro „{name}“ gestoppt.', base);
  }
}
