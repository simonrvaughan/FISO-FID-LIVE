/* DEV455: deterministic client-side NOTAM schedule interpretation. No I/O. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FFAPP_NOTAM_SCHEDULE=factory();})(typeof window==='undefined'?globalThis:window,function(){
'use strict';
const DAY=86400000,MIN=60000,MONTHS='JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' '),DAYS='SUN MON TUE WED THU FRI SAT'.split(' '),cache=new Map();
function midnight(t){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());}
function date(y,m,d){const t=Date.UTC(y,m-1,d),v=new Date(t);if(v.getUTCFullYear()!==y||v.getUTCMonth()!==m-1||v.getUTCDate()!==d)throw Error('Invalid calendar date');return t;}
function timestamp(v,end){
 const s=String(v??'').trim().toUpperCase();if(end&&s==='PERM')return Infinity;
 let m=s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:EST)?$/);if(m){const y=2000+Number(m[1]);if(+m[4]>23||+m[5]>59)return NaN;try{return date(y,+m[2],+m[3])+(+m[4]*60+(+m[5]))*MIN;}catch{return NaN;}}
 m=s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|\+00:00)$/);
 if(!m||+m[4]>23||+m[5]>59||+(m[6]||0)>59)return NaN;
 try{return date(+m[1],+m[2],+m[3])+(+m[4]*60+(+m[5]))*MIN+(+(m[6]||0))*1000+Math.round(Number(m[7]||0)*1000);}catch{return NaN;}
}
function fields(r){
 let d=r.scheduleD!==undefined?r.scheduleD:r.d;
 // DEV469: no published D) means continuous activity within B)/C), for
 // every NOTAM family. Explicit blank or unsupported D) still needs review.
 if(!String(d??'').trim()&&!/(?:^|\s)D\)/i.test(r.notam||r.raw||''))d='H24';
 return{b:r.validStartISO||r.startISO||r.b,c:r.validFinishISO||r.finishISO||r.c,d};
}
function compile(record){
 const f=fields(record),key=JSON.stringify([f.b,f.c,f.d]);if(cache.has(key))return cache.get(key);
 let result;
 try{
  const begin=timestamp(f.b,false),finish=timestamp(f.c,true);if(!Number.isFinite(begin)||!(Number.isFinite(finish)||finish===Infinity)||finish<=begin)throw Error('Missing or invalid B)/C) validity');
  const raw=String(f.d??'').toUpperCase().replace(/[\u2010-\u2014\u2212]/g,'-').replace(/\s+/g,' ').trim();if(!raw)throw Error('D) schedule is missing');if(raw.length>2000)throw Error('D) schedule exceeds interpretation limit');
  const tokens=raw.match(/[A-Z]+\d*|\d{1,4}|[-,;]/g)||[];if(tokens.join('')!==raw.replace(/\s/g,''))throw Error('Unsupported schedule punctuation');
  // H24 and compact solar offsets are standard lexical forms, not free prose.
  const t=[];for(const word of tokens){if(/^MINUS\d+$|^PLUS\d+$/.test(word))t.push(word.replace(/\d+$/,''),word.match(/\d+$/)[0]);else t.push(word);}
  const bd=new Date(begin),bcYear=bd.getUTCFullYear(),context={year:bcYear,month:bd.getUTCMonth()+1,seenMonth:false};let i=0;
  const isMonth=x=>MONTHS.includes(x),isDate=x=>/^\d{1,2}$/.test(x||''),isTime=x=>/^\d{4}$/.test(x||'')||x==='SR'||x==='SS'||x==='H24';
  function readDate(a,pos,ctx){
   let month=ctx.month,year=ctx.year;
   if(isMonth(a[pos])){month=MONTHS.indexOf(a[pos++])+1;if(month<ctx.month){if(ctx.seenMonth)year++;else if(Number.isFinite(finish)&&new Date(finish).getUTCFullYear()>bcYear&&month<=new Date(finish).getUTCMonth()+1)year++;}ctx.month=month;ctx.year=year;ctx.seenMonth=true;}
   if(!isDate(a[pos]))throw Error('Expected a UTC calendar date');const day=Number(a[pos++]);
   return{day:date(year,month,day),pos};
  }
  function selector(a,ctx){
   a=a.filter(x=>x!=='UTC'&&x!=='EVERY'&&x!=='DAY');if(!a.length||a.length===1&&a[0]==='DAILY')return{kind:'daily'};
   if(a.includes('DAILY'))throw Error('Ambiguous DAILY selector');
   if(a.some(x=>DAYS.includes(x))){let allowed=[];for(let n=0;n<a.length;){const start=DAYS.indexOf(a[n++]);if(start<0)throw Error('Mixed/unsupported weekday selector');let end=start;if(a[n]==='-'){n++;end=DAYS.indexOf(a[n++]);if(end<0)throw Error('Invalid weekday range');}let d=start;for(let g=0;g<7;g++){allowed.push(d);if(d===end)break;d=(d+1)%7;}}return{kind:'weekdays',days:allowed};}
   const ranges=[];let n=0;while(n<a.length){const start=readDate(a,n,ctx);n=start.pos;let end=start.day;if(a[n]==='-'){const parsed=readDate(a,n+1,ctx);n=parsed.pos;end=parsed.day;if(end<start.day)throw Error('Calendar range is reversed');}ranges.push([start.day,end]);}
   if(!Number.isFinite(finish)||finish-begin>370*DAY)throw Error('Calendar schedule year is ambiguous');
   return{kind:'dates',ranges};
  }
  function clock(){const v=t[i++];if(/^\d{4}$/.test(v||'')){const hh=+v.slice(0,2),mm=+v.slice(2);if(hh>23||mm>59)throw Error('Invalid UTC time (2400 is not accepted)');return{kind:'clock',minute:hh*60+mm};}
   if(v!=='SR'&&v!=='SS')throw Error('Expected a UTC or solar time');let offset=0;if(t[i]==='PLUS'||t[i]==='MINUS'){const sign=t[i++]==='PLUS'?1:-1;if(!/^\d{1,3}$/.test(t[i]||'')||+t[i]>180)throw Error('Unsupported solar offset');offset=sign*Number(t[i++]);}return{kind:v,offset};}
  const clauses=[];let previous={include:{kind:'daily'},exclude:null};
  while(i<t.length){if(t[i]===','||t[i]===';'){i++;continue;}
   const prefix=[];while(i<t.length&&!isTime(t[i])&&t[i]!==','&&t[i]!==';')prefix.push(t[i++]);
   if(!isTime(t[i]))throw Error('Schedule clause has no time period');
   const exc=prefix.indexOf('EXC');if(exc===prefix.length-1&&exc>=0)throw Error('Empty exception selector');if(prefix.indexOf('EXC',exc+1)>=0&&exc>=0)throw Error('Multiple exceptions in one selector');
   let include=prefix.length?selector(exc<0?prefix:prefix.slice(0,exc),context):previous.include;
   let exclude=exc>=0?selector(prefix.slice(exc+1),{...context}):prefix.length?null:previous.exclude;
   const ranges=[];while(i<t.length&&isTime(t[i])){
    if(t[i]==='H24'){i++;ranges.push({h24:true});continue;}
    const start=clock();if(t[i++]!=='-')throw Error('Missing time-range separator');
    if(isMonth(t[i])||isDate(t[i])){
     if(include.kind!=='dates'||include.ranges.length!==1||include.ranges[0][0]!==include.ranges[0][1])throw Error('Multi-day activity requires one explicit start date');
     const endDate=readDate(t,i,context);i=endDate.pos;const end=clock();ranges.push({start,end,absoluteStart:include.ranges[0][0],absoluteEnd:endDate.day});
    }else ranges.push({start,end:clock()});
   }
   if(t[i]==='EXC'){i++;const exception=[];while(i<t.length&&t[i]!==','&&t[i]!==';')exception.push(t[i++]);if(!exception.length||exception.includes('EXC'))throw Error('Invalid schedule exception');exclude=selector(exception,{...context});}
   if(!ranges.length)throw Error('No schedule periods');
   clauses.push({include,exclude,ranges});previous={include,exclude};
  }
  if(!clauses.length)throw Error('No recognised activity schedule');
  result={state:'recognised',begin,finish,clauses};
 }catch(error){result={state:'uncertain',reason:error.message};}
 if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
function matches(selector,day){if(!selector)return false;if(selector.kind==='daily')return true;if(selector.kind==='weekdays')return selector.days.includes(new Date(day).getUTCDay());return selector.ranges.some(([a,b])=>day>=a&&day<=b);}
function windows(record,from,to,solar){
 const parsed=compile(record);if(parsed.state==='uncertain')return parsed;
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>2*DAY)return{state:'uncertain',reason:'Invalid schedule query range'};
 if(to<=parsed.begin||from>=parsed.finish)return{state:'recognised',intervals:[]};
 const intervals=[];
 try{
  function instant(clock,day,isEnd){if(clock.kind==='clock')return day+(isEnd&&clock.minute===1439?1440:clock.minute)*MIN;if(typeof solar!=='function')throw Error('Solar timing unavailable');const value=solar(record,day,clock.kind==='SR');if(!Number.isFinite(value))throw Error('Solar timing/position unavailable');return day+(value+clock.offset)*MIN;}
  function add(a,b){a=Math.max(a,parsed.begin);b=Math.min(b,parsed.finish);if(b>a&&a<to&&b>from)intervals.push([a,b]);}
  for(const clause of parsed.clauses){
   for(const range of clause.ranges){
    if(range.absoluteStart!==undefined){if(clause.exclude)throw Error('Ambiguous exception on multi-day period');const a=instant(range.start,range.absoluteStart,false),b=instant(range.end,range.absoluteEnd,true);if(b<=a)throw Error('Reversed multi-day period');add(a,b);continue;}
    for(let day=midnight(from)-2*DAY;day<to;day+=DAY){if(!matches(clause.include,day))continue;
     let a=range.h24?day:instant(range.start,day,false),b=range.h24?day+DAY:instant(range.end,day,true);
     if(!range.h24&&b===a)throw Error('Zero-length schedule period');
     const overnight=b<a;if(overnight)b=range.end.kind==='clock'?b+DAY:instant(range.end,day+DAY,true);
     if(clause.exclude&&overnight)throw Error('Full-day exception on overnight period is ambiguous');
     if(clause.exclude&&matches(clause.exclude,day))continue;add(a,b);
    }
   }
  }
  intervals.sort((a,b)=>a[0]-b[0]);return{state:'recognised',intervals};
 }catch(error){return{state:'uncertain',reason:error.message};}
}
function evaluate(record,now,leadMinutes=0,solar){
 const lead=Math.max(0,Math.min(60,Number(leadMinutes)||0))*MIN,value=windows(record,now,now+Math.max(lead,1)+1,solar);if(value.state==='uncertain')return value;
 for(const [start,end]of value.intervals)if(now>=start&&now<end)return{state:'active',nextChange:end};
 const future=value.intervals.find(([start])=>start>now&&start-now<=lead);return future?{state:'upcoming',nextStart:future[0],nextChange:future[0],minutes:Math.ceil((future[0]-now)/MIN)}:{state:'inactive'};
}
function today(record,now,solar){const day=midnight(now),value=windows(record,day+MIN,day+DAY,solar);return value.state==='uncertain'?value:{state:value.intervals.length?'scheduled':'inactive',intervals:value.intervals};}
return{compile,windows,evaluate,today,midnight,timestamp};
});
