// ================================================================
// detector.js  —  Blinky 后台检测引擎
// 可调参数集中在顶部
// ================================================================
// ── 故事B 可调参数（集中在顶部，方便测试/演示时调整）──────────────
// 涨债速率：Accumulate 模式约 8 分钟涨满到 100（D_MAX / (8*60) ≈ 0.208/s）
const K_OUT_ACCUMULATE = 100 / (8 * 60);  // 真实模式涨速（约8分钟涨满）
const K_OUT_INSTANT    = 100 / 30;        // 演示模式涨速（约30秒涨满，方便快速搭建）

// 还债：故事B —— 普通眨眼只还极少量（保险，防止深眨识别不准时debt完全卡死），
//        深眨（用力眨）才是还债主力。
//        ⚠️ K_IN_NORMAL 实测安全上限约0.3，超过会压制debt累积导致提醒永不触发（已用模拟验证）。
const K_IN_NORMAL = 0.2;   // 普通眨眼保险还款（极小，不破坏累积机制）
const REPAY_PER_DEEP_BLINK = 40;  // 每次深眨还款量（2-3次可从满债清零）
const RW_DEEP_THRESHOLD = 0.55;   // 深眨判定门槛（按真机数据校准：用力眨实测rw约0.55-0.82）

// 提醒脉冲：debt 持续高于阈值时，每隔 PULSE_INTERVAL 秒闪一次褪色提示
const DEBT_ALERT_THRESHOLD = 80;  // debt 超过此值触发提醒
const PULSE_INTERVAL = 15;        // 提醒重复间隔（秒）
const PULSE_DURATION = 2;         // 单次褪色脉冲持续（秒）：0.5渐暗+1停留+0.5恢复

const T_GRACE    = 60;           // 宽限期（秒），此期间不触发干预
const D_MAX      = 100;          // 债务上限

// 模式：测试/演示时可置 true 跳过宽限期 + 用演示涨速
const DEV_INSTANT_MODE = false;  // true = 跳过宽限期 + 快速涨债，用于快速调试

// 选定的提醒模式（"accumulation" 真实 / "instant" 即时演示），由 selectedMode 决定涨速

// ── 校准阈值（从 storage 加载）──────────────────────────────────
let customThreshold  = 0.25;
let avgBlinkInterval = 6.0;
let alertThreshold   = 8.0;
let openEAR   = 0.35;
let closedEAR = 0.15;
let squeezeEAR = 0.10;
let selectedMode = "accumulation";
let isCalibrated = false;

// ── 运行时状态 ──────────────────────────────────────────────────
let video, faceMesh, faces = [];
let earHistory = [], smoothedEAR = 0;
let timeWithoutBlinking = 0;
let isBlinking = false, blinkFrameCount = 0, currentBlinkTrough = 1.0;
let debtD = 0, totalBlinkCount = 0, squeezeLeft = 0;
let modeStartTime = 0;
let cameraStarted = false;

// ── 故事B 新增运行时状态 ────────────────────────────────────────
let lastPulseTime = -999;      // 上次褪色脉冲触发的时刻（秒），用于15秒间隔控制
let pulseActive = false;       // 当前是否在播放褪色脉冲
let pulseStartTime = 0;        // 当前脉冲开始时刻
let deepBlinkCount = 0;        // 深眨累计次数（CSV用）
let normalBlinkCount = 0;      // 普通眨眼累计次数（CSV用）
let lastEventLog = [];         // 干预/眨眼事件日志（CSV Section 2/3）
let eventSendCursor = 0;       // 已发送给panel的事件游标（增量发送用）
let pendingAlertTime = -1;     // 最近一次提醒出现的时刻，用于算"响应延迟"

// ================================================================
// p5.js 入口
// ================================================================
function preload() {
  ml5.setBackend("webgl");
  faceMesh = ml5.faceMesh();
}

