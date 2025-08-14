/*
  Popem! - Kawaii Match-3 (cluster pop) Game
  HTML5 Canvas, pixel-perfect rendering, pastel kawaii style
*/

// Configuration
const GRID_COLS = 10;
const GRID_ROWS = 15;
const CELL_PX = 24; // internal pixel cell size (canvas logical units)
const CANVAS_WIDTH = GRID_COLS * CELL_PX;
const CANVAS_HEIGHT = GRID_ROWS * CELL_PX;

// Game state
let canvas, ctx;
let ui = { scoreEl: null, resetBtn: null, soundBtn: null, levelNum: null, targetScore: null, progressFill: null, overlay: null, overlayLevel: null, nextLevelBtn: null, overlayTitle: null, overlaySub: null, restartBtn: null };
let grid = [];
let frozen = []; // same dims as grid; value is integer hits remaining, e.g., 2
let score = 0;
let soundOn = true;
let level = 1;
let levelScore = 0;
let scoreTarget = 900;
let minMatch = 3;
let activeTypeCount = 4; // starts gentle; rises gradually
let interactionsLocked = false;
let pendingMoveCheck = false;

// Rendering helpers
let animationHandle = 0;
let lastTime = 0;

// Assets procedurally drawn per frame on an offscreen cache
const ITEM_TYPES = ["donut", "cookie", "croissant", "pudding", "boba"];
const PASTELS = {
  donut: ["#f7b2d9", "#ffd1b3", "#bcdcff", "#b8f3dc", "#c7b6f7"],
  cookie: ["#e6cfb2", "#ffd8a8", "#ffe8cc"],
  croissant: ["#ffd79a", "#f6c37b", "#f9b365"],
  pudding: ["#d3bdf0", "#c0e7d8", "#ffe0e9"],
  boba: ["#bcdcff", "#f7b2d9", "#b8f3dc", "#ffd1b3"],
};
// Emoji mode (requested): render items as emojis instead of faces/sprites
const USE_EMOJI = true;
const TYPE_TO_EMOJI = {
  donut: "🍩",
  cookie: "🍪",
  croissant: "🥐",
  pudding: "🍮",
  boba: "🧋",
  burst: "🍫",
};

// Animation queues
const popAnimations = []; // {cells:[{c,r,type,color}], t}
const falling = []; // track falling items animations
const particles = []; // {x,y, vx,vy, life, color, char}
const crackAnimations = []; // ice crack animations: {c,r,t,d}

// Offscreen caches for pixel art
const spriteCache = new Map(); // key -> canvas

// Simple PRNG for sparkle positions
function rand(min, max){ return Math.random() * (max - min) + min; }
function randi(min, max){ return Math.floor(rand(min, max)); }

// Utilities
function formatScore(n){ return n.toString().padStart(6, "0"); }

function createCanvas(w, h){
  const c = document.createElement("canvas");
  c.width = w; c.height = h; c.getContext("2d").imageSmoothingEnabled = false;
  return c;
}

function keyOfSprite(type, color){ return `${type}:${color}`; }

