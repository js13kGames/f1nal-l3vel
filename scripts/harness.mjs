// Test harness: loads the REAL production index.html game code into a Node vm
// with a mock DOM, and exposes the game's internal closure state for
// deterministic regression + physics-fairness testing.
//
// No test hooks live in production. The harness slices the IIFE body out of the
// shipped <script> and appends an export snippet in the SAME lexical scope, so
// index.html stays byte-for-byte the shipped artifact.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(HERE);
export const INDEX = path.join(ROOT, 'index.html');

function mockCanvas() {
  const listeners = {};
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return typeof k === 'string' ? () => {} : undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return {
    width: 960, height: 540, listeners,
    getContext: () => ctx,
    addEventListener(type, cb) { (listeners[type] ||= []).push(cb); },
    removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    focus() {}, setPointerCapture() {}, releasePointerCapture() {},
  };
}
function mockEl() {
  const listeners = {};
  return {
    hidden: false, innerHTML: '', listeners,
    addEventListener(type, cb) { (listeners[type] ||= []).push(cb); },
    setAttribute() {},
  };
}

export function load() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const start = script.indexOf('(()=>{') + 6;
  const end = script.lastIndexOf('})();');
  if (start < 6 || end < 0) throw new Error('could not slice IIFE body');
  const body = script.slice(start, end);

  const canvas = mockCanvas();
  const ov = mockEl();
  const mb = mockEl();
  const winListeners = {};
  const docListeners = {};
  const mqReg = {};
  const document = {
    hidden: false,
    querySelector: (sel) => sel === '#c' ? canvas : sel === '#ov' ? ov : sel === '#mb' ? mb : null,
    addEventListener(type, cb) { (docListeners[type] ||= []).push(cb); },
    removeEventListener() {},
  };

  class Osc { constructor() { this.frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; } connect() { return this; } start() {} stop() {} }
  class Gain { constructor() { this.gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; } connect() { return this; } }
  class AudioCtx { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; } resume() {} createOscillator() { return new Osc(); } createGain() { return new Gain(); } }

  const defaultRand = Math.random;
  const ctx = {
    document, localStorage: {}, console: { log() {}, warn() {}, error: console.error },
    innerWidth: 960, innerHeight: 540,
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    addEventListener(type, cb) { (winListeners[type] ||= []).push(cb); },
    removeEventListener() {},
    matchMedia(q) {
      const m = { media: q, matches: false, _l: [], addEventListener(t, cb) { this._l.push(cb); }, addListener(cb) { this._l.push(cb); } };
      mqReg[q] = m; return m;
    },
    __rand: defaultRand,
  };
  ctx.window = { AudioContext: AudioCtx, webkitAudioContext: AudioCtx };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const EXPORT = `;globalThis.__GAME={
    startRun,press,release,cancelInput,jump,update,draw,pattern,emit,gapFor,ob,addCoin,collide,checkState,toggleMute,paint,
    get p(){return p},get obs(){return obs},get coins(){return coins},get trail(){return trail},get bits(){return bits},get fx(){return fx},
    get plats(){return plats},get ups(){return ups},get winds(){return winds},get springs(){return springs},
    get solids(){return solids},get pits(){return pits},
    get boostT(){return boostT},set boostT(v){boostT=v},get revT(){return revT},set revT(v){revT=v},
    get mode(){return mode},set mode(v){mode=v},get won(){return won},
    get dist(){return dist},set dist(v){dist=v},get speed(){return speed},set speed(v){speed=v},
    get next(){return next},set next(v){next=v},
    get combo(){return combo},set combo(v){combo=v},get bonus(){return bonus},get maxCombo(){return maxCombo},
    get frozen(){return frozen},set frozen(v){frozen=v},get needResume(){return needResume},set needResume(v){needResume=v},
    get muted(){return muted},get rm(){return rm},set rm(v){rm=v},get shake(){return shake},get seen(){return seen}
  };`;
  const prelude = `var __R=Math.random;Math.random=function(){return typeof globalThis.__rand==='function'?globalThis.__rand():__R.call(Math)};\n`;
  vm.runInContext(prelude + body + EXPORT, ctx, { filename: 'index-game.js' });

  const g = ctx.__GAME;
  const fire = (map, type, ev) => { (map[type] || []).forEach((cb) => cb(ev)); };

  const env = {
    ctx, canvas, ov, mb,
    setRandom(fn) { ctx.__rand = fn || defaultRand; },
    resize(w, h) { if (w != null) ctx.innerWidth = w; if (h != null) ctx.innerHeight = h; fire(winListeners, 'resize', {}); },
    orient() { fire(winListeners, 'orientationchange', {}); },
    setHidden(b) { document.hidden = b; ctx.document.hidden = b; fire(docListeners, 'visibilitychange', {}); },
    setHiddenFlag(b) { document.hidden = b; ctx.document.hidden = b; },
    fireDocVisibility() { fire(docListeners, 'visibilitychange', {}); },
    fireWinVisibility() { fire(winListeners, 'visibilitychange', {}); },
    blur() { fire(winListeners, 'blur', {}); },
    focus() { fire(winListeners, 'focus', {}); },
    keyDown(code, { repeat = false, onMute = false } = {}) {
      fire(winListeners, 'keydown', { code, repeat, target: onMute ? mb : canvas, preventDefault() {} });
    },
    keyUp(code) { fire(winListeners, 'keyup', { code, preventDefault() {} }); },
    pointerDown(id = 1) { fire(canvas.listeners, 'pointerdown', { pointerId: id, preventDefault() {} }); },
    pointerUp(id = 1) { fire(canvas.listeners, 'pointerup', { pointerId: id, preventDefault() {} }); },
    pointerCancel(id = 1) { fire(canvas.listeners, 'pointercancel', { pointerId: id, preventDefault() {} }); },
    lostCapture(id = 1) { fire(canvas.listeners, 'lostpointercapture', { pointerId: id }); },
    muteTap() { fire(mb.listeners, 'pointerdown', { stopPropagation() {}, preventDefault() {} }); },
    reducedMotion(b) { const m = mqReg['(prefers-reduced-motion: reduce)']; if (m) { m.matches = b; m._l.forEach((cb) => cb({ matches: b })); } },
  };
  return { g, env };
}

