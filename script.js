// ============================================================
// 粒子情书 — script.js（全面升级版）
// 纯原生 Canvas，无第三方库
// ============================================================

const canvas    = document.getElementById('canvas');
const ctx       = canvas.getContext('2d');
const textGroup = document.getElementById('text-group');

// ---- 粒子数量配置 -------------------------------------------
const TOTAL     = 180;
const N_BRIGHT  = Math.round(TOTAL * 0.15);       // 27  亮点粒子
const N_MAIN    = Math.round(TOTAL * 0.55);        // 99  主体粒子
const N_AMBIENT = TOTAL - N_BRIGHT - N_MAIN;       // 54  氛围粒子
const N_HEART   = N_BRIGHT + N_MAIN;               // 126 分布在爱心轮廓

// ---- 物理参数 -----------------------------------------------
const SPRING_K     = 0.060;  // 弹簧回归系数（偏低让运动更流畅）
const DAMPING      = 0.84;   // 阻尼（< 0.88，使回归时有轻微过冲）
const MOUSE_RADIUS = 150;    // 鼠标斥力半径 px
const MOUSE_FORCE  = 12;     // 鼠标推力峰值
const LINE_DIST    = 100;    // 连线最大距离 px
const EXPLODE_SPD  = 36;     // 爆炸初速度（原版 2 倍）
const EXPLODE_MS   = 1500;   // 爆炸后开始回归的延迟 ms
const NUM_FIREFLY  = 6;      // 萤火虫光点数量

// ---- 运行时全局状态 ------------------------------------------
let W, H;                                 // Canvas 逻辑尺寸（CSS px）
let heartCX, heartCY, heartScale;         // 爱心参数（每次 resize 更新）
let mouse        = { x: -9999, y: -9999 };
let isExploding  = false;
let explodeTimer = null;
let startTime    = performance.now();
let particles    = [];
let bokehBlobs   = [];
let fireflies    = [];
let shockwaves   = [];

// ============================================================
// 高清渲染初始化
// canvas.width/height = CSS 尺寸 × devicePixelRatio
// ctx.scale 后，所有绘制坐标继续用逻辑像素，Retina 自动锐利
// ============================================================
function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  // 赋值 canvas.width 会自动重置 ctx transform，再 scale 不会累积
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
}

// ============================================================
// 心形参数方程采样
// x = 16sin³(t)，y 取反让尖角朝下
// ============================================================
function buildHeartPoints(n, cx, cy, scale) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t  = (i / n) * Math.PI * 2;
    const hx =  16 * Math.pow(Math.sin(t), 3);
    const hy = -(13 * Math.cos(t)
               -  5 * Math.cos(2 * t)
               -  2 * Math.cos(3 * t)
               -      Math.cos(4 * t));
    pts.push({ x: cx + hx * scale, y: cy + hy * scale });
  }
  return pts;
}

// ============================================================
// 粒子颜色方案（颜色存为 {r,g,b}，方便后续混合运算）
// ============================================================
function pickColor(type) {
  const t = Math.random();
  if (type === 'bright') {
    // 纯白偏粉
    return { r: 255, g: (225 + t * 30) | 0, b: (238 + t * 17) | 0 };
  }
  if (type === 'main') {
    // 暖粉 #ff6b9d → 淡紫
    return { r: (255 - t * 20) | 0, g: (107 + t * 95) | 0, b: (157 + t * 80) | 0 };
  }
  // 氛围：淡紫 #c9a0dc → 淡蓝 #a0c4dc
  return { r: (160 - t * 20) | 0, g: (140 + t * 60) | 0, b: (200 + t * 55) | 0 };
}

// ============================================================
// Particle 类
// ============================================================
class Particle {
  constructor(type, tx, ty) {
    this.type = type;
    this.tx   = tx;
    this.ty   = ty;
    this.x    = W * Math.random();
    this.y    = H * Math.random();
    this.vx   = 0;
    this.vy   = 0;

    // 粒子分级半径
    if      (type === 'bright')  this.baseR = 2.5 + Math.random() * 1.5;   // 2.5–4 px
    else if (type === 'main')    this.baseR = 1.2 + Math.random() * 0.8;   // 1.2–2 px
    else                         this.baseR = 0.4 + Math.random() * 0.4;   // 0.4–0.8 px

    this.color       = pickColor(type);
    this.pulsePhase  = Math.random() * Math.PI * 2;     // 脉动起始相位
    this.pulsePeriod = 3000 + Math.random() * 3000;     // 3–6 秒随机周期
    // 鼠标推力的随机偏转角（让散开更自然，不像子弹）
    this.jitter      = (Math.random() - 0.5) * 0.65;

    // 拖尾缓存（存前 2 帧位置）
    this.tx1 = this.x; this.ty1 = this.y;
    this.tx2 = this.x; this.ty2 = this.y;
  }