// Generate pixel-art sweet (used when USE_EMOJI=false)
function getItemSprite(type, color){
  const key = keyOfSprite(type, color);
  if(spriteCache.has(key)) return spriteCache.get(key);
  const w = CELL_PX, h = CELL_PX;
  const sc = createCanvas(w, h);
  const sctx = sc.getContext("2d");
  sctx.imageSmoothingEnabled = false;

  // base shadow
  sctx.fillStyle = "rgba(0,0,0,0.1)";
  sctx.fillRect(4, h-5, w-8, 3);

  // soft body
  const body = new Path2D();
  const radius = 6;
  body.roundRect(2, 2, w-4, h-6, radius);
  sctx.fillStyle = "#fffaf5";
  sctx.fill(body);

  // glaze / top color zone based on type
  sctx.save();
  sctx.beginPath();
  sctx.roundRect(2, 2, w-4, h-10, radius);
  sctx.clip();
  sctx.fillStyle = color;
  sctx.fillRect(2, 2, w-4, h-12);
  // subtle drips
  sctx.fillRect(6, h-16, 4, 8);
  sctx.fillRect(w-12, h-18, 3, 7);
  sctx.restore();

  // item-specific details
  switch(type){
    case "donut": {
      // center hole
      sctx.globalCompositeOperation = "destination-out";
      sctx.beginPath();
      sctx.arc(w/2, h/2, 4, 0, Math.PI*2);
      sctx.fill();
      sctx.globalCompositeOperation = "source-over";
      // sprinkles
      sctx.fillStyle = "#ff88b7"; sctx.fillRect(6, 6, 2, 1);
      sctx.fillStyle = "#88c6ff"; sctx.fillRect(12, 7, 2, 1);
      sctx.fillStyle = "#87e3c7"; sctx.fillRect(9, 10, 1, 2);
      break;
    }
    case "cookie": {
      // chips
      sctx.fillStyle = "#8b6b48";
      sctx.fillRect(6, 6, 2, 2);
      sctx.fillRect(12, 9, 2, 2);
      sctx.fillRect(9, 13, 2, 2);
      break;
    }
    case "croissant": {
      // arcs lines
      sctx.strokeStyle = "#e2a55a";
      sctx.lineWidth = 1;
      sctx.beginPath(); sctx.moveTo(5, 8); sctx.lineTo(15, 8); sctx.stroke();
      sctx.beginPath(); sctx.moveTo(5, 12); sctx.lineTo(15, 12); sctx.stroke();
      break;
    }
    case "pudding": {
      // cup bottom
      sctx.fillStyle = "#fff";
      sctx.fillRect(4, h-10, w-8, 6);
      sctx.strokeStyle = "#e9e2ff"; sctx.lineWidth = 1;
      sctx.strokeRect(4.5, h-10.5, w-9, 6);
      break;
    }
    case "boba": {
      // cup with pearls
      sctx.fillStyle = "rgba(255,255,255,.5)";
      sctx.fillRect(4, 6, w-8, h-12);
      sctx.fillStyle = "#5a5572";
      sctx.fillRect(6, h-10, 2, 2);
      sctx.fillRect(10, h-9, 2, 2);
      sctx.fillRect(14, h-11, 2, 2);
      // straw
      sctx.fillStyle = "#c7b6f7"; sctx.fillRect(w/2-1, 2, 2, 8);
      break;
    }
  }

  spriteCache.set(key, sc);
  return sc;
}

// Sound (tiny synth via WebAudio)
let audioCtx = null;
function ensureAudio(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}
function playChime(){ if(!soundOn) return; ensureAudio();
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle"; osc.frequency.value = 760; 
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.2, t0+0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0+0.25);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0+0.26);
}
function playPop(){ if(!soundOn) return; ensureAudio();
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine"; osc.frequency.setValueAtTime(420, t0);
  osc.frequency.exponentialRampToValueAtTime(220, t0+0.2);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.25, t0+0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0+0.22);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0+0.24);
}

// Grid management
function createRandomItem(){
  const usable = ITEM_TYPES.slice(0, Math.min(activeTypeCount, ITEM_TYPES.length));
  const type = usable[randi(0, usable.length)];
  const palette = PASTELS[type];
  const col = palette[randi(0, palette.length)];
  return { type, color: col, wiggle: 0 };
}

function spawnCandyBurstPowerup(){
  // Spawn a burst in a random non-frozen cell near the top rows
  const candidates = [];
  for(let r=0;r<Math.min(5, GRID_ROWS); r++){
    for(let c=0;c<GRID_COLS;c++){
      if(grid[r][c] && (!frozen[r] || frozen[r][c]===0)) candidates.push([c,r]);
    }
  }
  if(candidates.length===0) return;
  const [c,r] = candidates[randi(0, candidates.length)];
  grid[r][c] = { type: 'burst', color: '#f7b2d9', wiggle: 0 };
}

function initGrid(){
  grid = new Array(GRID_ROWS);
  frozen = new Array(GRID_ROWS);
  for(let r=0;r<GRID_ROWS;r++){
    grid[r] = new Array(GRID_COLS);
    frozen[r] = new Array(GRID_COLS);
    for(let c=0;c<GRID_COLS;c++){
      grid[r][c] = createRandomItem();
      // introduce some frozen tiles occasionally (rarity scales with level)
      const chance = Math.min(0.06 + level*0.01, 0.12);
      frozen[r][c] = Math.random() < chance ? 2 : 0; // needs 2 nearby matches to break
    }
  }
  ensurePlayableMove(true);
}

function inBounds(c, r){ return c>=0 && c<GRID_COLS && r>=0 && r<GRID_ROWS; }

function neighbors(c, r){
  return [ [c+1,r], [c-1,r], [c,r+1], [c,r-1] ].filter(([x,y])=>inBounds(x,y));
}

