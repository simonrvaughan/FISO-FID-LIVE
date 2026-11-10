'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{create}=require('../area-selection.js');
function model(){
 let time=0,next=0;const timers=new Map(),overlays=[];
 const selection=create({now:()=>time,delay:(fn,ms)=>{const id=++next;timers.set(id,{fn,at:time+ms});return id;},cancel:id=>timers.delete(id),draw:source=>{const overlay={source,removed:false,remove(){this.removed=true;},bringToFront(){}};overlays.push(overlay);return overlay;}});
 function advance(ms){time+=ms;for(const [id,t] of [...timers])if(t.at<=time){timers.delete(id);t.fn();}}
 return {selection,advance,overlays,timers};
}
test('area selection pulses for ten seconds and then removes its outline',()=>{
 const m=model(),source={operationalState:'active',opacity:.9};m.selection.start('A',()=>source);
 m.advance(9999);assert.equal(m.selection.selected(),'A');assert.equal(m.overlays[0].removed,false);
 m.advance(1);assert.equal(m.selection.selected(),null);assert.equal(m.overlays[0].removed,true);assert.equal(m.timers.size,0);
 assert.deepEqual(source,{operationalState:'active',opacity:.9});
});
test('a new area replaces the old pulse and gets its own complete ten seconds',()=>{
 const m=model();m.selection.start('A',()=>({}));m.advance(7000);m.selection.start('B',()=>({}));
 assert.equal(m.overlays[0].removed,true);assert.equal(m.timers.size,1);m.advance(3000);assert.equal(m.selection.selected(),'B');m.advance(7000);assert.equal(m.selection.selected(),null);
});
test('redraws and popup refreshes retain the original expiry instead of restarting it',()=>{
 const m=model();let source={};m.selection.start('A',()=>source);m.advance(4000);source={};m.selection.refresh();
 assert.equal(m.overlays[0].removed,true);assert.equal(m.overlays.length,2);m.advance(6000);assert.ok(m.overlays.every(o=>o.removed));
});
test('an expired or hidden TDA removes the selection outline immediately',()=>{
 const m=model();let source={};m.selection.start('A',()=>source);source=null;m.selection.refresh();assert.equal(m.overlays[0].removed,true);m.advance(10000);assert.equal(m.selection.selected(),null);
});