  // 当前含脉动的半径
  radius(elapsed) {
    const pulse = Math.sin(elapsed / this.pulsePeriod * Math.PI * 2 + this.pulsePhase);
    return Math.max(0.1, this.baseR * (1 + 0.2 * pulse));
  }

  update(elapsed) {
    // 更新拖尾坐标（先移后更）
    this.tx2 = this.tx1; this.ty2 = this.ty1;
    this.tx1 = this.x;   this.ty1 = this.y;

    // 弹簧回归力（DAMPING < 0.88 → 轻微过冲，产生弹跳感）
    this.vx += (this.tx - this.x) * SPRING_K;
    this.vy += (this.ty - this.y) * SPRING_K;

    // 鼠标斥力（爆炸期间暂停，避免两种力叠加混乱）
    if (!isExploding) {
      const dx = this.x - mouse.x;
      const dy = this.y - mouse.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < MOUSE_RADIUS * MOUSE_RADIUS && d2 > 0) {
        const d = Math.sqrt(d2);
        // 越近越强（线性衰减）+ 随机偏转角让散开更自然
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

  // 拖尾残影（仅爆炸时绘制，静止时残影与本体重叠不可见）
  drawTrail(elapsed) {
    if (!isExploding) return;
    const r = this.radius(elapsed);
    const { r: cr, g: cg, b: cb } = this.color;

    ctx.beginPath();
    ctx.arc(this.tx1, this.ty1, r * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.35)`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(this.tx2, this.ty2, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.15)`;
    ctx.fill();
  }

  draw(elapsed) {
    const r = this.radius(elapsed);
    const { r: cr, g: cg, b: cb } = this.color;

    // 光晕：径向渐变，半径 = 粒子本身 × 2.5（氛围粒子跳过，节省性能）
    if (this.type !== 'ambient') {
      const glowR = r * 2.5;
      // 亮点粒子光晕加微暖黄偏移
      const gr = this.type === 'bright' ? Math.min(cr + 20, 255) : cr;
      const gg = this.type === 'bright' ? Math.min(cg + 10, 255) : cg;
      const ga = this.type === 'bright' ? 0.75 : 0.45;
      const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, glowR);
      grad.addColorStop(0, `rgba(${gr},${gg},${cb},${ga})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.beginPath();
      ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // 粒子核心
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${this.type === 'ambient' ? 0.70 : 1.0})`;
    ctx.fill();
  }
}

// ============================================================
// 背景漂移虚化光斑（镜头光晕，若隐若现）
// ============================================================
const BLOB_COLORS = [
  { r: 255, g: 107, b: 157 },  // 暖粉
  { r: 180, g: 130, b: 220 },  // 淡紫
  { r: 130, g: 180, b: 220 },  // 淡蓝
];

class BokehBlob {
  constructor(index) {
    this.color = BLOB_COLORS[index % 3];
    this._init(true);
  }

  _init(randomPos) {
    if (randomPos) {
      this.x = W * Math.random();
      this.y = H * Math.random();
    } else {
      // 从随机边缘重新入场
      const side = Math.random() * 4 | 0;
      if      (side === 0) { this.x = -200;     this.y = H * Math.random(); }
      else if (side === 1) { this.x = W + 200;  this.y = H * Math.random(); }
      else if (side === 2) { this.x = W * Math.random(); this.y = -200;    }
      else                 { this.x = W * Math.random(); this.y = H + 200; }
    }
    this.r      = 80  + Math.random() * 70;
    this.alpha  = 0.03 + Math.random() * 0.05;
    this.angle  = Math.random() * Math.PI * 2;
    this.speed  = 0.12 + Math.random() * 0.20;
    this.dAngle = (Math.random() - 0.5) * 0.004;  // 缓慢改变漂移方向
  }

  update() {
    this.angle += this.dAngle;
    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;
    if (this.x < -300 || this.x > W + 300 || this.y < -300 || this.y > H + 300) {
      this._init(false);
    }
  }

  draw() {
    const { r, g, b } = this.color;
    const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r);
    grad.addColorStop(0, `rgba(${r},${g},${b},${this.alpha})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

// ============================================================
// 萤火虫跟随光点（鼠标附近 6 个惰性追随的微光点）
// ============================================================
class Firefly {
  constructor() {
    this.x     = W / 2;
    this.y     = H / 2;
    this.vx    = 0;
    this.vy    = 0;
    this.offX  = (Math.random() - 0.5) * 50;   // 相对鼠标的随机偏移
    this.offY  = (Math.random() - 0.5) * 50;
    this.r     = 0.8 + Math.random() * 1.2;
    this.alpha = 0;
    this.phase = Math.random() * Math.PI * 2;
  }

  update(elapsed) {
    const tx = mouse.x + this.offX;
    const ty = mouse.y + this.offY;
    // 低弹簧系数 → 反应慢，拖曳感明显
    this.vx += (tx - this.x) * 0.05;
    this.vy += (ty - this.y) * 0.05;
    this.vx *= 0.82;
    this.vy *= 0.82;
    this.x  += this.vx;
    this.y  += this.vy;
    // 鼠标在屏幕内淡入，离开后淡出消散
    const target = (mouse.x > 0 && mouse.x < W && mouse.y > 0 && mouse.y < H) ? 1 : 0;
    this.alpha += (target - this.alpha) * 0.06;
  }

  draw(elapsed) {
    if (this.alpha < 0.01) return;
    const pulse = 0.65 + 0.35 * Math.sin(elapsed / 900 + this.phase);
    const r  = this.r * pulse;
    const a  = this.alpha * pulse * 0.85;
    const gr = r * 5;
    const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, gr);
    grad.addColorStop(0, `rgba(255,220,240,${a})`);
    grad.addColorStop(1, `rgba(255,180,220,0)`);
    ctx.beginPath();
    ctx.arc(this.x, this.y, gr, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,245,255,${a})`;
    ctx.fill();
  }
}

// ============================================================
// 初始化 / Resize
// ============================================================
function init() {
  setupCanvas();

  // 心形缩放：最多占宽 60% / 高 50%
  heartScale = Math.min((W * 0.60) / 32, (H * 0.50) / 29);
  // 心形中心：42% 高度偏上，给文字留空间
  heartCX = W / 2;
  heartCY = H * 0.42 - 2.5 * heartScale;

  const hPts     = buildHeartPoints(N_HEART, heartCX, heartCY, heartScale);
  // Fisher-Yates 打乱，让亮点粒子均匀分布在爱心各处
  const shuffled = hPts.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0;
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  if (particles.length === 0) {
    // ---- 首次创建 ----
    for (let i = 0; i < N_BRIGHT; i++) {
      particles.push(new Particle('bright', shuffled[i].x, shuffled[i].y));
    }
    for (let i = N_BRIGHT; i < N_HEART; i++) {
      particles.push(new Particle('main', shuffled[i].x, shuffled[i].y));
    }
    // 氛围粒子：以心形轮廓点为基础，向外随机偏移 2–6 个缩放单位
    for (let i = 0; i < N_AMBIENT; i++) {
      const base  = hPts[Math.floor(Math.random() * N_HEART)];
      const angle = Math.random() * Math.PI * 2;
      const dist  = heartScale * (2 + Math.random() * 4);
      particles.push(new Particle(
        'ambient',
        base.x + Math.cos(angle) * dist,
        base.y + Math.sin(angle) * dist
      ));
    }

    // 背景光斑
    for (let i = 0; i < 3; i++) bokehBlobs.push(new BokehBlob(i));
    // 萤火虫
    for (let i = 0; i < NUM_FIREFLY; i++) fireflies.push(new Firefly());

  } else {
    // ---- Resize：仅更新目标坐标，保留粒子运动状态 ----
    let hi = 0;  // 心形点索引（bright + main 共用）
    particles.forEach(p => {
      if (p.type === 'ambient') {
        const base  = hPts[Math.floor(Math.random() * N_HEART)];
        const angle = Math.random() * Math.PI * 2;
        const dist  = heartScale * (2 + Math.random() * 4);
        p.tx = base.x + Math.cos(angle) * dist;
        p.ty = base.y + Math.sin(angle) * dist;
      } else {
        p.tx = shuffled[hi].x;
        p.ty = shuffled[hi].y;
        hi++;
      }
    });
  }

  // 文字组定位：爱心底部尖角（cy + 17*scale）下方 60px
  const tipY = heartCY + 17 * heartScale;
  textGroup.style.top = (tipY + 60) + 'px';
}

// ============================================================
// 爆炸：3 层冲击波 + 粒子随机飞出
// ============================================================
function explode(clickX, clickY) {
  if (isExploding) return;
  isExploding = true;

  particles.forEach(p => {
    const angle = Math.random() * Math.PI * 2;
    const speed = EXPLODE_SPD * (0.4 + Math.random() * 0.8);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
  });

  // 三层冲击波光环（白 / 粉 / 紫）
  [
    { color: { r:255, g:255, b:255 }, maxR: 220, speed: 7.0 },
    { color: { r:255, g:107, b:157 }, maxR: 310, speed: 4.5 },
    { color: { r:180, g:130, b:220 }, maxR: 400, speed: 2.8 },
  ].forEach(cfg => shockwaves.push({ x: clickX, y: clickY, r: 0, ...cfg }));

  clearTimeout(explodeTimer);
  explodeTimer = setTimeout(() => { isExploding = false; }, EXPLODE_MS);
}

// ============================================================
// 连线绘制：距离分级透明度 & 宽度，近距线额外叠加发光
// ============================================================
function drawLines() {
  for (let i = 0; i < particles.length; i++) {
    const pi = particles[i];
    for (let j = i + 1; j < particles.length; j++) {
      const pj = particles[j];
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= LINE_DIST * LINE_DIST) continue;

      const d = Math.sqrt(d2);
      let alpha, width;
      if      (d < 30) { alpha = 0.60; width = 1.2; }
      else if (d < 60) { alpha = 0.30; width = 0.75; }
      else             { alpha = 0.08; width = 0.30; }

      // 两端颜色混合（位移运算代替除法）
      const mr = (pi.color.r + pj.color.r) >> 1;
      const mg = (pi.color.g + pj.color.g) >> 1;
      const mb = (pi.color.b + pj.color.b) >> 1;

      ctx.beginPath();
      ctx.moveTo(pi.x, pi.y);
      ctx.lineTo(pj.x, pj.y);
      ctx.strokeStyle = `rgba(${mr},${mg},${mb},${alpha})`;
      ctx.lineWidth   = width;
      ctx.stroke();

      // 近距线额外叠加宽而透明的辉光线
      if (d < 30) {
        ctx.beginPath();
        ctx.moveTo(pi.x, pi.y);
        ctx.lineTo(pj.x, pj.y);
        ctx.strokeStyle = `rgba(${mr},${mg},${mb},0.10)`;
        ctx.lineWidth   = 5;
        ctx.stroke();
      }
    }
  }
}

// ============================================================
// 背景渲染：深空渐变拖尾遮罩 + 爱心光晕 + 漂移光斑
// 使用半透明覆盖代替 clearRect，让粒子产生运动拖尾
// 稳态下背景色收敛到遮罩色 rgba(10,10,26)，与 CSS 背景匹配
// ============================================================
function drawBackground() {
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, 'rgba(10,10,26,0.22)');
  bgGrad.addColorStop(1, 'rgba(13,5,20,0.22)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // 爱心后方大范围暖粉光晕（radius ≈ 页面宽 40%）
  const hg = ctx.createRadialGradient(heartCX, heartCY, 0, heartCX, heartCY, W * 0.40);
  hg.addColorStop(0,   'rgba(255,107,157,0.09)');
  hg.addColorStop(0.5, 'rgba(255,107,157,0.03)');
  hg.addColorStop(1,   'rgba(255,107,157,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, H);

  bokehBlobs.forEach(b => { b.update(); b.draw(); });
}

// ============================================================
// 冲击波更新 & 绘制
// ============================================================
function drawShockwaves() {
  shockwaves = shockwaves.filter(sw => {
    sw.r += sw.speed;
    if (sw.r >= sw.maxR) return false;
    const prog  = sw.r / sw.maxR;
    const alpha = (1 - prog) * 0.65;
    const lw    = 2.5 * (1 - prog * 0.7) + 0.3;
    const { r, g, b } = sw.color;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth   = lw;
    ctx.stroke();
    return true;
  });
}

// ============================================================
// 主动画循环
// ============================================================
function animate() {
  const elapsed = performance.now() - startTime;

  drawBackground();                              // 背景 + 拖尾遮罩 + 光斑
  particles.forEach(p => p.drawTrail(elapsed));  // 爆炸拖尾残影
  drawLines();                                   // 粒子连线
  particles.forEach(p => { p.update(elapsed); p.draw(elapsed); }); // 粒子
  drawShockwaves();                              // 冲击波光环
  fireflies.forEach(f => { f.update(elapsed); f.draw(elapsed); }); // 萤火虫

  requestAnimationFrame(animate);
}

// ============================================================
// 事件绑定
// ============================================================
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

window.addEventListener('mouseleave', () => {
  mouse.x = -9999;
  mouse.y = -9999;
});

window.addEventListener('click', e => explode(e.clientX, e.clientY));

window.addEventListener('touchstart', e => {
  const t = e.touches[0];
  mouse.x = t.clientX;
  mouse.y = t.clientY;
  explode(t.clientX, t.clientY);
}, { passive: true });

window.addEventListener('touchmove', e => {
  mouse.x = e.touches[0].clientX;
  mouse.y = e.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchend', () => {
  mouse.x = -9999;
  mouse.y = -9999;
});

window.addEventListener('resize', () => {
  startTime = performance.now();  // 重置计时，防止脉动相位突变
  init();
});

// ============================================================
// 启动
// ============================================================
init();
animate();
