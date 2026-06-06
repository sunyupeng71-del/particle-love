// ============================================================
// 粒子情书 — script.js
// 技术栈：原生 Canvas + requestAnimationFrame，无第三方库
// ============================================================

const canvas   = document.getElementById('canvas');
const ctx      = canvas.getContext('2d');
const loveText = document.getElementById('love-text');

// ---- 全局配置 ------------------------------------------------
const PARTICLE_COUNT = 180;    // 粒子总数
const SPRING_K       = 0.055;  // 弹簧回归系数（越大回归越急）
const DAMPING        = 0.88;   // 速度阻尼（模拟空气阻力）
const MOUSE_RADIUS   = 120;    // 鼠标斥力影响半径 px
const MOUSE_FORCE    = 10;     // 鼠标推力峰值
const LINE_DIST      = 75;     // 粒子间连线最大距离 px
const EXPLODE_SPEED  = 18;     // 烟花爆炸初速度
const EXPLODE_MS     = 1500;   // 爆炸结束后开始聚合的延迟 ms

// ---- 运行时状态 -----------------------------------------------
let mouse          = { x: -9999, y: -9999 }; // 鼠标坐标（超出屏幕则无影响）
let isExploding    = false;                   // 是否处于爆炸状态
let explodeTimeout = null;                    // 爆炸计时器
let particles      = [];                      // 粒子数组

// ============================================================
// 1. 心形坐标生成
//    参数方程：x = 16sin³(t)，y = 13cos(t)-5cos(2t)-2cos(3t)-cos(4t)
//    Canvas y 轴朝下，因此对 y 取反让尖角朝下（视觉上的"心形"）
// ============================================================
function buildHeartTargets(n, cx, cy, scale) {
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
// 2. 粒子颜色生成
//    粉色 40%、紫色 32%、白/淡紫 28%，随机透明度增加层次感
// ============================================================
function pickColor() {
  const r = Math.random();
  if (r < 0.40) {
    // 粉色系
    const g = 150 + (Math.random() * 80 | 0);
    const b = 170 + (Math.random() * 60 | 0);
    return `rgba(255,${g},${b},${(0.60 + Math.random() * 0.40).toFixed(2)})`;
  }
  if (r < 0.72) {
    // 紫色系
    const rv = 165 + (Math.random() * 75 | 0);
    const gv =  85 + (Math.random() * 85 | 0);
    return `rgba(${rv},${gv},255,${(0.55 + Math.random() * 0.40).toFixed(2)})`;
  }
  // 白/淡紫色系
  const v = 215 + (Math.random() * 40 | 0);
  return `rgba(${v},${v - 15},${v + 10},${(0.45 + Math.random() * 0.45).toFixed(2)})`;
}

// ============================================================
// 3. Particle 类
// ============================================================
class Particle {
  constructor(tx, ty) {
    this.tx = tx;  // 目标 x（心形轮廓上的位置）
    this.ty = ty;  // 目标 y
    // 初始随机散布，开场时有"粒子聚合成心形"的动态效果
    this.x  = canvas.width  * Math.random();
    this.y  = canvas.height * Math.random();
    this.vx = 0;
    this.vy = 0;
    this.r  = 1.5 + Math.random() * 2.0;  // 粒子半径 1.5~3.5 px
    this.color = pickColor();
  }

  update() {
    // ① 弹簧力：将粒子拉向心形目标位置
    this.vx += (this.tx - this.x) * SPRING_K;
    this.vy += (this.ty - this.y) * SPRING_K;

    // ② 鼠标斥力（爆炸期间跳过，避免两种力叠加混乱）
    if (!isExploding) {
      const dx = this.x - mouse.x;
      const dy = this.y - mouse.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < MOUSE_RADIUS * MOUSE_RADIUS && d2 > 0) {
        const d = Math.sqrt(d2);
        // 距离越近推力越强（线性衰减）
        const f = (1 - d / MOUSE_RADIUS) * MOUSE_FORCE;
        this.vx += (dx / d) * f;
        this.vy += (dy / d) * f;
      }
    }

    // ③ 阻尼：每帧速度衰减，防止无限震荡
    this.vx *= DAMPING;
    this.vy *= DAMPING;

    // ④ 积分更新位置
    this.x += this.vx;
    this.y += this.vy;
  }

  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
  }
}

