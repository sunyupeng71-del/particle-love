// ============================================================
// 给范晓语 — script.js（梦境升级版）
// 纯原生 Canvas，无第三方库
// ============================================================

// ---- DOM 引用 -----------------------------------------------
const canvas         = document.getElementById('canvas');
const ctx            = canvas.getContext('2d');
const textGroup      = document.getElementById('text-group');
const introScreen    = document.getElementById('intro-screen');
const introTextEl    = document.getElementById('intro-text');
const secretMsgEl    = document.getElementById('secret-msg');
const fireworkNameEl = document.getElementById('firework-name');
const musicBtn       = document.getElementById('music-btn');
const musicTip       = document.getElementById('music-tip');
const subTextEl      = document.getElementById('sub-text');

// ---- 粒子数量 -----------------------------------------------
const TOTAL     = 180;
const N_BRIGHT  = Math.round(TOTAL * 0.15);       // 27  亮点
const N_MAIN    = Math.round(TOTAL * 0.55);        // 99  主体
const N_AMBIENT = TOTAL - N_BRIGHT - N_MAIN;       // 54  氛围
const N_HEART   = N_BRIGHT + N_MAIN;               // 126 在爱心轮廓
const N_ORBIT   = 18;                              // 星环粒子
const N_STARS   = 6;                               // 跟随星星

// ---- 物理参数 -----------------------------------------------
const SPRING_K      = 0.060;   // 正常弹簧系数
const GATHER_SPRING = 0.012;   // 入场聚合弹簧（慢、梦幻）
const DAMPING       = 0.84;    // 阻尼（偏低 → 弹跳感）
const MOUSE_RADIUS  = 150;     // 鼠标斥力半径 px
const MOUSE_FORCE   = 12;      // 鼠标推力峰值
const LINE_DIST     = 100;     // phase0 连线最大距离 px
const EXPLODE_SPD   = 36;      // 爆炸初速度
const EXPLODE_MS    = 1500;    // 爆炸后聚合延迟 ms

// ---- 入场状态机 ---------------------------------------------
const State = { WELCOME: 0, FADING: 1, GATHERING: 2, TYPING: 3, COMPLETE: 4 };
let introState = State.WELCOME;
let curSpring  = 0;    // 当前弹簧系数随状态切换

// ---- 全局运行时 ----------------------------------------------
let W, H;
let heartCX, heartCY, heartScale;
let mouse       = { x: -9999, y: -9999 };
let touchPoints = [];              // 触摸点（最多 2 个）
let isExploding = false;
let explodeTimer = null;
let startTime   = performance.now();

// ---- 对象数组 -----------------------------------------------
let particles      = [];
let orbitParticles = [];
let bokehBlobs     = [];
let starFollowers  = [];
let shockwaves     = [];

// ---- 诗意阶段 -----------------------------------------------
let phase = 0;          // 0: 前30s / 1: 30s-2min / 2: 2min+
let escapedSet = new Set();
let escapeTimeout = null;

// ---- 彩蛋 ---------------------------------------------------
let clickTimes     = [];
let easterEggOn    = false;
let easterEggTimer = null;

// ---- 烟花名字 -----------------------------------------------
let fwNameActive = false;

// ---- 防止触摸→click 双触发 ----------------------------------
let lastTouchTime = 0;

// ============================================================
// 一、高清渲染
// ============================================================
function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width        = W * dpr;   // 赋值自动重置 transform
  canvas.height       = H * dpr;
  ctx.scale(dpr, dpr);             // 缩放后坐标系仍用逻辑像素
}

// ============================================================
// 二、心形坐标
// ============================================================
function buildHeartPoints(n, cx, cy, scale) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t  = (i / n) * Math.PI * 2;
    const hx =  16 * Math.pow(Math.sin(t), 3);
    const hy = -(13 * Math.cos(t) - 5 * Math.cos(2*t)
                                  - 2 * Math.cos(3*t) - Math.cos(4*t));
    pts.push({ x: cx + hx * scale, y: cy + hy * scale });
  }
  return pts;
}

