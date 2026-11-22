// Isolated menu lifecycle/keyboard fixture. Does not import or start the application.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, process.argv[2] ?? 'artifacts/local-prototypes/browser');
const entry = `
import { showEditorMenu, closeEditorMenu } from './src/contextMenu';
window.runContextMenuChecks = () => {
  const errors = [], check = (ok, name) => { if (!ok) errors.push(name); };
  let ran = 0, closed = 0, escaped = 0;
  const anchor = document.getElementById('anchor'); anchor.focus();
  const bubble = () => escaped++;
  document.addEventListener('keydown', bubble);
  const groups = [[{id:'copy',label:'Copy',run:()=>ran++}, {id:'delete',label:'Delete (disabled)',enabled:false,run:()=>ran+=100}],
    [{id:'tools',label:'Tools',run(){},items:[{id:'paste',label:'Paste',run:()=>ran++}]}]];
  showEditorMenu(innerWidth-2,innerHeight-2,groups,()=>closed++);
  let menu = document.querySelector('.editor-context-menu');
  check(!!menu, 'menu opens');
  const rect = menu.getBoundingClientRect();
  check(rect.left>=0 && rect.top>=0 && rect.right<=innerWidth+1 && rect.bottom<=innerHeight+1,'viewport bounds');
  check(document.activeElement.textContent.includes('Copy'),'first enabled item focused');
  check(menu.querySelector('kbd').textContent==='Ctrl+C','shared shortcut display');
  menu.querySelector('button:disabled').click(); check(ran===0,'disabled action blocked');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));
  check(escaped===0 && ran===0,'Delete captured instead of reaching editor');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  check(document.activeElement.textContent.includes('Tools'),'arrows skip disabled items');
  document.activeElement.click();
  check(!menu.querySelector('.editor-context-submenu').hidden,'submenu opens');
  check(document.activeElement.textContent.includes('Paste'),'submenu focus');
  const subBox = menu.querySelector('.editor-context-submenu');
  const subCss = getComputedStyle(subBox);
  check(subCss.position === 'fixed','flyout is viewport-anchored, not inline');
  const parentBtn = [...menu.querySelectorAll(':scope > .editor-context-subitem > button')].find(b => b.getAttribute('aria-haspopup') === 'true');
  const wr = parentBtn.getBoundingClientRect(), br = subBox.getBoundingClientRect();
  check(br.left >= wr.right - 2 || br.right <= wr.left + 2,'flyout opens to the side');
  check(menu.scrollWidth <= menu.clientWidth + 1,'no horizontal scrollbar while flyout is open');
  check(br.left >= 0 && br.right <= innerWidth + 1 && br.top >= 0 && br.bottom <= innerHeight + 1,'flyout stays inside viewport');
  menu.dispatchEvent(new Event('scroll'));
  check(subBox.hidden && menu.isConnected,'menu scroll parks the flyout, menu stays open');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check(!!document.querySelector('.editor-context-menu') && subBox.hidden,'first Escape backs out of flyout');
  check(document.activeElement === parentBtn,'focus returns to parent entry');
  parentBtn.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
  check(!subBox.hidden,'hover reopens flyout');
  subBox.querySelector('button:not(:disabled)').focus();
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check(subBox.hidden && document.activeElement === parentBtn,'Escape backs out again');
  parentBtn.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  check(!subBox.hidden && document.activeElement.textContent.includes('Paste'),'ArrowRight opens flyout');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
  check(subBox.hidden && document.activeElement === parentBtn,'ArrowLeft returns to parent entry');
  parentBtn.focus(); parentBtn.click();
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check(!document.querySelector('.editor-context-menu') && closed===1,'second Escape closes');
  check(document.activeElement===anchor,'focus restored');
  anchor.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
  check(escaped===1,'capture listener removed');
  showEditorMenu(20,20,groups,()=>closed++);
  document.querySelector('.editor-context-menu button').click();
  check(ran===1 && closed===2,'action closes once and runs once');
  showEditorMenu(20,20,groups,()=>closed++);
  showEditorMenu(30,30,groups,()=>closed++);
  check(document.querySelectorAll('.editor-context-menu').length===1,'single menu instance');
  document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  check(!document.querySelector('.editor-context-menu'),'outside click closes');
  showEditorMenu(20,20,groups);
  menu = document.querySelector('.editor-context-menu');
  menu.dispatchEvent(new Event('scroll'));
  check(menu.isConnected,'scrolling menu root keeps menu open');
  menu.querySelector('.editor-context-submenu').dispatchEvent(new Event('scroll'));
  check(menu.isConnected,'scrolling nested menu keeps menu open');
  document.getElementById('anchor').dispatchEvent(new Event('scroll'));
  check(!menu.isConnected,'scrolling external element closes menu');
  showEditorMenu(20,20,groups);
  document.dispatchEvent(new Event('scroll'));
  check(!document.querySelector('.editor-context-menu'),'scrolling document closes menu');
  closeEditorMenu(); document.removeEventListener('keydown',bubble);
  return {errors,ran,closed};
};
document.getElementById('anchor').addEventListener('click',()=>showEditorMenu(40,60,[[{id:'copy',label:'Copy',run(){}}]]));
`;
const result = await build({ absWorkingDir: root, stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true,
  write: false, format: 'esm', platform: 'browser', metafile: true });
for (const file of Object.keys(result.metafile.inputs)) {
  if (/src\/(main|editor|laser|machine|camera|cameraui|native)\.ts$/.test(file)) throw new Error('Forbidden fixture import: ' + file);
}
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'fixture.js'), result.outputFiles[0].contents);
writeFileSync(resolve(out, 'style.css'), readFileSync(resolve(root, 'src/style.css')));
writeFileSync(resolve(out, 'index.html'), `<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; media-src 'none'; img-src 'none'">
<title>Isolated context-menu checks</title><link rel="stylesheet" href="style.css">
<button id="anchor">Menu fixture</button><script type="module" src="fixture.js"></script></html>`);
console.log('Isolated context menu fixture written to ' + out);