// ---- Physics simulation helpers (use the REAL production update/collision) ----

export const SPEEDS = { min: 330, mid: 460, max: 590 };

// Put the game into a clean single-template sandbox at a target speed.
export function sandbox(g, speedVal) {
  g.startRun();
  g.frozen = false;
  g.next = 1e9;                 // block procedural generation
  g.obs.length = 0;
  g.coins.length = 0;
  g.dist = Math.max(0, (speedVal - 330) / 0.19);
  g.speed = speedVal;
}

function threatFront(g) {
  let best = null;
  for (const o of g.obs) {
    if (o.type === 'c') continue;                 // ceiling: never jump for it
    const left = o.type === 's' ? o.x : o.x + o.w * 0.24;
    const right = o.type === 's' ? o.x + o.w : o.x + o.w * 0.76;
    if (right > g.p.x && (best === null || left < best)) best = left;
  }
  return best;
}
function allPassed(g) {
  return g.obs.every((o) => o.x + o.w < g.p.x);
}

// Attempt to clear the currently-spawned obstacles with one timing strategy.
function attempt(g, speedVal, spawn, params) {
  sandbox(g, speedVal);
  spawn(g);
  const dt = 1 / 60;
  let jumped = false, jt = 0, doubled = false, released = false, coinHit = false;
  for (let time = 0; time < 4.5; time += dt) {
    if (!jumped && g.p.on) {
      const front = threatFront(g);
      if (front !== null && front - g.p.x <= params.lead) { g.press(); jumped = true; jt = 0; }
    } else if (jumped) {
      jt += dt;
      if (!released && jt >= params.hold) { g.release(); released = true; }
      if (params.dbl && !doubled && jt >= params.dblT) { g.press(); doubled = true; }
    }
    g.update(dt);
    if (g.coins.some((c) => c.got)) coinHit = true;
    if (g.mode === 'end' && !g.won) return { ok: false, coin: false };
    if (allPassed(g)) return { ok: true, coin: coinHit };
  }
  return { ok: allPassed(g), coin: coinHit };
}