// ============================================================
// 三、颜色选取
// ============================================================
function pickColor(type) {
  const t = Math.random();
  if (type === 'bright') return { r: 255, g: (225+t*30)|0, b: (238+t*17)|0 };
  if (type === 'main')   return { r: (255-t*20)|0, g: (107+t*95)|0, b: (157+t*80)|0 };
  return { r: (158-t*20)|0, g: (140+t*60)|0, b: (200+t*55)|0 };
}

// ============================================================
// 四、Particle 类
// ============================================================
class Particle {
  constructor(type, tx, ty, ix, iy) {
    this.type    = type;
    this.heartX  = tx;   // 永久心形目标
    this.heartY  = ty;
    this.tx      = tx;   // 当前目标（逃逸时临时改变）
    this.ty      = ty;
    this.x       = ix;   // 初始位置（屏幕外围）
    this.y       = iy;
    this.vx      = 0;
    this.vy      = 0;
    this.isEscaping = false;

    if      (type === 'bright')  this.baseR = 2.5 + Math.random() * 1.5;
    else if (type === 'main')    this.baseR = 1.2 + Math.random() * 0.8;
    else                         this.baseR = 0.4 + Math.random() * 0.4;

    this.color       = pickColor(type);
    this.savedColor  = null;
    this.pulsePhase  = Math.random() * Math.PI * 2;
    this.pulsePeriod = 3000 + Math.random() * 3000;
    this.jitter      = (Math.random() - 0.5) * 0.65;  // 鼠标推力随机偏转
    this.tx1 = ix; this.ty1 = iy;   // 拖尾缓存
    this.tx2 = ix; this.ty2 = iy;
  }

  radius(elapsed) {
    const pulse = Math.sin(elapsed / this.pulsePeriod * Math.PI * 2 + this.pulsePhase);
    return Math.max(0.1, this.baseR * (1 + 0.20 * pulse));
  }

  update(elapsed) {
    // 更新拖尾
    this.tx2 = this.tx1; this.ty2 = this.ty1;
    this.tx1 = this.x;   this.ty1 = this.y;

    // 弹簧回归
    this.vx += (this.tx - this.x) * curSpring;
    this.vy += (this.ty - this.y) * curSpring;

    // 聚合阶段加微小扰动，让飞行路径更像萤火虫而非直线
    if (introState === State.GATHERING) {
      this.vx += (Math.random() - 0.5) * 0.28;
      this.vy += (Math.random() - 0.5) * 0.28;
    }

    // 鼠标斥力（仅 COMPLETE 且非爆炸）
    if (introState === State.COMPLETE && !isExploding) {
      const dx = this.x - mouse.x;
      const dy = this.y - mouse.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < MOUSE_RADIUS*MOUSE_RADIUS && d2 > 0) {
        const d = Math.sqrt(d2);
        const f = (1 - d / MOUSE_RADIUS) * MOUSE_FORCE;
        const a = Math.atan2(dy, dx) + this.jitter;
        this.vx += Math.cos(a) * f;
        this.vy += Math.sin(a) * f;
      }
    }

