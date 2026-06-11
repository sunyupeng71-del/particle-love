// ============================================================
// 给范晓语 — script.js（宇宙终极版）
// ============================================================

// ---- DOM refs -----------------------------------------------
const canvas         = document.getElementById('canvas');
const ctx            = canvas.getContext('2d');
const introWrap      = document.getElementById('intro-wrap');
const introLine1     = document.getElementById('intro-line1');   // 七句话复用
const introLine2     = document.getElementById('intro-line2');
const musicBtn       = document.getElementById('music-btn');

// ============================================================
// 〇、记忆地基（localStorage）+ 调试快进
// ============================================================
// 这是整个「一百夜」机制的地基：访问计数、上次到访、已说过的话、
// 黎明进度。所有里程碑（第2/10/50/100夜、生日、久别）都从这里读。
const LS = { visits:'fx_visits', last:'fx_lastVisit', first:'fx_firstVisit', said:'fx_said' };

// —— 调试快进：?night=N 指定夜数；?hour=H 指定时辰；?bday=1 强制生日；?fresh=1 清空记忆 ——
const Q = new URLSearchParams(location.search);
const DBG = {
  night: Q.has('night') ? Math.max(1, parseInt(Q.get('night'), 10) || 1) : null,
  hour:  Q.has('hour')  ? Math.max(0, Math.min(23, parseInt(Q.get('hour'), 10) || 0)) : null,
  bday:  Q.get('bday')  === '1',
  fresh: Q.get('fresh') === '1',
  away:  Q.get('away')  === '1',   // 强制「久别重逢」
  sunrise: Q.get('sunrise') === '1', // 强制「第100夜日出」预览
};
function lsGet(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : v; } catch(e){ return d; } }
function lsSet(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
// ?fresh=1：彻底清零所有记忆（访问/痕迹/星座/暖星/日出等全部 fx_ 键）
if (DBG.fresh) { try { Object.keys(localStorage).filter(k => k.startsWith('fx_')).forEach(k => localStorage.removeItem(k)); } catch(e){} }

// —— 访问计数：真实到访才 +1 并写入；调试指定夜数时不写入，方便反复预览 ——
const _rawVisits = parseInt(lsGet(LS.visits, '0'), 10) || 0;
const visitCount = DBG.night !== null ? DBG.night : _rawVisits + 1;
if (DBG.night === null) lsSet(LS.visits, String(visitCount));

// —— 上次到访 / 久别（>30天）——
const _lastTs  = parseInt(lsGet(LS.last, '0'), 10) || 0;
const nowTs    = Date.now();
const daysAway = _lastTs ? (nowTs - _lastTs) / 86400000 : 0;
const longAway = DBG.away || daysAway > 30;
if (DBG.night === null) lsSet(LS.last, String(nowTs));
if (!lsGet(LS.first, '')) lsSet(LS.first, String(nowTs));

// —— 黎明进度：一百夜 = 一场日出，每次只涨 1%（第8步驱动底部天光）——
const dawnProgress = Math.min(visitCount / 100, 1);

// —— 时辰与生日（8月17日）——
const _now = new Date();
const hour = DBG.hour !== null ? DBG.hour : _now.getHours();
const isBirthday = DBG.bday || (_now.getMonth() === 7 && _now.getDate() === 17);

// —— 七句话：说过即焚（调试夜数时视为从未说过，便于预览）——
let _saidSet = new Set();
try { _saidSet = new Set(JSON.parse(lsGet(LS.said, '[]'))); } catch(e){}
function hasSaid(key){ return DBG.night === null && _saidSet.has(key); }
function markSaid(key){
  if (DBG.night !== null) return;
  _saidSet.add(key); lsSet(LS.said, JSON.stringify([..._saidSet]));
}

// —— 访问节奏：每次回来开场更快一点（门开得更快），下限 0.45 ——
const tScale = Math.max(0.45, 1 - (visitCount - 1) * 0.06);

console.info(`[宇宙] 第 ${visitCount} 夜 · 时辰 ${hour}:00 · 黎明进度 ${(dawnProgress*100).toFixed(0)}%`,
             `\n调试：?night=N ?hour=H ?bday=1 ?fresh=1`);

// 声音由「轻触苏醒」门控：她第一次点击/触摸之前，绝不发声、绝不创建 AudioContext、绝不加载 Tone.js。
// 真正的实现见文件底部「音频系统」与「轻触苏醒」。

// ---- 音频状态（HTML5 Audio 本地文件版）-----------------------
let soundEnabled     = false;
let musicToggleCount = 0;
let mouseSoundAccum  = 0;     // [节流控制] 鼠标移动距离累计，达到 100px 触发一次
let mouseSoundLastX  = -1, mouseSoundLastY = -1;
let lastParticleSndT = 0;     // [冷却控制] 粒子互动音冷却时间戳（200ms）

// 烟花文件跳过前置静音的秒数（根据实际文件调整）
const FIREWORK_SKIP  = 1.19;

// ------------------------------------------------------------
// 声部轮转池（voice pool）
// ------------------------------------------------------------
// 【为什么需要它 —— 这是“移动不响、停下才响”的根本修复】
// 如果只用一个 Audio 对象，每次触发都执行 currentTime=0 把播放头拉回开头。
// 鼠标持续移动时触发很密集，后一次会在前一次还没播完时打断它，
// 导致移动中的声音被自己反复掐断、几乎听不见；一旦停下，最后一次
// 才得以完整播放 —— 听感就成了“一停才响”。
//
// 解决：为高频音效准备多个副本，每次触发轮流用下一个副本，
// 相邻触发落在不同对象上、互不打断。池子大小有限（4 个），
// 最多同时 4 层 × 0.08 ≈ 0.32，绝不会叠加爆音。
// 旧的 mp3 / HTML5 Audio 系统已移除（禁外部音频文件、禁循环 BGM）。
// 新的声音全部由 Tone.js（钢琴/和弦）+ 原生 Web Audio（drone/叮）合成，
// 见文件底部「音频系统」。

// ---- 数量常量 -----------------------------------------------
const TOTAL      = 180;
const N_BRIGHT   = Math.round(TOTAL * 0.15);
const N_MAIN     = Math.round(TOTAL * 0.55);
const N_AMBIENT  = TOTAL - N_BRIGHT - N_MAIN;
const N_HEART    = N_BRIGHT + N_MAIN;
const N_ORBIT    = 18;
const N_FOLLOWER = 6;
const N_BG_STARS = 350;

// ---- 物理常量 -----------------------------------------------
const SPRING_K      = 0.058;
const GATHER_SPRING = 0.011;
const CONTRACT_SPR  = 0.22;   // 爆炸收缩弹簧
const DAMPING       = 0.84;
const MOUSE_INNER   = 40;     // 吸引半径
const MOUSE_OUTER   = 150;    // 斥力半径
const MOUSE_FORCE   = 12;
const LINE_DIST     = 100;
const EXPLODE_SPD   = 38;
const EXPLODE_MS    = 1500;

// ---- 状态枚举（五阶段体验节奏）-----------------------------
// DARK 黑暗 → FIRST_STAR 第一颗星 → SPREAD 星野渗透 → NAME 名字 → COMPLETE 完全交互
const St = { DARK:0, FIRST_STAR:1, SPREAD:2, NAME:3, COMPLETE:4 };
let introState = St.DARK;
let curSpring  = 0;

// ---- 开场运行时 ---------------------------------------------
let spreadStartT      = 0;            // SPREAD 起始时间戳
let firstStarIdx      = 0;            // 「第一颗星」的粒子索引
let firstStarPos      = { x:0, y:0 };
let bgRevealAlpha     = 0;            // 背景星空/光斑揭幕透明度 0→1
let grainAlpha        = 1;            // 黑暗颗粒透明度 1→0
let dustParticles     = [];           // 名字「碎成星尘」用的临时粒子
let grainBuf          = null;         // 黑暗颗粒缓冲

// ---- 生命感：呼吸 / 困倦 / 清醒度（第2步）-------------------
let lastActivityT  = performance.now();   // 最近一次互动（鼠标/触摸/点击）
let breathPhase    = 0;                    // 呼吸相位
let breathPeriod   = 4000;                 // 当前呼吸周期 ms，随困倦放缓
let wakefulness    = longAway ? 0.80 : 1;  // 清醒度 0.82~1；久别重逢从更暗处缓缓苏醒
let lifeFactor     = 1;                    // = 呼吸 × 清醒度，乘到全场亮度
let isAsleep       = false;                // 是否已睡着（>10min 静止）
let breathFrozen   = false;                // 切走标签页：屏住呼吸
let lastFrameT     = performance.now();    // 上一帧时间戳（算 dt）

// ---- 一次一星：星数随访问增长（封顶 120）-------------------
let EXTRA_STARS    = Math.min(Math.max(visitCount - 1, 0), 120);

// ---- Bloom 柔光离屏画布 -------------------------------------
let bloomCanvas = null, bloomCtx = null, bloomOK = false;
const BLOOM_SCALE = 0.5;   // 半分辨率，省性能

// ---- 流星顶层画布（每帧彻底清空，不参与主画布的拖尾，因而不会残留） ----
let fxCanvas = null, fxCtx = null, meteorLayerDirty = false;

// ---- 时辰主题（凌晨/清晨/昼/黄昏/夜）-----------------------
// solid = 每帧重铺的实色夜幕（按时辰）；不再用半透明拖尾，避免残影长期累积
function getTimeTheme(h) {
  if (h >= 0  && h < 5)  return { solid:'rgb(5,5,13)',   starMul:1.15, edge:null,                                  watch:true  };
  if (h >= 5  && h < 9)  return { solid:'rgb(10,9,20)',  starMul:0.90, edge:{r:120,g:90,b:160,a:0.05,pos:'top'},    watch:false };
  if (h >= 9  && h < 17) return { solid:'rgb(14,15,28)', starMul:0.62, edge:null,                                  watch:false };
  if (h >= 17 && h < 20) return { solid:'rgb(12,8,16)',  starMul:0.85, edge:{r:200,g:120,b:70,a:0.06,pos:'bottom'}, watch:false };
  return                        { solid:'rgb(7,7,16)',   starMul:1.00, edge:null,                                  watch:(h>=22) };
}
const TT = getTimeTheme(hour);

// ---- 长明：常态宇宙的心脏（核+晕+纱）------------------------
// 一盏为她留着的灯。呼吸从它荡向天边；凡经过它光晕的，都被照亮。
let lampX = 0, lampY = 0, lampR = 0, lampDiag = 1;
let lampWisps = [];                    // 纱：分钟级缓慢换位的雾丝
let lampAlpha = 0;                     // 灯的揭幕度（它比宇宙先在：FIRST_STAR 起就亮）
let moonGlow  = 0;                     // 生日弯月当前的明度（灯会因它烧旺一点）
let lampPulseTimer = Infinity;         // 下一次脉动（无声光环）的时刻
// 行为细节（第3步）：迎向鼠标 / 久别晃一下 / 越闲越显 / 越烧越稳
let lampLeanX = 0, lampLeanY = 0;      // 迎向鼠标的偏移（平滑）
let lampSwayT = 0;                     // 久别重逢「晃一下」的起始时刻
let lampPresence = 1;                  // 存在感（与她的活跃度成反比，平滑）
let lampDX = 0, lampDY = 0;            // 本帧灯心总偏移（lean+sway+jitter）
let lampBright = 1;                    // 本帧灯亮度倍率（presence×flicker×lean）

// ---- 夜风：常态宇宙的天气地基（《夜风与旅人》第一阶段）------
let windAngle = 0, windDirX = 1, windDirY = 0;   // 风向（约12分钟缓慢转一圈）
let windStrength = 0;        // 风力 0~1（含无风之夜）
let windSwayPhase = 0;       // 整片星野「俯仰」相位
let windWake = 1;            // 风的清醒度（困倦放缓、睡着停）
let windGustT0 = -1e9;       // 当前阵风起始（很久以前=无）
let windGustNext = 0;        // 下一阵风时刻
let windPrevT = performance.now();
let prevAsleep = false;
let woX = 0, woY = 0;        // windOffset 的输出（scratch，避免每帧分配数组）
let mouseVX = 0, mouseVY = 0, prevMX = -9999, prevMY = -9999;  // 平滑鼠标速度（她的流）
const SWAY_MAX = 6;          // 最大摆幅(px，近层满)
const GUST_DUR = 7500;       // 阵风横穿时长(ms)
// 今夜的天气性格（按日期种子：约 1/5 夜近乎无风）；?wind=calm|high 可强制
let _wseed = ((_now.getFullYear()*1000 + (_now.getMonth()+1)*32 + _now.getDate()) >>> 0) || 1;
function _wrand(){ _wseed = (_wseed*1664525 + 1013904223) >>> 0; return _wseed / 4294967296; }
const _windDbg = Q.get('wind');
const NIGHT_WIND_MAX = _windDbg === 'calm' ? 0.08 : _windDbg === 'high' ? 1.0
                     : ((_wrand() < 0.2) ? (0.05 + _wrand()*0.20) : (0.5 + _wrand()*0.5));
const NIGHT_DIR0 = _wrand() * Math.PI * 2;
// 今夜云量（按日期种子：约 1/4 夜无云）；?cloud=clear|heavy 可强制
const NIGHT_CLOUDS = (() => {
  const cq = Q.get('cloud');
  if (cq === 'clear') return 0; if (cq === 'heavy') return 3;
  return (_wrand() < 0.25) ? 0 : (1 + (_wrand() < 0.5 ? 1 : 2));   // 否则 1~3 片
})();
let dust = [];               // 星尘：随风横渡的微尘，唯独穿过长明的光才被点亮
let clouds = [];             // 云影：无形的「星光变弱的区域」，遮得住所有星、唯独遮不住灯
const LAMP_FX = 0.42, LAMP_FY = 0.60;  // 灯的家：第一夜第一颗星亮起的地方
// 时辰：凌晨烧得最旺，白天几乎不退（门廊灯）；它不随全场清醒度/日出变暗
const LAMP_DAY = (hour >= 9 && hour < 17) ? 0.82 : ((hour >= 0 && hour < 5) ? 1.0 : 0.92);

// ---- 第3步：记忆与停留反馈 ----------------------------------
let shyStar   = null;   // 认生的星（当前这一颗）
let shyStop   = 50;     // 停在距光标多远（随访问减小，约第30夜触到）
let shySpeed  = 1;      // 靠近速度倍率（久别更快）
let warmStar  = null;   // 暖星彩蛋（全场唯一偏暖的一颗）
let warmHoverStart = 0; // 光标停在暖星上的起始时刻
let warmDone  = (DBG.night === null) && (lsGet('fx_warm','') === '1');

// 痕迹热图：降采样网格，跨会话留存 —— 她走过的地方会淡淡留下痕迹
const TG_W = 32, TG_H = 18;
let traceGrid = new Float32Array(TG_W * TG_H);
(function loadTrace(){
  try {
    const saved = JSON.parse(lsGet('fx_trace', '[]'));
    if (Array.isArray(saved) && saved.length === TG_W*TG_H)
      for (let i = 0; i < saved.length; i++) traceGrid[i] = (saved[i] || 0) / 255;
  } catch(e){}
})();
let traceSaveT = performance.now();
function saveTrace(){
  if (DBG.night !== null) return;          // 调试夜数不写入，避免污染真实记忆
  const out = new Array(TG_W * TG_H);
  for (let i = 0; i < traceGrid.length; i++) out[i] = Math.round(Math.min(1, traceGrid[i]) * 255);
  lsSet('fx_trace', JSON.stringify(out));
}
function recordTrace(){
  if (mouse.x < 0 || mouse.x > W || mouse.y < 0 || mouse.y > H) return;
  const cx = Math.floor(mouse.x / W * TG_W);
  const cy = Math.floor(mouse.y / H * TG_H);
  const i  = cy * TG_W + cx;
  if (i >= 0 && i < traceGrid.length) traceGrid[i] = Math.min(1, traceGrid[i] + 0.004);
}

// ---- 第4步：点击=提问 + 连星成座 ----------------------------
let press = null;             // 指针按下状态 {sx,sy,star,t}
let ripples = [];             // 涟漪回应
const STAR_GRAB   = 38;       // 抓取星星的半径
const CONNECT_MIN = 26;       // 超过此位移视为「拖拽连线」而非「轻点」

// 连星成座：她画下的线永久极淡留存（跨会话，存分数坐标）
let constellations = [];
(function loadConstel(){
  try {
    const saved = JSON.parse(lsGet('fx_constel','[]'));
    if (Array.isArray(saved)) constellations = saved.filter(c => c && 'ax' in c);
  } catch(e){}
})();
function saveConstel(){
  if (DBG.night !== null) return;
  lsSet('fx_constel', JSON.stringify(constellations.slice(-120)));   // 封顶 120 条
}
// ---- 里程碑高潮：第100夜日出 / 生日弯月（playBloomChord 等真正实现见底部音频系统）----
let dawnLevel = 0;            // 日出序列时的天亮程度 0→1→0
let starFade  = 0;           // 日出时星星隐去 0→1
let sunriseActive = false, sunrisePhase = null, sunriseT0 = 0, sunriseFreeze = false;
let moonActive = false, moonT0 = 0, moonCanvas = null;

// ---- 爆炸阶段 -----------------------------------------------
let explodePhase = 'idle'; // 'idle' | 'contract' | 'blast'
let explodeCX = 0, explodeCY = 0;
let contractTimer = null, explodeTimer = null;

// ---- 全局运行时 ----------------------------------------------
let W, H;
let heartCX, heartCY, heartScale;
let mouse            = { x: -9999, y: -9999 };
let lastMouseMoveTime = 0;
let mouseHistory     = [];   // 鼠标轨迹
let touchPoints      = [];
let startTime        = performance.now();
let frameCount       = 0;

// ---- 对象池 -------------------------------------------------
let particles      = [];
let orbitParticles = [];
let bokehBlobs     = [];
let starFollowers  = [];
let shockwaves     = [];
let meteors        = [];

// ---- 背景星星（预分配 Float32Array）-------------------------
// 每颗星 6 个 float：baseAngle, dist, radius, brightness, twinkleSpd, twinklePhase
let bgStarBuf = null;

// ---- 诗意阶段 -----------------------------------------------
let phase         = 0;
let escapedSet    = new Set();
let escapeTimeout = null;

// ---- 彩蛋 ---------------------------------------------------
let clickTimes     = [];
let egg1On         = false;
let egg1Timer      = null;
let egg2On         = false;
let egg2Timer      = null;
let egg3Shown      = false;
let lastTouchTime  = 0;

// ---- 流星调度 -----------------------------------------------
let meteorTimeout  = null;

// ============================================================
// 一、高清 Canvas
// ============================================================
function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  ctx.scale(dpr, dpr);
}

