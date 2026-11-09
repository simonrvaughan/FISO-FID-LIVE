'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),geometry=require('../tda-geometry.js'),geo=require('../vendor/geographiclib-geodesic.min.js').Geodesic.WGS84,schedule=require('../notam-schedule.js'),fixtures=require('./fixtures/holbeach.json');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
function fn(name){const start=source.indexOf('  function '+name+'(');assert.ok(start>=0,name);const end=source.indexOf('\n  function ',start+12);return source.slice(start,end);}
const context=vm.createContext({window:{FFAPP_TDA_GEOMETRY:geometry},console,AUTO_PIB_TDA_RULE:'TEMPORARY_DANGER_AREA_ACTIVITY',currentPibSourcePage:()=>null});
['autoPibUtcIso','autoPibCoordToDecimal','autoPibGlidingCoords','pibNotamToText','autoPibTdaRecord'].forEach(name=>vm.runInContext(fn(name),context));
const classify=n=>context.autoPibTdaRecord(n);
test('published NOTAM text ingestion retains decimal coordinates, B/C and F/G without inventing D',()=>{
 const engine=require('../notamengine.js')({});
 for(const n of fixtures){const parsed=engine.parsePibText(n.raw,'fixture.txt',1).notams[0];assert.equal(parsed.notamId,n.notamId);for(const field of ['b','c','d','f','g','eText'])assert.equal(parsed[field],n[field]);}
});
test('three distinct TDA records, published levels and identical A/B horizontal geometry',()=>{
 const records=fixtures.filter(n=>n.notamId!=='J3954/26').map(classify);
 assert.equal(new Set(records.map(n=>n.notamId)).size,3);
 assert.deepEqual(records.map(n=>[n.displayLabel,n.lower,n.upper]),[['TDA EGD290A','7000FT AMSL','FL195'],['TDA EGD290B','2300FT AMSL','7000FT AMSL'],['TDA EGD290C','SFC','2300FT AMSL']]);
 assert.equal(JSON.stringify(records[0].points),JSON.stringify(records[1].points));
 for(const n of records){assert.ok(n.points.length>100);assert.equal(n.hideRadius,true);assert.equal(n.scheduleD,'');assert.equal(n.alwaysActive,false);}
});
test('decimal seconds, hemisphere and malformed coordinate validation',()=>{
 const p=geometry.coordinate('525322.96N','0000709.79E');assert.ok(Math.abs(p.lat-(52+53/60+22.96/3600))<1e-12);
 assert.ok(geometry.coordinate('525322.96S','0000709.79W').lon<0);
 assert.equal(geometry.coordinate('526022N','0000709E'),null);
 assert.equal(geometry.coordinate('915322N','0000709E'),null);
});
test('all published arc endpoints retained, centres excluded, radii and directions verified',()=>{
 for(const n of fixtures){const g=geometry.boundary(n.eText);assert.deepEqual(g.points[0],g.points.at(-1));
  const arcs=g.segments.filter(s=>s.kind==='arc');assert.equal(arcs.length,n.notamId==='J3978/26'||n.notamId==='J3979/26'?2:1);
  for(const arc of arcs){assert.equal(arc.sweep>0,arc.clockwise);for(let i=arc.first+1;i<arc.last;i++){const p=g.points[i],distance=geo.Inverse(arc.center.lat,arc.center.lon,p.lat,p.lon).s12;assert.ok(Math.abs(distance-arc.radius)<1e-6);}
   assert.ok(!g.points.some(p=>p.lat===arc.center.lat&&p.lon===arc.center.lon));
  }
 }
 const a=geometry.boundary(fixtures.find(n=>n.notamId==='J3978/26').eText);
 assert.ok(a.segments.find(s=>s.kind==='arc').sweep>280,'clockwise long arc must not use the short arc');
 const latitude=a.segments.find(s=>s.kind==='latitude');assert.equal(latitude.from.lat,52+48/60+30/3600);assert.equal(latitude.to.lon,1/3);
 const end=geometry.coordinate('525553.69N','0001929.36E');assert.ok(a.points.some(p=>p.lat===end.lat&&p.lon===end.lon));
});
test('absent D uses B/C: before, warning, active, final instant, C and after',()=>{
 for(const n of fixtures.filter(n=>n.notamId!=='J3954/26')){const h=classify(n);for(const [time,state] of [['2026-11-10T07:59:59Z','inactive'],['2026-11-10T08:00:00Z','upcoming'],['2026-11-10T08:30:00Z','active'],['2026-11-10T16:59:59Z','active'],['2026-11-10T17:00:00Z','inactive'],['2026-11-10T17:00:01Z','inactive']])assert.equal(schedule.evaluate(h,Date.parse(time),30).state,state,time);}
});
test('D schedule remains authoritative and unsupported D is not widened',()=>{
 const n=classify(fixtures.find(n=>n.notamId==='J3954/26'));assert.equal(schedule.evaluate(n,Date.parse('2026-11-10T15:00:00Z'),30).state,'inactive');
 assert.equal(schedule.evaluate({...n,scheduleD:'BY ARRANGEMENT'},Date.parse('2026-11-10T10:00:00Z'),30).state,'uncertain');
});
test('ordinary circles, permanent danger areas and suppressed trigger NOTAMs retain behaviour',()=>{
 assert.equal(geometry.boundary('WI 2 NM RADIUS OF 525152N 0001001E'),null);
 const base={...fixtures[0],notamId:'J1000/26',eText:'TEMPO DANGER AREA (TDA) EGD289A INSTALLED WI 1.65NM RADIUS OF 523022N 0015244W'};
 const circle=classify(base);assert.equal(circle.radiusNm,1.65);assert.equal(circle.points,undefined);
 assert.equal(classify({...base,eText:'DANGER AREA EGD207 ACTIVATED'}),null);
 assert.equal(classify({...base,notamId:'J2809/26'}),null);
 assert.equal(classify({...base,eText:base.eText.replace('EGD289A','EGD098F')}),null);
});
test('unrecognised arc never silently becomes a straight polygon',()=>{
 assert.throws(()=>geometry.boundary('AREA BOUNDED BY 525400N 0000633E THEN ARC VIA 524830N 0001200E - 524830N 0002000E'),/Unsupported/);
});