    this.vx *= DAMPING;
    this.vy *= DAMPING;
    this.x  += this.vx;
    this.y  += this.vy;
  }

  drawTrail(elapsed) {
    if (!isExploding) return;
    const r = this.radius(elapsed);
    const { r: cr, g: cg, b: cb } = this.color;
    ctx.beginPath();
    ctx.arc(this.tx1, this.ty1, r * 0.65, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.35)`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.tx2, this.ty2, r * 0.35, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.15)`;
    ctx.fill();
  }

  draw(elapsed) {
    const r = this.radius(elapsed);
    const { r: cr, g: cg, b: cb } = this.color;

    // 光晕（氛围粒子跳过以节省性能）
    if (this.type !== 'ambient') {
      const glowR = r * 2.5;
      const gr = this.type === 'bright' ? Math.min(cr+20, 255) : cr;
      const gg = this.type === 'bright' ? Math.min(cg+10, 255) : cg;
      const ga = this.type === 'bright' ? 0.75 : 0.45;
      const grd = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, glowR);
      grd.addColorStop(0, `rgba(${gr},${gg},${cb},${ga})`);
      grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.beginPath();
      ctx.arc(this.x, this.y, glowR, 0, Math.PI*2);
      ctx.fillStyle = grd;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${this.type === 'ambient' ? 0.70 : 1.0})`;
    ctx.fill();
  }
}

// ============================================================
// 五、OrbitParticle 类（星环，phase 1 时出现）
// ============================================================
class OrbitParticle {
  constructor(i) {
    this.angle  = (i / N_ORBIT) * Math.PI * 2 + Math.random() * 0.4;
    this.speed  = (0.0018 + Math.random() * 0.0010) * (Math.random() > 0.5 ? 1 : -1);
    this.r      = 1.2 + Math.random() * 1.0;
    this.alpha  = 0;
    this.orbitR = 0;
    this.color  = {
      r: 255,
      g: (172 + Math.random()*45)|0,
      b: (215 + Math.random()*40)|0
    };
  }

  update(targetAlpha, targetOrbitR) {
    this.angle  += this.speed;
    this.alpha  += (targetAlpha  - this.alpha)  * 0.015;
    this.orbitR += (targetOrbitR - this.orbitR) * 0.02;
  }

  draw() {
    if (this.alpha < 0.01) return;
    // 轻微椭圆感（y 轴压缩 0.75）模拟视角倾斜
    const x = heartCX + Math.cos(this.angle) * this.orbitR;
    const y = heartCY + Math.sin(this.angle) * this.orbitR * 0.78;
    const { r, g, b } = this.color;
    const glowR = this.r * 3.5;
    const grd   = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    grd.addColorStop(0, `rgba(${r},${g},${b},${this.alpha * 0.85})`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI*2);
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, this.r, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${r},${g},${b},${this.alpha})`;
    ctx.fill();
  }
}

// ============================================================
// 六、BokehBlob 类（背景漂移虚化光斑）
// ============================================================
const BLOB_COLORS = [
  { r:255, g:107, b:157 },
  { r:180, g:130, b:220 },
  { r:130, g:180, b:220 },
];

class BokehBlob {
  constructor(i) {
    this.color = BLOB_COLORS[i % 3];
    this._init(true);
  }
  _init(rnd) {
    if (rnd) {
      this.x = W * Math.random();
      this.y = H * Math.random();
    } else {
      const s = Math.random()*4|0;
      if      (s===0) { this.x=-200;   this.y=H*Math.random(); }
      else if (s===1) { this.x=W+200;  this.y=H*Math.random(); }
      else if (s===2) { this.x=W*Math.random(); this.y=-200;  }
      else            { this.x=W*Math.random(); this.y=H+200; }
    }
    this.r      = 80  + Math.random() * 70;
    this.alpha  = 0.03 + Math.random() * 0.05;
    this.angle  = Math.random() * Math.PI * 2;
    this.speed  = 0.12 + Math.random() * 0.20;
    this.dAngle = (Math.random()-0.5) * 0.004;
  }
  update() {
    this.angle += this.dAngle;
    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;
    if (this.x<-300||this.x>W+300||this.y<-300||this.y>H+300) this._init(false);
  }
  draw() {
    const { r, g, b } = this.color;
    const grd = ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,this.r);
    grd.addColorStop(0, `rgba(${r},${g},${b},${this.alpha})`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.arc(this.x,this.y,this.r,0,Math.PI*2);
    ctx.fillStyle = grd;
    ctx.fill();
  }
}

// ============================================================
// 七、StarFollower 类（四角星跟随鼠标，自转）
// ============================================================
class StarFollower {
  constructor() {
    this.x      = W/2; this.y = H/2;
    this.vx     = 0;   this.vy = 0;
    this.offX   = (Math.random()-0.5) * 55;
    this.offY   = (Math.random()-0.5) * 55;
    this.size   = 2.2 + Math.random() * 2.0;
    this.rot    = Math.random() * Math.PI;
    this.rotSpd = (Math.random()-0.5) * 0.045;  // 自转速度（正负随机）
    this.alpha  = 0;
    this.phase  = Math.random() * Math.PI * 2;
  }

