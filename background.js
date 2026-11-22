let globalState = {
  selectedMode: "accumulation",
  isExpanded: false,
  panelLeft: "",
  panelTop: "",
  saturation: 100,
  brightness: 100,
  currentEAR: 0.25,
  debt: 0,
  timeWithoutBlinking: 0,
  modeTime: 0,
  squeezeLeft: 0,
  blinkCount: 0,
  squeezeEAR: 0.10,
  blinkRateSamples: [],
  interventionStyle: "vignette",
  // 故事B 新增字段
  debtHigh: false,
  deepBlinkCount: 0,
  normalBlinkCount: 0,
  eventLogDelta: [],
  activeMode: "accumulation"
};

let saveTimeout = null;

chrome.storage.local.get(['blinkyGlobalState'], (res) => {
  if (res.blinkyGlobalState) {
    globalState = Object.assign(globalState, res.blinkyGlobalState);
  }
});

function broadcastState(highFreqOnly = false) {
  if (highFreqOnly) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "GLOBAL_STATE_SYNC", state: globalState }, () => { if (chrome.runtime.lastError) {} });
      }
    });
  } else {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "GLOBAL_STATE_SYNC", state: globalState }, () => { if (chrome.runtime.lastError) {} });
        }
      });
    });
  }
  chrome.runtime.sendMessage({ type: "GLOBAL_STATE_SYNC", state: globalState }, () => { if (chrome.runtime.lastError) {} });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FILTER_UPDATE") {
    globalState.saturation = msg.saturation; globalState.brightness = msg.brightness;
    globalState.currentEAR = msg.currentEAR; globalState.debt = msg.debt;
    globalState.timeWithoutBlinking = msg.timeWithoutBlinking; globalState.modeTime = msg.modeTime;
    globalState.squeezeLeft = msg.squeezeLeft; globalState.blinkCount = msg.blinkCount;
    if (msg.blinkRateSamples !== undefined) { globalState.blinkRateSamples = msg.blinkRateSamples; }
    // 故事B 新增字段转发
    if (msg.debtHigh         !== undefined) globalState.debtHigh         = msg.debtHigh;
    if (msg.deepBlinkCount   !== undefined) globalState.deepBlinkCount   = msg.deepBlinkCount;
    if (msg.normalBlinkCount !== undefined) globalState.normalBlinkCount = msg.normalBlinkCount;
    if (msg.eventLogDelta    !== undefined) globalState.eventLogDelta    = msg.eventLogDelta;
    if (msg.activeMode       !== undefined) globalState.activeMode       = msg.activeMode;
    broadcastState(true);
    if (!saveTimeout) {
      saveTimeout = setTimeout(() => { chrome.storage.local.set({ blinkyGlobalState: globalState }); saveTimeout = null; }, 500);
    }
  }
  else if (msg.type === "SAVE_BLINK_SAMPLES") {
    globalState.blinkRateSamples = msg.blinkRateSamples; broadcastState(false); 
  }
  else if (msg.type === "STYLE_UPDATE") {
    globalState.interventionStyle = msg.style; broadcastState(false);
  }
  // 【新增处理：分离样式与模式，模式切换不重置时间和债务】
  else if (msg.type === "STYLE_MODE_UPDATE") {
    globalState.selectedMode = msg.mode;
    broadcastState(false); 
  }
  else if (msg.type === "MODE_UPDATE") {
    globalState.selectedMode = msg.selectedMode;
    if (msg.squeezeEAR !== undefined) { globalState.squeezeEAR = msg.squeezeEAR; }
    globalState.debt = 0; globalState.timeWithoutBlinking = 0; globalState.modeTime = 0;
    globalState.saturation = 100; globalState.brightness = 100; globalState.squeezeLeft = 0;
    globalState.blinkCount = 0; globalState.blinkRateSamples = [];
    broadcastState(false); 
  }
  else if (msg.type === "UI_STATE_CHANGE") {
    if (msg.panelLeft !== undefined) globalState.panelLeft = msg.panelLeft;
    if (msg.panelTop !== undefined) globalState.panelTop = msg.panelTop;
    if (msg.isExpanded !== undefined) globalState.isExpanded = msg.isExpanded;
    broadcastState(false); 
  }
  else if (msg.type === "REQUEST_GLOBAL_STATE") {
    sendResponse(globalState);
  }
  // 【新增处理：物理重置当前 Session 会话负债】
  else if (msg.type === "RESTART_SESSION") {
    globalState.debt = 0; globalState.timeWithoutBlinking = 0; globalState.modeTime = 0;
    globalState.saturation = 100; globalState.brightness = 100; globalState.squeezeLeft = 0;
    globalState.blinkCount = 0; globalState.blinkRateSamples = [];
    let oldMode = globalState.selectedMode;
    globalState.selectedMode = "force_reset_engine"; broadcastState(false);
    setTimeout(() => { globalState.selectedMode = oldMode; broadcastState(false); }, 100);
  }
  else if (msg.type === "RESET_CALIBRATION") {
    globalState.debt = 0; globalState.timeWithoutBlinking = 0; globalState.modeTime = 0;
    globalState.saturation = 100; globalState.brightness = 100; globalState.squeezeLeft = 0;
    globalState.blinkCount = 0; globalState.blinkRateSamples = [];
    broadcastState(false);
  }
  return true; 
});