// ============================================================
// 给范晓语 — script.js（宇宙终极版）
// ============================================================

// ---- DOM refs -----------------------------------------------
const canvas         = document.getElementById('canvas');
const ctx            = canvas.getContext('2d');
const textGroup      = document.getElementById('text-group');
const introWrap      = document.getElementById('intro-wrap');
const introLine1     = document.getElementById('intro-line1');
const introLine2     = document.getElementById('intro-line2');
const egg1Msg        = document.getElementById('egg1-msg');
const egg2Msg        = document.getElementById('egg2-msg');
const egg3Msg        = document.getElementById('egg3-msg');
const fireworkNameEl = document.getElementById('firework-name');
const musicBtn       = document.getElementById('music-btn');
const musicTip       = document.getElementById('music-tip');
const subTextEl      = document.getElementById('sub-text');
const bgMusicEl      = document.getElementById('bgMusic');

// ---- 音频状态（HTML5 Audio 本地文件版）-----------------------
let soundEnabled     = false;
let musicToggleCount = 0;
let mouseSoundAccum  = 0;      // 鼠标移动距离累计
let mouseSoundLastX  = -1, mouseSoundLastY = -1;
let lastParticleSndT = 0;      // 粒子音效节流时间戳
let lastChimeMoveT   = 0;      // 鼠标移动风铃节流时间戳

// 烟花文件跳过前置静音的秒数（根据实际文件调整）
const FIREWORK_SKIP  = 0.35;

// 预加载本地音频对象（文件位于 音乐/ 子目录）
// 风铃拆成两个独立对象：各自 reset 复用，彻底避免 clone 叠加爆音
const sndChimeMove = new Audio('音乐/chime.mp3'); // 鼠标移动
const sndChimePush = new Audio('音乐/chime.mp3'); // 粒子推开
const sndFirework  = new Audio('音乐/firework.wav');
const sndMagic     = new Audio('音乐/magic.wav');
const sndSwitchOn  = new Audio('音乐/switch-on.mp3');
const sndSwitchOff = new Audio('音乐/switch-off.mp3');
if (bgMusicEl) { bgMusicEl.loop = true; bgMusicEl.volume = 0.2; }

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

// ---- 状态枚举 -----------------------------------------------
const St = { WELCOME:0, GATHERING:1, TYPING:2, COMPLETE:3 };
let introState = St.WELCOME;
let curSpring  = 0;

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

// ---- 烟花名字 -----------------------------------------------
let fwNameActive   = false;

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
function initBgStars() {
  bgStarBuf = new Float32Array(N_BG_STARS * 6);
  const maxDist = Math.hypot(W, H) * 0.62;
  for (let i = 0; i < N_BG_STARS; i++) {
    const b = i * 6;
    bgStarBuf[b+0] = Math.random() * Math.PI * 2;          // baseAngle
    bgStarBuf[b+1] = Math.random() * maxDist;              // dist
    bgStarBuf[b+2] = 0.3 + Math.random() * 0.5;           // radius
    bgStarBuf[b+3] = 0.25 + Math.random() * 0.65;         // brightness
    bgStarBuf[b+4] = (0.4 + Math.random() * 2.2) * 0.001; // twinkleSpd rad/ms
    bgStarBuf[b+5] = Math.random() * Math.PI * 2;          // twinklePhase
  }
}

