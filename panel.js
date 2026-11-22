// ================================================================
// panel.js  —  Blinky Panel  (p5 calibration + HTML running view)
// ================================================================

// ── Calibration state ──────────────────────────────────────────
let video, faceMesh, faces = [];
let appState = "intro";
let squeezeEAR_Array = [], openEAR_Array = [], closedEAR_Array = [];
let squeezeEAR = 0, openEAR = 0, closedEAR = 0;
let customThreshold = 0.25;
let blinkTimestamps = [], eyeWasClosed = false, blinkCount = 0;
let avgBlinkInterval = 6.0, alertThreshold = 15.0, blinkFlashTimer = 0;
let stateStartTime = 0;
const DURATION_RECORD    = 3000;
const DURATION_BLINKRATE = 30000;

// ── Live data ──────────────────────────────────────────────────
let liveEAR = 0.25, liveDebt = 0, liveTWB = 0, liveModeTime = 0;
let liveSqueezeLeft = 0, liveBlinkCount = 0, liveSat = 100;
let selectedMode  = "accumulation";
let selectedStyle = "vignette";
let maxDebtSeen   = 0;
let userBlinkRateSamples = [];
let lastSampleTime = 0, lastSampleBlinkCount = 0;

// ── Experimental Data (CSV) ────────────────────────────────────
let rawBlinkLog = [];
let lastRawBlinkCount = 0;

// ── 故事B：CSV 数据收集 ─────────────────────────────────────────
let liveDeepBlinks = 0, liveNormalBlinks = 0;
let liveEventLog = [];           // detector 传来的眨眼/提醒事件
let liveActiveMode = "accumulation";
let timeSeriesLog = [];          // Section1：每秒记录 debt/saturation 真实历史
let lastTimeSeriesSec = -1;
let panelStartWallClock = 0;     // panel 墙钟起始时间(ms)，作为CSV时间轴基准

// ── Chart state & Scroll Track Variables ───────────────────────
let chartAnimId = null;
let springEAR = 0.25;     // 弹簧位置（追踪 liveEAR，产生眼睑回弹）
let springVel = 0;        // 弹簧速度
let twinklePhase = 0;     // 星星闪烁相位

let chartScrollOffset = 0;  // 单位：分钟，0 = 跟随最新，负数 = 往历史查看
let isScrollLocked    = true; // true = 自动跟随，false = 用户手动停留在历史位置
let isScrollDragging  = false;
let scrollDragStartX  = 0;
let scrollDragStartOffset = 0;

// ── Calibration canvas colors ──────────────────────────────────
const BG    = [231, 231, 231];
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const GREEN = [0, 200, 100];
const RED   = [200, 30, 50];
const BLUE  = [30, 120, 220];
const GRAY  = [160, 160, 160];

// ================================================================
// p5.js  —  Calibration flow
// ================================================================
function preload() {
  ml5.setBackend("webgl");
  faceMesh = ml5.faceMesh();
}

function setup() {
  const cnv = createCanvas(361, 560);
  cnv.parent('cal-wrap');
  textAlign(CENTER, CENTER);

  chrome.storage.local.get(
    ['isCalibrated','customThreshold','avgBlinkInterval','alertThreshold',
     'openEAR','closedEAR','squeezeEAR','selectedMode','calibProgress'],
    (data) => {
      if (data.isCalibrated) {
        customThreshold  = data.customThreshold;
        avgBlinkInterval = data.avgBlinkInterval;
        alertThreshold   = data.alertThreshold;
        openEAR    = data.openEAR;
        closedEAR  = data.closedEAR;
        squeezeEAR = data.squeezeEAR || 0.10;
        selectedMode = data.selectedMode || "accumulation";
        transitionToRunning();
      } else if (data.calibProgress) {
        const p = data.calibProgress;
        squeezeEAR = p.squeezeEAR || 0;
        openEAR = p.openEAR || 0;
        closedEAR = p.closedEAR || 0;
        customThreshold  = p.customThreshold  || 0.25;
        avgBlinkInterval = p.avgBlinkInterval || 6.0;
        alertThreshold   = p.alertThreshold   || 15.0;
        appState = p.step || "intro";
        startPanelCamera();
      } else {
        startPanelCamera();
      }
    }
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "GLOBAL_STATE_SYNC" && msg.state) {
      const s = msg.state;
      liveEAR  = s.currentEAR || liveEAR;
      liveDebt = s.debt       || 0;
      liveTWB  = s.timeWithoutBlinking || 0;
      liveModeTime = s.modeTime || 0;
      liveSqueezeLeft = s.squeezeLeft || 0;
      liveBlinkCount  = s.blinkCount  || 0;
      liveSat = s.saturation || 100;
      if (s.selectedMode)      selectedMode  = s.selectedMode;
      if (s.interventionStyle) selectedStyle = s.interventionStyle;
      // 故事B 新增字段
      if (s.deepBlinkCount   !== undefined) liveDeepBlinks   = s.deepBlinkCount;
      if (s.normalBlinkCount !== undefined) liveNormalBlinks = s.normalBlinkCount;
      // 事件增量：追加到本地累积数组，按 t+type+debtBefore 去重（防止重发重复）
      if (s.eventLogDelta && s.eventLogDelta.length) {
        s.eventLogDelta.forEach(ev => {
          const last = liveEventLog[liveEventLog.length-1];
          const dup = last && last.t === ev.t && last.type === ev.type &&
                      last.debtBefore === ev.debtBefore;
          if (!dup) liveEventLog.push(ev);
        });
        if (liveEventLog.length > 8000) liveEventLog = liveEventLog.slice(-8000);
      }
      if (s.activeMode)                     liveActiveMode   = s.activeMode;
      
      if (s.blinkRateSamples !== undefined) {
        if (s.blinkRateSamples.length === 0 && userBlinkRateSamples.length > 0) {
          userBlinkRateSamples = [];
          rawBlinkLog = [];
          lastRawBlinkCount = 0;
          lastSampleTime = 0; 
          lastSampleBlinkCount = 0;
          chartScrollOffset = 0;
          isScrollLocked = true;
        } else {
          userBlinkRateSamples = s.blinkRateSamples;
        }
      }
      
      if (liveDebt > maxDebtSeen) maxDebtSeen = liveDebt;
      if (appState === "running") updateRunningView();
    }
  });

  chrome.runtime.sendMessage({ type:"REQUEST_GLOBAL_STATE" }, (state) => {
    if (!state) return;
    if (state.blinkRateSamples && state.blinkRateSamples.length > 0) {
      userBlinkRateSamples = state.blinkRateSamples;
    }
    if (state.interventionStyle) selectedStyle = state.interventionStyle;
    if (state.selectedMode)      selectedMode  = state.selectedMode;
  });
}