// ============================================================
// 二、背景星空（Float32Array，避免循环内创建对象）
// ============================================================
// 三层景深：远（多、暗、小、慢）/ 中 / 近（少、亮、大、视差大）
// 每颗星 7 个 float：baseAngle, dist, radius, brightness, twinkleSpd, twinklePhase, depth
const BG_DEPTHS = [0.15, 0.45, 0.85];   // 远 / 中 / 近
function initBgStars() {
  bgStarBuf = new Float32Array(N_BG_STARS * 7);
  const maxDist = Math.hypot(W, H) * 0.62;
  for (let i = 0; i < N_BG_STARS; i++) {
    const b = i * 7;
    // 前 55% 远、30% 中、15% 近
    const depth = (i < N_BG_STARS*0.55) ? BG_DEPTHS[0]
                : (i < N_BG_STARS*0.85) ? BG_DEPTHS[1]
                :                          BG_DEPTHS[2];
    bgStarBuf[b+0] = Math.random() * Math.PI * 2;          // baseAngle
    bgStarBuf[b+1] = Math.random() * maxDist;              // dist
    bgStarBuf[b+2] = 0.25 + Math.random() * 0.45;          // radius 基数
    bgStarBuf[b+3] = 0.22 + Math.random() * 0.55;          // brightness 基数
    bgStarBuf[b+4] = (0.4 + Math.random() * 2.0) * 0.001;  // twinkleSpd rad/ms
    bgStarBuf[b+5] = Math.random() * Math.PI * 2;          // twinklePhase
    bgStarBuf[b+6] = depth;
  }
}

function drawBgStars(elapsed, mul) {
  mul = (mul === undefined) ? 1 : mul;
  const ROT = (Math.PI * 2) / 300000;     // 慢得多（300s），几乎是一片静止的深空
  const cx = W / 2, cy = H / 2;
  // 鼠标视差：仅光标在屏内时启用，近层位移大、远层几乎不动
  let mx = 0, my = 0;
  if (mouse.x >= 0 && mouse.x <= W && mouse.y >= 0 && mouse.y <= H) {
    mx = (mouse.x - cx); my = (mouse.y - cy);
  }
  for (let i = 0; i < N_BG_STARS; i++) {
    const b     = i * 7;
    const depth = bgStarBuf[b+6];
    const ang   = bgStarBuf[b+0] + elapsed * ROT * (0.4 + depth);
    const d     = bgStarBuf[b+1];
    const r     = bgStarBuf[b+2] * (0.6 + depth * 1.0);
    const br    = bgStarBuf[b+3] * (0.45 + depth * 0.75)
                  * (0.55 + 0.45 * Math.sin(elapsed * bgStarBuf[b+4] + bgStarBuf[b+5])) * mul;
    if (br < 0.01) continue;
    let x = cx + Math.cos(ang) * d - mx * depth * 0.035;
    let y = cy + Math.sin(ang) * d - my * depth * 0.035;
    windOffset(x, y, depth); x += woX; y += woY;   // 夜风：星随风轻轻俯仰（景深分配）
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(208,220,255,${(br * cloudDim(x, y)).toFixed(2)})`;   // 云影：经过处星光变弱
    ctx.fill();
  }
}

// ============================================================
// 三、流星
// ============================================================
function spawnMeteor() {
  meteors.push({
    x:     Math.random() * W * 0.75,
    y:     Math.random() * H * 0.25,
    angle: Math.PI / 5 + (Math.random() - 0.5) * 0.35,
    speed: 9 + Math.random() * 7,
    len:   100 + Math.random() * 140,
    born:  performance.now(),
    life:  550 + Math.random() * 400,
  });
  meteorTimeout = setTimeout(spawnMeteor, 15000 + Math.random() * 10000);
}

// 流星画在顶层画布上，每帧整层清空——拖尾只来自当帧的渐变，绝不跨帧累积/残留。
function drawMeteors() {
  if (!fxCtx) return;
  // 无流星且上一帧也已清空：直接跳过（零开销）
  if (meteors.length === 0 && !meteorLayerDirty) return;

  fxCtx.clearRect(0, 0, W, H);   // 关键：每帧绘制前彻底清空流星层

  const now = performance.now();
  meteors = meteors.filter(m => {
    const t = (now - m.born) / m.life;
    if (t >= 1) return false;    // 寿命结束：移出数组 → 下一帧不再绘制 → 立即消失
    const alpha = t < 0.4 ? t / 0.4 : (1 - t) / 0.6;
    const hx = m.x + Math.cos(m.angle) * m.speed * t * 55;
    const hy = m.y + Math.sin(m.angle) * m.speed * t * 55;
    const tx = hx - Math.cos(m.angle) * m.len;
    const ty = hy - Math.sin(m.angle) * m.len;
    const g  = fxCtx.createLinearGradient(tx, ty, hx, hy);
    g.addColorStop(0,   'rgba(140,195,255,0)');         // 尾：完全透明
    g.addColorStop(0.6, `rgba(180,220,255,${(alpha * 0.35).toFixed(2)})`);
    g.addColorStop(1,   `rgba(255,255,255,${alpha.toFixed(2)})`);  // 头
    fxCtx.beginPath();
    fxCtx.moveTo(tx, ty); fxCtx.lineTo(hx, hy);
    fxCtx.strokeStyle = g; fxCtx.lineWidth = 1.4; fxCtx.stroke();
    return true;
  });

  meteorLayerDirty = meteors.length > 0;   // 记录本帧是否有内容，便于下帧决定是否需要清空
}

// ============================================================
// 四、心形坐标
// ============================================================
function buildHeartPoints(n, cx, cy, scale) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t  = (i / n) * Math.PI * 2;
    const hx =  16 * Math.pow(Math.sin(t), 3);
    const hy = -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));
    pts.push({ x: cx + hx * scale, y: cy + hy * scale });
  }
  return pts;
}

// ============================================================
// 五、颜色
// ============================================================
// 统一冷调：星白 → 蓝白（b≥g≥r，绝不偏黄）。
// 唯一的「暖星」留给第3步的彩蛋 —— 让它成为这片冷星野里唯一一点暖。
function pickColor(type) {
  if (type === 'bright') {
    // 亮星：近白的冷蓝白
    return { r:(226+Math.random()*22)|0, g:(236+Math.random()*15)|0, b:(250+Math.random()*5)|0 };
  }
  if (type === 'main') {
    // 主星：冷白
    return { r:(206+Math.random()*28)|0, g:(220+Math.random()*22)|0, b:(244+Math.random()*11)|0 };
  }
  // 远处微尘：暗蓝白
  return { r:(162+Math.random()*30)|0, g:(186+Math.random()*26)|0, b:(222+Math.random()*28)|0 };
}

// ============================================================
// 六、Particle 类
// ============================================================
class Particle {
  constructor(type, tx, ty, ix, iy) {
    this.type   = type;
    this.heartX = tx; this.heartY = ty;
    this.tx = tx;     this.ty = ty;
    this.x  = ix;     this.y  = iy;
    this.vx = 0;      this.vy = 0;
    this.isEscaping  = false;
    this.brownX = 0;  this.brownY = 0;

    if      (type === 'bright')  this.baseR = 2.5 + Math.random() * 1.5;
    else if (type === 'main')    this.baseR = 1.2 + Math.random() * 0.8;
    else                         this.baseR = 0.4 + Math.random() * 0.4;

    this.color       = pickColor(type);
    this.savedColor  = null;
    this.pulsePhase  = Math.random() * Math.PI * 2;
    this.pulsePeriod = 3000 + Math.random() * 3000;
    this.jitter      = (Math.random() - 0.5) * 0.65;
    this.tx1 = ix; this.ty1 = iy;
    this.tx2 = ix; this.ty2 = iy;

    // 星野渐现（SPREAD 阶段「渗透」用）
    this.vis        = 0;   // 当前可见度 0→1
    this.visTarget  = 0;   // 目标可见度
    this.appearDelay = 0;  // 错峰点亮延迟（ms）
    this.homeFx = 0; this.homeFy = 0;  // home 的分数坐标（resize 等比重算）
    this.trembleT = 0;     // 暖星「颤一下」的起始时刻
    this.htx = ix; this.hty = iy;   // 烟花「绽放」时的爱心轮廓目标
  }

  radius(elapsed) {
    return Math.max(0.1, this.baseR * (1 + 0.20 * Math.sin(elapsed / this.pulsePeriod * Math.PI * 2 + this.pulsePhase)));
  }

  // 粒子距当前目标的偏移量（用于连线断开判断）
  get displaced() {
    const dx = this.x - this.heartX, dy = this.y - this.heartY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  update(elapsed) {
    this.tx2 = this.tx1; this.ty2 = this.ty1;
    this.tx1 = this.x;   this.ty1 = this.y;

    // 渐现：进入 SPREAD 后，按各自错峰延迟点亮（星野「墨滴入水」式渗透）
    if (introState >= St.SPREAD && this.visTarget < 1) {
      if (performance.now() - spreadStartT >= this.appearDelay) this.visTarget = 1;
    }
    this.vis += (this.visTarget - this.vis) * 0.04;

    // 布朗微漂：仅完全交互态，让星野像在轻轻呼吸
    if (introState === St.COMPLETE) {
      this.brownX = this.brownX * 0.96 + (Math.random() - 0.5) * 0.18;
      this.brownY = this.brownY * 0.96 + (Math.random() - 0.5) * 0.18;
    }
    const btx = this.tx + Math.max(-3, Math.min(3, this.brownX));
    const bty = this.ty + Math.max(-3, Math.min(3, this.brownY));

    // 弹簧回归 / 烟花各阶段
    if (explodePhase === 'gather') {
      this.vx += (this.htx - this.x) * 0.045;   // 缓慢聚拢到爱心轮廓
      this.vy += (this.hty - this.y) * 0.045;
    } else if (explodePhase === 'hold') {
      this.vx += (this.htx - this.x) * 0.10;     // 停顿：定在爱心上
      this.vy += (this.hty - this.y) * 0.10;
    } else if (explodePhase === 'snow') {
      this.vy += 0.035;                           // 轻轻散开后如雪缓降
      this.vx += (btx - this.x) * curSpring * 0.35;
      this.vy += (bty - this.y) * curSpring * 0.35;
    } else if (!(this === shyStar && introState === St.COMPLETE)) {
      this.vx += (btx - this.x) * curSpring;      // 正常 home 弹簧
      this.vy += (bty - this.y) * curSpring;
    }

    // 星野渗透：轻微随机扰动，像萤火虫缓缓散开
    if (introState === St.SPREAD) {
      this.vx += (Math.random() - 0.5) * 0.18;
      this.vy += (Math.random() - 0.5) * 0.18;
    }

    // 鼠标交互（仅 COMPLETE 且非爆炸；入场期间不响应）
    if (introState === St.COMPLETE && explodePhase === 'idle') {
      const mdx = mouse.x - this.x;
      const mdy = mouse.y - this.y;
      const md  = Math.sqrt(mdx*mdx + mdy*mdy);

      if (this === shyStar) {
        // 认生的星：朝光标靠近，停在 shyStop 处（随访问越来越近）
        const hx = this.heartX - mouse.x, hy = this.heartY - mouse.y;
        const hd = Math.hypot(hx, hy) || 1;
        const tgx = mouse.x + (hx / hd) * shyStop;
        const tgy = mouse.y + (hy / hd) * shyStop;
        this.vx += (tgx - this.x) * 0.03 * shySpeed;
        this.vy += (tgy - this.y) * 0.03 * shySpeed;
      } else if (md < MOUSE_INNER && md > 0) {
        const f = (1 - md / MOUSE_INNER) * 3.5;
        this.vx += (mdx / md) * f;
        this.vy += (mdy / md) * f;
      } else if (md < MOUSE_OUTER && md > 0) {
        const f = (1 - (md - MOUSE_INNER) / (MOUSE_OUTER - MOUSE_INNER)) * MOUSE_FORCE;
        const a = Math.atan2(-mdy, -mdx) + this.jitter;
        this.vx += Math.cos(a) * f;
        this.vy += Math.sin(a) * f;
        maybePlayStarGlint();
      }
    }

    // 暖星彩蛋：被「发现」后颤一下（700ms 衰减抖动），不重复
    if (this === warmStar && this.trembleT) {
      const dt = performance.now() - this.trembleT;
      if (dt < 700) {
        const amp = (1 - dt / 700) * 1.1;
        this.vx += Math.sin(dt * 0.07) * amp;
        this.vy += Math.cos(dt * 0.05) * amp * 0.5;
      } else {
        this.trembleT = 0;
      }
    }

    this.vx *= DAMPING; this.vy *= DAMPING;
    this.x  += this.vx; this.y  += this.vy;
  }

  drawTrail(elapsed) {
    if (explodePhase !== 'blast') return;
    const r = this.radius(elapsed);
    const { r:cr, g:cg, b:cb } = this.color;
    ctx.beginPath();
    ctx.arc(this.tx1, this.ty1, r*0.62, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.32)`; ctx.fill();
    ctx.beginPath();
    ctx.arc(this.tx2, this.ty2, r*0.32, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.14)`; ctx.fill();
  }

  draw(elapsed) {
    let va = this.vis * lifeFactor * (1 - starFade);   // 全场呼吸 × 清醒度；日出时星渐隐
    // 涟漪：波前扫过这颗星时，它暗一下
    if (ripples.length) {
      const now = performance.now();
      for (let k = 0; k < ripples.length; k++) {
        const rp = ripples[k];
        const front = (now - rp.born) * 0.55;
        const dd = Math.abs(Math.hypot(this.x - rp.cx, this.y - rp.cy) - front);
        if (dd < 70) va *= (0.4 + 0.6 * (dd / 70));
      }
    }
    // 长明：经过它光晕的星，都会被照亮（灯照亮门口）
    if (lampR > 0) {
      const ld2 = (this.x - lampX) * (this.x - lampX) + (this.y - lampY) * (this.y - lampY);
      if (ld2 < lampR * lampR) va *= 1 + (1 - Math.sqrt(ld2) / lampR) * 0.7;
    }
    va *= cloudDim(this.x, this.y);        // 云影：经过处星光变弱（灯不受影响）
    if (va < 0.01) return;                 // 尚未点亮 / 睡得太深：不画
    windOffset(this.x, this.y, 0.8);       // 夜风：星野随风俯仰（近层，仅绘制偏移、不动物理）
    const px = this.x + woX, py = this.y + woY;
    const r  = this.radius(elapsed);
    // 极淡的冷暖微漂（30s 一周期），克制，不再粉紫
    const drift  = Math.sin(elapsed / 30000 * Math.PI * 2 + this.pulsePhase);
    const { r:cr, g:cg, b:cb } = this.color;
    const gr = cr, gg = (cg + drift * 5) | 0, gb = Math.min(255, (cb + drift * 7) | 0);

    const shyB = (this === shyStar) ? 1.7 : 1;   // 认生的星：靠近时微微变亮

    if (this.type !== 'ambient') {
      const glowR = r * 2.5 * shyB;
      const glr   = this.type === 'bright' ? Math.min(gr+20,255) : gr;
      const glg   = this.type === 'bright' ? Math.min(gg+10,255) : gg;
      const ga    = Math.min(1, (this.type === 'bright' ? 0.75 : 0.44) * va * shyB);
      const grd   = ctx.createRadialGradient(px, py, 0, px, py, glowR);
      grd.addColorStop(0, `rgba(${glr},${glg},${gb},${ga})`);
      grd.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
      ctx.beginPath(); ctx.arc(px, py, glowR, 0, Math.PI*2);
      ctx.fillStyle = grd; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${gr},${gg},${gb},${((this.type==='ambient'?0.68:1.0)*va).toFixed(3)})`;
    ctx.fill();
  }
}

