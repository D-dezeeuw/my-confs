// Minimal confetti — single-burst spawner with gravity + tilt + alpha fade.
// API-compatible with the subset of canvas-confetti this project actually
// uses: { particleCount, spread, startVelocity, angle, origin, colors,
// gravity, decay, ticks, disableForReducedMotion }.
//
// Rectangles only, single shared canvas, no worker. Calling fire() while
// an animation is already running queues new particles into the same
// rAF chain. The canvas is removed from the DOM as soon as the last
// particle expires.

const TWO_PI = Math.PI * 2;

let canvas = null;
let ctx = null;
let particles = [];
let rafId = 0;

const DEFAULTS = {
  particleCount: 50,
  spread: 60,
  startVelocity: 35,
  gravity: 0.7,
  decay: 0.92,
  ticks: 180,
  angle: 90, // 90° = straight up
  origin: { x: 0.5, y: 0.5 },
  colors: ["#7c5cff", "#2dd4bf", "#f59e0b", "#ef4444"],
  disableForReducedMotion: false,
};

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  fitCanvas();
  window.addEventListener("resize", fitCanvas);
}

function fitCanvas() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function removeCanvas() {
  if (!canvas) return;
  window.removeEventListener("resize", fitCanvas);
  canvas.remove();
  canvas = null;
  ctx = null;
}

function tick() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles = particles.filter((p) => {
    p.x += Math.cos(p.angle) * p.vel;
    p.y += Math.sin(p.angle) * p.vel + p.gravity;
    p.vel *= p.decay;
    p.tilt += p.tiltSpeed;
    p.wobble += p.wobbleSpeed;
    p.life++;

    if (p.life > p.maxLife) return false;
    if (p.y > window.innerHeight + 30) return false;

    const alpha = 1 - p.life / p.maxLife;
    const wobbleX = Math.sin(p.wobble) * 4;

    ctx.save();
    ctx.translate(p.x + wobbleX, p.y);
    ctx.rotate(p.tilt);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
    ctx.restore();
    return true;
  });

  if (particles.length > 0) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = 0;
    removeCanvas();
  }
}

export default function fire(options) {
  const opts = { ...DEFAULTS, ...(options || {}) };
  if (
    opts.disableForReducedMotion &&
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  ensureCanvas();

  const angleRad = (opts.angle * Math.PI) / 180;
  const spreadRad = (opts.spread * Math.PI) / 180;
  const ox = opts.origin.x * window.innerWidth;
  const oy = opts.origin.y * window.innerHeight;

  for (let i = 0; i < opts.particleCount; i++) {
    particles.push({
      x: ox,
      y: oy,
      // angle=90 → straight up. Canvas y is down-positive, so we negate.
      angle: -angleRad + (Math.random() * spreadRad - spreadRad / 2),
      vel: opts.startVelocity * (0.5 + Math.random() * 0.5),
      gravity: opts.gravity,
      decay: opts.decay,
      tilt: Math.random() * TWO_PI,
      tiltSpeed: (Math.random() - 0.5) * 0.3,
      wobble: Math.random() * TWO_PI,
      wobbleSpeed: 0.06 + Math.random() * 0.05,
      color: opts.colors[i % opts.colors.length],
      size: 6 + Math.random() * 5,
      life: 0,
      maxLife: opts.ticks,
    });
  }

  if (!rafId) {
    rafId = requestAnimationFrame(tick);
  }
}
