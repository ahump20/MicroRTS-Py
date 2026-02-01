/**
 * BlazeCraft Enhanced Engine
 * MicroRTS-inspired grid-based RTS engine with physics, particles, fog of war,
 * unit management, and real-time metrics.
 */

// ============================================================
// CONFIGURATION (derived from MicroRTS game mechanics)
// ============================================================
const CONFIG = {
  GRID_W: 16,
  GRID_H: 16,
  CELL_SIZE: 0, // computed on resize
  // MicroRTS unit types
  UNIT_TYPES: {
    resource: { hp: 99, speed: 0, attack: 0, range: 0, cost: 0, buildTime: 0, color: '#22c55e', label: 'R', isBuilding: true },
    base:     { hp: 10, speed: 0, attack: 0, range: 0, cost: 200, buildTime: 200, color: '#fbbf24', label: 'B', isBuilding: true },
    barracks: { hp: 6,  speed: 0, attack: 0, range: 0, cost: 150, buildTime: 150, color: '#fb923c', label: 'K', isBuilding: true },
    worker:   { hp: 1,  speed: 1, attack: 1, range: 1, cost: 50,  buildTime: 50,  color: '#60a5fa', label: 'W', isBuilding: false },
    light:    { hp: 2,  speed: 2, attack: 2, range: 1, cost: 100, buildTime: 80,  color: '#34d399', label: 'L', isBuilding: false },
    heavy:    { hp: 4,  speed: 1, attack: 4, range: 1, cost: 150, buildTime: 120, color: '#f87171', label: 'H', isBuilding: false },
    ranged:   { hp: 1,  speed: 1, attack: 2, range: 3, cost: 120, buildTime: 100, color: '#a78bfa', label: 'R', isBuilding: false },
  },
  // MicroRTS action types
  ACTIONS: ['noop', 'move', 'harvest', 'return', 'produce', 'attack'],
  // MicroRTS reward weights
  REWARD_WEIGHTS: { winLoss: 10.0, resources: 1.0, workers: 1.0, buildings: 0.2, attack: 1.0, combat: 4.0 },
  // Physics
  PARTICLE_LIMIT: 200,
  TICK_MS: 50,
  // Fog of war
  FOG_ENABLED: true,
  VISION_RANGE: 4,
};

// ============================================================
// STATE
// ============================================================
const state = {
  units: [],
  particles: [],
  grid: [],       // terrain: 0=free, 1=wall, 2=resource
  fogGrid: [],    // 0=hidden, 1=explored, 2=visible
  selected: [],
  camera: { x: 0, y: 0, zoom: 1 },
  mouse: { x: 0, y: 0, gridX: 0, gridY: 0, down: false, button: 0, dragStart: null },
  resources: { gold: 200, tasks: 0, files: 0, tokens: 0, failed: 0, workers: 0 },
  cycle: 0,
  startTime: Date.now(),
  demoMode: true,
  fogEnabled: CONFIG.FOG_ENABLED,
  showGrid: true,
  logFilter: 'all',
  events: [],
  opsEvents: 0,
  opsErrors: 0,
  rewards: { winLoss: 0, resources: 0, workers: 0, buildings: 0, attack: 0, combat: 0 },
  prodQueue: [],
  nextUnitId: 1,
};

// ============================================================
// DOM REFS
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const canvas = $('#mapCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = $('#minimapCanvas');
const mctx = minimapCanvas.getContext('2d');
const portraitCanvas = $('#portraitCanvas');
const pctx = portraitCanvas.getContext('2d');

// ============================================================
// INITIALIZATION
// ============================================================
function init() {
  initGrid();
  initUnits();
  initFog();
  resizeCanvas();
  bindEvents();
  updateFog();
  requestAnimationFrame(gameLoop);
  setInterval(gameTick, CONFIG.TICK_MS);
  if (state.demoMode) startDemo();
  log('System online. BlazeCraft Enhanced initialized.', 'info');
  log('MicroRTS engine loaded: 16x16 grid, 7 unit types', 'info');
}

// Generate MicroRTS-style map (basesWorkers16x16)
function initGrid() {
  state.grid = Array.from({ length: CONFIG.GRID_H }, () => Array(CONFIG.GRID_W).fill(0));
  // Walls
  for (let y = 6; y <= 9; y++) { state.grid[y][7] = 1; state.grid[y][8] = 1; }
  // Resources
  state.grid[2][6] = 2; state.grid[2][7] = 2; state.grid[3][6] = 2;
  state.grid[12][9] = 2; state.grid[13][8] = 2; state.grid[13][9] = 2;
}

function initUnits() {
  // Player 1 (blue)
  spawnUnit('base', 1, 1, 1);
  spawnUnit('worker', 2, 1, 1);
  spawnUnit('worker', 1, 2, 1);
  // Player 2 (red / AI enemy)
  spawnUnit('base', 14, 14, 2);
  spawnUnit('worker', 13, 14, 2);
  spawnUnit('worker', 14, 13, 2);
}

function initFog() {
  state.fogGrid = Array.from({ length: CONFIG.GRID_H }, () => Array(CONFIG.GRID_W).fill(0));
}

function spawnUnit(type, gx, gy, owner) {
  const def = CONFIG.UNIT_TYPES[type];
  const unit = {
    id: state.nextUnitId++,
    type, owner,
    gx, gy,
    // Smooth position for rendering (physics interpolation)
    rx: gx, ry: gy,
    hp: def.hp, maxHp: def.hp,
    action: 'noop',
    target: null,
    progress: 0,
    carrying: 0,
    task: null,
    vx: 0, vy: 0, // velocity for physics
  };
  state.units.push(unit);
  return unit;
}

// ============================================================
// CANVAS RESIZE
// ============================================================
function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.scale(devicePixelRatio, devicePixelRatio);
  CONFIG.CELL_SIZE = Math.min(rect.width, rect.height) / CONFIG.GRID_W;
}
window.addEventListener('resize', resizeCanvas);

// ============================================================
// RENDERING
// ============================================================
let lastFrame = 0;

function gameLoop(ts) {
  const dt = (ts - lastFrame) / 1000;
  lastFrame = ts;
  updatePhysics(dt);
  render(dt);
  requestAnimationFrame(gameLoop);
}