  update(elapsed) {
    const tx = mouse.x + this.offX;
    const ty = mouse.y + this.offY;
    // 低弹簧 → 惰性跟随，拖曳感明显
    this.vx += (tx - this.x) * 0.05;
    this.vy += (ty - this.y) * 0.05;
    this.vx *= 0.82; this.vy *= 0.82;
    this.x  += this.vx; this.y += this.vy;
    this.rot += this.rotSpd;
    // 鼠标在屏幕内淡入，离开后慢慢消散
    const vis = (mouse.x>0 && mouse.x<W && mouse.y>0 && mouse.y<H) ? 1 : 0;
    this.alpha += (vis - this.alpha) * 0.06;
  }

  draw(elapsed) {
    if (this.alpha < 0.01) return;
    const pulse = 0.70 + 0.30 * Math.sin(elapsed/850 + this.phase);
    const s = this.size * pulse;
    const a = this.alpha * pulse * 0.88;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);

    // 四角星路径
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const oa = (i/4) * Math.PI * 2;
      const ia = oa + Math.PI / 4;
      i === 0
        ? ctx.moveTo(s*Math.cos(oa), s*Math.sin(oa))
        : ctx.lineTo(s*Math.cos(oa), s*Math.sin(oa));
      ctx.lineTo(s*0.36*Math.cos(ia), s*0.36*Math.sin(ia));
    }
    ctx.closePath();

    ctx.shadowColor = `rgba(255,210,232,${a*0.90})`;
    ctx.shadowBlur  = s * 5;
    ctx.fillStyle   = `rgba(255,242,252,${a})`;
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.restore();
  }
}

// ============================================================
// 八、初始化 / Resize
// ============================================================
function edgePos() {
  // 入场起始：粒子散布在爱心中心为圆心的外围环上
  const ang  = Math.random() * Math.PI * 2;
  const dist = Math.min(W, H) * 0.50 + Math.random() * Math.min(W, H) * 0.28;
  return [ heartCX + Math.cos(ang)*dist, heartCY + Math.sin(ang)*dist ];
}

