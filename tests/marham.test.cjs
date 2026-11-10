'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),fixtures=require('./fixtures/marham.json'),earth=require('../vendor/geographiclib-geodesic.min.js').Geodesic.WGS84;
function model(){
 let time=Date.parse('2026-11-10T11:00:00Z');
 const document={readyState:'loading',addEventListener(){},getElementById(){return null;},querySelector(){return null;},querySelectorAll(){return [];}};
 const window={document,addEventListener(){},ffappNowMs:()=>time,ffappNowDate:()=>new Date(time),FISO_AREA_LABELS:require('../danger-area-labels.js'),FFAPP_NOTAM_SCHEDULE:require('../notam-schedule.js')};
 const ctx=vm.createContext({window,document,console,setInterval(){},setTimeout(){},clearTimeout(){},localStorage:{getItem(){return null;},setItem(){}}});
 vm.runInContext(fs.readFileSync(path.join(root,'aviationdata.js'),'utf8'),ctx);
 let hz=fs.readFileSync(path.join(root,'hazdam.js'),'utf8').replace('window.HAZDAM = {','window.HAZDAM = { labelHtml, effectiveState, effectiveLevels,');
 vm.runInContext(hz,ctx);
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 function load(name){const a=app.indexOf('  function '+name+'('),b=app.indexOf('\n  function ',a+12);assert.ok(a>=0,name);vm.runInContext(app.slice(a,b),ctx);}
 Object.assign(ctx,{pad:v=>String(v).padStart(2,'0'),currentPibSourcePage:()=>null});
 ['hazdamCanonicalAreaRef','hazdamExtractAreaRefsFromNotam','hazdamFindAreaByCanonicalRef','hazdamDangerNotamAction','hazdamFormatLevel','hazdamBcdDateToUtcParts','hazdamPibNotamTodayTimes','autoPibDangerAreaLineSegments','autoPibDangerAreaRelevantToPib','autoPibDangerAreaPayloads','pibNotamToText'].forEach(load);
 return {window,ctx,setTime:s=>time=Date.parse(s)};
}
test('Marham NOTAM ingestion and exact AIP circle architecture, with independent vertical bands',()=>{
 const engine=require('../notamengine.js')({}),{window,ctx}=model();
 for(const [i,n] of fixtures.entries()){
  const parsed=engine.parsePibText(n.raw,'marham.txt',1).notams[0];assert.equal(parsed.notamId,n.notamId);assert.equal(parsed.d,'');
  const p=ctx.autoPibDangerAreaPayloads(parsed);assert.equal(p.length,1);assert.equal(p[0].areaId,'EGD220'+(i?'B':'A'));assert.equal(p[0].lower,i?'FL105':'SFC');assert.equal(p[0].upper,i?'FL195':'FL105');
  const a=window.HAZDAM.staticAreas[p[0].areaId];assert.equal(a.geometryType,'circle');assert.equal(a.circleRadiusNm,5);assert.equal(a.circleCenter[0],52+38/60+54/3600);assert.equal(a.circleCenter[1],33/60+2/3600);assert.equal(a.hours,'Activated by NOTAM.');
  for(const pt of a.coords)assert.ok(Math.abs(earth.Inverse(a.circleCenter[0],a.circleCenter[1],pt[0],pt[1]).s12-9260)<1e-6);
 }
 assert.notEqual(window.HAZDAM.staticAreas.EGD220A,window.HAZDAM.staticAreas.EGD220B);
});
test('Marham B/C activation, warning and expiry use HAZDAM with no D schedule',()=>{
 const {window,ctx,setTime}=model();
 for(const n of fixtures){const p=ctx.autoPibDangerAreaPayloads(n)[0];assert.equal(window.HAZDAM.applyAutoNotamBundleToArea(p.areaId,[p]),true);}
 for(const [time,state] of [['2026-11-09T11:00:00Z','inactive'],['2026-11-10T10:14:59Z','inactive'],['2026-11-10T10:15:00Z','pending'],['2026-11-10T10:30:00Z','active'],['2026-11-10T18:59:59Z','active'],['2026-11-10T19:00:00Z','inactive']]){
  setTime(time);for(const id of ['EGD220A','EGD220B'])assert.equal(window.HAZDAM.effectiveState(id),state,id+' '+time);
 }
 setTime('2026-11-10T11:00:00Z');assert.equal(window.HAZDAM.effectiveLevels('EGD220A').upper,'FL105');assert.equal(window.HAZDAM.effectiveLevels('EGD220B').lower,'FL105');assert.equal(window.HAZDAM.effectiveLevels('EGD220B').upper,'FL195');
});

test('chart labels show Marham levels and dated activation times without losing separate A/B identities',()=>{
 const {window,ctx,setTime}=model();for(const n of fixtures){const p=ctx.autoPibDangerAreaPayloads(n)[0];window.HAZDAM.applyAutoNotamBundleToArea(p.areaId,[p]);}
 setTime('2026-11-10T11:00:00Z');
 for(const id of ['EGD220A','EGD220B']){const html=window.HAZDAM.labelHtml(id);assert.match(html,/10 NOV 1030–1900Z/);assert.match(html,new RegExp('data-area-ref="'+id.slice(2)+'"'));}
 assert.match(window.HAZDAM.labelHtml('EGD220A'),/FL105<\/span><br><span[^>]*>SFC/);assert.match(window.HAZDAM.labelHtml('EGD220B'),/FL195<\/span><br><span[^>]*>FL105/);
 setTime('2026-11-10T10:00:00Z');assert.match(window.HAZDAM.labelHtml('EGD220A'),/NEXT 10 NOV/);
 setTime('2026-11-10T19:00:00Z');assert.match(window.HAZDAM.labelHtml('EGD220A'),/ENDED 10 NOV/);
});