function drawBgStars(elapsed) {
  const ROT = (Math.PI * 2) / 120000; // 120s 一圈
  const cx = W / 2, cy = H / 2;
  for (let i = 0; i < N_BG_STARS; i++) {
    const b   = i * 6;
    const ang = bgStarBuf[b+0] + elapsed * ROT;
    const d   = bgStarBuf[b+1];
    const r   = bgStarBuf[b+2];
    const br  = bgStarBuf[b+3] * (0.55 + 0.45 * Math.sin(elapsed * bgStarBuf[b+4] + bgStarBuf[b+5]));
    const x   = cx + Math.cos(ang) * d;
    const y   = cy + Math.sin(ang) * d;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,215,255,${br.toFixed(2)})`;
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

function drawMeteors() {
  const now = performance.now();
  meteors = meteors.filter(m => {
    const t = (now - m.born) / m.life;
    if (t >= 1) return false;
    const alpha = t < 0.4 ? t / 0.4 : (1 - t) / 0.6;
    const hx = m.x + Math.cos(m.angle) * m.speed * t * 55;
    const hy = m.y + Math.sin(m.angle) * m.speed * t * 55;
    const tx = hx - Math.cos(m.angle) * m.len;
    const ty = hy - Math.sin(m.angle) * m.len;
    const g  = ctx.createLinearGradient(tx, ty, hx, hy);
    g.addColorStop(0,   'rgba(140,195,255,0)');
    g.addColorStop(0.6, `rgba(180,220,255,${(alpha * 0.35).toFixed(2)})`);
    g.addColorStop(1,   `rgba(255,255,255,${alpha.toFixed(2)})`);
    ctx.beginPath();
    ctx.moveTo(tx, ty); ctx.lineTo(hx, hy);
    ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.stroke();
    return true;
  });
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
function pickColor(type) {
  const t = Math.random();
  if (type === 'bright') return { r:255, g:(222+t*33)|0, b:(238+t*17)|0 };
  if (type === 'main')   return { r:(255-t*18)|0, g:(107+t*95)|0, b:(157+t*82)|0 };
  return { r:(158-t*20)|0, g:(138+t*62)|0, b:(200+t*55)|0 };
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

    // 布朗运动：在目标位置 ±3px 随机漂移，让爱心像在呼吸
    if (introState === St.COMPLETE && !egg2On) {
      this.brownX = this.brownX * 0.96 + (Math.random() - 0.5) * 0.18;
      this.brownY = this.brownY * 0.96 + (Math.random() - 0.5) * 0.18;
    }
    const btx = this.tx + Math.max(-3, Math.min(3, this.brownX));
    const bty = this.ty + Math.max(-3, Math.min(3, this.brownY));

    // 爆炸收缩阶段：强弹簧拉向点击中心
    if (explodePhase === 'contract') {
      this.vx += (explodeCX - this.x) * CONTRACT_SPR;
      this.vy += (explodeCY - this.y) * CONTRACT_SPR;
    } else {
      this.vx += (btx - this.x) * curSpring;
      this.vy += (bty - this.y) * curSpring;
    }

    // 聚合入场：给粒子随机扰动，模拟萤火虫飞行
    if (introState === St.GATHERING) {
      this.vx += (Math.random() - 0.5) * 0.28;
      this.vy += (Math.random() - 0.5) * 0.28;
    }

    // 鼠标双区域交互（仅 COMPLETE 且非爆炸）
    if (introState === St.COMPLETE && explodePhase === 'idle') {
      const mdx = mouse.x - this.x;
      const mdy = mouse.y - this.y;
      const md2 = mdx*mdx + mdy*mdy;
      const md  = Math.sqrt(md2);
      if (md < MOUSE_INNER && md > 0) {
        // 内圈：轻微吸引
        const f = (1 - md / MOUSE_INNER) * 3.5;
        this.vx += (mdx / md) * f;
        this.vy += (mdy / md) * f;
      } else if (md < MOUSE_OUTER && md > 0) {
        // 外圈：斥力 + 随机偏转
        const f = (1 - (md - MOUSE_INNER) / (MOUSE_OUTER - MOUSE_INNER)) * MOUSE_FORCE;
        const a = Math.atan2(-mdy, -mdx) + this.jitter;
        this.vx += Math.cos(a) * f;
        this.vy += Math.sin(a) * f;
        maybePlayStarGlint();  // 星光闪烁音（节流+3%概率）
      }

      // 鼠标静止 2s 后极缓慢靠近光标
      if (performance.now() - lastMouseMoveTime > 2000 && md > 10 && md < 350) {
        this.vx += (mdx / md) * 0.04;
        this.vy += (mdy / md) * 0.04;
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
    const r = this.radius(elapsed);
    // 色相缓慢漂移：粉→浅紫→粉，30s 一周期
    const drift  = Math.sin(elapsed / 30000 * Math.PI * 2 + this.pulsePhase);
    const { r:cr, g:cg, b:cb } = this.color;
    const gr = cr, gg = (cg + drift * 22) | 0, gb = Math.min(255, (cb - drift * 15) | 0);

    if (this.type !== 'ambient') {
      const glowR = r * 2.5;
      const glr   = this.type === 'bright' ? Math.min(gr+20,255) : gr;
      const glg   = this.type === 'bright' ? Math.min(gg+10,255) : gg;
      const ga    = this.type === 'bright' ? 0.75 : 0.44;
      const grd   = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, glowR);
      grd.addColorStop(0, `rgba(${glr},${glg},${gb},${ga})`);
      grd.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
      ctx.beginPath(); ctx.arc(this.x, this.y, glowR, 0, Math.PI*2);
      ctx.fillStyle = grd; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${gr},${gg},${gb},${this.type==='ambient'?0.68:1.0})`;
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
const BLOB_C = [{r:255,g:107,b:157},{r:180,g:130,b:220},{r:130,g:180,b:220}];
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
  draw() {
    const {r,g,b}=this.color;
    const grd=ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,this.r);
    grd.addColorStop(0,`rgba(${r},${g},${b},${this.alpha})`);
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
function init() {
  setupCanvas();
  heartScale = Math.min((W*0.60)/32, (H*0.50)/29);
  heartCX    = W/2;
  heartCY    = H*0.42 - 2.5*heartScale;

  const hPts     = buildHeartPoints(N_HEART, heartCX, heartCY, heartScale);
  const shuffled = shuffle(hPts.slice());

  if (particles.length === 0) {
    for (let i=0;i<N_BRIGHT;i++) {
      const [ix,iy]=edgePos();
      particles.push(new Particle('bright',shuffled[i].x,shuffled[i].y,ix,iy));
    }
    for (let i=N_BRIGHT;i<N_HEART;i++) {
      const [ix,iy]=edgePos();
      particles.push(new Particle('main',shuffled[i].x,shuffled[i].y,ix,iy));
    }
    for (let i=0;i<N_AMBIENT;i++) {
      const base=hPts[Math.floor(Math.random()*N_HEART)];
      const ang=Math.random()*Math.PI*2, dist=heartScale*(2+Math.random()*4);
      const [ix,iy]=edgePos();
      particles.push(new Particle('ambient',base.x+Math.cos(ang)*dist,base.y+Math.sin(ang)*dist,ix,iy));
    }
    for (let i=0;i<N_ORBIT;   i++) orbitParticles.push(new OrbitParticle(i));
    for (let i=0;i<3;         i++) bokehBlobs.push(new BokehBlob(i));
    for (let i=0;i<N_FOLLOWER;i++) starFollowers.push(new StarFollower());
    initBgStars();
  } else {
    let hi=0;
    const sh2=shuffle(buildHeartPoints(N_HEART,heartCX,heartCY,heartScale).slice());
    particles.forEach(p => {
      if (p.type==='ambient') {
        const base=hPts[Math.floor(Math.random()*N_HEART)];
        const ang=Math.random()*Math.PI*2, dist=heartScale*(2+Math.random()*4);
        p.heartX=p.tx=base.x+Math.cos(ang)*dist; p.heartY=p.ty=base.y+Math.sin(ang)*dist;
      } else { p.heartX=p.tx=sh2[hi].x; p.heartY=p.ty=sh2[hi].y; hi++; }
      p.isEscaping=false;
    });
    escapedSet.clear();
    initBgStars(); // 重新计算最大距离
  }
  textGroup.style.top = (heartCY+17*heartScale+62)+'px';
}

// ============================================================
// 十二、入场动画（新时间线）
// ============================================================
function startIntro() {
  // 0-2s: 星空背景出现（canvas 自然渲染）
  // 2s: 第一行文字淡入
  setTimeout(()=>{ introLine1.style.opacity='1'; }, 2000);
  // 3.5s: 第一行淡出
  setTimeout(()=>{ introLine1.style.opacity='0'; }, 3500);
  // 4s: 第二行淡入
  setTimeout(()=>{ introLine2.style.opacity='1'; }, 4000);
  // 5.5s: 第二行淡出
  setTimeout(()=>{ introLine2.style.opacity='0'; }, 5500);
  // 6s: 聚合开始
  setTimeout(()=>{ introState=St.GATHERING; curSpring=GATHER_SPRING; }, 6000);
  // 9s: 聚合完成，文字出现
  setTimeout(()=>{
    introState=St.TYPING; curSpring=SPRING_K;
    introWrap.style.display='none';
    textGroup.style.opacity='1';
    textGroup.style.animationPlayState='running';
    typeSubText();
  }, 9000);
  // 10.5s: 完全交互
  setTimeout(()=>{
    introState=St.COMPLETE;
    schedulePhaseCheck();
    scheduleEscape();
    scheduleEgg3();
    meteorTimeout=setTimeout(spawnMeteor, 5000+Math.random()*10000);
  }, 10500);
}

// ============================================================
// 十三、逐字淡入
// ============================================================
function typeSubText() {
  const text='晓语，遇见你是我最大的幸福';
  subTextEl.innerHTML='';
  [...text].forEach((ch,i)=>{
    const s=document.createElement('span'); s.textContent=ch; subTextEl.appendChild(s);
    setTimeout(()=>{ s.style.opacity='1'; }, i*80+200);
  });
}

// ============================================================
// 十四、诗意阶段调度
// ============================================================
function schedulePhaseCheck() {
  setTimeout(()=>{ phase=1; }, 30000);
  setTimeout(()=>{ phase=2; }, 120000);
}

// ============================================================
// 十五、粒子逃逸（phase 2）
// ============================================================
function scheduleEscape() {
  function run() {
    if (phase===2 && introState===St.COMPLETE) {
      const n=1+Math.floor(Math.random()*3);
      const pool=particles.filter(p=>!p.isEscaping&&p.type!=='ambient');
      for (let i=0;i<Math.min(n,pool.length);i++) {
        const idx=Math.floor(Math.random()*pool.length);
        const p=pool.splice(idx,1)[0];
        p.isEscaping=true; escapedSet.add(p);
        const ang=Math.random()*Math.PI*2;
        p.tx=heartCX+Math.cos(ang)*W*0.47; p.ty=heartCY+Math.sin(ang)*H*0.47;
        setTimeout(()=>{
          p.tx=p.heartX; p.ty=p.heartY;
          setTimeout(()=>{ p.isEscaping=false; escapedSet.delete(p); },2500);
        }, 3000+Math.random()*2000);
      }
    }
    escapeTimeout=setTimeout(run, 8000+Math.random()*10000);
  }
  escapeTimeout=setTimeout(run, 8000+Math.random()*10000);
}

// ============================================================
// 十六、彩蛋一：三连击（金色）
// ============================================================
function recordClick() {
  if (introState!==St.COMPLETE) return;
  const now=Date.now();
  clickTimes=clickTimes.filter(t=>now-t<1500); clickTimes.push(now);
  if (clickTimes.length>=3&&!egg1On&&!egg2On) { triggerEgg1(); clickTimes=[]; }
}
function triggerEgg1() {
  egg1On=true;
  playMusicBoxMelody();  // C5→E5→G5→C6 八音盒旋律
  particles.forEach(p=>{ p.savedColor={...p.color}; p.color={r:255,g:(188+Math.random()*38)|0,b:(48+Math.random()*32)|0}; });
  egg1Msg.style.opacity='1';
  clearTimeout(egg1Timer);
  egg1Timer=setTimeout(()=>{
    egg1Msg.style.opacity='0';
    setTimeout(()=>{ particles.forEach(p=>{p.color=p.savedColor;}); egg1On=false; },1200);
  }, 4000);
}

// ============================================================
// 十七、彩蛋二：Ctrl+L / 三指（星空模式）
// ============================================================
function triggerEgg2() {
  if (egg2On||introState!==St.COMPLETE) return;
  egg2On=true;
  // 粒子散布全屏
  particles.forEach(p=>{
    p.savedTX2=p.tx; p.savedTY2=p.ty;
    p.tx=Math.random()*W; p.ty=Math.random()*H;
  });
  egg2Msg.style.opacity='1';
  clearTimeout(egg2Timer);
  egg2Timer=setTimeout(()=>{
    egg2Msg.style.opacity='0';
    particles.forEach(p=>{ p.tx=p.savedTX2||p.heartX; p.ty=p.savedTY2||p.heartY; });
    setTimeout(()=>{ egg2On=false; },1500);
  }, 5000);
}

// ============================================================
// 十八、彩蛋三：5分钟自动
// ============================================================
function scheduleEgg3() {
  setTimeout(()=>{
    if (egg3Shown) return;
    egg3Shown=true;
    egg3Msg.style.opacity='1';
    setTimeout(()=>{ egg3Msg.style.opacity='0'; },3000);
  }, 300000); // 5 分钟
}

// ============================================================
// 十九、爆炸：先收缩 0.3s，再猛然炸开
// ============================================================
function explode(cx, cy) {
  if (introState!==St.COMPLETE||explodePhase!=='idle') return;
  explodePhase='contract'; explodeCX=cx; explodeCY=cy;

  // 0.3s 后炸开
  clearTimeout(contractTimer);
  contractTimer=setTimeout(()=>{
    explodePhase='blast';
    particles.forEach(p=>{
      const ang=Math.random()*Math.PI*2;
      const spd=EXPLODE_SPD*(0.4+Math.random()*0.8);
      p.vx=Math.cos(ang)*spd; p.vy=Math.sin(ang)*spd;
      // 30% 粒子短暂变色（金色或亮白）
      if (Math.random()<0.30) {
        p.savedColor={...p.color};
        p.color=Math.random()>0.5?{r:255,g:220,b:60}:{r:255,g:255,b:255};
        setTimeout(()=>{ if(p.savedColor) p.color=p.savedColor; },1800+Math.random()*1000);
      }
    });
    playFireworkBloom();  // 烟花温暖绽放音
    addShockwaves(cx,cy);
    showFireworkName(cx,cy);
    clearTimeout(explodeTimer);
    explodeTimer=setTimeout(()=>{ explodePhase='idle'; },EXPLODE_MS);
  }, 300);
}

function addShockwaves(cx,cy) {
  [{color:{r:255,g:255,b:255},maxR:220,speed:7.0},
   {color:{r:255,g:107,b:157},maxR:310,speed:4.5},
   {color:{r:180,g:130,b:220},maxR:400,speed:2.8}]
  .forEach(c=>shockwaves.push({x:cx,y:cy,r:0,...c}));
}

// ============================================================
// 二十、烟花名字动画
// ============================================================
function showFireworkName(cx,cy) {
  if (fwNameActive) return;
  fwNameActive=true;
  fireworkNameEl.style.left=cx+'px'; fireworkNameEl.style.top=cy+'px';
  fireworkNameEl.style.opacity='1'; fireworkNameEl.style.transform='translate(-50%,-50%) scale(0.55)';
  const t0=performance.now();
  (function step(now){
    const p=Math.min((now-t0)/950,1);
    fireworkNameEl.style.transform=`translate(-50%,-50%) scale(${(0.55+p*1.05).toFixed(3)})`;
    fireworkNameEl.style.opacity=(1-p).toFixed(3);
    if(p<1) requestAnimationFrame(step); else fwNameActive=false;
  })(performance.now());
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
    const a=(1-age)*0.22;
    ctx.beginPath(); ctx.arc(p.x,p.y,2.5*(1-age),0,Math.PI*2);
    ctx.fillStyle=`rgba(255,175,215,${a.toFixed(3)})`; ctx.fill();
  }
}