// Search the timing space; return whether any strategy clears, and whether any
// clearing strategy also collects the coin.
export function canClear(g, speedVal, spawn) {
  const leads = [140, 165, 190, 215, 240, 265, 290, 315];
  const holds = [0.05, 0.14, 0.6];
  let ok = false, coin = false;
  for (const lead of leads) for (const hold of holds) for (const dbl of [false, true]) {
    const dblTs = dbl ? [0.30, 0.36, 0.42] : [0];
    for (const dblT of dblTs) {
      const r = attempt(g, speedVal, spawn, { lead, hold, dbl, dblT });
      if (r.ok) { ok = true; if (r.coin) coin = true; }
      if (ok && coin) return { ok, coin };
    }
  }
  return { ok, coin };
}

// Two-phase controller for jump-required step templates. The generic canClear
// only ever jumps for a horn threat, so it cannot mount steps that sit above the
// auto-step threshold. This one first JUMPS onto the ascending steps to reach the
// launch height, then jumps the tall horn. It reports whether it cleared and
// whether the winning run ever stood on an emitted step (foot above the ground
// line) — which, because an idle runner stays pinned to the ground, is proof the
// ascent required a real jump onto the steps.
function climbAttempt(g, speedVal, spawn, params) {
  sandbox(g, speedVal);
  spawn(g);
  const dt = 1 / 60, G = 448, px = g.p.x;
  const step0 = g.solids.reduce((a, s) => (a === null || s.x < a.x ? s : a), null);
  const horn = g.obs.reduce((a, o) => (o.type !== 'c' && (a === null || o.x < a.x) ? o : a), null);
  if (!step0 || !horn) return { ok: false, onStep: false };
  let phase = 0, jt = 0, r1 = false, r2 = false, doubled = false, onStep = false;
  for (let time = 0; time < 6; time += dt) {
    const hornFront = horn.x + horn.w * 0.24;
    if (phase === 0 && g.p.on && step0.x - px <= params.L1) { g.press(); phase = 1; jt = 0; }
    else if (phase === 1) {
      jt += dt;
      if (!r1 && jt >= params.h1) { g.release(); r1 = true; }
      if (g.p.on && G - (g.p.y + g.p.h) >= 85) phase = 2;   // reached the launch runway
    } else if (phase === 2 && g.p.on && hornFront - px <= params.L2) { g.press(); phase = 3; jt = 0; }
    else if (phase === 3) {
      jt += dt;
      if (!r2 && jt >= params.h2) { g.release(); r2 = true; }
      if (params.dbl && !doubled && jt >= 0.12) { g.press(); doubled = true; }
    }
    g.update(dt);
    if (g.p.on && G - (g.p.y + g.p.h) > 20) onStep = true;   // grounded above the floor => stood on a step
    if (g.mode === 'end' && !g.won) return { ok: false, onStep };
    if (allPassed(g)) return { ok: true, onStep };
  }
  return { ok: allPassed(g), onStep };
}

// Search the two-phase timing space; return the first strategy that both clears
// the template and lands on a step along the way.
export function climbAndClear(g, speedVal, spawn) {
  let cleared = false;
  for (const L1 of [120, 140, 160, 180, 200, 220]) for (const h1 of [0.6, 0.14])
    for (const L2 of [180, 210, 240, 270, 300]) for (const h2 of [0.6, 0.14, 0.05]) for (const dbl of [false, true]) {
      const r = climbAttempt(g, speedVal, spawn, { L1, h1, L2, h2, dbl });
      if (r.ok) { cleared = true; if (r.onStep) return { ok: true, onStep: true }; }
    }
  return { ok: cleared, onStep: false };
}