function setup() {
  createCanvas(1, 1);
  tryLoadCalibration();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CALIBRATION_DONE") {
      customThreshold  = msg.customThreshold;
      avgBlinkInterval = msg.avgBlinkInterval;
      alertThreshold   = msg.alertThreshold;
      openEAR    = msg.openEAR;
      closedEAR  = msg.closedEAR;
      squeezeEAR = msg.squeezeEAR || (msg.closedEAR * 0.7);
      if (squeezeEAR >= closedEAR) squeezeEAR = closedEAR * 0.7;
      selectedMode = msg.selectedMode || "accumulation";
      isCalibrated = true;
      timeWithoutBlinking = 0; debtD = 0;
      squeezeLeft = 0; totalBlinkCount = 0;
      deepBlinkCount = 0; normalBlinkCount = 0;
      lastEventLog = []; eventSendCursor = 0;
      lastPulseTime = -999; pulseActive = false; pendingAlertTime = -1;
      modeStartTime = millis();
      startDetectorCamera();
    }

    else if (msg.type === "RESET_CALIBRATION") {
      isCalibrated = false; cameraStarted = false;
      if (faceMesh && faceMesh.detectStop) faceMesh.detectStop();
      if (video) { video.remove(); video = null; }
      timeWithoutBlinking = 0; debtD = 0;
      squeezeLeft = 0; totalBlinkCount = 0;
      deepBlinkCount = 0; normalBlinkCount = 0;
      lastEventLog = []; eventSendCursor = 0;
      lastPulseTime = -999; pulseActive = false; pendingAlertTime = -1;
      earHistory = [];
    }

    else if (msg.type === "GLOBAL_STATE_SYNC" && msg.state) {
      // 同步 squeezeEAR（panel 校准后热传）
      if (msg.state.squeezeEAR !== undefined && msg.state.squeezeEAR > 0) {
        squeezeEAR = msg.state.squeezeEAR;
        if (squeezeEAR >= closedEAR) squeezeEAR = closedEAR * 0.7;
      }
      // 同步模式切换
      if (msg.state.selectedMode && msg.state.selectedMode !== selectedMode) {
        selectedMode = msg.state.selectedMode;
        modeStartTime = millis() - ((msg.state.modeTime || 0) * 1000);
        debtD = msg.state.debt || debtD;
        timeWithoutBlinking = msg.state.timeWithoutBlinking || 0;
      }
    }

    else if (msg.type === "DEBUG_FAST_FORWARD") {
      debtD = Math.min(D_MAX, debtD + 30);
      timeWithoutBlinking += 5.0;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (faceMesh && faceMesh.detectStop) faceMesh.detectStop();
    } else {
      chrome.runtime.sendMessage({ type: "REQUEST_GLOBAL_STATE" }, (state) => {
        if (state && isCalibrated) {
          debtD = state.debt || 0;
          timeWithoutBlinking = 0;
          earHistory = [];
          if (state.modeTime) modeStartTime = millis() - state.modeTime * 1000;
          if (video && faceMesh) {
            faceMesh.detectStart(video, (r) => { faces = r || []; });
          }
          // 立即广播彩色
          chrome.runtime.sendMessage({
            type: "FILTER_UPDATE",
            saturation: 100, brightness: 100,
            currentEAR: smoothedEAR, debt: debtD,
            timeWithoutBlinking: 0,
            modeTime: (millis() - modeStartTime) / 1000,
            squeezeLeft, blinkCount: totalBlinkCount
          });
        }
      });
    }
  });
}

function startDetectorCamera() {
  if (cameraStarted) return;
  cameraStarted = true;
  video = createCapture(VIDEO);
  video.size(320, 240);
  video.hide();
  faceMesh.detectStart(video, (r) => { faces = r || []; });
}