function findCluster(c, r){
  const origin = grid[r][c];
  // Frozen tiles should not initiate or join clusters
  if(!origin || (frozen[r] && frozen[r][c] > 0)) return [];
  const tgtType = origin.type; // match by type; different flavors (colors) still count
  const seen = new Set();
  const stack = [[c,r]];
  const cells = [];
  while(stack.length){
    const [x,y] = stack.pop();
    const key = `${x},${y}`;
    if(seen.has(key)) continue;
    seen.add(key);
    const item = grid[y][x];
    // exclude frozen tiles from cluster membership and traversal
    if(item && item.type===tgtType && !(frozen[y] && frozen[y][x] > 0)){
      cells.push({c:x, r:y, type:item.type, color:item.color});
      for(const nb of neighbors(x,y)) stack.push(nb);
    }
  }
  return cells;
}

function hasAnyCluster(threshold = minMatch){
  for(let r=0;r<GRID_ROWS;r++){
    for(let c=0;c<GRID_COLS;c++){
      const origin = grid[r][c]; if(!origin) continue;
      // do not consider frozen tiles as starting points
      if(frozen[r] && frozen[r][c] > 0) continue;
      const localSeen = new Set();
      let count = 0;
      const stack = [[c,r]];
      while(stack.length){
        const [x,y] = stack.pop();
        const k = `${x},${y}`; if(localSeen.has(k)) continue; localSeen.add(k);
        const it = grid[y][x];
        // only count/traverse non-frozen tiles
        if(it && it.type===origin.type && !(frozen[y] && frozen[y][x] > 0)){
          count++;
          for(const [nx,ny] of neighbors(x,y)){
            const nk = `${nx},${ny}`; if(!localSeen.has(nk)) stack.push([nx,ny]);
          }
        }
      }
      if(count>=threshold) return true;
    }
  }
  return false;
}

function ensurePlayableMove(isInitial = false){
  if(hasAnyCluster(minMatch)) return;
  if(isInitial){
    // regenerate until there is at least one valid cluster
    for(let tries=0; tries<50 && !hasAnyCluster(minMatch); tries++){
      for(let r=0;r<GRID_ROWS;r++){
        for(let c=0;c<GRID_COLS;c++) grid[r][c] = createRandomItem();
      }
    }
  }
  if(!isInitial && !hasAnyCluster(minMatch)){
    triggerGameOver();
  }
}

function clearCells(cells){
  for(const {c,r} of cells){
    // If frozen remains, don't clear yet; require breaking first
    if(frozen[r] && frozen[r][c] > 0){
      // leave the item intact but reduce one extra as safety
      frozen[r][c] = Math.max(0, frozen[r][c]-1);
    } else {
      grid[r][c] = null;
    }
  }
}

function applyGravity(){
  let any = false;
  for(let c=0;c<GRID_COLS;c++){
    let segEnd = GRID_ROWS - 1;
    while(segEnd >= 0){
      // find the nearest frozen barrier at or below segEnd
      let segStart = segEnd;
      while(segStart >= 0 && !(frozen[segStart] && frozen[segStart][c] > 0)){
        segStart--;
      }
      // open segment is (segStart, segEnd]
      const collected = [];
      for(let r=segEnd; r>segStart; r--){
        if(grid[r][c]){ collected.push(grid[r][c]); }
      }
      // pack to bottom of segment
      let write = segEnd;
      for(const it of collected){
        if(grid[write][c] !== it){ any = true; }
        grid[write][c] = it;
        write--;
      }
      // fill remaining open cells in this segment
      for(let r=write; r>segStart; r--){
        grid[r][c] = createRandomItem();
        any = true;
      }
      // move to above the frozen barrier just found
      segEnd = segStart - 1;
    }
  }
  // Defer the no-move check until falling animations settle
  pendingMoveCheck = true;
  return any;
}

// Falling animation tracker: sample positions before gravity, animate to new positions
function computeFalls(before){
  // map from id key to from->to positions
  const moves = [];
  for(let r=0;r<GRID_ROWS;r++){
    for(let c=0;c<GRID_COLS;c++){
      const cellBefore = before[r][c];
      const cellNow = grid[r][c];
      if(cellNow && cellBefore!==cellNow){
        // find where this cell was above in before grid (same object reference if preserved)
        // Since we moved references during gravity, we can approximate: if cellBefore was null and cellNow exists, it fell from above.
        // Compute top-most previous non-null in same column above current row.
        let srcR = r;
        while(srcR>0 && !before[srcR][c]) srcR--;
        moves.push({ c, fromY: (srcR)*CELL_PX - CELL_PX, toY: r*CELL_PX, y: (srcR)*CELL_PX - CELL_PX, t:0, item: cellNow });
      }
    }
  }
  return moves;
}