function init() {
  setupCanvas();

  heartScale = Math.min((W * 0.60)/32, (H * 0.50)/29);
  heartCX    = W / 2;
  heartCY    = H * 0.42 - 2.5 * heartScale;

  const hPts     = buildHeartPoints(N_HEART, heartCX, heartCY, heartScale);
  const shuffled = hPts.slice();
  for (let i = shuffled.length-1; i>0; i--) {
    const j = Math.random()*(i+1)|0;
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  if (particles.length === 0) {
    // 首次创建
    for (let i = 0; i < N_BRIGHT; i++) {
      const [ix,iy] = edgePos();
      particles.push(new Particle('bright', shuffled[i].x, shuffled[i].y, ix, iy));
    }
    for (let i = N_BRIGHT; i < N_HEART; i++) {
      const [ix,iy] = edgePos();
      particles.push(new Particle('main', shuffled[i].x, shuffled[i].y, ix, iy));
    }
    for (let i = 0; i < N_AMBIENT; i++) {
      const base  = hPts[Math.floor(Math.random()*N_HEART)];
      const ang   = Math.random() * Math.PI * 2;
      const dist  = heartScale * (2 + Math.random()*4);
      const [ix,iy] = edgePos();
      particles.push(new Particle('ambient',
        base.x + Math.cos(ang)*dist, base.y + Math.sin(ang)*dist, ix, iy));
    }
    for (let i=0; i<N_ORBIT;  i++) orbitParticles.push(new OrbitParticle(i));
    for (let i=0; i<3;        i++) bokehBlobs.push(new BokehBlob(i));
    for (let i=0; i<N_STARS;  i++) starFollowers.push(new StarFollower());

  } else {
    // Resize：更新目标坐标，保留粒子当前运动状态
    let hi = 0;
    particles.forEach(p => {
      if (p.type === 'ambient') {
        const base = hPts[Math.floor(Math.random()*N_HEART)];
        const ang  = Math.random() * Math.PI * 2;
        const dist = heartScale * (2 + Math.random()*4);
        p.heartX = p.tx = base.x + Math.cos(ang)*dist;
        p.heartY = p.ty = base.y + Math.sin(ang)*dist;
      } else {
        p.heartX = p.tx = shuffled[hi].x;
        p.heartY = p.ty = shuffled[hi].y;
        hi++;
      }
      p.isEscaping = false;
    });
    escapedSet.clear();
  }

  // 文字定位：爱心尖角下方 62px
  textGroup.style.top = (heartCY + 17*heartScale + 62) + 'px';
}

// ============================================================
// 九、入场动画序列
// ============================================================
function startIntro() {
  // t=0.2s：欢迎语淡入
  setTimeout(() => { introTextEl.style.opacity = '1'; }, 200);

  // t=2s：欢迎语淡出
  setTimeout(() => { introTextEl.style.opacity = '0'; }, 2000);

  // t=3s：开启聚合弹簧，粒子开始飞向爱心
  setTimeout(() => {
    introState = State.GATHERING;
    curSpring  = GATHER_SPRING;
  }, 3000);

  // t=5.5s：聚合完成，恢复正常弹簧，文字出现
  setTimeout(() => {
    introState = State.TYPING;
    curSpring  = SPRING_K;
    introScreen.style.opacity = '0';
    textGroup.style.opacity   = '1';
    textGroup.style.animationPlayState = 'running';
    typeSubText();
  }, 5500);

  // t=7s：完全进入可交互状态，启动阶段调度
  setTimeout(() => {
    introState = State.COMPLETE;
    introScreen.style.display = 'none';
    schedulePhaseCheck();
    scheduleEscape();
  }, 7000);
}

// ============================================================
// 十、副标题逐字淡入
// ============================================================
function typeSubText() {
  const text = '能够遇见你，是我最大的幸福';
  subTextEl.innerHTML = '';
  [...text].forEach((ch, i) => {
    const span = document.createElement('span');
    span.textContent = ch;
    subTextEl.appendChild(span);
    setTimeout(() => { span.style.opacity = '1'; }, i * 80 + 150);
  });
}

// ============================================================
// 十一、诗意阶段调度
// ============================================================
function schedulePhaseCheck() {
  setTimeout(() => { phase = 1; }, 30000);   // 30s 后：星环出现
  setTimeout(() => { phase = 2; }, 120000);  // 2min 后：粒子逃逸
}

// ============================================================
// 十二、粒子逃逸（phase 2）
// ============================================================
function scheduleEscape() {
  function tryEscape() {
    if (phase === 2 && introState === State.COMPLETE) {
      const n = 1 + Math.floor(Math.random() * 3);
      const eligible = particles.filter(p => !p.isEscaping && p.type !== 'ambient');
      for (let i = 0; i < Math.min(n, eligible.length); i++) {
        const idx = Math.floor(Math.random() * eligible.length);
        const p   = eligible.splice(idx, 1)[0];
        p.isEscaping = true;
        escapedSet.add(p);
        // 逃逸目标：朝屏幕边缘方向飘
        const ang = Math.random() * Math.PI * 2;
        p.tx = heartCX + Math.cos(ang) * W * 0.48;
        p.ty = heartCY + Math.sin(ang) * H * 0.48;
        // 3-5 秒后缓缓飘回
        setTimeout(() => {
          p.tx = p.heartX;
          p.ty = p.heartY;
          setTimeout(() => {
            p.isEscaping = false;
            escapedSet.delete(p);
          }, 2500);
        }, 3000 + Math.random() * 2000);
      }
    }
    escapeTimeout = setTimeout(tryEscape, 8000 + Math.random() * 10000);
  }
  escapeTimeout = setTimeout(tryEscape, 8000 + Math.random() * 10000);
}

// ============================================================
// 十三、彩蛋：三连击触发
// ============================================================
function recordClick() {
  if (introState !== State.COMPLETE) return;
  const now = Date.now();
  clickTimes = clickTimes.filter(t => now - t < 1500);
  clickTimes.push(now);
  if (clickTimes.length >= 3 && !easterEggOn) {
    triggerEasterEgg();
    clickTimes = [];
  }
}

function triggerEasterEgg() {
  easterEggOn = true;
  // 粒子变金色
  particles.forEach(p => {
    p.savedColor = { ...p.color };
    p.color = { r: 255, g: (190 + Math.random()*35)|0, b: (50 + Math.random()*30)|0 };
  });
  secretMsgEl.style.opacity = '1';
  clearTimeout(easterEggTimer);
  easterEggTimer = setTimeout(() => {
    secretMsgEl.style.opacity = '0';
    setTimeout(() => {
      particles.forEach(p => { p.color = p.savedColor; p.savedColor = null; });
      easterEggOn = false;
    }, 1200);
  }, 4000);
}

// ============================================================
// 十四、爆炸 + 冲击波
// ============================================================
function explode(cx, cy) {
  if (isExploding || introState !== State.COMPLETE) return;
  isExploding = true;

  particles.forEach(p => {
    const ang   = Math.random() * Math.PI * 2;
    const speed = EXPLODE_SPD * (0.4 + Math.random() * 0.8);
    p.vx = Math.cos(ang) * speed;
    p.vy = Math.sin(ang) * speed;
  });

  [
    { color:{r:255,g:255,b:255}, maxR:220, speed:7.0 },
    { color:{r:255,g:107,b:157}, maxR:310, speed:4.5 },
    { color:{r:180,g:130,b:220}, maxR:400, speed:2.8 },
  ].forEach(c => shockwaves.push({ x:cx, y:cy, r:0, ...c }));

  showFireworkName(cx, cy);
  clearTimeout(explodeTimer);
  explodeTimer = setTimeout(() => { isExploding = false; }, EXPLODE_MS);
}

// ============================================================
// 十五、烟花名字动画（放大 + 淡出，rAF 驱动）
// ============================================================
function showFireworkName(x, y) {
  if (fwNameActive) return;
  fwNameActive = true;
  fireworkNameEl.style.left      = x + 'px';
  fireworkNameEl.style.top       = y + 'px';
  fireworkNameEl.style.opacity   = '1';
  fireworkNameEl.style.transform = 'translate(-50%,-50%) scale(0.55)';
  const t0 = performance.now();
  (function step(now) {
    const p = Math.min((now - t0) / 950, 1);
    fireworkNameEl.style.transform = `translate(-50%,-50%) scale(${(0.55 + p*1.05).toFixed(3)})`;
    fireworkNameEl.style.opacity   = (1 - p).toFixed(3);
    if (p < 1) requestAnimationFrame(step);
    else fwNameActive = false;
  })(performance.now());
}

// ============================================================
// 十六、连线绘制（连线密度随阶段降低）
// ============================================================
function drawLines() {
  const dist  = phase === 0 ? LINE_DIST : phase === 1 ? 70 : 55;
  const dist2 = dist * dist;

  for (let i = 0; i < particles.length; i++) {
    const pi = particles[i];
    for (let j = i+1; j < particles.length; j++) {
      const pj = particles[j];
      const dx = pi.x-pj.x, dy = pi.y-pj.y;
      const d2 = dx*dx + dy*dy;
      if (d2 >= dist2) continue;
      const d = Math.sqrt(d2);
      let alpha, width;
      if      (d < 30) { alpha = 0.60; width = 1.2; }
      else if (d < 60) { alpha = 0.28; width = 0.7; }
      else             { alpha = 0.07; width = 0.3; }
      const mr=(pi.color.r+pj.color.r)>>1;
      const mg=(pi.color.g+pj.color.g)>>1;
      const mb=(pi.color.b+pj.color.b)>>1;
      ctx.beginPath();
      ctx.moveTo(pi.x,pi.y); ctx.lineTo(pj.x,pj.y);
      ctx.strokeStyle=`rgba(${mr},${mg},${mb},${alpha})`;
      ctx.lineWidth=width; ctx.stroke();
      if (d < 30) {
        ctx.beginPath();
        ctx.moveTo(pi.x,pi.y); ctx.lineTo(pj.x,pj.y);
        ctx.strokeStyle=`rgba(${mr},${mg},${mb},0.10)`;
        ctx.lineWidth=5; ctx.stroke();
      }
    }
  }
}

// ============================================================
// 十七、双指触摸光线
// ============================================================
function drawTouchBeam() {
  if (touchPoints.length < 2) return;
  const p1=touchPoints[0], p2=touchPoints[1];
  const grd = ctx.createLinearGradient(p1.x,p1.y,p2.x,p2.y);
  grd.addColorStop(0,   'rgba(255,154,178,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.82)');
  grd.addColorStop(1,   'rgba(255,154,178,0.55)');
  ctx.beginPath();
  ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
  ctx.strokeStyle=grd; ctx.lineWidth=1.8; ctx.stroke();
}

// ============================================================
// 十八、背景渲染
// ============================================================
function drawBackground() {
  // 半透明遮罩：颜色累积收敛 → 深空色，同时产生粒子拖尾效果
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0, 'rgba(8,8,18,0.22)');
  bg.addColorStop(1, 'rgba(13,5,20,0.22)');
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,W,H);

  // 爱心后方暖粉光晕
  const hg = ctx.createRadialGradient(heartCX,heartCY,0,heartCX,heartCY,W*0.40);
  hg.addColorStop(0,   'rgba(255,107,157,0.09)');
  hg.addColorStop(0.5, 'rgba(255,107,157,0.03)');
  hg.addColorStop(1,   'rgba(255,107,157,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0,0,W,H);

  bokehBlobs.forEach(b => { b.update(); b.draw(); });
}