// ============================================================
// 4. 初始化 / 响应式 resize
// ============================================================
function init() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  // 根据可用空间等比计算心形缩放：最多占宽 60% / 高 50%
  // 心形宽约 32 单位、高约 29 单位（参数方程原始范围）
  const scale = Math.min(
    (canvas.width  * 0.60) / 32,
    (canvas.height * 0.50) / 29
  );

  // 心形几何中心
  // 公式中 hy 范围：-12（顶部凸起）到 +17（底部尖角）
  // 让整体视觉中心在画布 42% 高度处，给文字留出下方空间
  const cx = canvas.width  / 2;
  const cy = canvas.height * 0.42 - 2.5 * scale;  // 2.5 = (17-12)/2，补偿不对称

  const targets = buildHeartTargets(PARTICLE_COUNT, cx, cy, scale);

  if (particles.length === 0) {
    // 首次：创建所有粒子
    targets.forEach(t => particles.push(new Particle(t.x, t.y)));
  } else {
    // Resize：仅更新目标坐标，保持粒子当前运动状态，过渡更自然
    particles.forEach((p, i) => {
      p.tx = targets[i].x;
      p.ty = targets[i].y;
    });
  }

  // 动态定位呼吸灯文字：爱心底部尖角 + 间距
  const tipY = cy + 17 * scale;
  loveText.style.top = (tipY + scale * 2.8) + 'px';
}

// ============================================================
// 5. 烟花爆炸
//    点击后给所有粒子施加随机方向初速度；
//    EXPLODE_MS 毫秒后关闭爆炸标志，弹簧力自动将粒子拉回
// ============================================================
function explode() {
  if (isExploding) return;   // 防止短时间内重复触发
  isExploding = true;

  particles.forEach(p => {
    const angle = Math.random() * Math.PI * 2;
    const speed = EXPLODE_SPEED * (0.4 + Math.random() * 0.8);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
  });

  clearTimeout(explodeTimeout);
  explodeTimeout = setTimeout(() => {
    // 恢复正常状态，弹簧力接管，粒子缓慢归位
    isExploding = false;
  }, EXPLODE_MS);
}

// ============================================================
// 6. 粒子连线
//    对所有粒子两两检测距离，近则画半透明细线
//    O(n²) = 16110 次/帧，180 粒子量级下 Canvas 可流畅处理
// ============================================================
function drawLines() {
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < LINE_DIST * LINE_DIST) {
        // 距离越近透明度越高（最大 0.22）
        const alpha = (1 - Math.sqrt(d2) / LINE_DIST) * 0.22;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(210,160,255,${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  }
}

// ============================================================
// 7. 主动画循环
// ============================================================
function animate() {
  // 用半透明深色覆盖而非 clearRect，形成粒子运动拖影
  // 透明度 0.18：值越小拖影越长，越大则越清晰
  ctx.fillStyle = 'rgba(10,10,45,0.18)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 先画连线（在粒子下层），再画粒子本体
  drawLines();
  particles.forEach(p => {
    p.update();
    p.draw();
  });

  requestAnimationFrame(animate);
}

// ============================================================
// 8. 事件绑定
// ============================================================

// 鼠标移动：实时记录坐标，供粒子斥力计算
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

// 鼠标离开窗口：将坐标推到屏幕外，粒子不再受影响
window.addEventListener('mouseleave', () => {
  mouse.x = -9999;
  mouse.y = -9999;
});

// 点击任意位置：触发烟花爆炸
window.addEventListener('click', explode);

// 触摸支持（手机 / 平板）
window.addEventListener('touchmove', e => {
  mouse.x = e.touches[0].clientX;
  mouse.y = e.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchstart', e => {
  // 触摸单击也触发爆炸（touchend 会在 click 前触发，此处用 touchstart 区分移动和点击）
  if (e.touches.length === 1) explode();
}, { passive: true });

window.addEventListener('touchend', () => {
  mouse.x = -9999;
  mouse.y = -9999;
});

// 窗口尺寸变化：重新计算 Canvas 和心形目标坐标
window.addEventListener('resize', init);

// ============================================================
// 9. 启动
// ============================================================
init();
animate();