function snapshotGrid(){
  const snap = new Array(GRID_ROWS);
  for(let r=0;r<GRID_ROWS;r++){
    snap[r] = new Array(GRID_COLS);
    for(let c=0;c<GRID_COLS;c++) snap[r][c] = grid[r][c];
  }
  return snap;
}

// Particles for hearts/stars
function spawnParticles(cells){
  for(const {c,r,color} of cells){
    const cx = c*CELL_PX + CELL_PX/2;
    const cy = r*CELL_PX + CELL_PX/2;
    for(let i=0;i<8;i++){
      particles.push({
        x: cx, y: cy,
        vx: rand(-30,30), vy: rand(-80,-20),
        life: 0.7, color, char: Math.random()<0.5?"♥":"✦"
      });
    }
  }
}

// Pop bubbles effect
function spawnPopAnimation(cells){
  popAnimations.push({ cells, t: 0 });
}

function damageFrozenAround(cells){
  // For each popped cell, reduce frozen armor on neighbors and itself
  const hits = new Set();
  for(const {c,r} of cells){
    for(const [x,y] of [[c,r],...neighbors(c,r)]){
      if(!inBounds(x,y)) continue;
      const key = `${x},${y}`;
      if(hits.has(key)) continue; hits.add(key);
      if(frozen[y] && typeof frozen[y][x] === 'number' && frozen[y][x] > 0){
        frozen[y][x] = Math.max(0, frozen[y][x]-1);
        // crack animation with shards radiating outward
        crackAnimations.push({ c:x, r:y, t:0, d:0.45, shards: generateCrackShards(x, y) });
      }
    }
  }
}

// Generate wedge shards for an ice-crack effect
function generateCrackShards(c, r){
  const cx = c*CELL_PX + CELL_PX/2;
  const cy = r*CELL_PX + CELL_PX/2;
  const count = 7;
  const shards = [];
  for(let k=0;k<count;k++){
    const angle = (Math.PI*2*k)/count + rand(-0.2, 0.2);
    const spread = rand(0.15, 0.3);
    const inner = 3 + rand(-1,1);
    const outer = CELL_PX/2 - 2 + rand(-2,2);
    shards.push({ angle, spread, inner, outer });
  }
  return { cx, cy, shards };
}

// Interaction
function toCell(px, py){
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor((px - rect.left) * scaleX / CELL_PX);
  const y = Math.floor((py - rect.top) * scaleY / CELL_PX);
  return {c:x, r:y};
}

function handleClick(ev){
  if(interactionsLocked) return;
  const {c,r} = toCell(ev.clientX, ev.clientY);
  if(!inBounds(c,r)) return;
  const clicked = grid[r][c];
  // Candy burst power-up
  if(clicked && clicked.type === 'burst'){
    playPop();
    // burst 6 cells including the clicked one to avoid leaving a hole
    const all = [];
    for(let rr=0;rr<GRID_ROWS;rr++) for(let cc=0;cc<GRID_COLS;cc++) if(grid[rr][cc]) all.push([cc,rr]);
    // shuffle
    for(let i=all.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [all[i],all[j]]=[all[j],all[i]]; }
    const selected = new Set([`${c},${r}`]);
    const burstList = [[c,r]];
    for(const [cc,rr] of all){
      if(burstList.length>=6) break;
      const k = `${cc},${rr}`;
      if(selected.has(k)) continue;
      selected.add(k);
      burstList.push([cc,rr]);
    }
    const burstCells = burstList.map(([cc,rr])=>({c:cc,r:rr,type:grid[rr][cc].type,color:grid[rr][cc].color}));
    spawnParticles(burstCells);
    spawnPopAnimation(burstCells);
    damageFrozenAround(burstCells);
    clearCells(burstCells);
    const before = snapshotGrid();
    applyGravity();
    const moves = computeFalls(before);
    falling.length = 0; falling.push(...moves);
    return;
  }
  const cluster = findCluster(c,r);
  if(cluster.length>=minMatch){
    playPop();
    spawnParticles(cluster);
    spawnPopAnimation(cluster);
    damageFrozenAround(cluster);
    clearCells(cluster);
    const gained = cluster.length * 10;
    score += gained;
    levelScore += gained;
    ui.scoreEl.textContent = formatScore(score);
    updateProgress();
    const before = snapshotGrid();
    applyGravity();
    const moves = computeFalls(before);
    falling.length = 0;
    falling.push(...moves);
    if(levelScore >= scoreTarget){
      // celebratory explosion of remaining items
      winLevelSequence();
    }
  } else {
    playChime();
    // wiggle small feedback
    for(const cell of cluster){
      const item = grid[cell.r][cell.c];
      if(item) item.wiggle = 1;
    }
  }
}