// ============================================================
// 二十三、背景渲染
// ============================================================
function drawBackground(elapsed) {
  // 深空半透明遮罩（产生拖尾效果）
  ctx.fillStyle='rgba(8,8,18,0.20)';
  ctx.fillRect(0,0,W,H);
  // 爱心后方暖粉光晕
  const hg=ctx.createRadialGradient(heartCX,heartCY,0,heartCX,heartCY,W*0.40);
  hg.addColorStop(0,'rgba(255,107,157,0.08)');
  hg.addColorStop(0.5,'rgba(255,107,157,0.03)');
  hg.addColorStop(1,'rgba(255,107,157,0)');
  ctx.fillStyle=hg; ctx.fillRect(0,0,W,H);
  // 背景星空
  drawBgStars(elapsed);
  // 漂移光斑
  bokehBlobs.forEach(b=>{ b.update(); b.draw(); });
}

// ============================================================
// 二十四、冲击波
// ============================================================
function drawShockwaves() {
  shockwaves=shockwaves.filter(sw=>{
    sw.r+=sw.speed; if(sw.r>=sw.maxR) return false;
    const pg=sw.r/sw.maxR, al=(1-pg)*0.65, lw=2.5*(1-pg*0.7)+0.3;
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
  const elapsed=performance.now()-startTime;
  frameCount++;

  drawBackground(elapsed);
  drawMeteors();
  updateMouseHistory();
  drawMouseTrail();
  particles.forEach(p=>p.drawTrail(elapsed));
  drawLines();
  particles.forEach(p=>{ p.update(elapsed); p.draw(elapsed); });
  updateDrawOrbit();
  drawShockwaves();
  drawTouchBeam();
  starFollowers.forEach(s=>{ s.update(elapsed); s.draw(elapsed); });

  requestAnimationFrame(animate);
}

// ============================================================
// 二十八、事件
// ============================================================
window.addEventListener('mousemove', e=>{
  mouse.x=e.clientX; mouse.y=e.clientY; lastMouseMoveTime=performance.now();
  onMouseMoved(e.clientX, e.clientY);  // 鼠标移动叮声
});
window.addEventListener('mouseleave',()=>{ mouse.x=-9999; mouse.y=-9999; });

window.addEventListener('click', e=>{
  if (Date.now()-lastTouchTime<350) return;
  recordClick(); explode(e.clientX,e.clientY);
});

// Ctrl+L：彩蛋二
window.addEventListener('keydown', e=>{
  if (e.ctrlKey&&e.key==='l') { e.preventDefault(); triggerEgg2(); }
});

// 触摸
window.addEventListener('touchstart', e=>{
  lastTouchTime=Date.now();
  const t=e.touches[0]; mouse.x=t.clientX; mouse.y=t.clientY;
  if (e.touches.length===1) { recordClick(); explode(t.clientX,t.clientY); }
  if (e.touches.length===3) triggerEgg2(); // 三指触发彩蛋二
}, {passive:true});

window.addEventListener('touchmove', e=>{
  touchPoints=[];
  for(let i=0;i<Math.min(e.touches.length,2);i++) touchPoints.push({x:e.touches[i].clientX,y:e.touches[i].clientY});
  mouse.x=touchPoints[0].x; mouse.y=touchPoints[0].y;
},{passive:true});

window.addEventListener('touchend', e=>{
  touchPoints=[];
  if(e.touches.length===0){mouse.x=-9999;mouse.y=-9999;}
},{passive:true});

// 音乐按钮：完整切换逻辑（开/关循环）
let tipTimer = null;
musicBtn.addEventListener('click', e=>{
  e.stopPropagation();
  toggleMusic();
});

window.addEventListener('resize',()=>{ startTime=performance.now(); init(); });

// ============================================================
// 音频系统 v3（HTML5 Audio · 本地文件 · 零依赖）
// ============================================================

// 通用播放（低频一次性音效用：clone 保证不打断）
function playSound(snd, vol) {
  if (!soundEnabled) return;
  const clip = snd.cloneNode();
  clip.volume = Math.max(0, Math.min(1, vol));
  clip.play().catch(() => {});
}

// 强制播放（不受 soundEnabled 限制，用于关闭确认音）
function playSoundForce(snd, vol) {
  const clip = snd.cloneNode();
  clip.volume = Math.max(0, Math.min(1, vol));
  clip.play().catch(() => {});
}

// ---- 一、鼠标移动风铃音 -------------------------------------
// 修复：不用 clone，直接 reset 同一对象，彻底杜绝叠加爆音
// 距离阈值提高到 80px，时间节流 220ms，限制最大播放频率
function onMouseMoved(x, y) {
  if (mouseSoundLastX < 0) { mouseSoundLastX = x; mouseSoundLastY = y; return; }
  const dx = x - mouseSoundLastX, dy = y - mouseSoundLastY;
  mouseSoundAccum += Math.sqrt(dx*dx + dy*dy);
  mouseSoundLastX = x; mouseSoundLastY = y;
  if (!soundEnabled || mouseSoundAccum < 80) return;
  mouseSoundAccum = 0;
  const now = performance.now();
  if (now - lastChimeMoveT < 220) return;   // 时间节流，避免快速移动时叠加
  lastChimeMoveT = now;
  sndChimeMove.currentTime = 0;
  sndChimeMove.volume = 0.15;
  sndChimeMove.play().catch(() => {});
}

// ---- 二、粒子推开音 -----------------------------------------
// 修复：同上，reset 同一对象；节流从 150ms 提高到 400ms
// 鼠标必须在 300ms 内有移动才允许触发，静止时彻底无声
function maybePlayStarGlint() {
  if (!soundEnabled) return;
  const now = performance.now();
  if (now - lastMouseMoveTime > 300) return;  // 鼠标静止则跳过
  if (now - lastParticleSndT < 400) return;   // 节流 400ms
  if (Math.random() > 0.03) return;           // 3% 概率
  lastParticleSndT = now;
  sndChimePush.currentTime = 0;
  sndChimePush.volume = 0.1;
  sndChimePush.play().catch(() => {});
}

// ---- 三、烟花绽放音 -----------------------------------------
// 修复：currentTime = FIREWORK_SKIP 跳过文件开头的静音段
function playFireworkBloom() {
  if (!soundEnabled) return;
  sndFirework.currentTime = FIREWORK_SKIP;
  sndFirework.volume = 0.3;
  sndFirework.play().catch(() => {});
}

// ---- 四、彩蛋八音盒音 ---------------------------------------
function playMusicBoxMelody() {
  playSound(sndMagic, 0.25);
}

// ---- 五、♫ 按钮切换（奇=开，偶=关）------------------------
function toggleMusic() {
  musicToggleCount++;
  soundEnabled = musicToggleCount % 2 === 1;

  if (soundEnabled) {
    playSound(sndSwitchOn, 0.2);
    if (bgMusicEl) bgMusicEl.play().catch(() => {});
    musicBtn.style.color       = 'rgba(255,154,178,0.88)';
    musicBtn.style.borderColor = 'rgba(255,154,178,0.45)';
    musicTip.style.opacity     = '1';
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { musicTip.style.opacity = '0'; }, 3000);
  } else {
    playSoundForce(sndSwitchOff, 0.2);
    if (bgMusicEl) bgMusicEl.pause();
    musicBtn.style.color       = '';
    musicBtn.style.borderColor = '';
  }
}

// ============================================================
// 二十九、启动
// ============================================================
init();
animate();
startIntro();