// ============================================================
// 七、OrbitParticle（星环，phase 1）
// ============================================================
class OrbitParticle {
  constructor(i) {
    this.angle  = (i / N_ORBIT) * Math.PI * 2 + Math.random() * 0.4;
    this.speed  = (0.0017 + Math.random() * 0.0010) * (Math.random() > 0.5 ? 1 : -1);
    this.r      = 1.1 + Math.random() * 1.0;
    this.alpha  = 0; this.orbitR = 0;
    this.color  = { r:255, g:(170+Math.random()*48)|0, b:(215+Math.random()*40)|0 };
  }
  update(ta, tr) {
    this.angle  += this.speed;
    this.alpha  += (ta - this.alpha)  * 0.015;
    this.orbitR += (tr - this.orbitR) * 0.02;
  }
  draw() {
    if (this.alpha < 0.01) return;
    const x = heartCX + Math.cos(this.angle) * this.orbitR;
    const y = heartCY + Math.sin(this.angle) * this.orbitR * 0.78;
    const { r, g, b } = this.color;
    const grd = ctx.createRadialGradient(x,y,0,x,y,this.r*3.5);
    grd.addColorStop(0, `rgba(${r},${g},${b},${this.alpha*0.85})`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath(); ctx.arc(x,y,this.r*3.5,0,Math.PI*2); ctx.fillStyle=grd; ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,this.r,0,Math.PI*2);
    ctx.fillStyle=`rgba(${r},${g},${b},${this.alpha})`; ctx.fill();
  }
}

// ============================================================
// 八、BokehBlob（背景漂移光斑）
// ============================================================
const BLOB_C = [{r:110,g:140,b:205},{r:140,g:135,b:200},{r:108,g:168,b:212}]; // 冷调星云光斑
class BokehBlob {
  constructor(i) { this.color=BLOB_C[i%3]; this._init(true); }
  _init(rnd) {
    if (rnd) { this.x=W*Math.random(); this.y=H*Math.random(); }
    else {
      const s=Math.random()*4|0;
      if(s===0){this.x=-200;this.y=H*Math.random();}
      else if(s===1){this.x=W+200;this.y=H*Math.random();}
      else if(s===2){this.x=W*Math.random();this.y=-200;}
      else{this.x=W*Math.random();this.y=H+200;}
    }
    this.r=80+Math.random()*70; this.alpha=0.03+Math.random()*0.05;
    this.angle=Math.random()*Math.PI*2; this.speed=0.11+Math.random()*0.20;
    this.dAngle=(Math.random()-0.5)*0.004;
  }
  update() {
    this.angle+=this.dAngle; this.x+=Math.cos(this.angle)*this.speed; this.y+=Math.sin(this.angle)*this.speed;
    if(this.x<-300||this.x>W+300||this.y<-300||this.y>H+300) this._init(false);
  }
  draw(mul) {
    const {r,g,b}=this.color;
    const a = this.alpha * ((mul === undefined) ? 1 : mul);
    const grd=ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,this.r);
    grd.addColorStop(0,`rgba(${r},${g},${b},${a})`);
    grd.addColorStop(1,`rgba(${r},${g},${b},0)`);
    ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fillStyle=grd; ctx.fill();
  }
}

// ============================================================
// 九、StarFollower（四角自转星星）
// ============================================================
class StarFollower {
  constructor() {
    this.x=W/2; this.y=H/2; this.vx=0; this.vy=0;
    this.offX=(Math.random()-0.5)*55; this.offY=(Math.random()-0.5)*55;
    this.size=2.2+Math.random()*2.0; this.rot=Math.random()*Math.PI;
    this.rotSpd=(Math.random()-0.5)*0.046; this.alpha=0; this.phase=Math.random()*Math.PI*2;
  }
  update(elapsed) {
    const tx=mouse.x+this.offX, ty=mouse.y+this.offY;
    this.vx+=(tx-this.x)*0.05; this.vy+=(ty-this.y)*0.05;
    this.vx*=0.82; this.vy*=0.82; this.x+=this.vx; this.y+=this.vy; this.rot+=this.rotSpd;
    const vis=(mouse.x>0&&mouse.x<W&&mouse.y>0&&mouse.y<H)?1:0;
    this.alpha+=(vis-this.alpha)*0.06;
  }
  draw(elapsed) {
    if (this.alpha<0.01) return;
    const pulse=0.70+0.30*Math.sin(elapsed/850+this.phase);
    const s=this.size*pulse, a=this.alpha*pulse*0.88;
    ctx.save(); ctx.translate(this.x,this.y); ctx.rotate(this.rot);
    ctx.beginPath();
    for (let i=0;i<4;i++) {
      const oa=(i/4)*Math.PI*2, ia=oa+Math.PI/4;
      i===0?ctx.moveTo(s*Math.cos(oa),s*Math.sin(oa)):ctx.lineTo(s*Math.cos(oa),s*Math.sin(oa));
      ctx.lineTo(s*0.36*Math.cos(ia),s*0.36*Math.sin(ia));
    }
    ctx.closePath();
    ctx.shadowColor=`rgba(255,210,232,${a*0.9})`; ctx.shadowBlur=s*5;
    ctx.fillStyle=`rgba(255,242,252,${a})`; ctx.fill();
    ctx.shadowBlur=0; ctx.restore();
  }
}

// ============================================================
// 十、初始化工具
// ============================================================
function edgePos() {
  const ang=Math.random()*Math.PI*2;
  const d=Math.min(W,H)*0.50+Math.random()*Math.min(W,H)*0.28;
  return [heartCX+Math.cos(ang)*d, heartCY+Math.sin(ang)*d];
}

function shuffle(arr) {
  for (let i=arr.length-1;i>0;i--) {
    const j=Math.random()*(i+1)|0; [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

// ============================================================
// 十一、init / resize
// ============================================================
// 星野 home 的分数坐标（满屏分布，留边）
function buildFieldFractions(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ fx: 0.05 + Math.random() * 0.90, fy: 0.07 + Math.random() * 0.86 });
  }
  return out;
}

// 黑暗颗粒缓冲（每颗 3 个 float：fx, fy, phase）
function initGrain() {
  grainBuf = new Float32Array(60 * 3);
  for (let i = 0; i < 60; i++) {
    const b = i * 3;
    grainBuf[b]   = Math.random();
    grainBuf[b+1] = Math.random();
    grainBuf[b+2] = Math.random() * Math.PI * 2;
  }
}

function init() {
  setupCanvas();
  setupBloom();
  setupMeteorLayer();
  // 烟花爱心的中心/尺度（不再常驻显示，仅第4步烟花瞬间成形时用）
  heartScale = Math.min((W*0.60)/32, (H*0.50)/29);
  heartCX    = W/2;
  heartCY    = H*0.46;

  // 粒子的初始聚拢点 = 灯的位置：星野从灯的光里向外渗出
  const cx = LAMP_FX * W, cy = LAMP_FY * H;

  if (particles.length === 0) {
    const homes = buildFieldFractions(N_HEART + N_AMBIENT + EXTRA_STARS);
    let hi = 0;
    const mk = (type) => {
      const f  = homes[hi++];
      const hx = f.fx * W, hy = f.fy * H;
      // 初始位置：聚拢在中心附近 —— SPREAD 阶段由此向外「渗透扩散」
      const ix = cx + (hx - cx) * 0.12 + (Math.random()-0.5)*20;
      const iy = cy + (hy - cy) * 0.12 + (Math.random()-0.5)*20;
      const p  = new Particle(type, hx, hy, ix, iy);
      p.homeFx = f.fx; p.homeFy = f.fy;
      p.appearDelay = Math.random() * 6000;   // 错峰点亮（渗透感）
      return p;
    };
    for (let i=0;i<N_BRIGHT;i++)        particles.push(mk('bright'));
    for (let i=N_BRIGHT;i<N_HEART;i++)  particles.push(mk('main'));
    for (let i=0;i<N_AMBIENT;i++)       particles.push(mk('ambient'));
    for (let i=0;i<EXTRA_STARS;i++)     particles.push(mk('ambient')); // 一次一星

    firstStarIdx = 0;  // 第一颗星：取一颗 bright

    // 暖星彩蛋：固定一颗 bright 星，色温比全场都暖一点点（全场唯一的暖）
    warmStar = particles[3] || particles[0];
    warmStar.color = { r:255, g:240, b:214 };

    for (let i=0;i<N_ORBIT;   i++) orbitParticles.push(new OrbitParticle(i));  // 暂留，开场不启用
    for (let i=0;i<3;         i++) bokehBlobs.push(new BokehBlob(i));
    for (let i=0;i<N_FOLLOWER;i++) starFollowers.push(new StarFollower());
    initBgStars();
    initGrain();
  } else {
    // resize：按分数等比重算 home
    particles.forEach(p => {
      p.heartX = p.tx = p.homeFx * W;
      p.heartY = p.ty = p.homeFy * H;
    });
    initBgStars();
  }
  initLamp();   // 长明的几何与纱（resize 重算几何、保留纱）
  initDust();   // 星尘
  initClouds(); // 云影
}