function startPanelCamera() {
  if (video) return;
  video = createCapture(VIDEO);
  video.size(340, 260);
  video.hide();
  faceMesh.detectStart(video, (r) => { faces = r || []; });
}

function calcEAR(p1,p2,p3,p4,p5,p6) {
  return (dist(p2.x,p2.y,p6.x,p6.y) + dist(p3.x,p3.y,p5.x,p5.y)) /
         (2*dist(p1.x,p1.y,p4.x,p4.y) + 0.0001);
}

function draw() {
  if (appState === "running") return;
  background(...BG);

  let ear = 0;
  if (faces.length > 0 && faces[0]?.keypoints) {
    const kp = faces[0].keypoints;
    ear = (calcEAR(kp[33],kp[160],kp[158],kp[133],kp[153],kp[144]) +
           calcEAR(kp[362],kp[385],kp[387],kp[263],kp[373],kp[380])) / 2;
  }

  switch (appState) {
    case "intro":          drawIntro();           break;
    case "open_ready":     drawReady("Step 1 · Eyes Open","Look at the screen naturally\nDon't open too wide","intro"); break;
    case "open":           drawRecording("Recording: Eyes Open",ear,...GREEN,openEAR_Array); break;
    case "open_result":    drawResult("Open Baseline",openEAR_Array,openEAR,"open_ready"); break;
    case "squeeze_ready":  drawReady("Step 2 · Squeeze Shut","Squeeze your eyes tight\nHold for 3 seconds","open_result"); break;
    case "squeeze":        drawRecording("Recording: Squeeze",ear,...RED,squeezeEAR_Array); break;
    case "squeeze_result": drawResult("Squeeze Baseline",squeezeEAR_Array,squeezeEAR,"squeeze_ready"); break;
    case "closed_ready":   drawReady("Step 3 · Gentle Close","Gently close your eyes\nHold for 3 seconds","squeeze_result"); break;
    case "closed":         drawRecording("Recording: Closed",ear,...BLUE,closedEAR_Array); break;
    case "closed_result":  drawResult("Closed Baseline",closedEAR_Array,closedEAR,"closed_ready"); break;
    case "blink_ready":    drawReady("Step 4 · Blink Rate","Blink naturally for 30s\nNothing special needed","closed_result"); break;
    case "blinkrate":      drawBlinkRate(ear); break;
    case "blink_result":   drawBlinkResult(); break;
    case "calibrated":     drawCalibrated(); break;
  }

  drawResetBtn();
}

function drawIntro() {
  fill(200); noStroke(); circle(width/2, 120, 130);
  noFill(); stroke(...BLACK); strokeWeight(2); circle(width/2, 120, 110);
  fill(...BLACK); noStroke(); ellipse(width/2, 120, 50, 34);
  fill(...BG); circle(width/2, 120, 22);
  fill(...BLACK); circle(width/2+5, 116, 8);
  noStroke();
  fill(...BLACK); textSize(30); text("Blinky", width/2, 195);
  fill(80); textSize(12); text("Biometric Eye Fatigue Intervention", width/2, 222);
  drawBlkBtn("Start Calibration", width/2, 310, 230, 46);
}

function drawReady(title, sub, prev) {
  drawBackBtn();
  fill(...BLACK); textSize(19); text(title, width/2, 90);
  fill(80); textSize(13); text(sub, width/2, 168);
  drawBlkBtn("Start Recording", width/2, 290, 175, 46);
}

function drawRecording(title, ear, r, g, b, array) {
  if (faces.length > 0 && ear > 0) array.push(ear);
  fill(...BLACK); textSize(17); text(title, width/2, 40);
  fill(r,g,b); textSize(52); text(ear.toFixed(3), width/2, 160);
  const elapsed  = millis() - stateStartTime;
  const progress = constrain(elapsed / DURATION_RECORD, 0, 1);
  noFill(); stroke(200); strokeWeight(8); circle(width/2, 160, 130);
  stroke(r,g,b); strokeCap(ROUND);
  arc(width/2, 160, 130, 130, -HALF_PI, -HALF_PI + TWO_PI*progress);
  noStroke();
  if (!faces.length) { fill(...RED); textSize(13); text("⚠️ No face detected", width/2, 270); }
  if (elapsed >= DURATION_RECORD) finishRecording();
}

function finishRecording() {
  if (appState === "open") {
    openEAR = calcAvg(openEAR_Array);
    if (openEAR <= 0) openEAR = 0.30;
    saveProgress("open_result"); appState = "open_result";
  } else if (appState === "squeeze") {
    squeezeEAR = squeezeEAR_Array.length > 0 ? Math.min(...squeezeEAR_Array) : 0.10;
    if (squeezeEAR <= 0) squeezeEAR = 0.10;
    saveProgress("squeeze_result"); appState = "squeeze_result";
  } else if (appState === "closed") {
    closedEAR = calcAvg(closedEAR_Array);
    calcThreshold(); 
    saveProgress("closed_result"); appState = "closed_result";
  }
}

function drawResult(title, array, val, retry) {
  fill(...BLACK); textSize(20); text(title + " Done", width/2, 55);
  fill(...GREEN.map(v=>v*0.7)); textSize(52); text(val.toFixed(3), width/2, 160);
  fill(array.length ? 100 : 200); textSize(12);
  text(array.length ? `Valid frames: ${array.length}` : "⚠️ Frames lost, using fallback", width/2, 225);
  drawOutlineBtn("Redo", width/2-80, 320, 130, 42);
  drawBlkBtn("Next", width/2+80, 320, 130, 42);
}