function render(dt) {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  const cs = CONFIG.CELL_SIZE;
  const ox = (w - cs * CONFIG.GRID_W) / 2 + state.camera.x;
  const oy = (h - cs * CONFIG.GRID_H) / 2 + state.camera.y;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(state.camera.zoom, state.camera.zoom);

  // Draw grid
  drawGrid(cs);
  // Draw terrain
  drawTerrain(cs);
  // Draw fog
  if (state.fogEnabled) drawFog(cs);
  // Draw units
  drawUnits(cs, dt);
  // Draw particles
  drawParticles(cs, dt);
  // Draw selection box
  drawSelectionBox(cs, ox, oy);
  // Draw attack lines
  drawAttackLines(cs);

  ctx.restore();

  // Minimap
  renderMinimap();
}

function drawGrid(cs) {
  if (!state.showGrid) return;
  ctx.strokeStyle = '#ffffff08';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= CONFIG.GRID_W; x++) {
    ctx.beginPath(); ctx.moveTo(x * cs, 0); ctx.lineTo(x * cs, CONFIG.GRID_H * cs); ctx.stroke();
  }
  for (let y = 0; y <= CONFIG.GRID_H; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * cs); ctx.lineTo(CONFIG.GRID_W * cs, y * cs); ctx.stroke();
  }
}

function drawTerrain(cs) {
  for (let y = 0; y < CONFIG.GRID_H; y++) {
    for (let x = 0; x < CONFIG.GRID_W; x++) {
      const t = state.grid[y][x];
      if (t === 1) {
        // Wall
        ctx.fillStyle = '#2a1f14';
        ctx.fillRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
        ctx.strokeStyle = '#4a3520';
        ctx.strokeRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
        // Wall detail
        ctx.fillStyle = '#3a2a18';
        ctx.fillRect(x * cs + cs * 0.2, y * cs + cs * 0.2, cs * 0.3, cs * 0.3);
        ctx.fillRect(x * cs + cs * 0.55, y * cs + cs * 0.5, cs * 0.3, cs * 0.3);
      } else if (t === 2) {
        // Resource
        ctx.fillStyle = '#064e2044';
        ctx.fillRect(x * cs, y * cs, cs, cs);
        // Crystal shape
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.moveTo(x * cs + cs / 2, y * cs + cs * 0.15);
        ctx.lineTo(x * cs + cs * 0.75, y * cs + cs / 2);
        ctx.lineTo(x * cs + cs / 2, y * cs + cs * 0.85);
        ctx.lineTo(x * cs + cs * 0.25, y * cs + cs / 2);
        ctx.closePath();
        ctx.fill();
        // Glow
        ctx.shadowColor = '#22c55e';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }
}

function drawFog(cs) {
  for (let y = 0; y < CONFIG.GRID_H; y++) {
    for (let x = 0; x < CONFIG.GRID_W; x++) {
      const f = state.fogGrid[y][x];
      if (f === 0) {
        ctx.fillStyle = '#07080cee';
        ctx.fillRect(x * cs, y * cs, cs, cs);
      } else if (f === 1) {
        ctx.fillStyle = '#07080c88';
        ctx.fillRect(x * cs, y * cs, cs, cs);
      }
    }
  }
}

function drawUnits(cs, dt) {
  for (const u of state.units) {
    // Skip if in fog
    if (state.fogEnabled && state.fogGrid[u.gy]?.[u.gx] < 2 && u.owner !== 1) continue;

    const px = u.rx * cs + cs / 2;
    const py = u.ry * cs + cs / 2;
    const r = cs * 0.35;
    const def = CONFIG.UNIT_TYPES[u.type];

    // Selection ring
    if (state.selected.includes(u.id)) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, r + 4, 0, Math.PI * 2);
      ctx.stroke();
      // Selection pulsing
      ctx.strokeStyle = '#22c55e44';
      ctx.lineWidth = 1;
      const pulse = Math.sin(Date.now() / 300) * 3 + 5;
      ctx.beginPath();
      ctx.arc(px, py, r + pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Owner tint
    const ownerColor = u.owner === 1 ? '#3b82f6' : '#ef4444';

    if (def.isBuilding) {
      // Buildings: squares
      const bsize = cs * 0.7;
      ctx.fillStyle = def.color;
      ctx.shadowColor = ownerColor;
      ctx.shadowBlur = 6;
      ctx.fillRect(px - bsize / 2, py - bsize / 2, bsize, bsize);
      ctx.shadowBlur = 0;
      // Border
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(px - bsize / 2, py - bsize / 2, bsize, bsize);
      // Label
      ctx.fillStyle = '#000';
      ctx.font = `bold ${cs * 0.3}px ${getComputedStyle(document.body).getPropertyValue('--font-mono')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.label, px, py);
    } else {
      // Mobile units: circles
      ctx.fillStyle = def.color;
      ctx.shadowColor = ownerColor;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Border ring
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      // Unit label
      ctx.fillStyle = '#000';
      ctx.font = `bold ${cs * 0.28}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.label, px, py);
      // Direction indicator (for moving units)
      if (u.action === 'move' && u.target) {
        const angle = Math.atan2(u.target.y - u.gy, u.target.x - u.gx);
        ctx.strokeStyle = '#ffffff66';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(angle) * r, py + Math.sin(angle) * r);
        ctx.lineTo(px + Math.cos(angle) * (r + 6), py + Math.sin(angle) * (r + 6));
        ctx.stroke();
      }
    }

    // HP bar
    if (u.hp < u.maxHp) {
      const bw = cs * 0.6;
      const bh = 3;
      const bx = px - bw / 2;
      const by = py - r - 8;
      ctx.fillStyle = '#0008';
      ctx.fillRect(bx, by, bw, bh);
      const hpPct = u.hp / u.maxHp;
      ctx.fillStyle = hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
      ctx.fillRect(bx, by, bw * hpPct, bh);
    }

    // Carrying indicator
    if (u.carrying > 0) {
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(px + r * 0.7, py - r * 0.7, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Action indicator
    if (u.action !== 'noop' && u.action !== 'move') {
      ctx.fillStyle = '#ffffff88';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(u.action, px, py + r + 10);
    }
  }
}

function drawParticles(cs, dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    if (p.life <= 0) { state.particles.splice(i, 1); continue; }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.gravity * dt; // physics: gravity

    const alpha = Math.min(1, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;

    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(p.x * cs, p.y * cs, p.size * cs, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(p.x * cs - p.size * cs / 2, p.y * cs - p.size * cs / 2, p.size * cs, p.size * cs);
    }

    // Glow for fire particles
    if (p.glow) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = 1;
  }
}

function drawSelectionBox(cs, ox, oy) {
  if (!state.mouse.down || state.mouse.button !== 0 || !state.mouse.dragStart) return;
  const ds = state.mouse.dragStart;
  const me = state.mouse;
  const x1 = Math.min(ds.sx, me.x) - ox;
  const y1 = Math.min(ds.sy, me.y) - oy;
  const x2 = Math.max(ds.sx, me.x) - ox;
  const y2 = Math.max(ds.sy, me.y) - oy;
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 2]);
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  ctx.setLineDash([]);
  ctx.fillStyle = '#22c55e11';
  ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
}

