// ================================================================
// content.js  —  Blinky 网页注入层
// 负责：1. 注入悬浮窗  2. 注入检测 iframe  3. 视觉干预
// ================================================================

let lastSaturation = 100;

function initBlinky() {
  if (!document.body) { setTimeout(initBlinky, 100); return; }

  const detectorFrame = document.createElement('iframe');
  detectorFrame.src = chrome.runtime.getURL('detector.html');
  detectorFrame.style.cssText = `
    position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;
    border:none;z-index:2147483646;pointer-events:none;
  `;
  detectorFrame.allow = "camera";

  const overlay = document.createElement('div');
  overlay.id = 'blinky-overlay';
  overlay.style.cssText = `
    position:fixed;top:0;left:0;width:100vw;height:100vh;
    pointer-events:none;z-index:2147483640;
    transition:background 0.3s,backdrop-filter 0.3s;
  `;

  const focusRing = document.createElement('div');
  focusRing.id = 'blinky-focus-ring';
  focusRing.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    border-radius:50%;border:5px solid #00ffaa;
    pointer-events:none;z-index:2147483641;display:none;
    transition:width 0.3s,height 0.3s,border-color 0.3s;box-sizing:border-box;
  `;

  const centralPrompt = document.createElement('div');
  centralPrompt.id = 'xinliu-central-prompt';
  centralPrompt.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    z-index:2147483642;pointer-events:none;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    font-size:15px;font-weight:bold;color:#00ffaa;text-align:center;
    background:rgba(15,15,35,0.88);padding:12px 22px;border-radius:24px;
    border:1px solid rgba(0,255,170,0.35);display:none;
    text-shadow:0 1px 8px rgba(0,0,0,0.8);transition:opacity 0.3s;
  `;

  const PANEL_W_COLLAPSED = 230, PANEL_W_EXPANDED = 361;
  const PANEL_H_TITLEBAR  = 36,  PANEL_H_CONTENT  = 620;
  const PANEL_H_COLLAPSED = PANEL_H_TITLEBAR;
  const PANEL_H_EXPANDED  = PANEL_H_TITLEBAR + PANEL_H_CONTENT;
  let isExpanded = false;

  const container = document.createElement('div');
  container.id = 'xinliu-container';
  container.style.cssText = `
    position:fixed;top:12px;right:12px;
    width:${PANEL_W_COLLAPSED}px;height:${PANEL_H_COLLAPSED}px;
    z-index:2147483647;border-radius:12px;overflow:hidden;
    box-shadow:0 4px 20px rgba(0,0,0,0.18);
    transition:height 0.3s cubic-bezier(0.25,0.8,0.25,1),
               width  0.3s cubic-bezier(0.25,0.8,0.25,1);
  `;

  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    width:100%;height:${PANEL_H_TITLEBAR}px;
    background:#e7e7e7;
    border-bottom:1px solid rgba(0,0,0,0.12);
    display:flex;align-items:center;justify-content:space-between;
    padding:0 14px;box-sizing:border-box;cursor:grab;user-select:none;
  `;
  titleBar.innerHTML = `
    <span id="blinky-title-label" style="color:#000;font-size:13px;font-weight:bold;letter-spacing:0.5px;
      font-family:'Nico Moji','Courier New',monospace;transition:color 0.3s;">
      👁 Blinky
    </span>
    <button id="xinliu-toggle" style="background:none;border:1.5px solid #000;
      color:#000;border-radius:6px;width:22px;height:22px;cursor:pointer;
      font-size:14px;display:flex;align-items:center;justify-content:center;
      line-height:1;">
      −
    </button>
  `;
  const toggleBtn = titleBar.querySelector('#xinliu-toggle');

  const panelIframe = document.createElement('iframe');
  panelIframe.src = chrome.runtime.getURL('panel.html');
  panelIframe.style.cssText = `
    width:100%;height:0px;border:none;display:block;
    background:#e7e7e7;visibility:hidden;pointer-events:none;
  `;
  panelIframe.allow = "camera";

  container.appendChild(titleBar);
  container.appendChild(panelIframe);
  document.body.appendChild(detectorFrame);
  document.body.appendChild(overlay);
  document.body.appendChild(focusRing);
  document.body.appendChild(centralPrompt);
  document.body.appendChild(container);

  function applyExpanded(expand) {
    isExpanded = expand;
    if (expand) {
      container.style.width = PANEL_W_EXPANDED + 'px';
      container.style.height = PANEL_H_EXPANDED + 'px';
      panelIframe.style.visibility = 'visible';
      panelIframe.style.height = PANEL_H_CONTENT + 'px';
      panelIframe.style.pointerEvents = 'auto';
      toggleBtn.textContent = '−'; toggleBtn.style.color = '#000';
    } else {
      container.style.width = PANEL_W_COLLAPSED + 'px';
      container.style.height = PANEL_H_COLLAPSED + 'px';
      panelIframe.style.visibility = 'hidden';
      panelIframe.style.height = '0px';
      panelIframe.style.pointerEvents = 'none';
      toggleBtn.textContent = '+'; toggleBtn.style.color = '#000';
    }
  }

  toggleBtn.addEventListener('click', () => {
    applyExpanded(!isExpanded);
    chrome.runtime.sendMessage({ type:"UI_STATE_CHANGE", isExpanded });
  });

  chrome.runtime.sendMessage({ type:"REQUEST_GLOBAL_STATE" }, (state) => {
    if (!state) return;
    applyExpanded(state.isExpanded || false);
    const l = parseInt(state.panelLeft), t = parseInt(state.panelTop);
    if (!isNaN(l) && !isNaN(t) &&
        l >= 0 && l <= window.innerWidth - 50 &&
        t >= 0 && t <= window.innerHeight - 30) {
      container.style.right = 'auto';
      container.style.left = l + 'px';
      container.style.top  = t + 'px';
    }
  });

  let isDragging = false, dOffX = 0, dOffY = 0;
  titleBar.addEventListener('mousedown', (e) => {
    if (e.target.id === 'xinliu-toggle') return;
    isDragging = true;
    dOffX = e.clientX - container.getBoundingClientRect().left;
    dOffY = e.clientY - container.getBoundingClientRect().top;
    titleBar.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const nl = Math.max(0, Math.min(e.clientX - dOffX, window.innerWidth  - container.offsetWidth));
    const nt = Math.max(0, Math.min(e.clientY - dOffY, window.innerHeight - container.offsetHeight));
    container.style.right = 'auto';
    container.style.left = nl + 'px';
    container.style.top  = nt + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false; titleBar.style.cursor = 'grab';
    const r = container.getBoundingClientRect();
    chrome.runtime.sendMessage({ type:"UI_STATE_CHANGE",
      panelLeft: Math.round(r.left), panelTop: Math.round(r.top) });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "GLOBAL_STATE_SYNC" || !msg.state) return;
    const state = msg.state;
    if (!isDragging) {
      const l = parseInt(state.panelLeft), t = parseInt(state.panelTop);
      if (!isNaN(l) && !isNaN(t) &&
          l >= 0 && l <= window.innerWidth - 50 &&
          t >= 0 && t <= window.innerHeight - 30) {
        container.style.right = 'auto';
        container.style.left = l + 'px';
        container.style.top  = t + 'px';
      }
    }
    if (state.isExpanded !== undefined && state.isExpanded !== isExpanded) {
      applyExpanded(state.isExpanded);
    }
    applyIntervention(state, overlay, focusRing, centralPrompt);
    updateTitleAlert(state);  // 故事B：折叠态 titleBar 提醒
  });

  document.addEventListener('visibilitychange', () => {
    overlay.style.background = 'none';
    overlay.style.backdropFilter = 'none';
    focusRing.style.display = 'none';
    centralPrompt.style.display = 'none';
    lastSaturation = 100;
  });
}

// ================================================================
// Part 2：视觉干预
// ================================================================
function applyIntervention(state, overlay, focusRing, centralPrompt) {
  const style = state.interventionStyle || "vignette";
  const sat   = state.saturation != null ? state.saturation : 100;

  overlay.style.background      = 'none';
  overlay.style.backgroundColor = 'transparent';
  overlay.style.backdropFilter  = 'none';
  focusRing.style.display       = 'none';
  centralPrompt.style.display   = 'none';

  if (style === "vignette") {
    const alpha = (100 - sat) / 100 * 0.88;
    overlay.style.background =
      `radial-gradient(circle,transparent 35%,rgba(0,0,0,${alpha}) 88%)`;
  }
  else if (style === "blackout") {
    overlay.style.backgroundColor = `rgba(0,0,0,${(100-sat)/100*0.95})`;
  }
  else if (style === "ring") {
    const t    = (100 - sat) / 100;
    const size = Math.floor(60 + 140 * t);
    const hue  = 140 + 210 * t;
    focusRing.style.width       = size + 'px';
    focusRing.style.height      = size + 'px';
    focusRing.style.borderColor = `hsl(${hue},100%,50%)`;
    focusRing.style.display     = 'block';
  }
  else if (style === "blur") {
    overlay.style.backdropFilter = `blur(${(100-sat)/100*12}px)`;
  }
  else if (style === "confetti") {
    if (lastSaturation < 95 && sat >= 95) triggerConfetti();
  }

  if ((style === "vignette" || style === "blackout") && sat < 88) {
    centralPrompt.style.display = 'block';
    centralPrompt.textContent = state.squeezeLeft > 0
      ? `Squeeze Eyes: ${state.squeezeLeft} Left`
      : "Blink Deeply to Repay Debt";
  }

  lastSaturation = sat;
}

// 故事B：折叠态 titleBar 提醒 —— debt 高于阈值时显示 "Blink hard 💧"，褐色闪动
// 注意：只改 titleBar 文字与颜色，不动任何布局/尺寸
function updateTitleAlert(state) {
  const label = document.getElementById('blinky-title-label');
  if (!label) return;

  // 注入闪动动画（只注入一次）
  if (!document.getElementById('blinky-title-css')) {
    const s = document.createElement('style');
    s.id = 'blinky-title-css';
    s.textContent = `
      @keyframes blinky-title-pulse {
        0%,100% { color:#8a5a2b; opacity:0.65; }
        50%     { color:#c97b34; opacity:1; }
      }
      .blinky-title-alert {
        animation: blinky-title-pulse 1s ease-in-out infinite;
      }
    `;
    document.head.appendChild(s);
  }

  if (state.debtHigh) {
    // 债务高 → 提示用力眨眼（不改布局，只换文字 + 褐色闪动）
    if (label.textContent.trim() !== '👁 Blink hard 💧') {
      label.textContent = '👁 Blink hard 💧';
    }
    label.classList.add('blinky-title-alert');
  } else {
    // 恢复正常
    if (label.textContent.trim() !== '👁 Blinky') {
      label.textContent = '👁 Blinky';
    }
    label.classList.remove('blinky-title-alert');
    label.style.color = '#000';
  }
}

function triggerConfetti() {
  if (!document.getElementById('blinky-confetti-css')) {
    const s = document.createElement('style');
    s.id = 'blinky-confetti-css';
    s.textContent = `
      @keyframes blinky-fall {
        from{top:-20px;opacity:1;transform:rotate(0deg)}
        to{top:110vh;opacity:0;transform:rotate(720deg)}
      }
      .blinky-confetti{
        position:fixed;pointer-events:none;z-index:2147483643;
        animation:blinky-fall 1.5s ease-out forwards;
      }
    `;
    document.head.appendChild(s);
  }
  const colors = ['#00ffaa','#ffaa00','#e94560','#00aaff','#ffffff','#aa00ff'];
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.className = 'blinky-confetti';
    const sz = 8 + Math.floor(Math.random() * 7);
    el.style.cssText = `
      width:${sz}px;height:${sz}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      left:${Math.random()*100}vw;top:-20px;
      border-radius:${Math.random()>0.5?'50%':'2px'};
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

initBlinky();
