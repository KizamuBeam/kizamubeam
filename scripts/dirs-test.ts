// Tests für Startverzeichnis-Auflösung (Öffnen/Speichern-Dialoge).
// Aufruf: npm run test:dirs
import { strict as assert } from 'node:assert';
import { dirOf, resolveStartDir } from '../src/fileDirs';

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

test('dirOf: POSIX, Windows, ohne Ordner', () => {
  assert.equal(dirOf('/home/sven/a.kzb'), '/home/sven');
  assert.equal(dirOf('C:\\Users\\sven\\a.kzb'), 'C:\\Users\\sven');
  assert.equal(dirOf('C:/Users/sven/a.kzb'), 'C:/Users/sven');
  assert.equal(dirOf('a.kzb'), '');
  assert.equal(dirOf(''), '');
  assert.equal(dirOf('/a.kzb'), '/');
  assert.equal(dirOf('C:\\a.kzb'), 'C:\\');
  assert.equal(dirOf('C:/a.kzb'), 'C:/');
  assert.equal(dirOf('\\\\server\\share\\a.kzb'), '\\\\server\\share');
});

test('resolveStartDir: Sitzung vor Default, Opt-in immer Default', () => {
  assert.equal(resolveStartDir(false, '/def', '/sess'), '/sess');
  assert.equal(resolveStartDir(false, '/def', null), '/def');
  assert.equal(resolveStartDir(false, '', null), null);
  assert.equal(resolveStartDir(false, '  ', '/sess'), '/sess');
  assert.equal(resolveStartDir(false, '  ', null), null);
  assert.equal(resolveStartDir(true, '/def', '/sess'), '/def');
  assert.equal(resolveStartDir(true, '/def', null), '/def');
  assert.equal(resolveStartDir(true, '', '/sess'), null);
  assert.equal(resolveStartDir(true, '', null), null);
  assert.equal(resolveStartDir(true, '  ', '/sess'), null);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