// ================================================================
// 主循环
// ================================================================
function draw() {
  if (document.hidden || !cameraStarted || !isCalibrated) return;
  const safeDelta = Math.min(deltaTime, 100);

  // ── 涨债速率：按模式选择（accumulation真实 / instant演示）──
  const isInstantMode = DEV_INSTANT_MODE || selectedMode === "instant";
  const K_OUT = isInstantMode ? K_OUT_INSTANT : K_OUT_ACCUMULATE;

  // 高债务时设定挤眼任务（需要3次深眨清零）
  if (debtD >= DEBT_ALERT_THRESHOLD && squeezeLeft === 0 && !isBlinking) {
    squeezeLeft = 3;
  }

  // ── EAR 检测 + 还款逻辑（故事B：仅深眨大幅还债）─────────────
  if (faces && faces.length > 0 && faces[0] && faces[0].keypoints) {
    const kp = faces[0].keypoints;
    const lEAR = calculateEAR(kp[33],kp[160],kp[158],kp[133],kp[153],kp[144]);
    const rEAR = calculateEAR(kp[362],kp[385],kp[387],kp[263],kp[373],kp[380]);
    const avg  = (lEAR + rEAR) / 2;

    earHistory.push(avg);
    if (earHistory.length > 5) earHistory.shift();
    smoothedEAR = earHistory.reduce((a, b) => a + b, 0) / earHistory.length;

    // 迟滞双阈值去抖：闭眼判定用 customThreshold，睁眼判定用更高的回滞阈值，
    // 中间缓冲区维持当前状态，避免 EAR 在单一阈值附近抖动把一次眨眼拆成多次。
    const openThreshold = customThreshold + 0.04;  // 睁眼需回升超过此值才算睁开
    const eyeClosed = isBlinking ? (avg < openThreshold) : (avg < customThreshold);

    if (eyeClosed) {
      // 眼睛关闭中
      isBlinking = true;
      blinkFrameCount++;
      // ⚠️ trough 用原始瞬时 EAR(avg)而非平滑值：眨眼极快(100-300ms)，
      //    5帧平滑会抹平用力眨的尖谷，导致深度被严重低估、深眨判不出。
      currentBlinkTrough = Math.min(currentBlinkTrough, avg);
      timeWithoutBlinking = 0;

    } else if (isBlinking) {
      // 眼睛刚睁开 → 判断这次眨眼是深还是浅
      if (blinkFrameCount >= 2) {  // 降到2帧：用力快眨可能仅持续2帧
        totalBlinkCount++;
        // 还款权重 rw：trough 越接近个人标定的 squeezeEAR，rw 越接近1（用力越深）
        let rw = (closedEAR - currentBlinkTrough) /
                 (closedEAR - squeezeEAR + 0.0001);
        rw = constrain(rw, 0, 1);

        const debtBefore = debtD;

        if (rw > RW_DEEP_THRESHOLD) {
          // 深眨（用力眨）→ 大幅还债（文献：完整/用力眨刺激睑板腺分泌脂质）
          deepBlinkCount++;
          debtD = Math.max(0, debtD - REPAY_PER_DEEP_BLINK);
          if (squeezeLeft > 0) squeezeLeft--;
          // 记录深眨还债事件（CSV）
          logEvent("deep_blink", totalModeTimeNow(), rw, debtBefore, debtD);
        } else {
          // 普通/浅眨 → 仅象征性还款（文献：浅眨不补泪膜脂质层）
          normalBlinkCount++;
          debtD = Math.max(0, debtD - K_IN_NORMAL);
          logEvent("normal_blink", totalModeTimeNow(), rw, debtBefore, debtD);
        }
      }
      if (debtD < DEBT_ALERT_THRESHOLD) squeezeLeft = 0;
      isBlinking = false;
      blinkFrameCount = 0;
      currentBlinkTrough = 1.0;

    } else {
      // 睁眼中：负债随时间累积（涨速由模式决定）
      timeWithoutBlinking += safeDelta / 1000;
      debtD = Math.min(D_MAX, debtD + K_OUT * safeDelta / 1000);
    }

  } else {
    // 人脸离开：缓慢减少计时（不涨债）
    if (timeWithoutBlinking > 0) {
      timeWithoutBlinking -= safeDelta / 1000;
    }
  }

  // ── 提醒脉冲逻辑（故事B核心：debt 不实时挂钩屏幕，改为间歇脉冲）──
  const totalModeTime = (millis() - modeStartTime) / 1000;
  const graceOver = isInstantMode || (totalModeTime >= T_GRACE);

  // instant 模式额外触发条件：当前眨眼率低于平均时也触发（方便快速演示）
  let instantTrigger = false;
  if (isInstantMode && graceOver) {
    const curRate = totalModeTime > 5 ? totalBlinkCount / (totalModeTime / 60) : 99;
    const baseRate = 60 / Math.max(avgBlinkInterval, 0.1);
    instantTrigger = curRate < baseRate;
  }

  // 判断是否该开启一次新脉冲：债高于阈值(或instant触发)、宽限期已过、距上次脉冲≥间隔、当前无脉冲
  const debtHigh = debtD >= DEBT_ALERT_THRESHOLD;
  if (graceOver && !pulseActive &&
      (debtHigh || instantTrigger) &&
      (totalModeTime - lastPulseTime >= PULSE_INTERVAL)) {
    pulseActive = true;
    pulseStartTime = totalModeTime;
    lastPulseTime = totalModeTime;
    pendingAlertTime = totalModeTime;
    logEvent("alert_pulse", totalModeTime, 0, debtD, debtD);
  }

  // 计算脉冲期间的褪色程度（0.5s渐暗 → 1s停留 → 0.5s恢复）
  let saturation = 100, brightness = 100;
  if (pulseActive) {
    const p = totalModeTime - pulseStartTime;  // 脉冲已进行时间
    let depth = 0; // 0=正常 1=最暗
    if (p < 0.5)              depth = p / 0.5;                    // 渐暗
    else if (p < 1.5)         depth = 1;                          // 停留
    else if (p < PULSE_DURATION) depth = (PULSE_DURATION - p) / 0.5; // 恢复
    else { pulseActive = false; depth = 0; }                     // 结束

    saturation = constrain(map(depth, 0, 1, 100, 20), 20, 100);
    brightness = constrain(map(depth, 0, 1, 100, 75), 75, 100);
  }
  // 注意：debt 高但不在脉冲期时，屏幕保持正常（不实时挂钩，避免温水煮青蛙）

  // ── 每5帧发送一次消息 ────────────────────────────────────────
  if (frameCount % 5 === 0) {
    // 只发送自上次以来的新事件（增量），避免传整个大数组导致卡顿/丢消息
    const newEvents = lastEventLog.slice(eventSendCursor);
    eventSendCursor = lastEventLog.length;
    chrome.runtime.sendMessage({
      type: "FILTER_UPDATE",
      saturation, brightness,
      currentEAR: smoothedEAR,
      debt: debtD,
      timeWithoutBlinking,
      modeTime: totalModeTime,
      squeezeLeft,
      blinkCount: totalBlinkCount,
      // 故事B 新增字段
      debtHigh: debtHigh,              // titleBar 用：是否显示"Blink hard 💧"
      deepBlinkCount: deepBlinkCount,  // CSV 用
      normalBlinkCount: normalBlinkCount,
      eventLogDelta: newEvents,        // CSV 用：仅新增的眨眼/提醒事件（增量）
      activeMode: selectedMode
    });
  }
}

