import './core-fixtures-env';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { defaultLayer, newDoc } from '../src/model';
import { smoothAnchors } from '../src/editor/vector';
import { draftHandleMarks } from '../src/editor/render';
let count=0;const test=(name:string,f:()=>void)=>{f();count++;console.log('PASS '+name)};
function editor(){
  const ed=Object.create(Editor.prototype) as Editor;
  Object.assign(ed,{doc:newDoc(),currentLayer:0,sel:[],tool:'curvature',draft:null,drag:null,nodeSets:new Map(),segmentSets:new Map(),handleSets:new Map(),nodeSel:new Set(),history:new History(),batching:false,
    view:{zoom:1,ox:0,oy:0},canvas:{style:{}},snapHit:null,alignGuides:[],nodeEditObj:null});
  ed.doc.layers[0]=defaultLayer(0);ed.emit=()=>{};ed.redraw=()=>{};return ed;
}
const finite=(nodes:{x:number;y:number;cin?:{x:number;y:number};cout?:{x:number;y:number}}[])=>
  nodes.every((n)=>Number.isFinite(n.x+n.y) && (!n.cin || Number.isFinite(n.cin.x+n.cin.y)) && (!n.cout || Number.isFinite(n.cout.x+n.cout.y)));
test('smoothAnchors interpolates open anchors',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:10,y:0},{x:20,y:10}],false);
  assert.equal(out.length,3);assert.ok(finite(out));
  assert.ok(out[1].cin && out[1].cout && out[1].smooth);
});
test('two anchors stay straight',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:10,y:5}],false);
  assert.equal(out.length,2);assert.equal(out[0].cout,undefined);assert.equal(out[1].cin,undefined);
});
test('duplicate points guard against NaN',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:0,y:0},{x:10,y:0}],false);
  assert.ok(finite(out));
});
test('manual handles survive smoothing',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:10,y:0,cout:{x:14,y:0}},{x:20,y:10}],false);
  assert.deepEqual(out[1].cout,{x:14,y:0});assert.ok(out[1].cin);
});
test('finishCurvature commits smoothed path with one Undo',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:10}],closed:false};ed.finishCurvature();
  assert.equal(ed.doc.objs.length,1);assert.equal(ed.draft,null);assert.equal(ed.history.position,1);assert.equal(ed.sel.length,1);
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.equal(shape.subs.length,1);assert.ok(finite(shape.subs[0].nodes));assert.ok(shape.subs[0].nodes[1].smooth);
});
test('closed draft wraps tangents and stays closed',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:5,y:8}],closed:true};ed.finishCurvature();
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.equal(shape.subs[0].closed,true);
  assert.ok(shape.subs[0].nodes.every((n)=>n.cin && n.cout));
});
test('short draft discarded without Undo',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0}],closed:false};ed.finishCurvature();
  assert.equal(ed.doc.objs.length,0);assert.equal(ed.history.position,0);assert.equal(ed.draft,null);
});
test('undo restores empty doc',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0}],closed:false};ed.finishCurvature();
  ed.doUndo();assert.equal(ed.doc.objs.length,0);
});
test('backspace pops last anchor during draw',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0}],closed:false};
  ed.onKey({key:'Backspace',code:'Backspace',preventDefault(){},target:{tagName:'CANVAS'},ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,repeat:false,defaultPrevented:false} as unknown as KeyboardEvent);
  assert.equal(ed.draft!.nodes.length,1);
});
test('escape discards draft without Undo',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0}],closed:false};
  ed.onKey({key:'Escape',code:'Escape',preventDefault(){},target:{tagName:'CANVAS'},ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,repeat:false,defaultPrevented:false} as unknown as KeyboardEvent);
  assert.equal(ed.draft,null);assert.equal(ed.doc.objs.length,0);assert.equal(ed.history.position,0);
});
test('right-click commits smoothed path',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:10}],closed:false};ed.rightPress();
  assert.equal(ed.doc.objs.length,1);assert.equal(ed.history.position,1);
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.ok(shape.subs[0].nodes[1].cout);
});
test('draftHandleMarks maps anchors and arms 1:1',()=>{
  const marks=draftHandleMarks([{x:0,y:0},{x:10,y:0,cin:{x:6,y:0},cout:{x:14,y:0}},{x:20,y:10}],3);
  assert.equal(marks.length,3);assert.deepEqual(marks[1].arms,[{x:6,y:0},{x:14,y:0}]);assert.deepEqual(marks[0].arms,[]);
});
test('draftHandleMarks excludes ghost node',()=>{
  const marks=draftHandleMarks([{x:0,y:0},{x:10,y:0},{x:20,y:10},{x:99,y:99}],3);
  assert.equal(marks.length,3);
});
console.log(`${count} curvature groups passed`);