function drawBlinkRate(ear) {
  if (faces.length > 0) {
    if (ear < customThreshold && !eyeWasClosed) {
      blinkCount++; blinkTimestamps.push(millis());
      eyeWasClosed = true; blinkFlashTimer = 200;
    } else if (ear >= customThreshold) eyeWasClosed = false;
  }
  fill(...BLACK); textSize(17); text("Learning blink habit (30s)", width/2, 38);
  fill(80); textSize(12); text("Just blink naturally", width/2, 64);
  const elapsed = millis() - stateStartTime;
  const progress = constrain(elapsed / DURATION_BLINKRATE, 0, 1);
  noFill(); stroke(200); strokeWeight(8); circle(width/2, 190, 130);
  stroke(180,140,0); strokeCap(ROUND);
  arc(width/2, 190, 130, 130, -HALF_PI, -HALF_PI + TWO_PI*progress);
  noStroke();
  fill(150,100,0); textSize(38); text(ear.toFixed(3), width/2, 190);
  fill(...BLACK); textSize(14); text(`Detected: ${blinkCount}`, width/2, 278);
  
  fill(110); textSize(11);
  text(`Live EAR: ${ear.toFixed(3)}  |  Threshold: ${customThreshold.toFixed(3)}`, width/2, 345);

  if (blinkFlashTimer > 0) {
    push(); fill(255,255,255,map(blinkFlashTimer,0,200,0,140)); rect(0,0,width,height); pop();
    blinkFlashTimer -= deltaTime;
  }
  if (elapsed >= DURATION_BLINKRATE) { calcBlinkStats(); saveProgress("blink_result"); appState = "blink_result"; }
}

function drawBlinkResult() {
  fill(...BLACK); textSize(20); text("✅ Calibration Done", width/2, 45);
  if (avgBlinkInterval === -1) {
    fill(...RED); textSize(15); text("❌ No blink detected", width/2, 150);
    drawBlkBtn("Retry", width/2, 300, 175, 46);
    return;
  }
  fill(100); textSize(13); text(`Blink count: ${blinkCount}`, width/2, 100);
  fill(0,150,70); textSize(15); text(`Avg interval: ${avgBlinkInterval.toFixed(1)}s`, width/2, 140);
  fill(160,100,0); textSize(15); text(`Alert time: ${alertThreshold.toFixed(1)}s`, width/2, 175);
  drawOutlineBtn("Redo", width/2-80, 320, 130, 42);
  drawBlkBtn("Next", width/2+80, 320, 130, 42);
}

function drawCalibrated() {
  fill(...BLACK); textSize(22); text("🎉 Calibrated", width/2, 60);
  fill(0,140,60); textSize(14); text(`Threshold: ${customThreshold.toFixed(3)}`, width/2, 115);
  fill(200,30,50); textSize(14); text(`Min EAR: ${squeezeEAR.toFixed(3)}`, width/2, 145);
  fill(100); textSize(13); text(`Blink base: ${avgBlinkInterval.toFixed(1)}s`, width/2, 174);
  fill(140,90,0); textSize(13); text(`Alert time: ${alertThreshold.toFixed(1)}s`, width/2, 202);
  drawBlkBtn("Launch Blinky", width/2, 300, 210, 48);
}

function drawBlkBtn(label, x, y, w, h) {
  push(); rectMode(CENTER); fill(...BLACK); noStroke(); rect(x,y,w,h,22);
  fill(...WHITE); textSize(15); text(label,x,y); pop();
}
function drawOutlineBtn(label, x, y, w, h) {
  push(); rectMode(CENTER); noFill(); stroke(...BLACK); strokeWeight(1.5); rect(x,y,w,h,22);
  fill(...BLACK); textSize(15); text(label,x,y); pop();
}
function drawBackBtn() {
  push(); rectMode(CORNER); noFill(); stroke(...BLACK); strokeWeight(1.5); rect(12,8,72,26,6);
  fill(...BLACK); textSize(11); textAlign(CENTER,CENTER); text("← Back", 48, 21); pop();
}
function drawResetBtn() {
  push(); fill(180,180,180,200); noStroke(); circle(width-20,20,26);
  fill(...BLACK); textSize(13); textAlign(CENTER,CENTER); text("↺",width-20,21); pop();
}

function calcAvg(arr) { return arr.length === 0 ? 0.0 : arr.reduce((a,b)=>a+b,0)/arr.length; }

function calcThreshold() {
  let validClosed = (closedEAR > 0.05 && closedEAR < openEAR * 0.85) ? closedEAR : openEAR * 0.45;
  customThreshold = constrain(validClosed + (openEAR - validClosed) * 0.58, openEAR * 0.65, openEAR * 0.76);
  if (squeezeEAR <= 0 || squeezeEAR >= validClosed) squeezeEAR = validClosed * 0.65;
  squeezeEAR = Math.max(0.01, squeezeEAR);
}

function calcBlinkStats() {
  if (blinkCount === 0) { avgBlinkInterval = 5.5; alertThreshold = 8.0; return; }
  if (blinkTimestamps.length < 2) { avgBlinkInterval = 5; alertThreshold = constrain(6,4,25); return; }
  const ints = []; for (let i=1;i<blinkTimestamps.length;i++) ints.push((blinkTimestamps[i]-blinkTimestamps[i-1])/1000);
  avgBlinkInterval = constrain(ints.reduce((a,b)=>a+b)/ints.length,2,20);
  alertThreshold = constrain(avgBlinkInterval*1.2,4,25);
}

function saveProgress(step) {
  chrome.storage.local.set({ calibProgress: { step, squeezeEAR, openEAR, closedEAR, customThreshold, avgBlinkInterval, alertThreshold } });
}