function handleMove(ev){
  const {c,r} = toCell(ev.clientX, ev.clientY);
  if(!inBounds(c,r)) return;
  const item = grid[r][c];
  if(item && item.wiggle<0.2) item.wiggle = Math.max(item.wiggle, 0.2);
}

// Rendering
function drawBackground(){
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // subtle pattern lines
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for(let y=0;y<canvas.height;y+=8){ ctx.fillRect(0,y,canvas.width,1); }
}

function drawItem(item, x, y, dt){
  // wiggle/bounce
  if(item.wiggle>0){ item.wiggle = Math.max(0, item.wiggle - dt*1.8); }
  const wig = Math.sin((performance.now()/120) + x*0.1 + y*0.1) * item.wiggle * 2;

  if(USE_EMOJI){
    // tile background
    const rx = Math.round(x);
    const ry = Math.round(y + wig);
    ctx.save();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(rx+3, ry+CELL_PX-5, CELL_PX-6, 3);
    // rounded rect background
    const r = 6;
    const path = new Path2D();
    path.roundRect(rx+2, ry+2, CELL_PX-4, CELL_PX-6, r);
    ctx.fillStyle = item.type==='burst' ? '#ffcc66' : item.color;
    ctx.fill(path);
    ctx.strokeStyle = item.type==='burst' ? '#ff9f1a' : "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke(path);
    // emoji glyph
    ctx.font = `${Math.floor(CELL_PX*0.9)}px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const glyph = TYPE_TO_EMOJI[item.type] || '🍬';
    ctx.fillText(glyph, rx + CELL_PX/2, ry + CELL_PX/2);
    ctx.restore();
  } else {
    const sp = getItemSprite(item.type, item.color);
    ctx.drawImage(sp, Math.round(x), Math.round(y + wig));
  }
}

function drawPopAnimations(dt){
  for(let i=popAnimations.length-1;i>=0;i--){
    const a = popAnimations[i];
    a.t += dt;
    const prog = Math.min(1, a.t/0.35);
    for(const cell of a.cells){
      const cx = cell.c*CELL_PX + CELL_PX/2;
      const cy = cell.r*CELL_PX + CELL_PX/2;
      const radius = prog*CELL_PX*0.6;
      ctx.save();
      ctx.globalAlpha = 1 - prog;
      ctx.fillStyle = cell.color;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
    if(prog>=1){ popAnimations.splice(i,1); }
  }
}

function drawParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.life -= dt; if(p.life<=0){ particles.splice(i,1); continue; }
    p.vy += 240*dt;
    p.x += p.vx*dt; p.y += p.vy*dt;
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life/0.7);
    ctx.fillStyle = p.color;
    ctx.font = "10px 'Press Start 2P'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.char, Math.round(p.x), Math.round(p.y));
    ctx.restore();
  }
}

function drawGrid(dt){
  // base board
  drawBackground();

  // falling items first
  for(let i=falling.length-1;i>=0;i--){
    const f = falling[i];
    f.t += dt;
    const g = 980; // px/s^2
    const duration = 0.4;
    const t = Math.min(duration, f.t);
    const startY = f.fromY;
    const endY = f.toY;
    // ease with drop-acceleration
    const y = startY + (endY - startY) * (t/duration);
    drawItem(f.item, f.c*CELL_PX, y, dt);
    if(f.t>=duration){ falling.splice(i,1); }
  }

  // static items
  for(let r=0;r<GRID_ROWS;r++){
    for(let c=0;c<GRID_COLS;c++){
      const item = grid[r][c];
      if(!item) continue;
      // skip those currently drawn as falling duplicates (visual is fine since falling anim draws over)
      drawItem(item, c*CELL_PX, r*CELL_PX, dt);
      // draw frozen overlay if any
      if(frozen[r] && frozen[r][c] > 0){
        const rx = c*CELL_PX, ry = r*CELL_PX;
        ctx.save();
        // frosty glass with clearer differentiation
        const radius = 7;
        const p = new Path2D();
        p.roundRect(rx+1, ry+1, CELL_PX-2, CELL_PX-2, radius);
        // lighter icy tint so item beneath is visible
        const grad = ctx.createLinearGradient(rx, ry, rx, ry+CELL_PX);
        grad.addColorStop(0, 'rgba(170, 215, 255, 0.55)');
        grad.addColorStop(1, 'rgba(130, 180, 240, 0.65)');
        ctx.fillStyle = grad;
        ctx.fill(p);
        // inner highlight and outer border
        ctx.strokeStyle = 'rgba(255,255,255,0.98)';
        ctx.lineWidth = 2;
        ctx.stroke(p);
        ctx.strokeStyle = 'rgba(80,120,200,0.95)';
        ctx.lineWidth = 1;
        ctx.strokeRect(rx+0.5, ry+0.5, CELL_PX-1, CELL_PX-1);
        // sparkle dots (slightly lighter)
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for(let i=0;i<5;i++) ctx.fillRect(rx+3+i*4, ry+3+(i%2)*5, 1, 1);
        ctx.globalAlpha = 1;
        // badge: snowflake only (no numbering)
        const hitsLeft = frozen[r][c];
        ctx.font = `${Math.floor(CELL_PX*0.38)}px 'Segoe UI Emoji', system-ui`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText('❄', rx + 4, ry + 3);
        // faint static cracks when nearly broken
        if(hitsLeft === 1){
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rx + 4, ry + CELL_PX/2);
          ctx.lineTo(rx + CELL_PX - 6, ry + 6);
          ctx.moveTo(rx + 6, ry + 6);
          ctx.lineTo(rx + CELL_PX - 5, ry + CELL_PX - 6);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // ice crack animations overlay (radiating shards)
  for(let i=crackAnimations.length-1;i>=0;i--){
    const a = crackAnimations[i]; a.t += dt; const prog = Math.min(1, a.t/a.d);
    const rx = a.c*CELL_PX, ry = a.r*CELL_PX;
    ctx.save();
    ctx.translate(rx, ry);
    if(a.shards){
      const cx = CELL_PX/2, cy = CELL_PX/2;
      for(const s of a.shards.shards){
        const out = s.inner + (s.outer - s.inner) * prog;
        const a1 = s.angle - s.spread/2;
        const a2 = s.angle + s.spread/2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a1)*out, cy + Math.sin(a1)*out);
        ctx.lineTo(cx + Math.cos(a2)*out, cy + Math.sin(a2)*out);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
    if(prog>=1) crackAnimations.splice(i,1);
  }

  drawPopAnimations(dt);
  drawParticles(dt);

  // When no more falling animations and a move check is pending, validate moves
  if(pendingMoveCheck && falling.length===0 && popAnimations.length===0){
    pendingMoveCheck = false;
    ensurePlayableMove(false);
  }
}

// Resize: maintain integer scaling for crisp pixels
function resizeCanvas(){
  const maxW = Math.min(window.innerWidth*0.9, 640);
  const scale = Math.floor(maxW / CANVAS_WIDTH) || 1;
  const displayW = CANVAS_WIDTH * scale;
  const displayH = CANVAS_HEIGHT * scale;
  canvas.style.width = displayW + "px";
  canvas.style.height = displayH + "px";
}

function loop(ts){
  const dt = Math.min(0.05, (ts - lastTime)/1000 || 0);
  lastTime = ts;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGrid(dt);
  animationHandle = requestAnimationFrame(loop);
}

function computeTargetForLevel(lv){
  // gentler ramp: linear early, slightly steeper later
  if(lv <= 3) return 900 + (lv-1) * 400; // 900, 1300, 1700
  return 1700 + Math.floor((lv-3) * 500 * 1.1); // then 2250, 2800, ...
}

function updateProgress(reset){
  const ratio = Math.max(0, Math.min(1, levelScore / scoreTarget));
  if(ui.progressFill){ ui.progressFill.style.width = (ratio*100).toFixed(1) + "%"; }
  if(reset){ ui.progressFill.style.width = "0%"; }
}

function winLevelSequence(){
  interactionsLocked = true;
  // explode remaining items into particles then show overlay
  const cells = [];
  for(let r=0;r<GRID_ROWS;r++){
    for(let c=0;c<GRID_COLS;c++){
      const it = grid[r][c]; if(!it) continue;
      cells.push({ c, r, type: it.type, color: it.color });
    }
  }
  spawnParticles(cells);
  spawnPopAnimation(cells);
  setTimeout(()=>{
    ui.overlayLevel.textContent = String(level);
    ui.overlayTitle.textContent = "Kawaii Congrats!";
    ui.overlaySub.textContent = `Level ${level} complete`;
    ui.nextLevelBtn.style.display = "inline-block";
    ui.restartBtn.style.display = "none";
    ui.overlay.classList.remove("hidden");
  }, 450);
}

function nextLevel(){
  ui.overlay.classList.add("hidden");
  level += 1;
  // increase difficulty slowly: introduce types gradually and delay min-match bumps
  // Types: 4 → 4 → 5 → 5 (levels 1-4), then 5 onward
  if(level <= 2){ activeTypeCount = 4; }
  else { activeTypeCount = Math.min(5, 3 + level - 1); }
  // Min match increases at levels 5 and 9 (max 5)
  if(level === 5 || level === 9){ minMatch = Math.min(5, minMatch + 1); }
  scoreTarget = computeTargetForLevel(level);
  levelScore = 0;
  ui.levelNum.textContent = String(level);
  ui.targetScore.textContent = formatScore(scoreTarget);
  updateProgress(true);
  initGrid();
  // Chance to spawn a burst power-up at the start of a level
  if(level % 2 === 0) spawnCandyBurstPowerup();
  interactionsLocked = false;
}

function triggerGameOver(){
  interactionsLocked = true;
  setTimeout(()=>{
    ui.overlayTitle.textContent = "Game Over";
    ui.overlaySub.textContent = "No more moves. Try again!";
    ui.nextLevelBtn.style.display = "none";
    ui.restartBtn.style.display = "inline-block";
    ui.overlay.classList.remove("hidden");
  }, 150);
}

function newGame(){
  score = 0; level = 1; levelScore = 0; minMatch = 3; activeTypeCount = 4; scoreTarget = computeTargetForLevel(level);
  ui.levelNum.textContent = String(level);
  ui.targetScore.textContent = formatScore(scoreTarget);
  ui.scoreEl.textContent = formatScore(score);
  initGrid();
  particles.length = 0; popAnimations.length = 0; falling.length = 0;
  updateProgress(true);
}

function toggleSound(){
  soundOn = !soundOn;
  ui.soundBtn.textContent = `Sound: ${soundOn?"On":"Off"}`;
}

function init(){
  canvas = document.getElementById("game");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  ctx = canvas.getContext("2d", { alpha: true });
  ctx.imageSmoothingEnabled = false;
  ui.scoreEl = document.getElementById("score");
  ui.resetBtn = document.getElementById("resetBtn");
  ui.soundBtn = document.getElementById("soundBtn");
  ui.levelNum = document.getElementById("levelNum");
  ui.targetScore = document.getElementById("targetScore");
  ui.progressFill = document.getElementById("progressFill");
  ui.overlay = document.getElementById("overlay");
  ui.overlayLevel = document.getElementById("overlayLevel");
  ui.nextLevelBtn = document.getElementById("nextLevelBtn");
  ui.overlayTitle = document.getElementById("overlayTitle");
  ui.overlaySub = document.getElementById("overlaySub");
  ui.restartBtn = document.getElementById("restartBtn");
  ui.resetBtn.addEventListener("click", newGame);
  ui.soundBtn.addEventListener("click", toggleSound);
  canvas.addEventListener("click", handleClick);
  canvas.addEventListener("mousemove", handleMove);
  canvas.addEventListener("touchstart", (e)=>{ if(e.touches[0]) handleClick({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }); });
  ui.nextLevelBtn.addEventListener("click", nextLevel);
  ui.restartBtn.addEventListener("click", ()=>{ ui.overlay.classList.add("hidden"); newGame(); interactionsLocked=false;});
  window.addEventListener("resize", resizeCanvas);
  newGame();
  resizeCanvas();
  cancelAnimationFrame(animationHandle);
  lastTime = performance.now();
  animationHandle = requestAnimationFrame(loop);
}

window.addEventListener("DOMContentLoaded", init);


