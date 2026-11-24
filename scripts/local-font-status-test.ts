// Tests für localFontStatus (src/fonts.ts): Browser-Stand des lokalen Schriftzugriffs,
// ohne Rückfrage auszulösen. Aufruf: node scripts/run-ts.mjs scripts/local-font-status-test.ts
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const { localFontStatus } = await import('../src/fonts');

const g = globalThis as Record<string, unknown>;
// core-fixtures-env setzt window := globalThis; Node 22 hat navigator als Getter-only —
// deshalb pro Test defineProperty-Stubs (konfigurierbar) statt Objekt-Tausch.
const navProto = Object.getPrototypeOf(navigator) as object;
const origPerms = Object.getOwnPropertyDescriptor(navigator, 'permissions')
  ?? Object.getOwnPropertyDescriptor(navProto, 'permissions');
function stub(part: { fonts?: unknown; tauri?: boolean; permState?: string; permThrows?: boolean }) {
  if (part.fonts === undefined) delete g.queryLocalFonts;
  else Object.defineProperty(g, 'queryLocalFonts', { value: part.fonts, configurable: true, writable: true });
  if (part.tauri) Object.defineProperty(g, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  else delete g.__TAURI_INTERNALS__;
  const perms = part.permThrows
    ? { query: async () => { throw new Error('no api'); } }
    : { query: async () => ({ state: part.permState ?? 'prompt' }) };
  Object.defineProperty(navigator, 'permissions', { value: perms, configurable: true });
}
function restore() {
  delete g.queryLocalFonts;
  delete g.__TAURI_INTERNALS__;
  if (origPerms) Object.defineProperty(navigator, 'permissions', origPerms);
}
const noFonts = async (): Promise<never[]> => [];

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  } finally {
    restore();
  }
}

// Tauri meldet immer granted (Desktop kennt keine Browser-Rückfrage).
await test('Tauri → granted', async () => {
  stub({ tauri: true });
  assert.equal(await localFontStatus(), 'granted');
});

// Browser ohne API (Firefox/Safari) → unsupported.
await test('ohne queryLocalFonts → unsupported', async () => {
  stub({ permState: 'granted' });
  assert.equal(await localFontStatus(), 'unsupported');
});

await test('granted → granted', async () => {
  stub({ fonts: noFonts, permState: 'granted' });
  assert.equal(await localFontStatus(), 'granted');
});

await test('denied → denied', async () => {
  stub({ fonts: noFonts, permState: 'denied' });
  assert.equal(await localFontStatus(), 'denied');
});

// Noch nie gefragt (prompt) → prompt; die Rückfrage kommt erst bei requestLocalFonts.
await test('prompt → prompt', async () => {
  stub({ fonts: noFonts, permState: 'prompt' });
  assert.equal(await localFontStatus(), 'prompt');
});

// Kaputte Permissions-API (wirft) → prompt statt Absturz.
await test('Permissions-Fehler → prompt', async () => {
  stub({ fonts: noFonts, permThrows: true });
  assert.equal(await localFontStatus(), 'prompt');
});

if (failed) {
  console.log(`${failed} Test(s) FEHLGESCHLAGEN`);
  process.exit(1);
} else {
  console.log('Alle localFontStatus-Tests bestanden');
}