function mousePressed() {
  if (appState === "running") return;
  if (dist(mouseX,mouseY,width-20,20) < 14) { doReset(); return; }

  if (appState === "intro" && hitBtn(width/2,310,230,46)) appState = "open_ready";
  else if (appState === "open_ready") {
    if (hitBack()) appState = "intro";
    if (hitBtn(width/2,290,175,46)) { openEAR_Array=[]; stateStartTime=millis(); appState="open"; }
  }
  else if (appState === "open_result") {
    if (hitBtn(width/2-80,320,130,42)) appState = "open_ready";
    if (hitBtn(width/2+80,320,130,42)) appState = "squeeze_ready";
  }
  else if (appState === "squeeze_ready") {
    if (hitBack()) appState = "open_result";
    if (hitBtn(width/2,290,175,46)) { squeezeEAR_Array=[]; stateStartTime=millis(); appState="squeeze"; }
  }
  else if (appState === "squeeze_result") {
    if (hitBtn(width/2-80,320,130,42)) appState = "squeeze_ready";
    if (hitBtn(width/2+80,320,130,42)) appState = "closed_ready";
  }
  else if (appState === "closed_ready") {
    if (hitBack()) appState = "squeeze_result";
    if (hitBtn(width/2,290,175,46)) { closedEAR_Array=[]; stateStartTime=millis(); appState="closed"; }
  }
  else if (appState === "closed_result") {
    if (hitBtn(width/2-80,320,130,42)) appState = "closed_ready";
    if (hitBtn(width/2+80,320,130,42)) appState = "blink_ready";
  }
  else if (appState === "blink_ready") {
    if (hitBack()) appState = "closed_result";
    if (hitBtn(width/2,290,175,46)) { blinkTimestamps=[]; blinkCount=0; eyeWasClosed=false; blinkFlashTimer=0; stateStartTime=millis(); appState="blinkrate"; }
  }
  else if (appState === "blink_result") {
    if (hitBtn(width/2-80,320,130,42)) appState = "blink_ready";
    if (hitBtn(width/2+80,320,130,42)) appState = "calibrated";
  }
  else if (appState === "calibrated" && hitBtn(width/2,300,210,48)) {
    chrome.storage.local.set({
      isCalibrated:true, customThreshold, avgBlinkInterval,
      alertThreshold, openEAR, closedEAR, squeezeEAR, selectedMode
    }, () => {
      chrome.storage.local.remove('calibProgress');
      if (video) { if (faceMesh?.detectStop) faceMesh.detectStop(); video.remove(); video=null; }
      chrome.runtime.sendMessage({ type:"CALIBRATION_DONE", customThreshold, avgBlinkInterval, alertThreshold, openEAR, closedEAR, squeezeEAR, selectedMode });
      transitionToRunning();
    });
  }
}

function hitBtn(x,y,w,h) { return mouseX>x-w/2 && mouseX<x+w/2 && mouseY>y-h/2 && mouseY<y+h/2; }
function hitBack() { return mouseX>12 && mouseX<84 && mouseY>8 && mouseY<34; }

function doReset() {
  chrome.storage.local.clear(() => {
    chrome.runtime.sendMessage({ type:"RESET_CALIBRATION" });
    squeezeEAR=0; openEAR=0; closedEAR=0;
    squeezeEAR_Array=[]; openEAR_Array=[]; closedEAR_Array=[];
    blinkTimestamps=[]; blinkCount=0;
    customThreshold=0.25; avgBlinkInterval=6; alertThreshold=15;
    userBlinkRateSamples=[]; rawBlinkLog=[]; lastRawBlinkCount=0;
    chartScrollOffset=0; isScrollLocked=true;
    if (video) { if (faceMesh?.detectStop) faceMesh.detectStop(); video.remove(); video=null; }
    appState="intro"; startPanelCamera();
    document.getElementById('run-view').style.display = 'none';
    document.getElementById('cal-wrap').style.display = 'block'; 
    const cnvEl = document.querySelector('#cal-wrap canvas');
    if (cnvEl) cnvEl.style.display = 'block';
  });
}

function transitionToRunning() {
  appState = "running";
  document.getElementById('cal-wrap').style.display = 'none';
  const cnvEl = document.querySelector('#cal-wrap canvas');
  if (cnvEl) cnvEl.style.display = 'none';
  const runView = document.getElementById('run-view');
  runView.style.display = 'block';
  initTabUI();
  initRunningButtons();
  updateRunningView();
  startChartLoop();
}

const TAB_DEFS = {
  focus:     { left: 0,   width: 94  },
  customize: { left: 94,  width: 142 },
  data:      { left: 236, width: 83  }
};
let activeTab = "focus";

function initTabUI() {
  const btns = document.querySelectorAll('.t-btn');
  btns.forEach(btn => { btn.addEventListener('click', () => { setActiveTab(btn.dataset.tab); }); });
  setActiveTab("focus");
}

function setActiveTab(tab) {
  activeTab = tab;
  const pill = document.getElementById('t-pill');
  pill.style.left  = TAB_DEFS[tab].left  + 'px';
  pill.style.width = TAB_DEFS[tab].width + 'px';
  document.querySelectorAll('.t-btn').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); });
  ['focus','customize','data'].forEach(t => { document.getElementById('tab-'+t).style.display = (t === tab) ? 'block' : 'none'; });
}

function initRunningButtons() {
  document.getElementById('m-acc').addEventListener('click', () => selectMode('accumulation'));
  document.getElementById('m-inst').addEventListener('click', () => selectMode('instant'));
  ['vignette','confetti','ring','blur'].forEach(eff => { document.getElementById('e-'+eff).addEventListener('click', () => selectEffect(eff)); });
  document.getElementById('exp-btn').addEventListener('click', exportData);
  document.getElementById('btn-clear').addEventListener('click', () => {
    chrome.storage.local.clear(() => {
      chrome.runtime.sendMessage({ type:"RESET_CALIBRATION" });
      userBlinkRateSamples=[]; rawBlinkLog=[]; lastRawBlinkCount=0;
      timeSeriesLog=[]; lastTimeSeriesSec=-1; liveEventLog=[];
      liveDeepBlinks=0; liveNormalBlinks=0;
      chartScrollOffset=0; isScrollLocked=true;
      const cnvEl = document.querySelector('#cal-wrap canvas');
      if (cnvEl) { cnvEl.style.display='block'; }
      document.getElementById('cal-wrap').style.display = 'block';
      appState="intro"; startPanelCamera();
    });
  });
  document.getElementById('btn-restart').addEventListener('click', () => { 
    chrome.runtime.sendMessage({ type:"RESTART_SESSION" }); 
  });

  const track = document.getElementById('chart-scroll-track');
  if (track) {
    track.addEventListener('mousedown', (e) => {
      isScrollDragging      = true;
      scrollDragStartX      = e.clientX;
      scrollDragStartOffset = chartScrollOffset;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isScrollDragging) return;
      const totalMins  = Math.max(5, liveModeTime / 60);
      const trackWidth = track.clientWidth || 319;
      const minsPerPx  = totalMins / trackWidth;
      chartScrollOffset = Math.min(0,
        Math.max(-(totalMins - 5),
          scrollDragStartOffset + (e.clientX - scrollDragStartX) * minsPerPx
        )
      );
      isScrollLocked = chartScrollOffset >= -0.1;
    });
    document.addEventListener('mouseup', () => {
      if (!isScrollDragging) return;
      isScrollDragging = false;
      if (chartScrollOffset >= -0.1) {
        chartScrollOffset = 0;
        isScrollLocked    = true;
      }
    });
    track.addEventListener('dblclick', () => {
      chartScrollOffset = 0;
      isScrollLocked    = true;
    });
  }
}