// 故事B：当前 session 已运行秒数
function totalModeTimeNow() {
  return (millis() - modeStartTime) / 1000;
}

// 故事B：记录事件（眨眼/提醒），供 CSV 导出
function logEvent(type, t, rw, debtBefore, debtAfter) {
  lastEventLog.push({
    t: t,
    type: type,
    rw: rw,
    debtBefore: debtBefore,
    debtAfter: debtAfter,
    // 若是深眨且之前有待响应的提醒，计算响应延迟
    responseLatency: (type === "deep_blink" && pendingAlertTime >= 0)
      ? (t - pendingAlertTime) : -1
  });
  if (type === "deep_blink") pendingAlertTime = -1; // 响应后清除
  if (lastEventLog.length > 2000) lastEventLog.shift();
}

function tryLoadCalibration() {
  chrome.storage.local.get(
    ['isCalibrated','customThreshold','avgBlinkInterval','alertThreshold',
     'openEAR','closedEAR','squeezeEAR','selectedMode'],
    (data) => {
      if (data.isCalibrated) {
        customThreshold  = data.customThreshold;
        avgBlinkInterval = data.avgBlinkInterval;
        alertThreshold   = data.alertThreshold;
        openEAR    = data.openEAR;
        closedEAR  = data.closedEAR;
        squeezeEAR = data.squeezeEAR || (data.closedEAR * 0.7);
        if (squeezeEAR >= closedEAR) squeezeEAR = closedEAR * 0.7;
        selectedMode = data.selectedMode || "accumulation";
        isCalibrated = true;

        chrome.runtime.sendMessage({ type: "REQUEST_GLOBAL_STATE" }, (state) => {
          if (state) {
            debtD = state.debt || 0;
            timeWithoutBlinking = state.timeWithoutBlinking || 0;
            squeezeLeft = state.squeezeLeft || 0;
            totalBlinkCount = state.blinkCount || 0;
            modeStartTime = (state.modeTime && state.modeTime > 0)
              ? millis() - state.modeTime * 1000
              : millis();
          }
          startDetectorCamera();
        });
      } else {
        setTimeout(tryLoadCalibration, 2000);
      }
    }
  );
}

function calculateEAR(p1,p2,p3,p4,p5,p6) {
  const v1 = dist(p2.x,p2.y,p6.x,p6.y);
  const v2 = dist(p3.x,p3.y,p5.x,p5.y);
  const h  = dist(p1.x,p1.y,p4.x,p4.y);
  return (v1+v2) / (2.0*h + 0.0001);
}