// ============================================================
// 十二、五阶段开场（第一夜：黑 → 一颗星 → 星野渗透 → 名字 → 完全交互）
// ============================================================
// 时间线随访问次数压缩（tScale）：每次回来，门开得更快一点。
function startIntro() {
  introState = St.DARK;
  curSpring  = 0;
  bgRevealAlpha = 0; grainAlpha = 1;
  introWrap.style.display = 'none';      // 名字不再常驻，只在 NAME 阶段说一次

  const T_DARK = 1800 * tScale;          // 阶段0：黑暗保持
  const T_WAIT = 4500 * tScale;          // 阶段1：第一颗星等待「触碰」的上限

  // 阶段0 → 阶段1：黑暗中亮起第一颗星
  setTimeout(()=>{
    if (introState === St.DARK){ introState = St.FIRST_STAR; positionFirstStar(); }
  }, T_DARK);

  // 阶段1 → 阶段2：她一触碰就推进（见 onFirstGesture）；此处是兜底——始终不动也会继续
  setTimeout(()=>{ advanceToSpread(); }, T_DARK + T_WAIT);
}

// 第一颗星：偏左下，独自亮起 —— 它不再是一颗会融进星野的粒子，
// 它就是「长明」本身（淡入由 lampAlpha 驱动，见 animate）。它比宇宙先在。
function positionFirstStar() {
  firstStarPos = { x: lampX, y: lampY };
  playHerNote();   // 她的专属音随第一颗星（=灯）亮起而响
  if (longAway) lampSwayT = performance.now();   // 久别重逢：灯亮起时先晃一下，像有人提灯到门口看一眼
}

// 阶段2：星野渗透 —— 粒子从灯的光里向外扩散、错峰点亮
function advanceToSpread() {
  if (introState !== St.FIRST_STAR) return;
  introState = St.SPREAD;
  curSpring  = GATHER_SPRING;
  spreadStartT = performance.now();
  setTimeout(()=>{ enterNameStage(); }, 9000 * tScale);
}

// 阶段3：名字 —— 说当晚那一句（说完即焚），随后碎成星尘
function enterNameStage() {
  introState = St.NAME;
  curSpring  = SPRING_K;
  const s = pickOpeningSentence();
  if (s) {
    showSentence(s.text);
    markSaid(s.key);
    setTimeout(()=>{ dissolveSentence(enterComplete); }, 5000 * tScale + 1400);
  } else {
    setTimeout(enterComplete, 1500);     // 沉默之夜：什么都不说
  }
}

// 阶段4：完全交互
function enterComplete() {
  introState = St.COMPLETE;
  meteorTimeout = setTimeout(spawnMeteor, 8000 + Math.random()*12000);
  lampPulseTimer = performance.now() + 30000 + Math.random()*30000;   // 长明首次脉动：30~60s 后
  seedTravelers();   // 她推门进来时，天上已有人正在路过

  // 第100夜日出（前几分钟一切如常，安静下来后才发生）
  if (DBG.sunrise || (visitCount >= 100 && !hasSaid('s_hundred'))) {
    setTimeout(() => { if (introState === St.COMPLETE) startSunrise(); }, DBG.sunrise ? 3500 : 18000);
  }
  // 生日弯月（8月17日）
  if (isBirthday) {
    setTimeout(() => { if (introState === St.COMPLETE) startBirthdayMoon(); }, 6000);
  }
}

// ============================================================
// 十三、七句话（说过即焚）—— 开场阶段触发的几句
// ============================================================
// 第50/100夜、生日的句子需后续步骤的视觉支撑（月亮/日出/和弦），暂以 defer 标记延后。
const OPENING_SENTENCES = [
  { key:'s_name',     text:'晓语',                                           when:c=>c.visit===1 },
  { key:'s_ten',      text:'今晚的天上，比你第一次来的时候，多了十颗星。',     when:c=>c.visit>=10 },
  { key:'s_fifty',    text:'这里的每一颗星，都是一句没说出口的话。',           when:c=>c.visit>=50 },
  { key:'s_latenight',text:'这么晚。没关系，星星也都醒着。',                  when:c=>c.hour>=0 && c.hour<5 },
  { key:'s_back',     text:'你回来了。',                                      when:c=>c.visit>=2 },
  { key:'s_birthday1',text:'这个宇宙没有月亮。除了今天。', defer:true,         when:c=>c.isBirthday },
  { key:'s_hundred',  text:'这是一百个夜晚没说出口的话，一起开口的声音。', defer:true, when:c=>c.visit>=100 },
];
function pickOpeningSentence() {
  const ctx = { visit: visitCount, hour, isBirthday, longAway };
  for (const s of OPENING_SENTENCES) {
    if (s.defer || hasSaid(s.key)) continue;
    if (s.when(ctx)) return s;
  }
  return null;
}

// 文字浮现：偏左下，极细、不发光
function showSentence(text) {
  introWrap.style.display = 'block';
  introLine2.style.display = 'none';
  const el = introLine1;
  el.textContent         = text;
  el.style.position      = 'fixed';
  el.style.left          = '11%';
  el.style.top           = '60%';
  el.style.transform     = 'none';
  el.style.margin        = '0';
  el.style.maxWidth      = '78vw';
  el.style.fontSize      = 'clamp(15px, 2vw, 22px)';
  el.style.fontWeight    = '300';
  el.style.letterSpacing = '0.22em';
  el.style.color         = 'rgba(238,240,248,0.92)';
  el.style.textShadow    = 'none';
  el.style.transition    = 'opacity 2.2s ease';
  el.style.opacity       = '0';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ el.style.opacity = '1'; }));
}

// 碎成星尘：文字淡出 + 在原位生成飘散的星尘
function dissolveSentence(cb) {
  const el = introLine1;
  const rect = el.getBoundingClientRect();
  spawnStardust(rect);
  el.style.transition = 'opacity 1.6s ease';
  el.style.opacity = '0';
  setTimeout(()=>{ if (cb) cb(); }, 1700);
}

function spawnStardust(rect) {
  const n = 30;
  for (let i = 0; i < n; i++) {
    dustParticles.push({
      x: rect.left + Math.random()*Math.max(rect.width, 30),
      y: rect.top  + Math.random()*Math.max(rect.height, 16),
      vx: (Math.random()-0.5)*0.5,
      vy: -0.15 - Math.random()*0.5,
      r:  0.6 + Math.random()*1.3,
      born: performance.now(),
      life: 2200 + Math.random()*1600,
    });
  }
}

function drawDust() {
  if (dustParticles.length === 0) return;
  const now = performance.now();
  dustParticles = dustParticles.filter(d => {
    const t = (now - d.born) / d.life;
    if (t >= 1) return false;
    d.x += d.vx; d.y += d.vy; d.vy += 0.002;
    const a = (1 - t) * 0.8;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI*2);
    ctx.fillStyle = `rgba(235,238,250,${a.toFixed(3)})`; ctx.fill();
    return true;
  });
}

// 黑暗中的细颗粒（眼睛适应暗房间的颗粒感），SPREAD 后淡出
function drawGrain(elapsed) {
  if (grainAlpha < 0.01 || !grainBuf) return;
  for (let i = 0; i < 60; i++) {
    const b  = i * 3;
    const x  = (grainBuf[b]   + Math.sin(elapsed*0.00004 + grainBuf[b+2])*0.02) * W;
    const y  = (grainBuf[b+1] + Math.cos(elapsed*0.00003 + grainBuf[b+2])*0.02) * H;
    const tw = 0.5 + 0.5 * Math.sin(elapsed*0.001 + grainBuf[b+2]);
    ctx.beginPath(); ctx.arc(x, y, 0.7, 0, Math.PI*2);
    ctx.fillStyle = `rgba(150,160,190,${(0.05*grainAlpha*tw).toFixed(3)})`; ctx.fill();
  }
}

// 开场中再次触碰：推进开场（声音已在「轻触苏醒」时启动，这里只管推进）
function onFirstGesture() {
  if (introState === St.FIRST_STAR) advanceToSpread();
}

// 旧的「诗意阶段 / 粒子逃逸 / 三连击金色 / Ctrl+L 星空 / 5分钟提示」彩蛋已全部移除
// （与 Fable 版冲突）。新的"彩蛋"是：暖星 + 七句话 + 第100夜日出 + 生日弯月。

// ============================================================
// 十九、点击 = 向天空提问（克制的随机回应；约 1/10 沉默）
// ============================================================
function askSky(cx, cy) {
  if (introState !== St.COMPLETE || explodePhase !== 'idle') return;
  const roll = Math.random();
  if      (roll < 0.10) { return; }              // 沉默：天空只是看着她
  else if (roll < 0.42) heartBlossom(cx, cy);    // 温柔绽放：爱心0.5秒闪现→雪落
  else if (roll < 0.74) rippleAt(cx, cy);         // 涟漪：星空轻颤
  else                  meteorAnswer();           // 远年流星
}

// 温柔绽放：缓慢聚成爱心轮廓 → 停顿0.5s → 轻轻散开 → 如雪缓降
// （六步结构，力度 −70%，冲击波极淡，不浮现名字）
function heartBlossom(cx, cy) {
  explodePhase = 'gather';
  const scale = Math.min(W, H) / 75;
  const hw = 16 * scale, hh = 17 * scale;
  cx = Math.max(hw + 24, Math.min(W - hw - 24, cx));   // 夹住，整颗爱心不出界
  cy = Math.max(hh + 24, Math.min(H - hh - 24, cy));
  const pts = shuffle(buildHeartPoints(particles.length, cx, cy, scale));
  particles.forEach((p, i) => { p.htx = pts[i].x; p.hty = pts[i].y; });

  clearTimeout(contractTimer); clearTimeout(explodeTimer);
  contractTimer = setTimeout(() => {            // 聚拢 0.7s 后
    explodePhase = 'hold';
    addShockwaves(cx, cy);                       // 极淡冲击波
    dustGust(cx, cy);                            // 绽放气流：把附近的尘轻轻荡开
    playBloomChord();                            // 第5步：合成音
    setTimeout(() => {                           // 停顿 0.5s 后轻轻散开
      explodePhase = 'snow';
      particles.forEach(p => {
        const ang = Math.random() * Math.PI * 2;
        const spd = 11 * (0.4 + Math.random() * 0.7);   // 原 38，−70%
        p.vx = Math.cos(ang) * spd * 0.6;
        p.vy = Math.sin(ang) * spd * 0.6 - 1.2;         // 先微微上扬，再如雪落下
      });
      explodeTimer = setTimeout(() => { explodePhase = 'idle'; }, 2800);
    }, 500);
  }, 700);
}

