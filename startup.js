// DEV448 shell-only loading status. Map readiness does not wait for network NOTAM updates.

(function(){
  var splash=document.getElementById("ffappStartupSplash");
  var text=document.getElementById("ffappStartupText");
  var bar=document.getElementById("ffappStartupBar");
  var sub=document.getElementById("ffappStartupSub");
  var lastClock="", clockTicks=0, finished=false, started=0, active=false;
  var messages=[
    [0,"Cleared for startup — map coming alive…",12,"Waking the operational display"],
    [3,"Spinning the propeller… digitally, thankfully.",22,"Loading map and airfield information"],
    [6,"Checking the NOTAMs — because surprises belong at birthday parties.",34,"Reading live PIB information"],
    [10,"Plotting the interesting bits of UK airspace…",46,"Building operational areas and hazards"],
    [14,"Counting parachutes. Nobody jump yet.",57,"Loading PARA sites and status controls"],
    [18,"Listening for squawks — 7700 still gets our attention.",68,"Starting ADS-B traffic processing"],
    [22,"Fun fact: the first powered flight lasted only 12 seconds.",77,"AUTO PIB is still parsing in the background"],
    [28,"Aviation fact: Concorde cruised at about Mach 2.",84,"Waiting for AUTO PIB and the UTC clock"],
    [35,"No holding charge today — we're still loading.",89,"Operational data is continuing to initialise"],
    [43,"Cabin crew, prepare the map for departure…",93,"Final checks: AUTO PIB + UTC clock"],
    [52,"Still with us? Good. The computers are doing the paperwork.",96,"Waiting for the final operational checks"],
    [65,"Nearly there — even aviation software gets a pre-flight check.",97,"AUTO PIB and UTC clock must both be ready"]
  ];
  function paint(msg,pct,detail){
    if(text&&msg)text.textContent=msg;
    if(bar&&Number.isFinite(Number(pct)))bar.style.width=Math.max(2,Math.min(100,Number(pct)))+"%";
    if(sub&&detail)sub.textContent=detail;
  }
  function show(msg,pct,detail){
    if(!splash)return; active=true; finished=false; started=performance.now(); clockTicks=0; lastClock="";
    splash.style.display="flex"; splash.classList.remove("ffapp-startup-hide");
    paint(msg||messages[0][1],pct==null?12:pct,detail||messages[0][3]);
  }
  function revealMap(){ if(splash&&active&&!finished) splash.classList.add("ffapp-map-visible"); }
  function clockIsRunning(){
    var c=document.getElementById("clock"); if(!c)return false;
    var v=String(c.textContent||"").trim(); if(!/^\d{2}:\d{2}:\d{2}$/.test(v))return false;
    if(lastClock && v!==lastClock) clockTicks++; lastClock=v; return clockTicks>=1;
  }
  function autoPibState(){
    var state=window.FFAPP_LIVE_PIB_STATE&&window.FFAPP_LIVE_PIB_STATE.state;
    if(state==="complete"||state==="error"||state==="checking") return state;
    var el=document.getElementById("autoPibHazStatus");
    var v=String(el&&el.textContent||"");
    if(/AUTO PLOT complete/i.test(v) || /NATS checked .* no change/i.test(v)) return "complete";
    if(/WARNING: NATS feed unavailable|AUTO PLOT failed|feed unavailable\/invalid/i.test(v)) return "error";
    return "checking";
  }
  function finishHide(){
    if(finished||!splash)return; finished=true;
    paint("FISO FID ready — chocks away!",100,"UTC clock running · AUTO PIB complete");
    setTimeout(function(){ splash.classList.add("ffapp-startup-hide"); setTimeout(function(){splash.style.display="none";active=false;},260); },650);
  }
  window.ffappStartup={
    show:show,
    update:function(msg,pct,detail){if(active)paint(msg,pct,detail);},
    hide:function(){
      if(!active||finished)return;finished=true;splash.style.display="none";active=false;
      try{performance.mark("ffapp-map-usable");window.dispatchEvent(new Event("ffapp-map-usable"));}catch(_){}
    },
    revealMap:revealMap
  };
  setInterval(function(){
    if(!active||finished)return;
    if(window.FISO_FID_MAP) revealMap();
    var clockOK=clockIsRunning(), pibState=autoPibState(), pibOK=pibState==="complete";
    if(clockOK&&pibOK){finishHide();return;}
    // DEV429: never leave the startup card permanently hung if the external NATS feed
    // reaches a terminal error. The operational map remains usable and shows the red
    // LIVE AUTO PIB warning; close the holding card once the clock is proven running.
    if(clockOK&&pibState==="error"){
      paint("Map ready — NATS PIB needs another circuit.",100,"UTC clock running · LIVE AUTO PIB unavailable · last valid PIB retained");
      finished=true;
      setTimeout(function(){ splash.classList.add("ffapp-startup-hide"); setTimeout(function(){splash.style.display="none";active=false;},260); },2200);
      return;
    }
    var elapsed=(performance.now()-started)/1000, chosen=messages[0];
    for(var i=0;i<messages.length;i++) if(elapsed>=messages[i][0]) chosen=messages[i];
    var detail=chosen[3];
    if(clockOK&&!pibOK) detail="UTC clock running · waiting for LIVE AUTO PIB to complete";
    else if(!clockOK&&pibOK) detail="AUTO PIB complete · waiting for UTC clock to start";
    paint(chosen[1],chosen[2],detail);
  },500);
})();
