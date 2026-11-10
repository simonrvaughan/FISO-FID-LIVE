'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),labels=require('../danger-area-labels.js');
const holbeach=require('./fixtures/holbeach.json');
test('TDA labels use the published window, respecting recurring D rather than the whole validity',()=>{
 const now=Date.parse('2026-11-10T11:00:00Z');
 for(const n of holbeach){assert.equal(labels.timing(n,now),n.notamId==='J3954/26'?'10 NOV 0830–1400Z':'10 NOV 0830–1700Z');}
 assert.equal(labels.timing(holbeach.find(n=>n.notamId==='J3954/26'),Date.parse('2026-11-11T11:00:00Z')),'11 NOV 0830–1400Z');
 const n=holbeach[0];assert.equal(labels.timing({...n,d:'UNSUPPORTED'},now),'CHECK NOTAM');
});
test('labels keep distinct stacked identifiers/levels, escape text and show no fabricated time',()=>{
 const a=labels.html('TDA EGD290A','FL195','7000FT AMSL','10 NOV 0830–1700Z');
 const b=labels.html('TDA EGD290B','7000FT AMSL','2300FT AMSL','10 NOV 0830–1700Z');
 assert.match(a,/data-area-ref="D290A"/);assert.match(b,/data-area-ref="D290B"/);assert.match(a,/FL195<\/span><br><span[^>]*>7000FT AMSL/);
 assert.equal(labels.timing({},Date.now()),'BY NOTAM');assert.ok(!labels.html('D290A','<img>','SFC','&').includes('<img>'));
 assert.equal(labels.applies('D220A'),true);assert.equal(labels.applies('EGD324B'),true);assert.equal(labels.applies('D207'),false);
});
test('stacked TDA labels fan out and each stalk anchors to its own published boundary',()=>{
 const geometry=require('../tda-geometry.js');const layouts=[];
 for(const n of holbeach){const boundary=geometry.boundary(n.eText),ref=n.eText.match(/EGD\d+[A-Z]?/)[0],layout=labels.layout(ref,boundary.points);layouts.push(layout.label.join(','));assert.ok(boundary.points.some(p=>p.lat===layout.anchor[0]&&p.lon===layout.anchor[1]));}
 assert.equal(new Set(layouts).size,4);
});
test('visible areas use one right-hand column, group stacked bands and keep labels apart',()=>{
 const polygon=[{x:100,y:150},{x:300,y:150},{x:300,y:250},{x:100,y:250}];
 const items=['D290C','D290B','D290A','D220B','D220A'].map((ref,i)=>({ref,points:polygon.map(p=>({x:p.x,y:p.y+(i>2?250:0)}))}));
 items.push({ref:'D324A',points:polygon.map(p=>({x:p.x-1200,y:p.y}))});
 const rows=labels.column(items,1000,800);
 assert.equal(rows.length,5);assert.equal(new Set(rows.map(r=>r.label.x)).size,1);assert.ok(rows[0].label.x>300);
 assert.deepEqual(rows.map(r=>r.ref),['D290A','D290B','D290C','D220A','D220B']);
 for(let i=1;i<rows.length;i++)assert.ok(rows[i].label.y-rows[i-1].label.y>=44);
 for(const row of rows){assert.ok(row.points.includes(row.anchor));assert.ok(row.label.x+108<=1000);assert.ok(row.label.y>=30&&row.label.y<=770);}
 const mobile=labels.column(items,390,600);assert.ok(mobile.every(r=>r.label.x>=12&&r.label.x+108<=378));
});