// 涟漪：从点击处荡开，所有星依次暗一下再亮（粒子变暗在 Particle.draw 里处理）
function rippleAt(cx, cy) { ripples.push({ cx, cy, born: performance.now() }); }
function drawRipples() {
  if (!ripples.length) return;
  const now = performance.now();
  const maxFront = Math.hypot(W, H);
  ripples = ripples.filter(rp => {
    const front = (now - rp.born) * 0.55;
    if (front > maxFront) return false;
    const a = Math.max(0, 0.06 * (1 - front / maxFront)) * lifeFactor * bgRevealAlpha;
    if (a > 0.002) {
      ctx.beginPath(); ctx.arc(rp.cx, rp.cy, front, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200,215,255,${a.toFixed(3)})`; ctx.lineWidth = 1; ctx.stroke();
    }
    return true;
  });
}

// 远年流星：一道很远、很慢的流星（光出发于几年前，到得比出发晚很多）
function meteorAnswer() {
  meteors.push({
    x:     W * 0.1 + Math.random() * W * 0.7,
    y:     Math.random() * H * 0.2,
    angle: Math.PI / 5 + (Math.random() - 0.5) * 0.3,
    speed: 5 + Math.random() * 4,
    len:   120 + Math.random() * 160,
    born:  performance.now(),
    life:  900 + Math.random() * 500,
  });
}

// 极淡冲击波：绽放时几乎看不见的一圈涟漪
function addShockwaves(cx, cy) {
  shockwaves.push({ x:cx, y:cy, r:0, color:{r:210,g:222,b:255}, maxR:Math.min(W,H)*0.45, speed:3.0 });
}

// ============================================================
// 连星成座：在星与星之间拖出细线，永久极淡留存
// ============================================================
function nearestStar(x, y, maxDist) {
  let best = null, bd = maxDist * maxDist;
  for (const p of particles) {
    if (p.type === 'ambient' || p.vis < 0.3) continue;
    const dx = p.x - x, dy = p.y - y, d2 = dx*dx + dy*dy;
    if (d2 < bd) { bd = d2; best = p; }
  }
  return best;
}
function addConstellation(p1, p2) {
  constellations.push({ ax:p1.homeFx, ay:p1.homeFy, bx:p2.homeFx, by:p2.homeFy });
  saveConstel();
  playBloomChord();
}
function drawConstellations(m) {
  if (!constellations.length || m < 0.02) return;
  ctx.lineWidth = 0.6;
  for (const c of constellations) {
    ctx.beginPath();
    ctx.moveTo(c.ax * W, c.ay * H);
    ctx.lineTo(c.bx * W, c.by * H);
    ctx.strokeStyle = `rgba(190,205,240,${(0.10 * m).toFixed(3)})`;
    ctx.stroke();
  }
}
// 拖拽时的预览连线
function drawDragPreview() {
  if (!press || !press.star || mouse.x < 0) return;
  if (Math.hypot(mouse.x - press.sx, mouse.y - press.sy) < CONNECT_MIN) return;
  ctx.beginPath();
  ctx.moveTo(press.star.x, press.star.y);
  ctx.lineTo(mouse.x, mouse.y);
  ctx.strokeStyle = 'rgba(210,222,255,0.35)'; ctx.lineWidth = 0.8; ctx.stroke();
}

// ============================================================
// 二十一、连线（近鼠标变亮，粒子偏离时断线）
// ============================================================
function drawLines() {
  const dist  = phase===0?LINE_DIST:phase===1?72:56;
  const dist2 = dist*dist;
  const md2   = MOUSE_OUTER*MOUSE_OUTER;

  for (let i=0;i<particles.length;i++) {
    const pi=particles[i];
    // 粒子偏离心形太远时跳过（连线断开效果）
    if (pi.displaced>55) continue;
    for (let j=i+1;j<particles.length;j++) {
      const pj=particles[j];
      if (pj.displaced>55) continue;
      const dx=pi.x-pj.x, dy=pi.y-pj.y;
      const d2=dx*dx+dy*dy;
      if (d2>=dist2) continue;
      const d=Math.sqrt(d2);
      let al,lw;
      if      (d<30){al=0.58;lw=1.2;}
      else if (d<60){al=0.26;lw=0.7;}
      else          {al=0.07;lw=0.3;}
      // 鼠标点亮：任一端点在鼠标范围内则提亮
      const midX=(pi.x+pj.x)*0.5, midY=(pi.y+pj.y)*0.5;
      const dmx=midX-mouse.x, dmy=midY-mouse.y;
      if (dmx*dmx+dmy*dmy<md2) al=Math.min(0.90, al*2.2);

      const mr=(pi.color.r+pj.color.r)>>1;
      const mg=(pi.color.g+pj.color.g)>>1;
      const mb=(pi.color.b+pj.color.b)>>1;
      ctx.beginPath(); ctx.moveTo(pi.x,pi.y); ctx.lineTo(pj.x,pj.y);
      ctx.strokeStyle=`rgba(${mr},${mg},${mb},${al})`; ctx.lineWidth=lw; ctx.stroke();
      if (d<30) {
        ctx.beginPath(); ctx.moveTo(pi.x,pi.y); ctx.lineTo(pj.x,pj.y);
        ctx.strokeStyle=`rgba(${mr},${mg},${mb},0.09)`; ctx.lineWidth=5; ctx.stroke();
      }
    }
  }
}

// ============================================================
// 二十二、鼠标光尾
// ============================================================
function updateMouseHistory() {
  if (mouse.x<0||mouse.x>W) return;
  const now=performance.now();
  mouseHistory.push({x:mouse.x,y:mouse.y,t:now});
  if (mouseHistory.length>80) mouseHistory.shift();
  // 只保留最近 800ms
  while(mouseHistory.length>0&&now-mouseHistory[0].t>800) mouseHistory.shift();
}

function drawMouseTrail() {
  const now=performance.now();
  for (let i=1;i<mouseHistory.length;i++) {
    const p=mouseHistory[i];
    const age=(now-p.t)/800;
    if (age >= 1) continue;                 // 防止半径变负（否则 arc() 抛错、整个动画循环崩溃）
    const rr = 2.5*(1-age);
    if (rr <= 0) continue;
    const a=(1-age)*0.18;
    ctx.beginPath(); ctx.arc(p.x,p.y,rr,0,Math.PI*2);
    ctx.fillStyle=`rgba(200,215,255,${a.toFixed(3)})`;  // 冷调微光（原为粉色）
    ctx.fill();
  }
}

// ============================================================
// 二十三、背景渲染
// ============================================================
function drawBackground(elapsed) {
  // 每帧彻底清空整个画布，再铺一层实色夜幕（颜色随时辰）。
  // 不再用半透明拖尾 —— 这样连线、流星、运动残影都只属于当前帧，绝不长期累积。
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = TT.solid;
  ctx.fillRect(0, 0, W, H);

  // 长明的纱+晕：自带 lampAlpha 门，FIRST_STAR（星野尚未浮现）时就已亮 —— 它比宇宙先在
  drawLampHalo(elapsed);

  if (bgRevealAlpha > 0.01) {
    const m = bgRevealAlpha * lifeFactor;
    // 时辰边缘色：清晨顶部微紫 / 黄昏底部余烬橙
    if (TT.edge) {
      const e = TT.edge;
      const g = (e.pos === 'top')
        ? ctx.createLinearGradient(0, 0, 0, H * 0.55)
        : ctx.createLinearGradient(0, H, 0, H * 0.45);
      g.addColorStop(0, `rgba(${e.r},${e.g},${e.b},${(e.a*m).toFixed(3)})`);
      g.addColorStop(1, `rgba(${e.r},${e.g},${e.b},0)`);
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    }
    const ms = m * (1 - starFade);                   // 日出时整片天（含痕迹/星座/守夜星）一起隐去
    drawBgStars(elapsed, ms * TT.starMul);
    drawDustMotes(bgRevealAlpha * (1 - starFade));   // 星尘：穿过灯光才被点亮（不随睡眠变暗，只随揭幕/日出）
    drawTravelers(bgRevealAlpha * (1 - starFade));   // 夜行者：横穿夜空的微光
    drawTraceHeatmap(ms);                            // 她走过的痕迹（跨会话）
    drawConstellations(ms);                          // 她画下的星座（跨会话）
    bokehBlobs.forEach(b=>{ b.update(); b.draw(ms); });
    drawDawnLine();                                  // 底部天光（黎明进度 / 日出）
  }
}

// 守夜星：深夜正上方，比谁都亮，整夜不动
function drawNightWatchStar(elapsed, m) {
  const x = W/2, y = H*0.12;
  const pulse = 0.85 + 0.15 * Math.sin(elapsed * 0.0006);
  const a = m * pulse;
  const grd = ctx.createRadialGradient(x, y, 0, x, y, 11);
  grd.addColorStop(0, `rgba(235,242,255,${(0.85*a).toFixed(3)})`);
  grd.addColorStop(1, 'rgba(235,242,255,0)');
  ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI*2); ctx.fillStyle = grd; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI*2);
  ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; ctx.fill();
}

// ============================================================
// 长明：常态宇宙的心脏（核 + 晕 + 纱 / 呼吸 / 脉动 / 照亮）
// ============================================================
function initLamp() {
  lampX = LAMP_FX * W;
  lampY = LAMP_FY * H;
  lampR = Math.min(W, H) * 0.13;       // 光晕（照亮）半径
  lampDiag = Math.hypot(W, H);
  if (lampWisps.length === 0) {         // 纱：六缕雾丝，分钟级缓慢绕行、永不重复
    for (let i = 0; i < 6; i++) {
      lampWisps.push({
        base: Math.random() * Math.PI * 2,
        dist: 0.20 + Math.random() * 0.65,        // 相对 lampR
        rad:  0.50 + Math.random() * 0.60,        // 相对 lampR
        a:    0.013 + Math.random() * 0.020,
        spd:  (Math.random() - 0.5) * 0.000022,   // rad/ms，约 5 分钟一圈
      });
    }
  }
}

// 每帧更新灯的「举止」：迎向鼠标 / 久别晃一下 / 越闲越显 / 越烧越稳
function updateLamp() {
  const now = performance.now();

  // ① 迎向鼠标：她的光标探进灯的领域时，灯心朝她轻轻倾过去（全世界都怕她碰，只有它把光递过来）
  let tlx = 0, tly = 0, leanInfluence = 0;
  if (mouse.x >= 0 && mouse.x <= W) {
    const dx = mouse.x - lampX, dy = mouse.y - lampY;
    const d  = Math.hypot(dx, dy);
    const reach = lampR * 1.7;
    if (d < reach && d > 0.001) {
      leanInfluence = 1 - d / reach;                       // 边缘 0 → 中心 1
      const mag = Math.min(d, lampR * 0.16) * leanInfluence;
      tlx = (dx / d) * mag; tly = (dy / d) * mag;
    }
  }
  lampLeanX += (tlx - lampLeanX) * 0.08;                    // 像火苗迎着一口气，缓而柔
  lampLeanY += (tly - lampLeanY) * 0.08;

  // ③ 存在感与活跃度成反比：她玩得欢，灯退成背景；她一停下，灯渐渐显出来独自守夜
  const idle = now - lastActivityT;
  const presenceTarget = idle < 1500 ? 0.85
                        : (idle < 60000 ? 0.85 + ((idle - 1500) / 58500) * 0.30 : 1.15);
  lampPresence += (presenceTarget - lampPresence) * 0.015;

  // ④ 越烧越稳：最初几夜有极轻的怕生颤，约第 30 夜后纹丝不乱（她不会察觉，只觉这角落越来越「定」）
  const steady = Math.min(1, Math.max(0, (visitCount - 1) / 30));
  const flick  = (Math.sin(now * 0.013) + Math.sin(now * 0.0219 + 1.3)) * 0.5;
  const jit    = (1 - steady) * lampR * 0.022;
  const jx = flick * jit, jy = Math.sin(now * 0.017 + 0.7) * jit * 0.6;
  const flickBright = 1 + flick * (1 - steady) * 0.05;

  // ② 久别重逢：苏醒时先晃一下（像有人提着灯走到门口看了一眼），随即收住、平稳
  let sx = 0, sy = 0;
  if (lampSwayT) {
    const dt = now - lampSwayT;
    if (dt < 1700) {
      const amp = (1 - dt / 1700) * lampR * 0.20;
      sx = Math.sin(dt * 0.011) * amp;
      sy = Math.sin(dt * 0.011) * amp * 0.18;
    } else { lampSwayT = 0; }
  }

  lampDX = lampLeanX + jx + sx;
  lampDY = lampLeanY + jy + sy;
  lampBright = lampPresence * flickBright * (1 + leanInfluence * 0.12);   // 迎向她时也把光递近一点
}

// 纱 + 晕：背景景观层。纯呼吸（睡着不停）、白天几乎不退；不随全场清醒度/日出 starFade 变暗。
function drawLampHalo(elapsed) {
  if (lampAlpha < 0.01) return;
  const breath = 0.82 + 0.18 * Math.sin(breathPhase);   // 纯呼吸：睡着也不停
  // 不随睡眠/日出全灭：日出只褪 70%（固执的白）；生日月升烧旺；× 本帧举止亮度
  const g0 = lampAlpha * LAMP_DAY * (1 - starFade * 0.7) * (1 + moonGlow * 0.15) * lampBright;
  const lx = lampX + lampDX, ly = lampY + lampDY;        // 迎向鼠标 / 晃 / 颤 的灯心

  // 纱：缓慢换位的雾丝（给灯以「一处地方」的体量，而非一个点）
  for (const w of lampWisps) {
    const ang = w.base + elapsed * w.spd;
    const wx  = lx + Math.cos(ang) * w.dist * lampR;
    const wy  = ly + Math.sin(ang) * w.dist * lampR;
    const rr  = w.rad * lampR;
    const a   = w.a * g0 * (0.7 + 0.3 * breath);
    const grd = ctx.createRadialGradient(wx, wy, 0, wx, wy, rr);
    grd.addColorStop(0, `rgba(208,224,255,${a.toFixed(3)})`);
    grd.addColorStop(1, 'rgba(208,224,255,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(wx, wy, rr, 0, Math.PI*2); ctx.fill();
  }

  // 晕：会呼吸的光晕（半径随呼吸胀缩；生日月升时略张开一点）
  const haloR = lampR * (0.60 + 0.12 * breath) * (1 + moonGlow * 0.1);
  const hg = ctx.createRadialGradient(lx, ly, 0, lx, ly, haloR);
  hg.addColorStop(0,    `rgba(238,246,255,${(0.17 * g0).toFixed(3)})`);
  hg.addColorStop(0.45, `rgba(220,232,255,${(0.06 * g0).toFixed(3)})`);
  hg.addColorStop(1,    'rgba(220,232,255,0)');
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(lx, ly, haloR, 0, Math.PI*2); ctx.fill();
}

// 核：最亮、最定的一粒白（前景层，绘于粒子 / 柔光之上）
function drawLampCore(elapsed) {
  if (lampAlpha < 0.01) return;
  const breath = 0.82 + 0.18 * Math.sin(breathPhase);
  // 日出时它是最后一颗、仍不全灭（固执的白）；生日月升烧旺；× 本帧举止亮度
  const g  = lampAlpha * LAMP_DAY * (1 - starFade * 0.7) * (1 + moonGlow * 0.15) * lampBright;
  const lx = lampX + lampDX, ly = lampY + lampDY;
  const cr = lampR * 0.18;
  const grd = ctx.createRadialGradient(lx, ly, 0, lx, ly, cr);
  grd.addColorStop(0,   `rgba(255,255,255,${(0.95 * g).toFixed(3)})`);
  grd.addColorStop(0.5, `rgba(246,251,255,${(0.45 * g * breath).toFixed(3)})`);
  grd.addColorStop(1,   'rgba(244,250,255,0)');
  ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(lx, ly, cr, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(lx, ly, 1.9, 0, Math.PI*2);
  ctx.fillStyle = `rgba(255,255,255,${g.toFixed(3)})`; ctx.fill();
}

// ============================================================
// 夜风：风场推进 + 查询（星野的共同摇曳 / 阵风 / 她的流）
// ============================================================
function updateWind(elapsed) {
  const now = performance.now();
  const dt = Math.min(64, now - windPrevT); windPrevT = now;
  windAngle = NIGHT_DIR0 + elapsed * (Math.PI*2 / 720000);          // 12 分钟缓慢转一圈
  windDirX = Math.cos(windAngle); windDirY = Math.sin(windAngle);
  const lfo = 0.5 + 0.5 * Math.sin(elapsed * (Math.PI*2 / 55000) + 1.3);
  const sTarget = NIGHT_WIND_MAX * (0.25 + 0.75 * lfo);             // 风力在无风↔微风间起伏
  windStrength += (sTarget - windStrength) * 0.01;
  windSwayPhase += dt * (Math.PI*2 / 6000);                         // 约 6s 一次俯仰
  const idle = now - lastActivityT;
  const wkT = idle < 120000 ? 1 : (idle < 600000 ? 0.5 : 0);        // 困倦放缓、睡着停
  windWake += (wkT - windWake) * 0.01;
  if (now > windGustNext && windStrength > 0.12 && !isAsleep) {     // 每 1~2 分钟一阵风
    windGustT0 = now; windGustNext = now + 60000 + Math.random()*60000;
  }
  if (prevAsleep && !isAsleep) windGustT0 = now;                    // 苏醒：第一阵风穿野而过
  prevAsleep = isAsleep;
  if (mouse.x >= 0 && prevMX >= 0) {                                // 平滑鼠标速度（她的流）
    mouseVX = mouseVX*0.85 + (mouse.x - prevMX)*0.15;
    mouseVY = mouseVY*0.85 + (mouse.y - prevMY)*0.15;
  } else { mouseVX *= 0.85; mouseVY *= 0.85; }
  prevMX = mouse.x; prevMY = mouse.y;

  // 风的气声：随风力起伏、阵风时微涨；睡着/静音则息（节流更新，避免每帧排程）
  if (windGain && now - windGainUpdT > 180) {
    windGainUpdT = now;
    let g = audioMuted ? 0 : windStrength * windWake * 0.05;
    const ga = now - windGustT0;
    if (ga >= 0 && ga < GUST_DUR) g += 0.028 * Math.sin((ga / GUST_DUR) * Math.PI) * windWake;
    windGain.gain.setTargetAtTime(g, actx.currentTime, 0.4);
    windFilter.frequency.setTargetAtTime(300 + windStrength * 260, actx.currentTime, 0.6);
  }
}

// 查询某点的风偏移 → 写入 woX/woY（不分配数组）。depth：远 0.15 ~ 近 0.85，近层晃得多。
function windOffset(x, y, depth) {
  const amp = windStrength * windWake * SWAY_MAX * depth;
  let off = amp * Math.sin(windSwayPhase);                          // 整片同方向轻轻俯仰（麦田）
  const gustAge = performance.now() - windGustT0;
  if (gustAge >= 0 && gustAge < GUST_DUR) {                         // 阵风：一道沿风向传播的窄带波
    const prog  = gustAge / GUST_DUR;
    const along = (x * windDirX + y * windDirY) / lampDiag + 0.5;
    const db    = along - prog;
    off += Math.exp(-(db*db) * 60) * SWAY_MAX * 1.8 * depth * windWake;   // 星依次低头又抬起
  }
  woX = windDirX * off; woY = windDirY * off;
  const mv2 = mouseVX*mouseVX + mouseVY*mouseVY;                    // 她的流：光标附近的星随她飘一小段
  if (mv2 > 0.6 && mouse.x >= 0) {
    const mdx = x - mouse.x, mdy = y - mouse.y, md2 = mdx*mdx + mdy*mdy, R = 150;
    if (md2 < R*R) {
      const prox = 1 - Math.sqrt(md2)/R;
      woX += mouseVX * prox * 0.45 * depth;
      woY += mouseVY * prox * 0.45 * depth;
    }
  }
}

// ============================================================
// 星尘：随风横渡的微尘，唯独穿过长明的光晕才被点亮（光要落在东西上才看得见）
// ============================================================
function initDust() {
  if (dust.length) return;
  for (let i = 0; i < 54; i++) {
    const depth = 0.25 + Math.random() * 0.75;        // 深浅不一
    dust.push({
      x: Math.random() * W, y: Math.random() * H, depth,
      baseA: 0.035 + Math.random() * 0.055,            // 平时近乎不可见
      bvx: (Math.random() - 0.5) * 0.35,               // 自身基础漂移（快慢不一）
      bvy: (Math.random() - 0.5) * 0.35,
      vx: 0, vy: 0,                                     // 瞬时速度（气流/她的流）
      r: 0.5 + Math.random() * 0.7,
    });
  }
}
function updateDustMotes() {
  if (!dust.length) return;
  const ww  = windStrength * windWake;                 // 随风横渡（睡着 windWake→0 则尘静）
  const mv2 = mouseVX*mouseVX + mouseVY*mouseVY;
  for (const m of dust) {
    m.x += windDirX * ww * (0.9 * m.depth) + m.bvx * windWake;
    m.y += windDirY * ww * (0.9 * m.depth) + m.bvy * windWake;
    m.x += m.vx; m.y += m.vy; m.vx *= 0.93; m.vy *= 0.93;
    if (mv2 > 0.6 && mouse.x >= 0) {                    // 她的流：尘随她的手飘一小段
      const dx = m.x - mouse.x, dy = m.y - mouse.y, d2 = dx*dx + dy*dy, R = 150;
      if (d2 < R*R) { const prox = 1 - Math.sqrt(d2)/R; m.vx += mouseVX*prox*0.06*m.depth; m.vy += mouseVY*prox*0.06*m.depth; }
    }
    const mg = 24;                                      // 环绕：飘出一边，从另一边回来
    if (m.x < -mg) m.x = W + mg; else if (m.x > W + mg) m.x = -mg;
    if (m.y < -mg) m.y = H + mg; else if (m.y > H + mg) m.y = -mg;
  }
}
function drawDustMotes(vis) {
  if (vis < 0.02 || !dust.length) return;
  for (const d of dust) {
    let a = d.baseA * d.depth * vis;
    if (lampR > 0) {                                    // 穿过长明光晕：被点亮
      const ld = Math.hypot(d.x - lampX, d.y - lampY), reach = lampR * 1.15;
      if (ld < reach) a *= 1 + (1 - ld / reach) * 9;
    }
    if (a < 0.004) continue;
    const rr = d.r * (0.6 + d.depth);
    ctx.beginPath(); ctx.arc(d.x, d.y, rr, 0, Math.PI*2);
    ctx.fillStyle = `rgba(222,232,255,${a.toFixed(3)})`; ctx.fill();
  }
}
function dustGust(cx, cy) {                              // 绽放气流：把附近的尘轻轻荡开
  const R = Math.min(W, H) * 0.35;
  for (const d of dust) {
    const dx = d.x - cx, dy = d.y - cy, dd = Math.hypot(dx, dy);
    if (dd < R && dd > 0.1) { const f = (1 - dd / R) * 2.4; d.vx += (dx/dd)*f; d.vy += (dy/dd)*f; }
  }
}

// ============================================================
// 夜行者：几粒不属于星野、会移动的微光，散漫横穿夜空，走完就消失不再回来。
// 偶尔有一位会朝灯弯过去、在灯边歇一会儿，起身离开时灯轻轻脉动一圈（灯在送客）。
// ============================================================
let travelers = [];
let travelerSpawnAt = 0;

function _lerpAngle(a, b, t) {
  const d = ((b - a + Math.PI*3) % (Math.PI*2)) - Math.PI;
  return a + d * t;
}
function spawnTraveler(onscreen) {
  const now = performance.now(), mg = 30;
  let x, y, heading;
  if (onscreen) {                                    // 她进来时已在途中的旅人
    x = W*(0.2+Math.random()*0.6); y = H*(0.2+Math.random()*0.6); heading = Math.random()*Math.PI*2;
  } else {
    const edge = Math.floor(Math.random()*4);
    if      (edge===0){ x=-mg;   y=Math.random()*H; heading = (Math.random()-0.5)*1.2; }
    else if (edge===1){ x=W+mg;  y=Math.random()*H; heading = Math.PI + (Math.random()-0.5)*1.2; }
    else if (edge===2){ x=Math.random()*W; y=-mg;   heading = Math.PI/2 + (Math.random()-0.5)*1.2; }
    else              { x=Math.random()*W; y=H+mg;  heading = -Math.PI/2 + (Math.random()-0.5)*1.2; }
  }
  const baseSpeed = 0.10 + Math.random()*0.12;       // 几分钟横穿
  travelers.push({
    x, y, heading, speed: baseSpeed, baseSpeed,
    state: 'wander',
    willVisit: Math.random() < 0.4,                  // 偶尔——不是每位都会
    visitAt: now + 8000 + Math.random()*22000,
    restUntil: 0, pauseUntil: 0, nextPause: now + 8000 + Math.random()*20000,
    inHalo: false, notePlayed: false, phase: Math.random()*Math.PI*2,
  });
}
function seedTravelers() {                            // 她推门进来时，天上已有人正在路过
  travelers = [];
  spawnTraveler(true);
  if (Math.random() < 0.6) spawnTraveler(true);
}
function updateTravelers() {
  const now = performance.now();
  const want = 2;
  if (travelers.length < want && now > travelerSpawnAt) { spawnTraveler(false); travelerSpawnAt = now + 10000 + Math.random()*25000; }
  else if (travelers.length < 3 && now > travelerSpawnAt && Math.random() < 0.2) { spawnTraveler(false); travelerSpawnAt = now + 20000 + Math.random()*30000; }

  const wk = 0.3 + 0.7 * windWake;                   // 睡着时旅人也走得倦
  for (let i = travelers.length - 1; i >= 0; i--) {
    const t = travelers[i];
    t.heading += (Math.random() - 0.5) * 0.03;        // 散漫：方向缓缓游移

    if (t.state === 'wander') {
      if (now > t.pauseUntil && now > t.nextPause) { t.pauseUntil = now + 2000 + Math.random()*3500; t.nextPause = now + 22000 + Math.random()*30000; }
      const moving = now > t.pauseUntil;
      t.speed += ((moving ? t.baseSpeed : 0) - t.speed) * 0.04;
      if (t.willVisit && now > t.visitAt) {           // 朝灯弯过去
        t.heading = _lerpAngle(t.heading, Math.atan2(lampY - t.y, lampX - t.x), 0.05);
        if (Math.hypot(t.x - lampX, t.y - lampY) < lampR * 0.8) { t.state = 'resting'; t.restUntil = now + 12000 + Math.random()*8000; }
      }
    } else if (t.state === 'resting') {               // 在灯边懒懒地绕半圈 / 歇着
      const ang = Math.atan2(t.y - lampY, t.x - lampX) + 0.012;
      const rr = lampR * 0.45;
      t.x += (lampX + Math.cos(ang)*rr - t.x) * 0.04;
      t.y += (lampY + Math.sin(ang)*rr - t.y) * 0.04;
      if (!t.notePlayed) { t.notePlayed = true; playTravelerNote(); }   // 落脚换来一个极轻的钢琴单音
      if (now > t.restUntil) { t.state = 'leaving'; t.willVisit = false; t.heading = Math.atan2(t.y - lampY, t.x - lampX); t.speed = t.baseSpeed; }
    } else { // leaving
      t.speed += (t.baseSpeed - t.speed) * 0.04;
    }

    if (t.state !== 'resting') {
      t.x += (Math.cos(t.heading) * t.speed + windDirX * windStrength * windWake * 0.3) * (t.state==='wander' ? wk : 1);
      t.y += (Math.sin(t.heading) * t.speed + windDirY * windStrength * windWake * 0.3) * (t.state==='wander' ? wk : 1);
    }

    const nowInHalo = Math.hypot(t.x - lampX, t.y - lampY) < lampR;   // 离开光晕的那一刻：灯送客
    if (t.inHalo && !nowInHalo && t.state === 'leaving') ripples.push({ cx: lampX, cy: lampY, born: now });
    t.inHalo = nowInHalo;

    const m = 60;
    if (t.x < -m || t.x > W + m || t.y < -m || t.y > H + m) travelers.splice(i, 1);   // 走完就消失，不再回来
  }
}
function drawTravelers(vis) {
  if (!travelers.length || vis < 0.02) return;
  const now = performance.now();
  for (const t of travelers) {
    let a = (0.45 + 0.3 * Math.sin(now * 0.0019 + t.phase)) * vis * cloudDim(t.x, t.y);
    const ld = Math.hypot(t.x - lampX, t.y - lampY), reach = lampR * 1.15;
    if (ld < reach) a *= 1 + (1 - ld / reach) * 0.8;   // 走进灯光也更亮
    a = Math.min(0.72, a);                              // 永远不比灯亮
    if (a < 0.02) continue;
    const grd = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, 5.5);
    grd.addColorStop(0, `rgba(226,236,255,${(a*0.6).toFixed(3)})`);
    grd.addColorStop(1, 'rgba(226,236,255,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(t.x, t.y, 5.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(t.x, t.y, 1.3, 0, Math.PI*2);
    ctx.fillStyle = `rgba(242,247,255,${a.toFixed(3)})`; ctx.fill();
  }
}
function playTravelerNote() {
  if (!audioStarted || audioMuted || !synth) return;
  const pool = unlockedPool();
  synth.triggerAttackRelease(pool[Math.floor(Math.random()*pool.length)], 2.2, undefined, 0.26);
}

// ============================================================
// 云影：无形的「星光变弱的区域」随风漂过。没有轮廓、没有颜色、从不被画出来——
// 只是几片缓缓移动的"暗"。遮得住所有星，唯独遮不住长明（天气越坏，灯越是灯）。
// ============================================================
function initClouds() {
  clouds = [];
  for (let i = 0; i < NIGHT_CLOUDS; i++) {
    clouds.push({
      x: Math.random()*W, y: Math.random()*H,
      r: Math.min(W, H) * (0.32 + Math.random()*0.22),   // 巨大、柔、无轮廓
      base: 0.16 + Math.random()*0.16,                    // 最暗约 16~32%
      strength: 0.2,
      dx: (Math.random()-0.5)*0.08, dy: (Math.random()-0.5)*0.08,   // 自身缓慢漂移
      phase: Math.random()*Math.PI*2,
    });
  }
}
function updateClouds(elapsed) {
  if (!clouds.length) return;
  const ww = windStrength * windWake;
  for (const c of clouds) {
    c.x += windDirX * ww * 0.7 + c.dx;                    // 随风 + 自身漂移
    c.y += windDirY * ww * 0.7 + c.dy;
    c.strength = c.base * (0.55 + 0.45 * Math.sin(elapsed * 0.00005 + c.phase));  // 厚薄缓变，永不重样
    const m = c.r;
    if (c.x < -m) c.x = W + m; else if (c.x > W + m) c.x = -m;
    if (c.y < -m) c.y = H + m; else if (c.y > H + m) c.y = -m;
  }
}
// 某点的星光衰减系数：1=无遮，最低约 0.5（不全灭，只是寥落）。灯不调用它。
function cloudDim(x, y) {
  if (!clouds.length) return 1;
  let dim = 1;
  for (const c of clouds) {
    const dx = x - c.x, dy = y - c.y, d2 = dx*dx + dy*dy;
    if (d2 < c.r * c.r) { const f = 1 - Math.sqrt(d2) / c.r; dim *= 1 - c.strength * f * f; }
  }
  return dim < 0.5 ? 0.5 : dim;
}

// ============================================================
// 里程碑高潮：第100夜日出 / 底部天光 / 生日弯月
// ============================================================
// 第100夜：星止、屏息3秒 → 终曲和弦 + 那句话 → 90秒天亮、星渐隐 → 复位，底部永留一线天光
function startSunrise() {
  if (sunriseActive) return;
  sunriseActive = true; sunrisePhase = 'freeze'; sunriseFreeze = true;
  stopAmbientPiano();
  if (droneGain && actx) droneGain.gain.setTargetAtTime(0, actx.currentTime, 1.2);   // 低鸣停
  setTimeout(() => {
    playFinalChord();                                                                 // 终曲和弦
    showSentence('这是一百个夜晚没说出口的话，一起开口的声音。');
    markSaid('s_hundred');
    sunriseT0 = performance.now(); sunrisePhase = 'dawning';
  }, 3000);                                                                           // 屏息 3 秒
}
function updateSunrise() {
  if (!sunriseActive || sunrisePhase !== 'dawning') return;
  const t = (performance.now() - sunriseT0) / 90000;                                  // 90 秒
  if (t >= 1) { endSunrise(); return; }
  dawnLevel = t < 0.5 ? (t / 0.5) : (1 - (t - 0.5) / 0.5);                             // 0→1→0
  starFade  = dawnLevel;
  if (t > 0.52 && introLine1.style.opacity !== '0') introLine1.style.opacity = '0';   // 天光最盛时无字
}
function endSunrise() {
  dawnLevel = 0; starFade = 0; sunriseActive = false; sunriseFreeze = false; sunrisePhase = null;
  if (droneGain && actx && !audioMuted) droneGain.gain.setTargetAtTime(0.05, actx.currentTime, 4);
  startAmbientPiano();
  if (DBG.night === null) lsSet('fx_sunrise', '1');
  // 从此底部永远留一线天光（由 dawnProgress=1 提供）
}

// 底部天光：每次访问 +1%（极淡、肉眼几乎无法察觉），第100夜后成为永久的一线
function drawDawnLine() {
  const baseA = Math.min(dawnProgress, 1) * 0.07;
  const a = Math.max(baseA, dawnLevel * 0.85);
  if (a < 0.004) return;
  const h = H * (0.10 + dawnLevel * 0.7);
  const g = ctx.createLinearGradient(0, H, 0, H - h);
  g.addColorStop(0,    `rgba(255,200,150,${a.toFixed(3)})`);
  g.addColorStop(0.45, `rgba(255,182,150,${(a*0.4).toFixed(3)})`);
  g.addColorStop(1,    'rgba(255,182,150,0)');
  ctx.fillStyle = g; ctx.fillRect(0, H - h, W, h);
}

// 生日弯月：极细极淡，用 3 分钟横过夜空，升落淡入淡出；首个生日附一句话
function startBirthdayMoon() {
  if (moonActive) return;
  moonActive = true; moonT0 = performance.now();
  if (!hasSaid('s_birthday1')) {
    showSentence('这个宇宙没有月亮。除了今天。');
    markSaid('s_birthday1');
    setTimeout(() => dissolveSentence(), 6500);
  }
}
function drawMoon() {
  if (!moonActive) { moonGlow = 0; return; }
  const t = (performance.now() - moonT0) / 180000;          // 3 分钟
  if (t >= 1) { moonActive = false; moonGlow = 0; return; }
  const x = W * (0.12 + 0.76 * t);
  const y = H * (1.02 - 0.82 * Math.sin(Math.PI * t));      // 抛物线升落
  const R = Math.min(W, H) * 0.042;
  const a = Math.sin(Math.PI * t);                          // 升起→落下，淡入淡出
  moonGlow = a;                                             // 灯会因这位一年一访的客人烧旺一点
  if (!moonCanvas) moonCanvas = document.createElement('canvas');
  const size = Math.max(2, Math.ceil(R * 3));
  moonCanvas.width = size; moonCanvas.height = size;
  const mx = moonCanvas.getContext('2d');
  const cx = size/2, cy = size/2;
  mx.fillStyle = 'rgba(245,243,236,1)';
  mx.beginPath(); mx.arc(cx, cy, R, 0, Math.PI*2); mx.fill();
  mx.globalCompositeOperation = 'destination-out';          // 挖出弯月（在离屏，不破坏主画布）
  mx.beginPath(); mx.arc(cx + R*0.55, cy - R*0.15, R*0.97, 0, Math.PI*2); mx.fill();
  ctx.save(); ctx.globalAlpha = 0.5 * a;
  ctx.drawImage(moonCanvas, x - cx, y - cy);
  ctx.restore();
}

// ============================================================
// 生命感：呼吸 / 困倦 / 睡着（每帧更新 lifeFactor）
// ============================================================
function updateLife() {
  const now = performance.now();
  const dt  = Math.min(64, now - lastFrameT);   // 限制 dt，切回标签页时不跳变
  lastFrameT = now;

  const idle = now - lastActivityT;
  let wTarget, pTarget;
  if      (idle < 120000) { wTarget = 1.00; pTarget = 4000; }  // 清醒
  else if (idle < 600000) { wTarget = 0.90; pTarget = 6500; }  // 困倦（2~10min）
  else                    { wTarget = 0.82; pTarget = 9000; }  // 睡着（>10min）

  const sleeping = idle >= 600000;
  if (sleeping && !isAsleep) { isAsleep = true;  setSleepState(true); }
  if (!sleeping && isAsleep) { isAsleep = false; setSleepState(false); }

  // 缓动：约 3 秒苏醒 / 入睡
  wakefulness  += (wTarget - wakefulness)  * 0.02;
  breathPeriod += (pTarget - breathPeriod) * 0.02;

  // 呼吸相位推进（切走标签页时屏息）
  if (!breathFrozen && !sunriseFreeze) breathPhase += (dt / breathPeriod) * Math.PI * 2;  // 日出屏息时也冻结

  lifeFactor = (0.92 + 0.08 * Math.sin(breathPhase)) * wakefulness;
}

// 认生的星：静止 >5s 选最近一颗，缓缓靠近；一动就放手（它自行归位）
function updateShyStar(){
  const idle = performance.now() - lastMouseMoveTime;
  if (idle < 5000 || mouse.x < 0 || mouse.x > W) { shyStar = null; return; }
  if (!shyStar) {
    let best = null, bd = 300 * 300;
    for (const p of particles) {
      if (p === warmStar || p.type === 'ambient' || p.vis < 0.4) continue;
      const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx*dx + dy*dy;
      if (d2 < bd) { bd = d2; best = p; }
    }
    shyStar  = best;
    shyStop  = Math.max(0, 60 - (visitCount - 1) * 2);   // 越来越近，约第30夜触到
    shySpeed = longAway ? 1.6 : 1.0;                      // 久别：靠近更快
  }
}

// 暖星彩蛋：光标在它上面停够久（3s）→ 颤一下，不重复
function updateSecretStar(){
  if (!warmStar || warmDone) return;
  const near = (mouse.x >= 0) &&
    ((mouse.x - warmStar.x)**2 + (mouse.y - warmStar.y)**2 < 16 * 16);
  const now = performance.now();
  if (near) {
    if (!warmHoverStart) warmHoverStart = now;
    else if (now - warmHoverStart > 3000) {
      warmStar.trembleT = now;
      warmDone = true;
      if (DBG.night === null) lsSet('fx_warm', '1');
    }
  } else {
    warmHoverStart = 0;
  }
}

// 痕迹热图：她走过的地方淡淡发亮（跨会话留存）；同时极慢衰减——淡，但很久才消失
function drawTraceHeatmap(m) {
  if (m < 0.02) return;
  const cw = W / TG_W, ch = H / TG_H, rr = cw * 0.85;
  for (let cy = 0; cy < TG_H; cy++) {
    for (let cx = 0; cx < TG_W; cx++) {
      const idx = cy * TG_W + cx;
      const v = traceGrid[idx];
      if (v > 0.0005) traceGrid[idx] = v * 0.99996;
      if (v < 0.08) continue;
      const x = (cx + 0.5) * cw, y = (cy + 0.5) * ch;
      const a = Math.min(0.05, v * 0.05) * m * cloudDim(x, y);   // 云影过她的旧痕，痕迹也暗一下
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, `rgba(150,175,225,${a.toFixed(3)})`);
      g.addColorStop(1, 'rgba(150,175,225,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI*2); ctx.fill();
    }
  }
}

// ============================================================
// Bloom 柔光：把较亮的粒子核画到半分辨率离屏，模糊后叠加回主画布
// ============================================================
function setupBloom() {
  const bw = Math.max(2, Math.round(W * BLOOM_SCALE));
  const bh = Math.max(2, Math.round(H * BLOOM_SCALE));
  if (!bloomCanvas) bloomCanvas = document.createElement('canvas');
  bloomCanvas.width = bw; bloomCanvas.height = bh;
  bloomCtx = bloomCanvas.getContext('2d');
  bloomOK  = ('filter' in ctx);    // 检测 ctx.filter 支持（不支持则跳过 bloom）
}

// 流星顶层画布：叠在主画布之上、文字层之下；每帧整层清空，所以流星不会留下残影
function setupMeteorLayer() {
  const dpr = window.devicePixelRatio || 1;
  if (!fxCanvas) {
    fxCanvas = document.createElement('canvas');
    fxCanvas.id = 'fx-meteor';
    fxCanvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:1;';
    document.body.appendChild(fxCanvas);
  }
  fxCanvas.width  = Math.round(W * dpr);
  fxCanvas.height = Math.round(H * dpr);
  fxCtx = fxCanvas.getContext('2d');
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 与主画布一致，按 CSS 像素绘制
  meteorLayerDirty = false;
}

function drawBloom() {
  if (!bloomOK || bgRevealAlpha < 0.02 || starFade > 0.98) return;
  const s = BLOOM_SCALE;
  bloomCtx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.type === 'ambient' || p.vis < 0.2) continue;
    const r = Math.max(0.8, p.baseR) * s * 1.5;
    const { r:cr, g:cg, b:cb } = p.color;
    bloomCtx.beginPath();
    bloomCtx.arc(p.x * s, p.y * s, r, 0, Math.PI*2);
    bloomCtx.fillStyle = `rgba(${cr},${cg},${cb},${(0.9*p.vis).toFixed(2)})`;
    bloomCtx.fill();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'blur(6px)';
  ctx.globalAlpha = 0.5 * lifeFactor * bgRevealAlpha * (1 - starFade);
  ctx.drawImage(bloomCanvas, 0, 0, W, H);
  ctx.restore();
}

// ============================================================
// 二十四、冲击波
// ============================================================
function drawShockwaves() {
  shockwaves=shockwaves.filter(sw=>{
    sw.r+=sw.speed; if(sw.r>=sw.maxR) return false;
    const pg=sw.r/sw.maxR, al=(1-pg)*0.08, lw=1.2*(1-pg*0.7)+0.3;
    const {r,g,b}=sw.color;
    ctx.beginPath(); ctx.arc(sw.x,sw.y,sw.r,0,Math.PI*2);
    ctx.strokeStyle=`rgba(${r},${g},${b},${al})`; ctx.lineWidth=lw; ctx.stroke();
    return true;
  });
}

// ============================================================
// 二十五、星环（phase 1）
// ============================================================
function updateDrawOrbit() {
  const ta=phase===1?0.70:0, tr=heartScale*21;
  orbitParticles.forEach(op=>{ op.update(ta,tr); op.draw(); });
}

// ============================================================
// 二十六、双指触摸光线
// ============================================================
function drawTouchBeam() {
  if (touchPoints.length<2) return;
  const p1=touchPoints[0],p2=touchPoints[1];
  const grd=ctx.createLinearGradient(p1.x,p1.y,p2.x,p2.y);
  grd.addColorStop(0,'rgba(255,154,178,0.55)');
  grd.addColorStop(0.5,'rgba(255,255,255,0.82)');
  grd.addColorStop(1,'rgba(255,154,178,0.55)');
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
  ctx.strokeStyle=grd; ctx.lineWidth=1.8; ctx.stroke();
}

// ============================================================
// 二十七、主动画循环
// ============================================================
function animate() {
  const elapsed = performance.now() - startTime;
  frameCount++;

  updateLife();      // 呼吸 / 困倦 / 睡着 → lifeFactor
  updateSunrise();   // 第100夜日出序列推进
  updateLamp();      // 长明的举止：迎向鼠标 / 久别晃一下 / 越闲越显 / 越烧越稳
  updateWind(elapsed); // 夜风：风向 / 风力 / 阵风 / 她的流
  updateDustMotes();   // 星尘随风横渡
  updateClouds(elapsed); // 云影随风漂过

  // 揭幕 / 黑暗颗粒透明度推进（缓动，约一次呼吸的尺度）
  const bgTarget = (introState >= St.SPREAD)     ? 1 : 0;
  bgRevealAlpha += (bgTarget - bgRevealAlpha) * 0.012;
  const grTarget = (introState <= St.FIRST_STAR) ? 1 : 0;
  grainAlpha    += (grTarget - grainAlpha) * 0.02;
  // 长明先于星野亮起：FIRST_STAR 起就缓缓淡入（黑暗中最先浮现的永远是它）
  const lampTarget = (introState >= St.FIRST_STAR) ? 1 : 0;
  lampAlpha += (lampTarget - lampAlpha) * 0.02;

  drawBackground(elapsed);
  drawGrain(elapsed);

  // 流星/鼠标光尾 + 记忆反馈：仅完全交互态（入场期间不响应鼠标）
  if (introState === St.COMPLETE) {
    updateShyStar();
    updateSecretStar();
    updateTravelers();   // 夜行者横穿夜空、偶尔到灯边歇脚
    recordTrace();
    const nowMs = performance.now();
    if (nowMs - traceSaveT > 8000) { saveTrace(); traceSaveT = nowMs; }
    // 长明的脉动：每隔一两到三四分钟，无声荡出一圈光环（复用涟漪系统：星被波前扫过暗一下再亮）
    if (nowMs > lampPulseTimer) {
      ripples.push({ cx: lampX, cy: lampY, born: nowMs });
      lampPulseTimer = nowMs + 90000 + Math.random() * 150000;
    }
    drawMeteors();
    updateMouseHistory();
    drawMouseTrail();
  }

  particles.forEach(p=>p.drawTrail(elapsed));
  // drawLines();        // 星野不自动连线；「连星成座」留待第3步
  particles.forEach(p=>{ p.update(elapsed); p.draw(elapsed); });
  drawBloom();           // 柔光：粒子的弥散辉光
  drawLampCore(elapsed); // 长明：核（最亮、最定的一点白，绘于粒子之上）
  // updateDrawOrbit();  // 心形星环（旧设计），已停用
  drawShockwaves();
  drawTouchBeam();
  drawDust();            // 名字碎成的星尘
  drawMoon();            // 生日弯月

  if (introState === St.COMPLETE) {
    drawRipples();        // 涟漪回应的淡环
    drawDragPreview();    // 连星成座的拖拽预览
    starFollowers.forEach(s=>{ s.update(elapsed); s.draw(elapsed); });
  }

  requestAnimationFrame(animate);
}

// ============================================================
// 二十八、事件
// ============================================================
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  lastMouseMoveTime = performance.now();
  lastActivityT     = lastMouseMoveTime;   // 唤醒/保持清醒

  onFirstGesture();                    // 首次移动：解锁声音 + 推进开场
  onMouseMoved(e.clientX, e.clientY);  // 声音一：鼠标微风
});
window.addEventListener('mouseleave',()=>{ mouse.x=-9999; mouse.y=-9999; });

// 指针：轻点=向天空提问；从一颗星拖到另一颗星=连成星座
function endPress(x, y) {
  if (!press) return;
  const moved = Math.hypot(x - press.sx, y - press.sy);
  if (moved < CONNECT_MIN) {
    askSky(x, y);                                   // 轻点 = 提问
  } else if (press.star) {
    const end = nearestStar(x, y, STAR_GRAB);
    if (end && end !== press.star) addConstellation(press.star, end);  // 拖拽 = 连星
  }
  press = null;
}
window.addEventListener('mousedown', e=>{
  if (Date.now()-lastTouchTime < 400) return;       // 忽略触摸合成的鼠标事件
  if (e.target === musicBtn) return;
  onFirstGesture();
  lastActivityT = performance.now();
  press = { sx:e.clientX, sy:e.clientY, star:nearestStar(e.clientX,e.clientY,STAR_GRAB), t:Date.now() };
});
window.addEventListener('mouseup', e=>{
  if (Date.now()-lastTouchTime < 400 || !press) { press = null; return; }
  endPress(e.clientX, e.clientY);
});

window.addEventListener('keydown', e=>{ onFirstGesture(); });   // 任意按键也可解锁声音/推进开场

// 触摸
window.addEventListener('touchstart', e=>{
  lastTouchTime=Date.now();
  const t=e.touches[0]; mouse.x=t.clientX; mouse.y=t.clientY;
  onFirstGesture();
  lastActivityT = performance.now();
  if (e.touches.length===1) press = { sx:t.clientX, sy:t.clientY, star:nearestStar(t.clientX,t.clientY,STAR_GRAB), t:Date.now() };
}, {passive:true});

window.addEventListener('touchmove', e=>{
  touchPoints=[];
  for(let i=0;i<Math.min(e.touches.length,2);i++) touchPoints.push({x:e.touches[i].clientX,y:e.touches[i].clientY});
  mouse.x=touchPoints[0].x; mouse.y=touchPoints[0].y;
  lastMouseMoveTime = lastActivityT = performance.now();
},{passive:true});

window.addEventListener('touchend', e=>{
  touchPoints=[];
  if (press && e.changedTouches && e.changedTouches.length) {
    const t = e.changedTouches[0];
    endPress(t.clientX, t.clientY);
  } else { press = null; }
  if(e.touches.length===0){mouse.x=-9999;mouse.y=-9999;}
},{passive:true});

// ♫ 按钮：静音 / 取消静音
musicBtn.addEventListener('click', e=>{
  e.stopPropagation();
  toggleMusic();
});

window.addEventListener('resize',()=>{ startTime=performance.now(); init(); });

// 切走标签页：屏住呼吸；切回：轻轻呼出（重置帧时戳，避免 dt 暴涨）
document.addEventListener('visibilitychange', ()=>{
  breathFrozen = document.hidden;
  if (document.hidden) saveTrace();                       // 切走时存一次痕迹
  else lastFrameT = performance.now();
});

// ============================================================
// 音频系统（Tone.js 合成钢琴/和弦 + 原生 Web Audio 低频 drone / 叮）
// 零外部音频文件、零循环 BGM；声音由「她的第一次触碰」解锁。
// ============================================================
let audioStarted = false, audioMuted = false, herNotePlayed = false;
let actx = null, synth = null, reverb = null, masterVol = null;
let droneOsc = null, droneGain = null, droneFilter = null;
let windGain = null, windNoiseSrc = null, windFilter = null, windGainUpdT = 0;  // 风的气声
let ambientTimer = null;

// 五声音阶（C 大调五声，跨两个八度）；随访问每 10 夜多解锁一个音
const PENTA    = ['C4','D4','E4','G4','A4','C5','D5','E5','G5','A5'];
const HER_NOTE = 'A4';   // 她的专属音（开场反复出现；也在五声里）
function unlockedNoteCount(){ return Math.max(3, Math.min(PENTA.length, 3 + Math.floor(visitCount / 10))); }
function unlockedPool(){ return PENTA.slice(0, unlockedNoteCount()); }

// 动态注入 Tone.js（CDN）——只在「轻触苏醒」之后才加载，点击前绝不引入
let toneLoading = false;
function loadTone(onReady){
  if (window.Tone) { if (onReady) onReady(); return; }
  if (toneLoading) return;
  toneLoading = true;
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js';
  s.async = true;
  s.onload  = () => { if (onReady) onReady(); };
  s.onerror = () => {};
  document.head.appendChild(s);
}

// 启动所有声音引擎。必须在真实手势（pointerdown/touch/click）的同步调用栈内执行——
// 这样 new AudioContext() 才会被允许进入 running 状态（mousemove 不算有效手势，是旧版失败的根因）。
function startAudioNow(){
  if (audioStarted) return;
  audioStarted = true;
  // 1) 原生 Web Audio：自建上下文 + 低频 drone（即时，不依赖 Tone；离线也能响）
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    if (actx.state === 'suspended' && actx.resume) actx.resume();
    buildDrone();
    buildWindSound();
  } catch(e) { actx = null; }
  // 2) Tone.js：加载完成后建钢琴/和弦（用 Tone 自身的上下文；此时页面已有用户激活，可正常发声）
  loadTone(() => {
    if (typeof window.Tone === 'undefined') return;
    try {
      Tone.start();
      buildSynth();
      playHerNote();              // 若已到第一颗星则此刻响；否则由 positionFirstStar 触发
      startAmbientPiano();
      if (isAsleep) setSleepState(true);
    } catch(e) {}
  });
  if (musicBtn) { musicBtn.style.color = 'rgba(200,215,255,0.8)'; musicBtn.style.borderColor = 'rgba(200,215,255,0.4)'; }
}

// 原生 Web Audio：40-50Hz 低频 drone + 缓慢 LFO 起伏（自建上下文 actx）
function buildDrone(){
  if (!actx || droneOsc) return;
  droneGain   = actx.createGain();   droneGain.gain.value = 0;
  droneFilter = actx.createBiquadFilter(); droneFilter.type = 'lowpass'; droneFilter.frequency.value = 120;
  droneOsc    = actx.createOscillator(); droneOsc.type = 'sine'; droneOsc.frequency.value = 44;
  const lfo     = actx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.08; // ~12s
  const lfoGain = actx.createGain(); lfoGain.gain.value = 0.018;
  lfo.connect(lfoGain); lfoGain.connect(droneGain.gain);
  droneOsc.connect(droneFilter); droneFilter.connect(droneGain); droneGain.connect(actx.destination);
  droneOsc.start(); lfo.start();
  droneGain.gain.setTargetAtTime(0.05, actx.currentTime, 3);   // 缓缓淡入
}

// 风的气声：低通白噪声，几乎听不见，垫在 40Hz 灯丝低鸣之下；音量随风力起伏（在 updateWind 里调）
function buildWindSound(){
  if (!actx || windGain) return;
  const len = Math.floor(actx.sampleRate * 2);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random()*2 - 1;   // 白噪声
  windNoiseSrc = actx.createBufferSource();
  windNoiseSrc.buffer = buf; windNoiseSrc.loop = true;
  windFilter = actx.createBiquadFilter();
  windFilter.type = 'lowpass'; windFilter.frequency.value = 360; windFilter.Q.value = 0.5;
  windGain = actx.createGain(); windGain.gain.value = 0;
  windNoiseSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(actx.destination);
  windNoiseSrc.start();
}

// Tone.js：柔和正弦钢琴 + 长混响（用 Tone 自身的上下文）
function buildSynth(){
  if (synth || typeof window.Tone === 'undefined') return;
  masterVol = new Tone.Volume(-11).toDestination();
  reverb    = new Tone.Reverb({ decay: 7, wet: 0.5 }).connect(masterVol);
  synth     = new Tone.PolySynth(Tone.Synth).connect(reverb);
  synth.set({
    oscillator: { type: 'sine' },
    envelope:   { attack: 0.04, decay: 0.7, sustain: 0.05, release: 3.6 },
    volume: -9,
  });
}

// 她的专属单音（每次会话只在开场响一次；之后作为五声之一在环境里复现）
function playHerNote(){
  if (herNotePlayed || !audioStarted || audioMuted || !synth || introState < St.FIRST_STAR) return;
  herNotePlayed = true;
  synth.triggerAttackRelease(HER_NOTE, 2.4, undefined, 0.55);
}

// 睡着：低鸣变深、钢琴停；醒来：恢复
function setSleepState(asleep){
  if (!audioStarted) return;
  if (droneOsc && droneFilter && actx) {
    const t = actx.currentTime;
    droneOsc.frequency.setTargetAtTime(asleep ? 38 : 44, t, 2);
    droneFilter.frequency.setTargetAtTime(asleep ? 80 : 120, t, 2);
  }
  if (asleep) stopAmbientPiano(); else startAmbientPiano();
}

// 稀疏环境钢琴：每隔 20~45s 一个随机已解锁音；睡着/隐藏/静音/非交互态时不响
// （沉默本身才是旋律 —— 音与音之间的空白是故意的）
function startAmbientPiano(){
  stopAmbientPiano();
  const tick = () => {
    if (audioStarted && !audioMuted && !isAsleep && !document.hidden && introState === St.COMPLETE && synth) {
      const pool = unlockedPool();
      synth.triggerAttackRelease(pool[Math.floor(Math.random()*pool.length)], 2.6, undefined, 0.42);
    }
    ambientTimer = setTimeout(tick, 20000 + Math.random()*25000);
  };
  ambientTimer = setTimeout(tick, 12000 + Math.random()*15000);
}
function stopAmbientPiano(){ if (ambientTimer) { clearTimeout(ambientTimer); ambientTimer = null; } }

// 温柔绽放 / 连星成座：一个柔和的小和音（2 个已解锁音）
function playBloomChord(){
  if (!audioStarted || audioMuted || !synth) return;
  const pool = unlockedPool();
  const a = pool[Math.floor(Math.random()*pool.length)];
  const b = pool[Math.floor(Math.random()*pool.length)];
  synth.triggerAttackRelease([a, b], 2.2, undefined, 0.4);
}

// 终曲和弦（第100夜）：她听过的所有音，第一次同时响起（待第100夜序列调用）
function playFinalChord(){
  if (!audioStarted || !synth) return;
  if (masterVol) masterVol.mute = false;
  synth.triggerAttackRelease(PENTA.slice(), 6.5, undefined, 0.7);
}

// 交互极轻「叮」：原生 Web Audio，随机音高，每次都略不同
function playDing(vol){
  if (!audioStarted || audioMuted || !actx) return;
  const HI = [880, 988, 1046, 1175, 1318, 1397, 1568];   // 高八度五声附近
  const f  = HI[Math.floor(Math.random()*HI.length)] * (0.99 + Math.random()*0.02);
  const o  = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
  const g  = actx.createGain();
  const t  = actx.currentTime, v = (vol || 0.05);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.55);
}

// 鼠标移动：偶尔一声极轻的叮（替代旧风铃；更稀疏）
function onMouseMoved(x, y){
  if (mouseSoundLastX < 0) { mouseSoundLastX = x; mouseSoundLastY = y; return; }
  mouseSoundAccum += Math.hypot(x - mouseSoundLastX, y - mouseSoundLastY);
  mouseSoundLastX = x; mouseSoundLastY = y;
  if (mouseSoundAccum < 240) return;
  mouseSoundAccum = 0;
  if (Math.random() < 0.45) playDing(0.04);
}

// 粒子互动音：靠近时偶发的极轻叮
function maybePlayStarGlint(){
  const now = performance.now();
  if (now - lastMouseMoveTime > 120) return;       // 静止不响
  if (now - lastParticleSndT < 320) return;        // 冷却
  if (Math.random() > 0.04) return;                // 偶发
  lastParticleSndT = now;
  playDing(0.05);
}

// ♫ 按钮：静音 / 取消静音（不再是 BGM 开关）
function toggleMusic(){
  audioMuted = !audioMuted;
  if (masterVol) masterVol.mute = audioMuted;
  if (droneGain && actx) droneGain.gain.setTargetAtTime(audioMuted ? 0 : 0.05, actx.currentTime, 0.4);
  if (audioMuted) { musicBtn.style.color = ''; musicBtn.style.borderColor = ''; }
  else            { musicBtn.style.color = 'rgba(200,215,255,0.8)'; musicBtn.style.borderColor = 'rgba(200,215,255,0.4)'; }
}

// ============================================================
// 轻触苏醒（声音解锁门）
// ============================================================
// 入场动画开始前，屏幕中央显示一行极小的字。她第一次点击/触摸之前：
// 不发声、不创建 AudioContext、不加载 Tone.js。
let wakeHintEl = null, universeWoken = false;

function showWakeHint() {
  wakeHintEl = document.createElement('div');
  wakeHintEl.textContent = '轻触屏幕，让宇宙苏醒';
  wakeHintEl.style.cssText =
    'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","微软雅黑",system-ui,-apple-system,"Segoe UI",sans-serif;' +
    'font-weight:200;font-size:clamp(12px,2.6vw,16px);letter-spacing:0.3em;' +
    'color:rgba(255,255,255,0.5);white-space:nowrap;pointer-events:none;' +
    'z-index:50;opacity:0;transition:opacity 2s ease;text-shadow:none;';
  document.body.appendChild(wakeHintEl);
  // 柔和淡入
  requestAnimationFrame(() => requestAnimationFrame(() => { if (wakeHintEl) wakeHintEl.style.opacity = '1'; }));
}

function wakeUniverse() {
  if (universeWoken) return;
  universeWoken = true;
  // 1) 文字缓慢淡出
  if (wakeHintEl) {
    wakeHintEl.style.transition = 'opacity 1.6s ease';
    wakeHintEl.style.opacity = '0';
    setTimeout(() => { if (wakeHintEl) { wakeHintEl.remove(); wakeHintEl = null; } }, 1700);
  }
  // 2) 同时启动所有声音引擎（在手势同步栈内创建 AudioContext）
  startAudioNow();
  // 3) 然后正式开始入场动画（1.8s 黑暗倒计时）
  startIntro();
}

// ============================================================
// 二十九、启动
// ============================================================
init();
animate();
showWakeHint();   // 先显示「轻触屏幕，让宇宙苏醒」，等她第一次触碰再开始

// 真实手势才解锁（pointerdown 覆盖鼠标/触摸/触控笔；另加 touchstart/mousedown/keydown 兜底）。
// 注意：故意不监听 mousemove —— 它不是有效的用户激活手势，正是旧版声音启动失败的原因。
['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(ev =>
  window.addEventListener(ev, wakeUniverse, { passive: true }));
