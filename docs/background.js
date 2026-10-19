// Port of SpiralChat's classic VacuumField and its fixed braille SpiralMark.
// Same seeded twelve-mode interference field, monochrome and quieter under text.
export function startBackground(field, mark) {
  const context = field.getContext('2d'), logo = mark.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let seed = 41;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const modes = Array.from({ length: 12 }, () => {
    const a = random() * Math.PI * 2, k = .02 + random() * .05, w = .32 + random() * .83;
    return { kx: Math.cos(a) * k, ky: Math.sin(a) * k, w: w * (random() < .5 ? -1 : 1), phase: random() * Math.PI * 2 };
  });
  const dots = new Map(), maxT = 2.2 * Math.PI * 2;
  for (let t = 0; t <= maxT; t += .02) {
    const r = .9 * Math.exp(Math.log(7 / .9) / maxT * t);
    const x = Math.round(9 + r * Math.cos(t)), y = Math.round(8 + r * Math.sin(t));
    if (x >= 0 && x < 18 && y >= 0 && y < 16 && !dots.has(y * 18 + x)) dots.set(y * 18 + x, { x, y, s: t / maxT });
  }
  let grid = [], width = 0, height = 0, last = -Infinity, active = false;
  const resize = () => {
    width = innerWidth; height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    field.width = width * dpr; field.height = height * dpr; context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gap = 15, cols = Math.floor(width / gap), rows = Math.floor(height / gap);
    const ox = (width - (cols - 1) * gap) / 2, oy = (height - (rows - 1) * gap) / 2;
    grid = Array.from({ length: cols * rows }, (_, i) => {
      const x = ox + i % cols * gap, y = oy + Math.floor(i / cols) * gap;
      return { x, y, c: modes.map(m => Math.cos(m.kx * x + m.ky * y + m.phase)), s: modes.map(m => Math.sin(m.kx * x + m.ky * y + m.phase)) };
    });
    last = -Infinity;
  };
  const render = (ms) => {
    requestAnimationFrame(render);
    if (document.hidden || ms - last < (reduced.matches ? 1000 : 50)) return;
    last = ms;
    const time = reduced.matches ? 3 : ms / 1000;
    context.clearRect(0, 0, width, height);
    const c = modes.map(m => Math.cos(m.w * time)), s = modes.map(m => Math.sin(m.w * time));
    const buckets = Array.from({ length: 16 }, () => []), front = time * .16 % 1.8 - .4;
    for (const dot of grid) {
      let f = 0;
      for (let i = 0; i < 12; i++) f += dot.c[i] * c[i] + dot.s[i] * s[i];
      f /= 3.464;
      const p = dot.x / width * .5 + (1 - dot.y / height) * .5;
      const gate = Math.max(.22, 1 - Math.abs(p - front) / .32);
      const e = Math.min(1, Math.pow(f * f * gate * 1.6 * 1.45, .72));
      buckets[Math.floor(e * 15)].push(dot);
    }
    for (let i = 0; i < 16; i++) {
      const e = i / 15;
      context.fillStyle = `rgba(255,255,255,${(.055 + .30 * e) * .35})`;
      context.beginPath();
      for (const dot of buckets[i]) { context.moveTo(dot.x + 1.1, dot.y); context.arc(dot.x, dot.y, .8 + .4 * e * e, 0, Math.PI * 2); }
      context.fill();
    }
    logo.clearRect(0, 0, 64, 64);
    for (const dot of dots.values()) {
      const grow = .5 - .65 * Math.cos(time * Math.PI / 3.6);
      const band = .5 + .5 * Math.cos(2 * Math.PI * (dot.s - time / 1.5));
      const alpha = reduced.matches ? .8 : active ? .2 + .8 * band ** 3 : .12 + .84 * Math.max(0, Math.min(1, (grow - dot.s) / .08));
      logo.fillStyle = `rgba(255,255,255,${alpha})`;
      logo.beginPath(); logo.arc(6 + dot.x * 3, 8 + dot.y * 3, .9, 0, Math.PI * 2); logo.fill();
    }
  };
  addEventListener('resize', resize); resize(); requestAnimationFrame(render);
  return { setWorking(value) { active = value; } };
}