function selectMode(mode) {
  selectedMode = mode;
  document.getElementById('m-acc').className  = 'mode-btn ' + (mode==='accumulation' ? 'on' : 'off');
  document.getElementById('m-inst').className = 'mode-btn ' + (mode==='instant'      ? 'on' : 'off');
  chrome.runtime.sendMessage({ type:"STYLE_MODE_UPDATE", mode });
}

function selectEffect(eff) {
  selectedStyle = eff;
  ['vignette','confetti','ring','blur'].forEach(e => { document.getElementById('e-'+e).className = 'eff-btn ' + (e===eff ? 'on' : 'off'); });
  chrome.runtime.sendMessage({ type:"STYLE_UPDATE", style: eff });
}

function exportData() {
  const baselineRate = (60 / Math.max(avgBlinkInterval, 0.1)).toFixed(2);
  let csv = "";

  // ── Metadata（方便测试对账：模式/基线/导出时间）──
  csv += "Blinky Session Export (Story B: tear-film debt model)\n";
  csv += `Mode,${liveActiveMode}\n`;
  csv += `Baseline_Blink_Rate_Per_Min,${baselineRate}\n`;
  csv += `Session_Length_Sec,${liveModeTime.toFixed(1)}\n`;
  csv += `Total_Blinks,${liveBlinkCount}  (deep=${liveDeepBlinks}, normal=${liveNormalBlinks})\n`;
  csv += `Export_Time,${new Date().toISOString()}\n`;
  csv += "\n";

  // ── Section 1：时间序列（每秒真实 debt/saturation/眨眼率）──
  csv += "Section 1: Time Series (per second)\n";
  csv += "Time_Sec,Debt,Saturation,TimeWithoutBlink_Sec,Inst_Blink_Rate,Baseline_Rate\n";
  timeSeriesLog.forEach(r => {
    csv += `${r.t.toFixed(1)},${r.debt.toFixed(1)},${r.sat.toFixed(0)},${r.twb.toFixed(1)},${r.rate.toFixed(1)},${r.base.toFixed(1)}\n`;
  });

  // ── Section 2：眨眼事件（区分深眨/浅眨 + 还债前后）──
  csv += "\nSection 2: Blink Events\n";
  csv += "Time_Sec,Blink_Type,RW_Depth,Debt_Before,Debt_After\n";
  (liveEventLog || []).forEach(e => {
    if (e.type === "deep_blink" || e.type === "normal_blink") {
      const type = e.type === "deep_blink" ? "deep" : "normal";
      csv += `${e.t.toFixed(1)},${type},${(e.rw||0).toFixed(2)},${e.debtBefore.toFixed(1)},${e.debtAfter.toFixed(1)}\n`;
    }
  });

  // ── Section 3：干预事件（提醒脉冲 / 响应延迟）──
  csv += "\nSection 3: Intervention Events\n";
  csv += "Time_Sec,Event,Debt_At_Event,Response_Latency_Sec\n";
  (liveEventLog || []).forEach(e => {
    if (e.type === "alert_pulse") {
      csv += `${e.t.toFixed(1)},alert_pulse,${e.debtBefore.toFixed(1)},-\n`;
    } else if (e.type === "deep_blink" && e.responseLatency >= 0) {
      csv += `${e.t.toFixed(1)},deep_blink_response,${e.debtBefore.toFixed(1)},${e.responseLatency.toFixed(1)}\n`;
    }
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const dateStr = new Date().toISOString().slice(0,10);
  link.setAttribute("download", `blinky_${liveActiveMode}_${Math.round(liveModeTime)}s_${dateStr}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function updateRunningView() {
  const mm = Math.floor(liveModeTime/60), ss = Math.floor(liveModeTime%60);
  const timerEl = document.getElementById('timer-disp');
  if (timerEl) timerEl.textContent = String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0');

  const baseRate = 60 / Math.max(avgBlinkInterval, 0.1);
  const currRate = liveModeTime > 10 ? liveBlinkCount / (liveModeTime/60) : baseRate;
  const pct = Math.max(0, Math.round((1 - currRate/baseRate) * 100));

  let statusCls, statusTxt;
  if      (liveDebt < 30) { statusCls = 'status-good';   statusTxt = 'Good'; }
  else if (liveDebt < 60) { statusCls = 'status-mid';    statusTxt = 'Fair'; }
  else if (liveDebt < 80) { statusCls = 'status-warn';   statusTxt = 'Warning'; }
  else                    { statusCls = 'status-danger'; statusTxt = 'Danger'; }

  const briefEl = document.getElementById('brief-stats');
  if (briefEl) briefEl.innerHTML = `Blink Rate: ${pct}% below normal<br><span class="${statusCls}">Status: ${statusTxt}</span>`;

  // cam-cvs 由 drawCamCanvas() 每帧绘制；brief-cvs 由 drawBriefCanvas() 绘制

  if (liveBlinkCount > lastRawBlinkCount) {
    const wt = panelStartWallClock ? (Date.now() - panelStartWallClock)/1000 : 0;
    rawBlinkLog.push({ t: liveModeTime, wt: wt, blinkCount: liveBlinkCount });
    lastRawBlinkCount = liveBlinkCount;
  }

  // 故事B：每过1秒记录一次真实历史（debt/saturation），供 CSV Section1。
  // 用 panel 自己的墙钟时间(panelWallClock)作为记录时间轴，不依赖 detector 的
  // modeTime——后者在切标签页时会跳变，曾导致历史被误清空。墙钟单调递增，永不丢历史。
  if (panelStartWallClock === 0) panelStartWallClock = Date.now();
  const wallSec = (Date.now() - panelStartWallClock) / 1000;
  const nowSec = Math.floor(wallSec);
  if (nowSec !== lastTimeSeriesSec && wallSec > 0) {
    lastTimeSeriesSec = nowSec;
    const baseRate = 60 / Math.max(avgBlinkInterval, 0.1);
    // 瞬时眨眼率：用最近60秒窗口内的眨眼数（从 rawBlinkLog 数），不是累计平均
    let instRate = 0;
    if (rawBlinkLog.length >= 2) {
      const windowStart = Math.max(0, wallSec - 60);
      const inWindow = rawBlinkLog.filter(b => b.wt >= windowStart);
      const span = Math.max(wallSec - windowStart, 1) / 60; // 分钟
      instRate = inWindow.length / span;
      if (instRate > 100) instRate = 0; // 防御：异常值丢弃
    }
    timeSeriesLog.push({
      t: wallSec,
      debt: liveDebt,
      sat: liveSat,
      twb: liveTWB,
      rate: instRate,
      base: baseRate
    });
    if (timeSeriesLog.length > 5000) timeSeriesLog.shift();
  }

  let currentMins = liveModeTime / 60;

  if (userBlinkRateSamples.length === 0 && liveModeTime > 2) {
    userBlinkRateSamples.push({ t: currentMins, rate: 12, cumulativeBlinks: liveBlinkCount });
    chrome.runtime.sendMessage({ type:"SAVE_BLINK_SAMPLES", blinkRateSamples: userBlinkRateSamples });
    
  } else if (userBlinkRateSamples.length > 0) {
    let lastP = userBlinkRateSamples[userBlinkRateSamples.length - 1];
    let elapsedSeconds = (currentMins - lastP.t) * 60;
    
    if (elapsedSeconds >= 30) {
      let targetMins = currentMins - 1.0; 
      let pastSample = userBlinkRateSamples[0];
      for (let i = userBlinkRateSamples.length - 1; i >= 0; i--) {
        if (userBlinkRateSamples[i].t <= targetMins) {
          pastSample = userBlinkRateSamples[i];
          break;
        }
      }
      
      let pastBlinks = pastSample ? (pastSample.cumulativeBlinks || 0) : 0;
      let windowBlinks = liveBlinkCount - pastBlinks;
      let ratePerMin = windowBlinks;
      
      let timeWindow = currentMins - (pastSample ? pastSample.t : 0);
      if (timeWindow > 0 && timeWindow < 0.9) {
        ratePerMin = windowBlinks / timeWindow;
      }

      userBlinkRateSamples.push({ t: currentMins, rate: ratePerMin, cumulativeBlinks: liveBlinkCount });
      if (userBlinkRateSamples.length > 360) userBlinkRateSamples.shift();
      
      chrome.runtime.sendMessage({ type:"SAVE_BLINK_SAMPLES", blinkRateSamples: userBlinkRateSamples });
    }
  }
}

// ════════════════════════════════════════════════════════════
// 共享：弹簧物理 + 区间颜色
// ════════════════════════════════════════════════════════════
function updateSpring() {
  springVel  = springVel * 0.65 + (liveEAR - springEAR) * 0.20;
  springEAR += springVel;
  springEAR  = Math.max(0, springEAR);
  twinklePhase += 0.08;
}

function earZone() {
  // 返回 {eyeColor, glow} 由 EAR 区间决定（轻眨/重眨颜色不同）
  const thr   = customThreshold || 0.25;
  const sqEAR = squeezeEAR      || 0.05;
  if (springEAR > thr)   return { c:'#00ffaa', g:'rgba(0,255,170,0.4)' };
  if (springEAR > sqEAR) return { c:'#ffcc00', g:'rgba(255,204,0,0.4)' };
  return { c:'#ff4040', g:'rgba(255,64,64,0.5)' };
}

function statusByDebt() {
  // 由 debt 决定情绪状态
  if (liveDebt < 30) return { key:'good',   iris:'#00ffaa', stars:true,  bloodshot:0   };
  if (liveDebt < 60) return { key:'mid',    iris:'#ffcc00', stars:false, bloodshot:0.2 };
  if (liveDebt < 80) return { key:'warn',   iris:'#ff7700', stars:false, bloodshot:0.55 };
  return                    { key:'danger', iris:'#ff3344', stars:false, bloodshot:1.0 };
}

// ════════════════════════════════════════════════════════════
// FOCUS 页简报画布：弹性眼睛 + 情绪状态 + 血丝 + 星星
// ════════════════════════════════════════════════════════════
function drawBriefCanvas() {
  const el = document.getElementById('brief-cvs');
  if (!el) return;
  el.width  = el.offsetWidth  || 319;
  el.height = el.offsetHeight || 188;
  const ctx = el.getContext('2d');
  const W = el.width, H = el.height;
  ctx.clearRect(0, 0, W, H);

  const st   = statusByDebt();
  const zone = earZone();
  const cx = W / 2, cy = H * 0.50;

  const refO  = openEAR || 0.35;
  const ratio = Math.min(1, Math.max(0, springEAR / (refO * 0.95)));

  // ── 状态光环 ──
  const haloR = 62;
  ctx.save();
  ctx.shadowColor = zone.g; ctx.shadowBlur = 28;
  ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI*2);
  ctx.strokeStyle = st.iris; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();

  // ── 良好状态：四角星闪烁 ──
  if (st.stars) {
    const starPos = [[-1,-0.75],[1,-0.75],[-1.15,0.35],[1.15,0.35],[0,-1.15]];
    starPos.forEach((p, i) => {
      const tw = 0.5 + 0.5 * Math.sin(twinklePhase + i * 1.3);
      drawStar(ctx, cx + p[0]*haloR, cy + p[1]*haloR, 4 + tw*4, st.iris, tw);
    });
  }

  // ── 眼睛 ──
  const eW = 92, maxEH = 46;
  const eH = Math.max(0, maxEH * ratio);

  if (eH > 1.5) {
    // 眼白
    ctx.save();
    ctx.shadowColor = zone.g; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.ellipse(cx, cy, eW/2, eH/2, 0, 0, Math.PI*2);
    ctx.fillStyle = (st.key==='danger') ? '#e8d5d0' : '#f4f4f4';
    ctx.fill(); ctx.restore();

    // 血丝（写实红线，从眼角向中心延伸）
    if (st.bloodshot > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(220,30,30,${st.bloodshot})`;
      ctx.lineWidth = 0.8;
      const veins = Math.round(st.bloodshot * 6);
      for (let i = 0; i < veins; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const sy = cy + (Math.random()-0.5) * eH * 0.5;
        const ex = cx + side * eW * 0.18;
        ctx.beginPath();
        ctx.moveTo(cx + side*eW*0.48, sy);
        ctx.lineTo(ex + (Math.random()-0.5)*8, cy + (Math.random()-0.5)*eH*0.4);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 虹膜（颜色由 debt 决定）
    const ir = Math.min(eH*0.46, eW*0.20);
    ctx.save();
    ctx.shadowColor = zone.g; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI*2);
    ctx.fillStyle = st.iris; ctx.fill(); ctx.restore();
    // 瞳孔
    ctx.beginPath(); ctx.arc(cx, cy, ir*0.42, 0, Math.PI*2);
    ctx.fillStyle = '#111'; ctx.fill();
    // 高光
    ctx.beginPath(); ctx.arc(cx-ir*0.3, cy-ir*0.3, ir*0.2, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
  }

  // 眼睑遮罩（上下黑色，眨眼时合拢）
  const close = (1 - ratio) * (maxEH/2 + 6);
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - eW, cy - maxEH/2 - 30, eW*2, close + 30);
  ctx.fillRect(cx - eW, cy + maxEH/2 - close, eW*2, maxEH + 30);

  // ── 底部弹力条（轻眨/重眨可视化）──
  const barW = 120, barH = 6;
  const barX = cx - barW/2, barY = H - 18;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, barX, barY, barW, barH, 3); ctx.fill();
  const fillW = barW * ratio;
  ctx.fillStyle = zone.c;
  roundRect(ctx, barX, barY, fillW, barH, 3); ctx.fill();
  // 弹力小球
  ctx.save();
  ctx.shadowColor = zone.g; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(barX + fillW, barY + barH/2, 5, 0, Math.PI*2);
  ctx.fillStyle = zone.c; ctx.fill(); ctx.restore();
}

function drawStar(ctx, x, y, r, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI/2) * i - Math.PI/2;
    ctx.lineTo(x + Math.cos(a)*r, y + Math.sin(a)*r);
    ctx.lineTo(x + Math.cos(a + Math.PI/4)*r*0.36, y + Math.sin(a + Math.PI/4)*r*0.36);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x+r, y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// ════════════════════════════════════════════════════════════
// DATA 页相机画布：弹性眼睛 + 弹力条 + 数据
// ════════════════════════════════════════════════════════════
function drawCamCanvas() {
  const el = document.getElementById('cam-cvs');
  if (!el) return;
  el.width  = el.offsetWidth  || 319;
  el.height = el.offsetHeight || 189;
  const ctx = el.getContext('2d');
  const W = el.width, H = el.height;
  ctx.clearRect(0, 0, W, H);

  const zone = earZone();
  const refO = openEAR || 0.35;
  const cx = W * 0.30, cy = H * 0.44;
  const eW = W * 0.38, maxEH = eW * 0.42;
  const ratio = Math.min(1, Math.max(0, springEAR / (refO * 0.95)));
  const eH = Math.max(0, maxEH * ratio);

  if (eH > 1.5) {
    ctx.save(); ctx.shadowColor = zone.g; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.ellipse(cx, cy, eW/2, eH/2, 0, 0, Math.PI*2);
    ctx.fillStyle = '#f0f0f0'; ctx.fill(); ctx.restore();
    const ir = Math.min(eH*0.44, eW*0.22);
    ctx.save(); ctx.shadowColor = zone.g; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI*2);
    ctx.fillStyle = zone.c; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, ir*0.44, 0, Math.PI*2);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx-ir*0.25, cy-ir*0.28, ir*0.18, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fill();
  }
  const closeGap = (1 - ratio) * (eH + 4);
  ctx.fillStyle = '#000';
  ctx.fillRect(cx-eW/2-6, 0, eW+12, cy-eH/2+closeGap*0.55);
  ctx.fillRect(cx-eW/2-6, cy+eH/2-closeGap*0.55, eW+12, H);
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='10px monospace'; ctx.textAlign='center';
  ctx.fillText('EAR '+liveEAR.toFixed(3), cx, H-8);

  // 右侧弹力条
  const bx=W*0.68, bw=14, bTop=H*0.06, bBot=H*0.74, bH=bBot-bTop;
  const thr=customThreshold||0.25, sqEAR=squeezeEAR||0.05;
  ctx.fillStyle='rgba(255,255,255,0.06)';
  roundRect(ctx, bx-bw/2, bTop, bw, bH, 7); ctx.fill();
  const thY=bBot-Math.min(1,thr/(refO*1.05))*bH;
  const sqY=bBot-Math.min(1,sqEAR/(refO*1.05))*bH;
  ctx.lineWidth=1; ctx.setLineDash([3,3]);
  [[thY,'rgba(0,255,170,0.4)'],[sqY,'rgba(255,64,64,0.4)']].forEach(([y,c])=>{
    ctx.strokeStyle=c; ctx.beginPath(); ctx.moveTo(bx-bw-4,y); ctx.lineTo(bx+bw+4,y); ctx.stroke();
  });
  ctx.setLineDash([]);
  const fillH=Math.max(3,Math.min(bH,(springEAR/(refO*1.05))*bH));
  const grad=ctx.createLinearGradient(0,bBot-fillH,0,bBot);
  grad.addColorStop(0,zone.c); grad.addColorStop(1,zone.c+'22');
  ctx.save(); ctx.shadowColor=zone.g; ctx.shadowBlur=8; ctx.fillStyle=grad;
  roundRect(ctx, bx-bw/2, bBot-fillH, bw, fillH, 7); ctx.fill(); ctx.restore();
  ctx.save(); ctx.shadowColor=zone.g; ctx.shadowBlur=18;
  ctx.beginPath(); ctx.arc(bx, bBot-fillH, 6.5, 0, Math.PI*2);
  ctx.fillStyle=zone.c; ctx.fill(); ctx.restore();

  // 数据
  const sx=bx+bw+10; let sy=bTop;
  [['TWB',liveTWB.toFixed(1)+'s'],['D',liveDebt.toFixed(0)],
   ['B',String(liveBlinkCount)],['Sat',liveSat.toFixed(0)+'%']
  ].forEach(([k,v])=>{
    ctx.font='9px monospace'; ctx.textAlign='left';
    ctx.fillStyle='rgba(255,255,255,0.32)'; ctx.fillText(k,sx,sy+10);
    ctx.fillStyle=zone.c; ctx.fillText(v,sx+24,sy+10);
    sy+=16;
  });
}

