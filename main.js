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
let score = 0;
let soundOn = true;
let level = 1;
let levelScore = 0;
let scoreTarget = 900;
let minMatch = 3;
let activeTypeCount = 4; // starts gentle; rises gradually
let interactionsLocked = false;

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
};

// Animation queues
const popAnimations = []; // {cells:[{c,r,type,color}], t}
const falling = []; // track falling items animations
const particles = []; // {x,y, vx,vy, life, color, char}

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

function initGrid(){
  grid = new Array(GRID_ROWS);
  for(let r=0;r<GRID_ROWS;r++){
    grid[r] = new Array(GRID_COLS);
    for(let c=0;c<GRID_COLS;c++){
      grid[r][c] = createRandomItem();
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
  if(!origin) return [];
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
    if(item && item.type===tgtType){
      cells.push({c:x, r:y, type:item.type, color:item.color});
      for(const nb of neighbors(x,y)) stack.push(nb);
    }
  }
  return cells;
}

function hasAnyCluster(threshold = minMatch){
  const seen = new Set();
  for(let r=0;r<GRID_ROWS;r++){
    for(let c=0;c<GRID_COLS;c++){
      const key = `${c},${r}`; if(seen.has(key)) continue;
      const origin = grid[r][c]; if(!origin) continue;
      const cluster = [];
      const stack = [[c,r]];
      while(stack.length){
        const [x,y] = stack.pop();
        const k = `${x},${y}`; if(seen.has(k)) continue; seen.add(k);
        const it = grid[y][x];
        if(it && it.type===origin.type){
          cluster.push([x,y]);
          for(const nb of neighbors(x,y)){
            const nk = `${nb[0]},${nb[1]}`; if(!seen.has(nk)) stack.push(nb);
          }
        }
      }
      if(cluster.length>=threshold) return true;
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
    grid[r][c] = null;
  }
}

function applyGravity(){
  let any = false;
  for(let c=0;c<GRID_COLS;c++){
    let write = GRID_ROWS - 1;
    for(let r=GRID_ROWS-1;r>=0;r--){
      const item = grid[r][c];
      if(item){
        if(r!==write){ any = true; grid[write][c] = item; grid[r][c] = null; }
        write--;
      }
    }
    for(let fill=write; fill>=0; fill--){ any = true; grid[fill][c] = createRandomItem(); }
  }
  ensurePlayableMove();
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
  const cluster = findCluster(c,r);
  if(cluster.length>=minMatch){
    playPop();
    spawnParticles(cluster);
    spawnPopAnimation(cluster);
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
    ctx.fillStyle = item.color;
    ctx.fill(path);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke(path);
    // emoji glyph
    ctx.font = `${Math.floor(CELL_PX*0.9)}px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(TYPE_TO_EMOJI[item.type], rx + CELL_PX/2, ry + CELL_PX/2);
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
    }
  }

  drawPopAnimations(dt);
  drawParticles(dt);
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
    ui.overlaySub.innerHTML = `Level <span id="overlayLevel">${level}</span> complete`;
    ui.nextLevelBtn.style.display = "inline-block";
    ui.restartBtn.style.display = "inline-block";
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