function drawAttackLines(cs) {
  for (const u of state.units) {
    if (u.action === 'attack' && u.target && u.owner === 1) {
      const tx = state.units.find(t => t.id === u.target);
      if (!tx) continue;
      ctx.strokeStyle = '#ef444488';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(u.rx * cs + cs / 2, u.ry * cs + cs / 2);
      ctx.lineTo(tx.rx * cs + cs / 2, tx.ry * cs + cs / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// ============================================================
// MINIMAP
// ============================================================
function renderMinimap() {
  const mw = minimapCanvas.width;
  const mh = minimapCanvas.height;
  const cw = mw / CONFIG.GRID_W;
  const ch = mh / CONFIG.GRID_H;

  mctx.fillStyle = '#0a0c12';
  mctx.fillRect(0, 0, mw, mh);

  // Terrain
  for (let y = 0; y < CONFIG.GRID_H; y++) {
    for (let x = 0; x < CONFIG.GRID_W; x++) {
      const t = state.grid[y][x];
      if (t === 1) { mctx.fillStyle = '#3a2a18'; mctx.fillRect(x * cw, y * ch, cw, ch); }
      else if (t === 2) { mctx.fillStyle = '#22c55e66'; mctx.fillRect(x * cw, y * ch, cw, ch); }
    }
  }

  // Units
  for (const u of state.units) {
    mctx.fillStyle = u.owner === 1 ? '#3b82f6' : '#ef4444';
    const s = CONFIG.UNIT_TYPES[u.type].isBuilding ? cw * 1.2 : cw * 0.8;
    mctx.fillRect(u.gx * cw + (cw - s) / 2, u.gy * ch + (ch - s) / 2, s, s);
  }

  // Fog
  if (state.fogEnabled) {
    for (let y = 0; y < CONFIG.GRID_H; y++) {
      for (let x = 0; x < CONFIG.GRID_W; x++) {
        if (state.fogGrid[y][x] === 0) { mctx.fillStyle = '#07080ccc'; mctx.fillRect(x * cw, y * ch, cw, ch); }
        else if (state.fogGrid[y][x] === 1) { mctx.fillStyle = '#07080c66'; mctx.fillRect(x * cw, y * ch, cw, ch); }
      }
    }
  }
}

// ============================================================
// PORTRAIT
// ============================================================
function renderPortrait(unit) {
  const w = portraitCanvas.width;
  const h = portraitCanvas.height;
  pctx.clearRect(0, 0, w, h);
  if (!unit) return;

  const def = CONFIG.UNIT_TYPES[unit.type];
  // Background glow
  const grad = pctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grad.addColorStop(0, def.color + '44');
  grad.addColorStop(1, 'transparent');
  pctx.fillStyle = grad;
  pctx.fillRect(0, 0, w, h);

  // Unit shape
  pctx.fillStyle = def.color;
  if (def.isBuilding) {
    pctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
    pctx.strokeStyle = unit.owner === 1 ? '#3b82f6' : '#ef4444';
    pctx.lineWidth = 2;
    pctx.strokeRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
  } else {
    pctx.beginPath();
    pctx.arc(w / 2, h / 2, w * 0.35, 0, Math.PI * 2);
    pctx.fill();
    pctx.strokeStyle = unit.owner === 1 ? '#3b82f6' : '#ef4444';
    pctx.lineWidth = 2;
    pctx.stroke();
  }

  // Label
  pctx.fillStyle = '#000';
  pctx.font = `bold ${w * 0.4}px sans-serif`;
  pctx.textAlign = 'center';
  pctx.textBaseline = 'middle';
  pctx.fillText(def.label, w / 2, h / 2);
}

// ============================================================
// PHYSICS ENGINE
// ============================================================
function updatePhysics(dt) {
  for (const u of state.units) {
    // Smooth position interpolation (lerp toward grid position)
    const lerp = Math.min(1, dt * 8);
    u.rx += (u.gx - u.rx) * lerp;
    u.ry += (u.gy - u.ry) * lerp;
  }

  // Particle physics
  for (const p of state.particles) {
    // Already handled in draw, but we add inter-particle repulsion for dense clusters
    if (p.repel) {
      for (const q of state.particles) {
        if (p === q) continue;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.5 && dist > 0.01) {
          p.vx += (dx / dist) * 0.1;
          p.vy += (dy / dist) * 0.1;
        }
      }
    }
  }
}

// ============================================================
// PARTICLE EMITTERS
// ============================================================
function emitExplosion(gx, gy) {
  for (let i = 0; i < 20; i++) {
    if (state.particles.length >= CONFIG.PARTICLE_LIMIT) break;
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    state.particles.push({
      x: gx + 0.5, y: gy + 0.5,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      gravity: 2,
      life: 0.3 + Math.random() * 0.5, maxLife: 0.8,
      size: 0.05 + Math.random() * 0.08,
      color: ['#ef4444', '#f59e0b', '#fbbf24', '#ffffff'][Math.floor(Math.random() * 4)],
      shape: Math.random() > 0.5 ? 'circle' : 'rect',
      glow: true,
      repel: false,
    });
  }
}

function emitHarvest(gx, gy) {
  for (let i = 0; i < 5; i++) {
    if (state.particles.length >= CONFIG.PARTICLE_LIMIT) break;
    state.particles.push({
      x: gx + 0.5, y: gy + 0.5,
      vx: (Math.random() - 0.5) * 1.5, vy: -1 - Math.random() * 2,
      gravity: 0.5,
      life: 0.5 + Math.random() * 0.5, maxLife: 1,
      size: 0.04 + Math.random() * 0.04,
      color: '#22c55e',
      shape: 'circle',
      glow: true,
      repel: false,
    });
  }
}

function emitSpawn(gx, gy, color) {
  for (let i = 0; i < 12; i++) {
    if (state.particles.length >= CONFIG.PARTICLE_LIMIT) break;
    const angle = Math.random() * Math.PI * 2;
    state.particles.push({
      x: gx + 0.5, y: gy + 0.5,
      vx: Math.cos(angle) * 2, vy: Math.sin(angle) * 2,
      gravity: 0,
      life: 0.4 + Math.random() * 0.4, maxLife: 0.8,
      size: 0.03 + Math.random() * 0.05,
      color: color || '#3b82f6',
      shape: 'circle',
      glow: true,
      repel: true,
    });
  }
}

// ============================================================
// FOG OF WAR
// ============================================================
function updateFog() {
  if (!state.fogEnabled) {
    for (let y = 0; y < CONFIG.GRID_H; y++)
      for (let x = 0; x < CONFIG.GRID_W; x++)
        state.fogGrid[y][x] = 2;
    return;
  }
  // Downgrade visible to explored
  for (let y = 0; y < CONFIG.GRID_H; y++)
    for (let x = 0; x < CONFIG.GRID_W; x++)
      if (state.fogGrid[y][x] === 2) state.fogGrid[y][x] = 1;

  // Reveal around player 1 units
  for (const u of state.units) {
    if (u.owner !== 1) continue;
    const range = CONFIG.VISION_RANGE;
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        if (dx * dx + dy * dy > range * range) continue;
        const nx = u.gx + dx;
        const ny = u.gy + dy;
        if (nx >= 0 && nx < CONFIG.GRID_W && ny >= 0 && ny < CONFIG.GRID_H) {
          state.fogGrid[ny][nx] = 2;
        }
      }
    }
  }
}

// ============================================================
// GAME TICK (simulation)
// ============================================================
function gameTick() {
  state.cycle++;
  updateGameTime();
  processActions();
  processAI();
  processProduction();
  updateFog();
  updateUI();
  updateRewards();

  if (state.cycle % 20 === 0) {
    addOpsEntry(`Cycle ${state.cycle}: ${state.units.length} units active`);
  }
}

function processActions() {
  for (const u of state.units) {
    if (u.action === 'move' && u.target) {
      const dx = u.target.x - u.gx;
      const dy = u.target.y - u.gy;
      if (dx === 0 && dy === 0) { u.action = 'noop'; u.target = null; continue; }
      const sx = Math.sign(dx);
      const sy = Math.sign(dy);
      const nx = u.gx + (Math.abs(dx) > Math.abs(dy) ? sx : 0);
      const ny = u.gy + (Math.abs(dx) <= Math.abs(dy) ? sy : 0);
      if (isWalkable(nx, ny)) { u.gx = nx; u.gy = ny; }
      if (u.gx === u.target.x && u.gy === u.target.y) { u.action = 'noop'; u.target = null; }
    }
    else if (u.action === 'harvest') {
      u.progress++;
      if (u.progress >= 10) {
        u.carrying = Math.min(u.carrying + 1, 4);
        u.progress = 0;
        emitHarvest(u.gx, u.gy);
        if (u.carrying >= 2) {
          u.action = 'return';
          const base = state.units.find(b => b.type === 'base' && b.owner === u.owner);
          if (base) u.target = { x: base.gx, y: base.gy };
        }
      }
    }
    else if (u.action === 'return' && u.target) {
      const dx = u.target.x - u.gx;
      const dy = u.target.y - u.gy;
      if (Math.abs(dx) + Math.abs(dy) <= 1) {
        state.resources.gold += u.carrying * 25;
        state.rewards.resources += u.carrying * 0.1;
        u.carrying = 0;
        u.action = 'noop';
        u.target = null;
        log(`Worker returned ${u.carrying || 2} resources`, 'economy');
      } else {
        const sx = Math.sign(dx);
        const sy = Math.sign(dy);
        const nx = u.gx + (Math.abs(dx) > Math.abs(dy) ? sx : 0);
        const ny = u.gy + (Math.abs(dx) <= Math.abs(dy) ? sy : 0);
        if (isWalkable(nx, ny)) { u.gx = nx; u.gy = ny; }
      }
    }
    else if (u.action === 'attack' && u.target) {
      const target = state.units.find(t => t.id === u.target);
      if (!target || target.hp <= 0) { u.action = 'noop'; u.target = null; continue; }
      const dist = Math.abs(target.gx - u.gx) + Math.abs(target.gy - u.gy);
      const def = CONFIG.UNIT_TYPES[u.type];
      if (dist <= def.range) {
        target.hp -= def.attack * 0.2;
        state.rewards.attack += 0.05;
        if (target.hp <= 0) {
          emitExplosion(target.gx, target.gy);
          log(`${u.type} destroyed enemy ${target.type}!`, 'combat');
          state.rewards.combat += 0.2;
          state.units = state.units.filter(x => x.id !== target.id);
          u.action = 'noop';
          u.target = null;
        }
      } else {
        // Move toward target
        const dx = Math.sign(target.gx - u.gx);
        const dy = Math.sign(target.gy - u.gy);
        const nx = u.gx + dx;
        const ny = u.gy + dy;
        if (isWalkable(nx, ny)) { u.gx = nx; u.gy = ny; }
      }
    }
  }
}

function processAI() {
  if (state.cycle % 5 !== 0) return;
  // Simple AI for player 2 (enemy)
  for (const u of state.units) {
    if (u.owner !== 2 || u.action !== 'noop') continue;
    const def = CONFIG.UNIT_TYPES[u.type];
    if (def.isBuilding) continue;

    // Find nearest player 1 unit
    let nearest = null, minDist = Infinity;
    for (const t of state.units) {
      if (t.owner !== 1) continue;
      const d = Math.abs(t.gx - u.gx) + Math.abs(t.gy - u.gy);
      if (d < minDist) { minDist = d; nearest = t; }
    }

    if (nearest && minDist <= 8) {
      u.action = 'attack';
      u.target = nearest.id;
    } else if (Math.random() < 0.1) {
      // Random patrol
      u.action = 'move';
      u.target = {
        x: Math.max(0, Math.min(CONFIG.GRID_W - 1, u.gx + Math.floor(Math.random() * 5) - 2)),
        y: Math.max(0, Math.min(CONFIG.GRID_H - 1, u.gy + Math.floor(Math.random() * 5) - 2))
      };
    }
  }
}

function processProduction() {
  for (let i = state.prodQueue.length - 1; i >= 0; i--) {
    const pq = state.prodQueue[i];
    pq.progress++;
    if (pq.progress >= pq.total) {
      // Find empty spot near producer
      const spots = [
        [pq.gx + 1, pq.gy], [pq.gx - 1, pq.gy],
        [pq.gx, pq.gy + 1], [pq.gx, pq.gy - 1],
        [pq.gx + 1, pq.gy + 1], [pq.gx - 1, pq.gy - 1],
      ];
      const spot = spots.find(([x, y]) => isWalkable(x, y));
      if (spot) {
        const newUnit = spawnUnit(pq.unitType, spot[0], spot[1], 1);
        emitSpawn(spot[0], spot[1], CONFIG.UNIT_TYPES[pq.unitType].color);
        log(`Produced ${pq.unitType} at (${spot[0]},${spot[1]})`, 'economy');
        state.resources.workers = state.units.filter(u => u.owner === 1 && !CONFIG.UNIT_TYPES[u.type].isBuilding).length;
        if (pq.unitType === 'worker') state.rewards.workers += 0.1;
        else state.rewards.combat += 0.1;
      }
      state.prodQueue.splice(i, 1);
      renderProdQueue();
    }
  }
}

function isWalkable(x, y) {
  if (x < 0 || x >= CONFIG.GRID_W || y < 0 || y >= CONFIG.GRID_H) return false;
  if (state.grid[y][x] === 1) return false;
  return !state.units.some(u => u.gx === x && u.gy === y);
}

// ============================================================
// REWARDS (MicroRTS-inspired)
// ============================================================
function updateRewards() {
  const r = state.rewards;
  const w = CONFIG.REWARD_WEIGHTS;
  const total = r.winLoss * w.winLoss + r.resources * w.resources + r.workers * w.workers +
                r.buildings * w.buildings + r.attack * w.attack + r.combat * w.combat;

  setBarWidth('rwWinLoss', Math.min(100, r.winLoss * 100));
  setBarWidth('rwResources', Math.min(100, r.resources * 50));
  setBarWidth('rwWorkers', Math.min(100, r.workers * 50));
  setBarWidth('rwBuildings', Math.min(100, r.buildings * 100));
  setBarWidth('rwAttack', Math.min(100, r.attack * 20));
  setBarWidth('rwCombat', Math.min(100, r.combat * 10));
  setText('rewardTotal', total.toFixed(2));
}

// ============================================================
// UI UPDATES
// ============================================================
function updateUI() {
  const p1Units = state.units.filter(u => u.owner === 1);
  const mobileP1 = p1Units.filter(u => !CONFIG.UNIT_TYPES[u.type].isBuilding);
  state.resources.workers = mobileP1.length;

  setText('resCompleted', state.resources.tasks);
  setText('resFiles', state.resources.files);
  setText('resWorkers', state.resources.workers);
  setText('resFailed', state.resources.failed);
  setText('resTokens', state.resources.tokens);
  setText('gameCycle', state.cycle);

  // Update idle alert
  const idle = mobileP1.filter(u => u.action === 'noop').length;
  const idleBtn = $('#idleAlert');
  if (idle > 0) {
    idleBtn.hidden = false;
    setText('idleAlertCount', idle);
  } else {
    idleBtn.hidden = true;
  }

  // Portrait for first selected unit
  const selUnit = state.units.find(u => state.selected.includes(u.id));
  if (selUnit) {
    const def = CONFIG.UNIT_TYPES[selUnit.type];
    setText('portraitName', `Agent-${selUnit.id}`);
    setText('portraitType', selUnit.type.charAt(0).toUpperCase() + selUnit.type.slice(1));
    setText('portraitTask', selUnit.action === 'noop' ? 'Idle' : selUnit.action);
    const hpPct = selUnit.hp / selUnit.maxHp;
    setBarWidth('hpBar', hpPct * 100);
    setText('hpVal', `${Math.ceil(selUnit.hp)}/${selUnit.maxHp}`);
    // HP ring
    const ring = $('#hpRing');
    if (ring) {
      ring.style.strokeDashoffset = 207 * (1 - hpPct);
      ring.classList.toggle('low', hpPct < 0.3);
    }
    renderPortrait(selUnit);
  }

  // Selection info
  const selInfo = $('#selectionInfo');
  if (state.selected.length > 0) {
    selInfo.hidden = false;
    setText('selCount', state.selected.length);
  } else {
    selInfo.hidden = true;
  }
}

function updateGameTime() {
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  setText('gameTime', `${m}:${s}`);
}

// ============================================================
// EVENT LOG
// ============================================================
function log(msg, type = 'info') {
  const now = new Date();
  const time = now.toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.events.push({ time, msg, type });

  const feed = $('#logFeed');
  if (!feed) return;
  if (state.logFilter !== 'all' && state.logFilter !== type) return;

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${msg}</span>`;
  feed.appendChild(entry);
  feed.scrollTop = feed.scrollHeight;

  // Keep log size manageable
  while (feed.children.length > 200) feed.removeChild(feed.firstChild);
}

function addOpsEntry(msg) {
  state.opsEvents++;
  const feed = $('#opsFeed');
  if (!feed) return;
  const entry = document.createElement('div');
  entry.className = 'ops-entry';
  entry.innerHTML = `<span class="ops-val">${msg}</span>`;
  feed.appendChild(entry);
  feed.scrollTop = feed.scrollHeight;
  while (feed.children.length > 100) feed.removeChild(feed.firstChild);
  setText('opsEvents', state.opsEvents);
  setText('opsLatency', Math.floor(10 + Math.random() * 30) + 'ms');
}

function renderProdQueue() {
  const qEl = $('#prodQueue');
  if (!qEl) return;
  qEl.innerHTML = '';
  for (const pq of state.prodQueue) {
    const pct = Math.floor((pq.progress / pq.total) * 100);
    const item = document.createElement('div');
    item.className = 'prod-item';
    item.innerHTML = `
      <span class="unit-icon unit-${pq.unitType}" style="width:14px;height:14px;"></span>
      <span style="font-size:10px;flex-shrink:0;">${pq.unitType}</span>
      <div class="prod-bar"><div class="prod-bar-fill" style="width:${pct}%"></div></div>
    `;
    qEl.appendChild(item);
  }
}

// ============================================================
// INPUT HANDLING
// ============================================================
function bindEvents() {
  // Canvas mouse
  canvas.addEventListener('mousedown', onCanvasMouseDown);
  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('mouseup', onCanvasMouseUp);
  canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Keyboard
  document.addEventListener('keydown', onKeyDown);

  // Command buttons
  $$('[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => executeCommand(btn.dataset.cmd));
  });

  // Tech buttons
  $$('[data-unit]').forEach(btn => {
    btn.addEventListener('click', () => produceUnit(btn.dataset.unit));
  });

  // Mode buttons
  $('#modeRTS')?.addEventListener('click', () => setMode('rts'));
  $('#modeOps')?.addEventListener('click', () => setMode('ops'));
  $('#modeTech')?.addEventListener('click', () => setMode('tech'));
  $('#toggleFog')?.addEventListener('click', toggleFog);
  $('#toggleDemo')?.addEventListener('click', toggleDemo);
  $('#toggleLog')?.addEventListener('click', toggleLog);

  // Log filters
  $$('.log-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.log-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.logFilter = btn.dataset.filter;
      rerenderLog();
    });
  });

  // Minimap buttons
  $$('.minimap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.minimap-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Welcome
  $('#welcomeDemo')?.addEventListener('click', () => closeWelcome(true));
  $('#welcomeDismiss')?.addEventListener('click', () => closeWelcome(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const overlay = $('#welcomeOverlay');
      if (overlay && !overlay.hidden) closeWelcome(false);
    }
  });

  // Tooltip system
  initTooltips();
}

function onCanvasMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = e.clientX - rect.left;
  state.mouse.y = e.clientY - rect.top;
  state.mouse.down = true;
  state.mouse.button = e.button;
  state.mouse.dragStart = { sx: state.mouse.x, sy: state.mouse.y };

  if (e.button === 1) {
    // MMB pan
    state.mouse.panStart = { cx: state.camera.x, cy: state.camera.y, mx: e.clientX, my: e.clientY };
  }
}

function onCanvasMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = e.clientX - rect.left;
  state.mouse.y = e.clientY - rect.top;

  // Update grid position
  const cs = CONFIG.CELL_SIZE * state.camera.zoom;
  const w = rect.width;
  const h = rect.height;
  const ox = (w - cs * CONFIG.GRID_W) / 2 + state.camera.x * state.camera.zoom;
  const oy = (h - cs * CONFIG.GRID_H) / 2 + state.camera.y * state.camera.zoom;
  state.mouse.gridX = Math.floor((state.mouse.x - ox) / cs);
  state.mouse.gridY = Math.floor((state.mouse.y - oy) / cs);

  // MMB pan
  if (state.mouse.down && state.mouse.button === 1 && state.mouse.panStart) {
    state.camera.x = state.mouse.panStart.cx + (e.clientX - state.mouse.panStart.mx);
    state.camera.y = state.mouse.panStart.cy + (e.clientY - state.mouse.panStart.my);
  }
}

function onCanvasMouseUp(e) {
  if (state.mouse.button === 0) {
    // Left click: select
    const cs = CONFIG.CELL_SIZE * state.camera.zoom;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const ox = (w - cs * CONFIG.GRID_W) / 2 + state.camera.x * state.camera.zoom;
    const oy = (h - cs * CONFIG.GRID_H) / 2 + state.camera.y * state.camera.zoom;

    if (state.mouse.dragStart) {
      const ds = state.mouse.dragStart;
      const x1 = Math.min(ds.sx, state.mouse.x);
      const y1 = Math.min(ds.sy, state.mouse.y);
      const x2 = Math.max(ds.sx, state.mouse.x);
      const y2 = Math.max(ds.sy, state.mouse.y);

      if (Math.abs(x2 - x1) < 5 && Math.abs(y2 - y1) < 5) {
        // Click select
        const gx = Math.floor((state.mouse.x - ox) / cs);
        const gy = Math.floor((state.mouse.y - oy) / cs);
        const unit = state.units.find(u => u.gx === gx && u.gy === gy && u.owner === 1);
        state.selected = unit ? [unit.id] : [];
      } else {
        // Box select
        state.selected = [];
        for (const u of state.units) {
          if (u.owner !== 1) continue;
          const upx = ox + u.gx * cs + cs / 2;
          const upy = oy + u.gy * cs + cs / 2;
          if (upx >= x1 && upx <= x2 && upy >= y1 && upy <= y2) {
            state.selected.push(u.id);
          }
        }
      }
      log(`Selected ${state.selected.length} unit(s)`, 'info');
    }
  } else if (state.mouse.button === 2) {
    // Right click: move/attack command
    const gx = state.mouse.gridX;
    const gy = state.mouse.gridY;
    if (gx >= 0 && gx < CONFIG.GRID_W && gy >= 0 && gy < CONFIG.GRID_H) {
      const enemy = state.units.find(u => u.gx === gx && u.gy === gy && u.owner !== 1);
      const resource = state.grid[gy]?.[gx] === 2;

      for (const id of state.selected) {
        const u = state.units.find(x => x.id === id);
        if (!u) continue;
        if (enemy) {
          u.action = 'attack';
          u.target = enemy.id;
          log(`${u.type} attacking enemy ${enemy.type}`, 'combat');
        } else if (resource && u.type === 'worker') {
          u.action = 'harvest';
          u.target = { x: gx, y: gy };
          u.progress = 0;
          log(`Worker harvesting at (${gx},${gy})`, 'economy');
        } else {
          u.action = 'move';
          u.target = { x: gx, y: gy };
        }
      }
    }
  }

  state.mouse.down = false;
  state.mouse.dragStart = null;
  state.mouse.panStart = null;
}

function onCanvasWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  state.camera.zoom = Math.max(0.5, Math.min(3, state.camera.zoom + delta));
}

function onKeyDown(e) {
  const key = e.key.toLowerCase();
  const keyMap = {
    m: 'move', s: 'stop', h: 'hold', v: 'harvest',
    r: 'resume', a: 'attack', p: 'produce', i: 'inspect',
    x: 'terminate', q: 'scan', t: 'return', l: 'patrol',
    g: 'toggleGrid', f: 'toggleFog',
  };

  if (key === 'g') { state.showGrid = !state.showGrid; return; }
  if (key === 'f') { toggleFog(); return; }
  if (key === 'escape') { state.selected = []; return; }

  // Number group select
  if (e.ctrlKey && key >= '1' && key <= '9') {
    const group = parseInt(key);
    state[`group${group}`] = [...state.selected];
    return;
  }
  if (!e.ctrlKey && key >= '1' && key <= '9') {
    const group = parseInt(key);
    if (state[`group${group}`]) state.selected = [...state[`group${group}`]];
    return;
  }

  if (keyMap[key]) executeCommand(keyMap[key]);
}

// ============================================================
// COMMANDS
// ============================================================
function executeCommand(cmd) {
  switch (cmd) {
    case 'stop':
      for (const id of state.selected) {
        const u = state.units.find(x => x.id === id);
        if (u) { u.action = 'noop'; u.target = null; }
      }
      log('Stop command issued', 'info');
      break;
    case 'hold':
      log('Hold position', 'info');
      break;
    case 'resume':
      log('Resuming operations', 'info');
      break;
    case 'attack':
      log('Attack mode - right-click target', 'combat');
      break;
    case 'harvest':
      for (const id of state.selected) {
        const u = state.units.find(x => x.id === id);
        if (u && u.type === 'worker') {
          // Find nearest resource
          let nearest = null, minD = Infinity;
          for (let y = 0; y < CONFIG.GRID_H; y++) {
            for (let x = 0; x < CONFIG.GRID_W; x++) {
              if (state.grid[y][x] !== 2) continue;
              const d = Math.abs(x - u.gx) + Math.abs(y - u.gy);
              if (d < minD) { minD = d; nearest = { x, y }; }
            }
          }
          if (nearest) {
            u.action = 'move';
            u.target = nearest;
            log(`Worker sent to harvest at (${nearest.x},${nearest.y})`, 'economy');
          }
        }
      }
      break;
    case 'inspect':
      if (state.selected.length > 0) {
        const u = state.units.find(x => x.id === state.selected[0]);
        if (u) log(`Inspecting Agent-${u.id}: ${u.type} HP:${Math.ceil(u.hp)}/${u.maxHp} Action:${u.action}`, 'info');
      }
      break;
    case 'terminate':
      log('Terminate command issued', 'error');
      state.resources.failed++;
      state.opsErrors++;
      setText('opsErrors', state.opsErrors);
      break;
    case 'scan':
      log('Scanning workspace...', 'info');
      state.resources.files += Math.floor(Math.random() * 5) + 1;
      break;
    case 'produce':
      produceUnit('worker');
      break;
    default:
      log(`Command: ${cmd}`, 'info');
  }
}

function produceUnit(type) {
  const def = CONFIG.UNIT_TYPES[type];
  if (state.resources.gold < def.cost) {
    log(`Not enough gold for ${type} (need ${def.cost})`, 'error');
    return;
  }
  const producer = state.units.find(u => u.owner === 1 && u.type === 'base');
  if (!producer) { log('No base to produce from', 'error'); return; }

  state.resources.gold -= def.cost;
  state.prodQueue.push({
    unitType: type,
    gx: producer.gx,
    gy: producer.gy,
    progress: 0,
    total: def.buildTime,
  });
  log(`Queued ${type} production (${def.cost}g)`, 'economy');
  renderProdQueue();
}

// ============================================================
// MODE SWITCHING
// ============================================================
function setMode(mode) {
  $$('.mode-btn').forEach(b => b.classList.remove('active'));
  $(`#mode${mode.charAt(0).toUpperCase() + mode.slice(1)}`)?.classList.add('active');
  const techPanel = $('#techPanel');
  if (techPanel) techPanel.style.display = mode === 'tech' || mode === 'rts' ? '' : 'none';
}

function toggleFog() {
  state.fogEnabled = !state.fogEnabled;
  updateFog();
  log(`Fog of war: ${state.fogEnabled ? 'ON' : 'OFF'}`, 'info');
}

function toggleDemo() {
  state.demoMode = !state.demoMode;
  const btn = $('#toggleDemo');
  if (btn) btn.classList.toggle('active', state.demoMode);
  if (state.demoMode) startDemo();
}

function toggleLog() {
  const panel = $('#logPanel');
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function rerenderLog() {
  const feed = $('#logFeed');
  if (!feed) return;
  feed.innerHTML = '';
  for (const ev of state.events) {
    if (state.logFilter !== 'all' && state.logFilter !== ev.type) continue;
    const entry = document.createElement('div');
    entry.className = `log-entry ${ev.type}`;
    entry.innerHTML = `<span class="log-time">${ev.time}</span><span class="log-msg">${ev.msg}</span>`;
    feed.appendChild(entry);
  }
  feed.scrollTop = feed.scrollHeight;
}

// ============================================================
// DEMO MODE
// ============================================================
function startDemo() {
  const demoInterval = setInterval(() => {
    if (!state.demoMode) { clearInterval(demoInterval); return; }

    // Simulate activity
    state.resources.tasks += Math.random() > 0.7 ? 1 : 0;
    state.resources.files += Math.random() > 0.8 ? 1 : 0;
    state.resources.tokens += Math.floor(Math.random() * 50);

    // Auto-produce units occasionally
    if (Math.random() > 0.9 && state.resources.gold >= 50) {
      const types = ['worker', 'light', 'heavy', 'ranged'];
      const type = types[Math.floor(Math.random() * types.length)];
      if (state.resources.gold >= CONFIG.UNIT_TYPES[type].cost) {
        produceUnit(type);
      }
    }

    // Enemy produces too
    if (Math.random() > 0.85) {
      const eBase = state.units.find(u => u.owner === 2 && u.type === 'base');
      if (eBase) {
        const types = ['worker', 'light', 'heavy'];
        const type = types[Math.floor(Math.random() * types.length)];
        const spots = [
          [eBase.gx + 1, eBase.gy], [eBase.gx - 1, eBase.gy],
          [eBase.gx, eBase.gy + 1], [eBase.gx, eBase.gy - 1],
        ];
        const spot = spots.find(([x, y]) => isWalkable(x, y));
        if (spot) {
          spawnUnit(type, spot[0], spot[1], 2);
          emitSpawn(spot[0], spot[1], '#ef4444');
        }
      }
    }

    // Occasionally auto-select and move player units
    const p1Mobile = state.units.filter(u => u.owner === 1 && !CONFIG.UNIT_TYPES[u.type].isBuilding && u.action === 'noop');
    if (p1Mobile.length > 0 && Math.random() > 0.5) {
      const u = p1Mobile[Math.floor(Math.random() * p1Mobile.length)];
      // Send to harvest or attack
      if (u.type === 'worker' && Math.random() > 0.3) {
        for (let y = 0; y < CONFIG.GRID_H; y++) {
          for (let x = 0; x < CONFIG.GRID_W; x++) {
            if (state.grid[y][x] === 2) {
              u.action = 'move';
              u.target = { x, y };
              log(`Demo: Worker sent to harvest`, 'economy');
              break;
            }
          }
          if (u.action !== 'noop') break;
        }
      } else {
        const enemy = state.units.find(e => e.owner === 2 && !CONFIG.UNIT_TYPES[e.type].isBuilding);
        if (enemy) {
          u.action = 'attack';
          u.target = enemy.id;
          log(`Demo: ${u.type} attacking enemy`, 'combat');
        }
      }
    }

    // Workers at resources auto-harvest
    for (const u of state.units) {
      if (u.owner === 1 && u.type === 'worker' && u.action === 'move' && u.target) {
        if (u.gx === u.target.x && u.gy === u.target.y && state.grid[u.gy]?.[u.gx] === 2) {
          u.action = 'harvest';
          u.progress = 0;
        }
      }
    }

    // Add gold passively in demo
    state.resources.gold += 5;

  }, 1500);
}

// ============================================================
// WELCOME OVERLAY
// ============================================================
function closeWelcome(startDemo) {
  const overlay = $('#welcomeOverlay');
  if (!overlay) return;
  overlay.classList.add('dismissed');
  setTimeout(() => {
    overlay.hidden = true;
    if (startDemo && !state.demoMode) toggleDemo();
  }, 300);
}

// Welcome logo animation
(function animateWelcomeLogo() {
  const c = $('#welcomeLogoCanvas');
  if (!c) return;
  const cx = c.getContext('2d');
  let t = 0;
  function draw() {
    t += 0.05;
    cx.clearRect(0, 0, 80, 80);
    // Fire gradient
    const grad = cx.createRadialGradient(40, 45, 5, 40, 40, 35);
    grad.addColorStop(0, '#fbbf24');
    grad.addColorStop(0.5, '#f59e0b');
    grad.addColorStop(1, '#dc2626');
    cx.fillStyle = grad;
    // Flame shape
    cx.beginPath();
    cx.moveTo(40, 10 + Math.sin(t) * 3);
    cx.bezierCurveTo(55, 25, 65, 40, 60, 55);
    cx.bezierCurveTo(58, 65, 50, 72, 40, 72);
    cx.bezierCurveTo(30, 72, 22, 65, 20, 55);
    cx.bezierCurveTo(15, 40, 25, 25, 40, 10 + Math.sin(t) * 3);
    cx.fill();
    // Inner glow
    const inner = cx.createRadialGradient(40, 50, 2, 40, 48, 15);
    inner.addColorStop(0, '#fef3c7');
    inner.addColorStop(1, '#f59e0b00');
    cx.fillStyle = inner;
    cx.beginPath();
    cx.arc(40, 48, 15, 0, Math.PI * 2);
    cx.fill();
    requestAnimationFrame(draw);
  }
  draw();
})();

// ============================================================
// TOOLTIPS
// ============================================================
function initTooltips() {
  const tooltip = $('#tooltip');
  if (!tooltip) return;

  const data = {
    move: { title: 'Move', desc: 'Move selected units to target', stats: 'Hotkey: M' },
    stop: { title: 'Stop', desc: 'Halt all current actions', stats: 'Hotkey: S' },
    hold: { title: 'Hold Position', desc: 'Pause execution, maintain state', stats: 'Hotkey: H' },
    harvest: { title: 'Harvest', desc: 'Send workers to gather resources', stats: 'Hotkey: V | MicroRTS: harvest action' },
    resume: { title: 'Resume', desc: 'Continue paused execution', stats: 'Hotkey: R' },
    attack: { title: 'Attack', desc: 'Attack target unit or area', stats: 'Hotkey: A | MicroRTS: attack action' },
    produce: { title: 'Produce', desc: 'Queue unit production at base', stats: 'Hotkey: P | MicroRTS: produce action' },
    inspect: { title: 'Inspect', desc: 'View detailed unit status', stats: 'Hotkey: I' },
    terminate: { title: 'Terminate', desc: 'Kill worker process immediately', stats: 'Hotkey: X | DANGER' },
    scan: { title: 'Scan', desc: 'Analyze workspace files', stats: 'Hotkey: Q' },
    return: { title: 'Return', desc: 'Return resources to base', stats: 'Hotkey: T | MicroRTS: return action' },
    patrol: { title: 'Patrol', desc: 'Move between waypoints', stats: 'Hotkey: L' },
  };

  $$('[data-cmd]').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const d = data[btn.dataset.cmd];
      if (!d) return;
      tooltip.querySelector('.tooltip-title').textContent = d.title;
      tooltip.querySelector('.tooltip-desc').textContent = d.desc;
      tooltip.querySelector('.tooltip-stats').textContent = d.stats;
      tooltip.classList.add('visible');
      const rect = btn.getBoundingClientRect();
      tooltip.style.left = rect.left + 'px';
      tooltip.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    });
    btn.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
  });

  // Tech button tooltips
  $$('[data-unit]').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const type = btn.dataset.unit;
      const def = CONFIG.UNIT_TYPES[type];
      if (!def) return;
      tooltip.querySelector('.tooltip-title').textContent = type.charAt(0).toUpperCase() + type.slice(1);
      tooltip.querySelector('.tooltip-desc').textContent = btn.title;
      tooltip.querySelector('.tooltip-stats').textContent = `HP:${def.hp} ATK:${def.attack} SPD:${def.speed} RNG:${def.range} Cost:${def.cost}g`;
      tooltip.classList.add('visible');
      const rect = btn.getBoundingClientRect();
      tooltip.style.left = (rect.right + 8) + 'px';
      tooltip.style.bottom = (window.innerHeight - rect.bottom) + 'px';
    });
    btn.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
  });
}

// ============================================================
// HELPERS
// ============================================================
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setBarWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

// ============================================================
// WISP PARTICLES (ambient)
// ============================================================
(function initWisps() {
  const container = document.getElementById('wc3-wisps');
  if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 15; i++) {
    const wisp = document.createElement('div');
    wisp.className = 'wc3-wisp';
    wisp.style.cssText = `left:${10 + Math.random() * 80}%;animation-delay:${Math.random() * 8}s;animation-duration:${6 + Math.random() * 6}s;`;
    container.appendChild(wisp);
  }
})();

// ============================================================
// BOOT
// ============================================================
window.addEventListener('DOMContentLoaded', init);