function startChartLoop() {
  if (chartAnimId) cancelAnimationFrame(chartAnimId);
  const loop = () => { updateSpring(); drawBriefCanvas(); drawCamCanvas(); drawChart(); chartAnimId = requestAnimationFrame(loop); };
  chartAnimId = requestAnimationFrame(loop);
}

function drawChart() {
  const el = document.getElementById('chart-cvs');
  if (!el) return;
  const box = el.parentElement;
  el.width  = box.clientWidth  || 319; el.height = box.clientHeight || 170;
  const ctx = el.getContext('2d');
  const W = el.width, H = el.height, PAD = { l:28, r:10, t:30, b:16 };
  const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;

  ctx.clearRect(0,0,W,H);

  let currentMins = liveModeTime / 60;
  const viewSpan  = 5;
  const latestR   = Math.max(viewSpan, currentMins + 0.3);
  const anchorRight = isScrollLocked
    ? latestR
    : Math.max(viewSpan, latestR + chartScrollOffset);
  const minM = anchorRight - viewSpan;
  const maxM = anchorRight;

  const tX = (t) => PAD.l + ((t - minM) / viewSpan) * cW;
  const rY = (r) => PAD.t + (1 - r / 18) * cH;

  ctx.save();
  ctx.beginPath(); ctx.rect(PAD.l, 0, cW, H); ctx.clip();

  ctx.beginPath(); ctx.strokeStyle='#00c864'; ctx.lineWidth=1.5;
  for (let i = 0; i <= Math.ceil(Math.max(15, maxM) * 10); i++) {
    const t = i * 0.1;
    const r = 6 + 11 * Math.exp(-t / 8);
    if (t >= minM - 1 && t <= maxM + 1) {
        if (t < minM) ctx.moveTo(tX(t), rY(r));
        else ctx.lineTo(tX(t), rY(r));
    }
  }
  ctx.stroke();

  if (userBlinkRateSamples.length > 0) {
    let smoothedSamples = [];
    for (let i = 0; i < userBlinkRateSamples.length; i++) {
      let prev = i > 0 ? userBlinkRateSamples[i-1].rate : userBlinkRateSamples[i].rate;
      let next = i < userBlinkRateSamples.length - 1 ? userBlinkRateSamples[i+1].rate : userBlinkRateSamples[i].rate;
      let smoothedRate = (prev + userBlinkRateSamples[i].rate + next) / 3;
      smoothedSamples.push({ t: userBlinkRateSamples[i].t, rate: smoothedRate });
    }

    ctx.beginPath(); ctx.strokeStyle='#3a8aff'; ctx.lineWidth=1.5;
    smoothedSamples.forEach((p, i) => {
      const x = tX(p.t); 
      const y = rY(Math.max(0, Math.min(18, p.rate)));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    
    const lastP = smoothedSamples[smoothedSamples.length - 1];
    if (currentMins > lastP.t && (currentMins - lastP.t) < 0.5) {
      ctx.lineTo(tX(currentMins), rY(Math.max(0, Math.min(18, lastP.rate))));
    }
    ctx.stroke();
  }
  ctx.restore(); 

  const dy = rY(7);
  ctx.beginPath(); ctx.strokeStyle='#e03040'; ctx.lineWidth=1; ctx.setLineDash([3,3]);
  ctx.moveTo(PAD.l,dy); ctx.lineTo(W-PAD.r,dy); ctx.stroke(); ctx.setLineDash([]);

  const cx = tX(currentMins);
  if (cx >= PAD.l && cx <= W - PAD.r) {
    ctx.beginPath(); ctx.strokeStyle='#f0c000'; ctx.lineWidth=1.5;
    ctx.moveTo(cx, PAD.t); ctx.lineTo(cx, PAD.t+cH); ctx.stroke();
  }

  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='9px monospace'; ctx.textAlign='center';
  let firstTick = Math.ceil(minM / 5) * 5;
  for (let m = firstTick; m <= maxM; m += 5) {
    let x = tX(m);
    if (x >= PAD.l && x <= W - PAD.r) {
      ctx.fillText(m + 'm', x, H - 3);
    }
  }
  
  ctx.textAlign='right'; ctx.fillText('7/m', PAD.l-2, dy+3);
  ctx.fillStyle='#00c864'; ctx.fillRect(PAD.l,8,12,3);
  ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='8px monospace'; ctx.textAlign='left'; ctx.fillText('baseline',PAD.l+15,11);
  ctx.fillStyle='#3a8aff'; ctx.fillRect(PAD.l+70,8,12,3);
  ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillText('you (trend)',PAD.l+85,11);

  const totalMins = Math.max(viewSpan, currentMins);
  const trackEl   = document.getElementById('chart-scroll-track');
  const thumbEl   = document.getElementById('chart-scroll-thumb');
  if (trackEl && thumbEl) {
    const trackW  = trackEl.clientWidth || 319;
    const thumbW  = Math.max(24, (viewSpan / totalMins) * trackW);
    const thumbL  = isScrollLocked
      ? trackW - thumbW
      : Math.max(0, Math.min(trackW - thumbW, (minM / totalMins) * trackW));
    thumbEl.style.width = thumbW + 'px';
    thumbEl.style.left  = thumbL + 'px';
  }
}

function gotFaces(r) { faces = r || []; }