// ============================================================
// 十九、冲击波绘制
// ============================================================
function drawShockwaves() {
  shockwaves = shockwaves.filter(sw => {
    sw.r += sw.speed;
    if (sw.r >= sw.maxR) return false;
    const prog  = sw.r / sw.maxR;
    const alpha = (1-prog) * 0.65;
    const lw    = 2.5*(1-prog*0.7) + 0.3;
    const {r,g,b} = sw.color;
    ctx.beginPath();
    ctx.arc(sw.x,sw.y,sw.r,0,Math.PI*2);
    ctx.strokeStyle=`rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth=lw; ctx.stroke();
    return true;
  });
}

// ============================================================
// 二十、星环更新 & 绘制（phase 1 显现）
// ============================================================
function updateDrawOrbit() {
  const orbitR      = heartScale * 21;
  const targetAlpha = phase === 1 ? 0.72 : 0;
  orbitParticles.forEach(op => { op.update(targetAlpha, orbitR); op.draw(); });
}

// ============================================================
// 二十一、主动画循环
// ============================================================
function animate() {
  const elapsed = performance.now() - startTime;

  drawBackground();
  particles.forEach(p => p.drawTrail(elapsed));
  drawLines();
  particles.forEach(p => { p.update(elapsed); p.draw(elapsed); });
  updateDrawOrbit();
  drawShockwaves();
  drawTouchBeam();
  starFollowers.forEach(s => { s.update(elapsed); s.draw(elapsed); });

  requestAnimationFrame(animate);
}

// ============================================================
// 二十二、事件绑定
// ============================================================
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
});
window.addEventListener('mouseleave', () => {
  mouse.x = -9999; mouse.y = -9999;
});

window.addEventListener('click', e => {
  // 防止触摸事件触发 click 导致双重计数（300ms 内忽略）
  if (Date.now() - lastTouchTime < 350) return;
  recordClick();
  explode(e.clientX, e.clientY);
});

window.addEventListener('touchstart', e => {
  lastTouchTime = Date.now();
  const t = e.touches[0];
  mouse.x = t.clientX; mouse.y = t.clientY;
  if (e.touches.length === 1) {
    recordClick();
    explode(t.clientX, t.clientY);
  }
}, { passive: true });

window.addEventListener('touchmove', e => {
  touchPoints = [];
  for (let i=0; i<Math.min(e.touches.length,2); i++) {
    touchPoints.push({ x:e.touches[i].clientX, y:e.touches[i].clientY });
  }
  mouse.x = touchPoints[0].x;
  mouse.y = touchPoints[0].y;
}, { passive: true });

window.addEventListener('touchend', e => {
  touchPoints = [];
  if (e.touches.length === 0) { mouse.x=-9999; mouse.y=-9999; }
}, { passive: true });

// 音乐按钮
let tipVisible = false;
musicBtn.addEventListener('click', e => {
  e.stopPropagation();
  tipVisible = !tipVisible;
  musicTip.style.opacity = tipVisible ? '1' : '0';
});

// Resize
window.addEventListener('resize', () => {
  startTime = performance.now();
  init();
});

// ============================================================
// 二十三、启动
// ============================================================
init();
animate();
startIntro();
