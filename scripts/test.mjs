// Deterministic regression + fairness suite for the 1337 game.
// Runs the REAL production code (index.html) via scripts/harness.mjs.
// Run:  node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { load, canClear, climbAndClear, sandbox, ROOT, INDEX } from './harness.mjs';

const DT = 1 / 60;
const G_GROUND = 448 - 24; // player top when grounded
const PX_CENTER = 170 + 12; // player horizontal centre (fixed world column)

function fresh() { return load(); }

// ---------------------------------------------------------------------------
// 1. Input-gated onboarding: ready -> first press starts AND jumps.
// ---------------------------------------------------------------------------
test('boots into ready mode with onboarding overlay, no auto-run', () => {
  const { g, env } = fresh();
  assert.equal(g.mode, 'ready');
  assert.ok(!env.ov.hidden, 'overlay visible in ready mode');
  assert.match(env.ov.innerHTML, /FINAL LEVEL/);
  assert.match(env.ov.innerHTML, /hold/i);
  assert.match(env.ov.innerHTML, /double/i);
  // No physics runs while in ready mode.
  const y0 = g.p.y;
  g.update(DT);
  assert.equal(g.p.y, y0);
  assert.equal(g.dist, 0);
});

test('first real press starts the run and jumps', () => {
  const { g } = fresh();
  g.press();
  assert.equal(g.mode, 'play');
  g.update(DT);
  assert.ok(!g.p.on, 'airborne after first press');
  assert.ok(g.p.vy < 0, 'moving upward');
  assert.equal(g.p.j, 1);
});

// ---------------------------------------------------------------------------
// 2. Hold vs short tap height; double-jump limit; coyote + buffer.
// ---------------------------------------------------------------------------
function apexY(tap) {
  const { g } = fresh();
  g.press();
  g.update(DT);          // jump fires here
  if (tap) g.release();  // short tap cuts upward velocity
  let miny = g.p.y;
  for (let i = 0; i < 90; i++) { g.update(DT); miny = Math.min(miny, g.p.y); if (g.p.on) break; }
  return miny;
}
test('holding jumps higher than a short tap', () => {
  const held = apexY(false), tapped = apexY(true);
  assert.ok(G_GROUND - held > 85, `full jump apex ~93px (got ${(G_GROUND - held).toFixed(1)})`);
  assert.ok(G_GROUND - tapped < G_GROUND - held - 25, 'tap noticeably lower than hold');
});

test('double jump is limited to two jumps; a third press does nothing', () => {
  const { g } = fresh();
  g.press(); g.update(DT); g.release();     // jump 1
  assert.equal(g.p.j, 1);
  g.press(); g.update(DT);                    // jump 2 (buffered while airborne)
  assert.equal(g.p.j, 2);
  const vyAfter2 = g.p.vy;
  g.press(); g.update(DT);                    // third press: no new jump
  assert.equal(g.p.j, 2);
  assert.ok(g.p.vy > vyAfter2, 'velocity only decayed by gravity, no re-launch');
});

test('coyote grace lets a just-left-ground press still jump', () => {
  const { g } = fresh();
  g.startRun();
  Object.assign(g.p, { on: false, coy: 0.05, j: 0, y: 400, vy: 40 });
  g.press();
  g.update(DT);
  assert.equal(g.p.j, 1);
  assert.ok(g.p.vy < -400, 'first jump velocity applied via coyote');
});

test('buffered press triggers a jump on landing', () => {
  const { g } = fresh();
  g.startRun();
  // Airborne, out of jumps, descending toward the ground.
  Object.assign(g.p, { on: false, coy: -1, j: 2, y: 415, vy: 220 });
  g.press();                       // buffer a press just before landing
  let jumped = false;
  for (let i = 0; i < 12; i++) { g.update(DT); if (!g.p.on && g.p.vy < -300) jumped = true; }
  assert.ok(jumped, 'buffered jump fired shortly after landing');
});

// ---------------------------------------------------------------------------
// 4. Collectible bits: bonus/combo, miss reset, distance untouched, restart clears.
// ---------------------------------------------------------------------------
test('collecting a coin awards combo/bonus and never advances distance', () => {
  const { g } = fresh();
  g.startRun(); g.speed = 400; g.dist = 500; g.next = 1e9;
  g.coins.push({ x: 180, y: 435, got: 0, miss: 0 });   // overlaps grounded player
  const distBefore = g.dist, comboBefore = g.combo;
  g.update(DT);
  assert.equal(g.combo, comboBefore + 1);
  assert.equal(g.bonus, 10);
  assert.equal(g.mode, 'play', 'coin contact is never a hazard');
  const expected = distBefore + 400 * DT / 20;         // only distance-driven growth
  assert.ok(Math.abs(g.dist - expected) < 1e-6, 'bonus did not leak into distance');
});

test('missing a coin resets the combo exactly once', () => {
  const { g } = fresh();
  g.startRun(); g.speed = 400; g.dist = 500; g.next = 1e9;
  g.combo = 3;
  const coin = { x: 160, y: 343, got: 0, miss: 0 };     // passes player without contact
  g.coins.push(coin);
  g.update(DT);
  assert.equal(g.combo, 0, 'combo reset on miss');
  assert.equal(coin.miss, 1);
  g.combo = 5;                                          // ensure it does not re-fire
  g.update(DT);
  assert.equal(g.combo, 5, 'already-missed coin does not reset again');
});

test('restart clears run-specific collection state', () => {
  const { g } = fresh();
  g.startRun();
  g.coins.push({ x: 180, y: 435, got: 0, miss: 0 });
  g.update(DT);
  assert.ok(g.bonus > 0 && g.combo > 0);
  g.mode = 'end';
  g.press();                                            // restart
  assert.equal(g.mode, 'play');
  assert.equal(g.bonus, 0);
  assert.equal(g.combo, 0);
  assert.equal(g.coins.length, 0);
  assert.equal(g.dist, 0);
});

// ---------------------------------------------------------------------------
// 5. Reduced motion: live change clears decorative state, keeps physics.
// ---------------------------------------------------------------------------
test('live reduced-motion change clears effects but preserves simulation', () => {
  const { g, env } = fresh();
  g.startRun();
  g.press(); g.update(DT); g.update(DT); g.update(DT);   // build trail/fx/bits
  const before = { vy: g.p.vy, y: g.p.y, dist: g.dist };
  env.reducedMotion(true);
  assert.equal(g.rm, true);
  assert.equal(g.trail.length, 0);
  assert.equal(g.fx.length, 0);
  assert.equal(g.bits.length, 0);
  assert.equal(g.shake, 0);
  assert.equal(g.p.vy, before.vy, 'velocity untouched');
  assert.equal(g.p.y, before.y, 'position untouched');
  assert.equal(g.dist, before.dist, 'progress untouched');
  // Airborne frames no longer spawn a trail.
  g.update(DT);
  assert.equal(g.trail.length, 0);
  assert.ok(g.dist > before.dist, 'gameplay still advances under reduced motion');
});

// ---------------------------------------------------------------------------
// Mute isolation: never starts a run or jumps.
// ---------------------------------------------------------------------------
test('mute (touch, key, focused-button space) never starts or jumps', () => {
  let { g, env } = fresh();
  env.muteTap();
  assert.equal(g.muted, 1);
  assert.equal(g.mode, 'ready');
  assert.equal(g.p.vy, 0);

  ({ g, env } = fresh());
  env.keyDown('KeyM'); env.keyUp('KeyM');
  assert.equal(g.muted, 1);
  assert.equal(g.mode, 'ready');

  ({ g, env } = fresh());
  env.keyDown('Space', { onMute: true });                // space while mute button focused
  assert.equal(g.mode, 'ready', 'focused mute button does not hijack into a jump');
});

// ---------------------------------------------------------------------------
// Pointer discipline: single active pointer, repeat + cancel handling.
// ---------------------------------------------------------------------------
test('only one gameplay pointer is active at a time', () => {
  const { g, env } = fresh();
  g.startRun();
  env.pointerDown(1);
  assert.equal(g.p.hold, 1);
  env.pointerDown(2);                                    // extra pointer ignored
  env.pointerUp(2);                                      // stray release ignored
  assert.equal(g.p.hold, 1, 'still holding via pointer 1');
  env.pointerUp(1);
  assert.equal(g.p.hold, 0);
});

test('keyboard auto-repeat does not create extra jumps', () => {
  const { g, env } = fresh();
  g.startRun();
  env.keyDown('Space', { repeat: false });
  const buf1 = g.p.buf;
  g.p.buf = 0;
  env.keyDown('Space', { repeat: true });                // auto-repeat
  assert.equal(g.p.buf, 0, 'repeat did not buffer another jump');
  assert.ok(buf1 > 0);
});

test('pointercancel clears input WITHOUT a short-hop velocity cut', () => {
  const { g, env } = fresh();
  g.startRun();
  Object.assign(g.p, { on: false, vy: -400, hold: 1, buf: 0.1 });
  env.pointerDown(3);                                    // becomes active pointer... but already airborne
  const vy = g.p.vy;
  env.pointerCancel(3);
  assert.equal(g.p.hold, 0);
  assert.equal(g.p.buf, 0);
  assert.equal(g.p.vy, vy, 'velocity preserved on cancel (no *0.58 cut)');
});

// ---------------------------------------------------------------------------
// Orientation + visibility: freeze, no input, no catch-up, deliberate resume.
// ---------------------------------------------------------------------------
function playing() {
  const { g, env } = fresh();
  g.press();                       // start + first jump
  for (let i = 0; i < 8; i++) g.update(DT);
  return { g, env };
}

test('portrait freezes the sim, ignores input, and preserves state exactly', () => {
  const { g, env } = playing();
  const snap = { y: g.p.y, vy: g.p.vy, dist: g.dist };
  env.resize(400, 800);            // rotate to portrait
  assert.equal(g.frozen, 1);
  assert.match(env.ov.innerHTML, /ROTATE/);
  // Input ignored + no time advances even with a huge dt.
  g.press();
  g.update(5);
  assert.equal(g.p.y, snap.y);
  assert.equal(g.p.vy, snap.vy);
  assert.equal(g.dist, snap.dist);
  // Back to landscape -> deliberate resume required.
  env.resize(960, 540);
  assert.equal(g.needResume, 1);
  assert.match(env.ov.innerHTML, /resume/i);
  // Resume press resumes WITHOUT jumping.
  const vyPre = g.p.vy;
  g.press();
  assert.equal(g.needResume, 0);
  assert.equal(g.frozen, 0);
  assert.equal(g.p.vy, vyPre, 'resume did not launch a jump');
  assert.equal(g.p.buf, 0);
  // A subsequent press now jumps normally.
  g.p.on = true; g.p.y = G_GROUND; g.p.vy = 0; g.p.j = 0;
  g.press(); g.update(DT);
  assert.ok(g.p.vy < 0, 'normal jump works after resume');
});

test('document-targeted visibilitychange freezes immediately with no window blur', () => {
  const { g, env } = playing();
  const snap = { y: g.p.y, vy: g.p.vy, dist: g.dist };
  // A window-dispatched visibilitychange must NOT be observed: production
  // listens on document, and the harness models each target independently.
  env.setHiddenFlag(true);
  env.fireWinVisibility();
  assert.equal(g.frozen, 0, 'window-scoped visibilitychange is not the listening target');
  assert.equal(g.dist, snap.dist);
  // The canonical document-scoped event freezes immediately, with no window blur.
  env.fireDocVisibility();
  assert.equal(g.frozen, 1, 'document visibilitychange freezes on its own');
  // Input is ignored and no time accrues while hidden.
  g.press();
  g.update(10);
  assert.equal(g.p.y, snap.y);
  assert.equal(g.p.vy, snap.vy);
  assert.equal(g.dist, snap.dist);
  assert.equal(g.p.buf, 0, 'no buffered jump survives the freeze');
  // Becoming visible again requires a deliberate resume; no catch-up jump.
  env.setHiddenFlag(false);
  env.fireDocVisibility();
  assert.equal(g.needResume, 1);
  const vyPre = g.p.vy;
  g.press();
  assert.equal(g.needResume, 0);
  assert.equal(g.frozen, 0);
  assert.equal(g.p.vy, vyPre, 'resume did not launch a jump');
  assert.equal(g.p.buf, 0, 'resume did not buffer a jump');
});

test('hidden/blur freeze avoids idle death and time catch-up', () => {
  const { g, env } = playing();
  const snap = { y: g.p.y, dist: g.dist };
  env.setHidden(true);
  assert.equal(g.frozen, 1);
  g.update(10);                    // simulated long time away
  assert.equal(g.p.y, snap.y);
  assert.equal(g.dist, snap.dist);
  env.setHidden(false);
  assert.equal(g.needResume, 1);
  // blur path
  g.press();                       // resume
  assert.equal(g.frozen, 0);
  env.blur();
  assert.equal(g.frozen, 1);
  g.update(10);
  assert.equal(g.dist, snap.dist);
  env.focus();
  assert.equal(g.needResume, 1);
});

// ---------------------------------------------------------------------------
// 2 (fairness). Every template clearable at min/mid/max speed + coin reachable.
// ---------------------------------------------------------------------------
const IDS = ['single', 'double', 'triple', 'tall', 'ceil', 'fall', 'saw', 'gate'];
const COIN_IDS = new Set(['single', 'double']);
for (const id of IDS) {
  test(`template "${id}" is clearable at every speed and parameter extreme`, () => {
    const { g, env } = fresh();
    for (const sv of [330, 460, 590]) {
      for (const rv of [0.001, 0.5, 0.999]) {
        env.setRandom(() => rv);
        const r = canClear(g, sv, (gg) => gg.emit(id, 880));
        assert.ok(r.ok, `${id} unclearable at speed ${sv}, rng ${rv}`);
        if (COIN_IDS.has(id)) assert.ok(r.coin, `${id} coin unreachable at speed ${sv}, rng ${rv}`);
      }
      env.setRandom(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Feature: step-up horns. A horn tall enough that NO ground jump (single OR
// double) can clear it. It is fair only because the template hands you a
// staircase — but the first riser sits ABOVE the auto-step threshold, so you
// must actually JUMP onto the steps to reach the launch height; a runner that
// never jumps stays pinned to the ground and is impaled by the horn.
// ---------------------------------------------------------------------------
test('step-up horn is unclearable from the ground but clearable only by jumping onto the steps', () => {
  const { g } = fresh();
  // The bare horn on flat ground: prove it is impossible at every speed with any
  // timing, hold, and double-jump strategy the search can find (evidence a
  // ground-only double jump cannot clear the tall horn).
  for (const sv of [330, 460, 590]) {
    const bare = canClear(g, sv, (gg) => gg.ob(880, 26, 225, 'g'));
    assert.ok(!bare.ok, `the 225px horn must be impossible from flat ground at speed ${sv}`);
  }
  // The generic single-jump-for-the-horn strategy is NOT enough: because the
  // ascent now requires jumping onto the steps, only the two-phase climber wins.
  for (const sv of [330, 460, 590]) {
    assert.ok(!canClear(g, sv, (gg) => gg.emit('step', 880)).ok,
      `walking the steps must not clear the template at speed ${sv} — a jump onto the steps is required`);
    const climb = climbAndClear(g, sv, (gg) => gg.emit('step', 880));
    assert.ok(climb.ok, `the step-up template must be clearable by climbing at speed ${sv}`);
    assert.ok(climb.onStep, `the winning path must land on a step above the ground at speed ${sv}`);
  }
  // Shape check: three ground-anchored ascending steps then the tall horn.
  g.startRun(); g.emit('step', 900);
  assert.equal(g.solids.length, 3, 'three ascending steps');
  const tops = Array.from(g.solids, (s) => 448 - s.y).sort((a, b) => a - b);
  assert.deepEqual(tops, [48, 72, 90], 'steps rise 48/72/90 to a launch height');
  assert.ok(tops[0] > 34, `the first riser (${tops[0]}px) sits above the 34px auto-step threshold, so it cannot be walked up`);
  for (const s of g.solids) assert.equal(s.y + s.h, 448, 'each step is anchored to the ground');
  assert.equal(g.obs.length, 1, 'exactly one horn');
  assert.equal(g.obs[0].type, 'g', 'the horn is a normal ground horn');
  assert.ok(g.obs[0].h > 218, `the horn is taller than any ground jump can clear (${g.obs[0].h}px)`);
  assert.equal(g.coins.length, 0, 'the step template scores nothing');
});

test('step-up horn: an idle runner cannot reach the launch height and is impaled by the horn', () => {
  for (const sv of [330, 460, 590]) {
    const { g } = fresh();
    sandbox(g, sv);
    g.emit('step', 900);
    let maxUp = 0, died = false;
    for (let i = 0; i < 600; i++) {
      g.update(DT);
      if (g.p.on) maxUp = Math.max(maxUp, 448 - (g.p.y + g.p.h));
      if (g.mode === 'end') { died = true; break; }
    }
    assert.equal(maxUp, 0, `without a jump the runner never rises off the ground at speed ${sv} (auto-step cannot mount the first riser)`);
    assert.ok(died && !g.won, `an idle runner is killed by the horn it never launched over at speed ${sv}`);
  }
});

// ---------------------------------------------------------------------------
// Feature: flappy-bird gate. A floor horn and a ceiling horn share the same
// column with a jumpable corridor between them; you must thread the gap.
// ---------------------------------------------------------------------------
test('flappy gate aligns a floor + ceiling horn pair with a jumpable corridor', () => {
  const { g } = fresh();
  g.startRun(); g.emit('gate', 900);
  assert.equal(g.obs.length, 2, 'a gate is exactly two horns');
  const floor = g.obs.find((o) => o.type === 'g');
  const roof = g.obs.find((o) => o.type === 'c');
  assert.ok(floor && roof, 'one ground horn and one ceiling horn');
  assert.equal(floor.x, roof.x, 'the pair is vertically aligned');
  assert.equal(floor.x + floor.w, roof.x + roof.w, 'the pair shares a column');
  assert.equal(floor.gate, 1, 'floor horn is tagged as part of the gate');
  assert.equal(roof.gate, 1, 'ceiling horn is tagged as part of the gate');
  assert.equal(g.coins.length, 0, 'the gate scores nothing');
  // The safe corridor (player-top window) is real and comfortably taller than the player.
  const lower = 0.76 * roof.h - 4;          // must stay below the ceiling collider
  const upper = 448 - 20 - 0.8 * floor.h;   // must stay above the floor collider
  assert.ok(upper - lower > g.p.h, `corridor ${(upper - lower).toFixed(0)}px exceeds the player height`);
  // The corridor is threadable by a real jump at every speed.
  for (const sv of [330, 460, 590]) {
    const r = canClear(g, sv, (gg) => gg.emit('gate', 880));
    assert.ok(r.ok, `gate corridor must be jumpable at speed ${sv}`);
  }
});

test('flappy gate forces a jump: an idle player collides with the floor horn', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.emit('gate', 900);
  for (let i = 0; i < 300; i++) { g.update(DT); if (g.mode !== 'play') break; }
  assert.equal(g.mode, 'end', 'standing still in a gate is lethal (the floor horn is unavoidable without jumping)');
  assert.ok(!g.won);
});

// The rendered horns are triangles pointing at each other: the ground horn's tip
// sits at its top (world y = floor.y) and the ceiling horn's tip hangs at its
// bottom (world y = roof.h). The VISIBLE opening is the vertical gap between
// those two tips at the shared centre column the player threads. This must be a
// real, comfortable gap versus the player's rendered-and-rotated size, not a
// gap that exists only in the shrunk collider (which previously let the tips
// visually touch/overlap while tests still passed).
test('flappy gate leaves a real visible opening between the rendered horn tips', () => {
  const { g } = fresh();
  g.startRun(); g.emit('gate', 900);
  const floor = g.obs.find((o) => o.type === 'g');
  const roof = g.obs.find((o) => o.type === 'c');
  const floorTipY = floor.y;          // ground horn tip (rendered at its top edge)
  const ceilTipY = roof.h;            // ceiling horn tip (rendered at its bottom edge)
  const visibleGap = floorTipY - ceilTipY;
  const diagonal = Math.hypot(g.p.w, g.p.h); // full rotated player diagonal (~33.9px)
  assert.ok(visibleGap > 0, `horn tips must not touch/overlap (visible gap ${visibleGap}px)`);
  assert.ok(visibleGap >= 80, `visible opening ${visibleGap}px must be comfortable (>=80px)`);
  assert.ok(
    visibleGap >= 2 * diagonal,
    `visible opening ${visibleGap}px must comfortably clear the rotated player (>=${(2 * diagonal).toFixed(0)}px)`,
  );
  // The design is explicit: the roof height is derived so the opening equals
  // ground-floor-opening. The lower horn stays meaningful (unchanged tall spike).
  assert.ok(floor.h >= 90, `lower horn stays meaningful (${floor.h}px)`);
});

// Prove the opening is real in motion, not just in the shrunk collider: replay a
// genuine, attainable jump and verify the player's rendered-and-rotated body
// threads the gate WITHOUT ever visually overlapping either horn triangle, at
// min/mid/max speed. The triangle boundaries are evaluated at the tightest
// column the player's rotated box spans, so this is a faithful pixel-geometry
// check against the real production update/collision.
function gateVisiblyThreadable(g, speedVal) {
  const DT2 = 1 / 60, PX = 170;
  const leads = [140, 165, 190, 215, 240, 265, 290, 315];
  const holds = [0.05, 0.14, 0.6];
  for (const lead of leads) for (const hold of holds) for (const dbl of [false, true]) {
    const dblTs = dbl ? [0.30, 0.36, 0.42] : [0];
    for (const dblT of dblTs) {
      sandbox(g, speedVal);
      g.emit('gate', 880);
      let jumped = false, jt = 0, doubled = false, released = false, clean = true, crossed = false, passed = false;
      for (let time = 0; time < 4.5 && clean; time += DT2) {
        if (!jumped && g.p.on) {
          const fl = g.obs.find((o) => o.type === 'g');
          const front = fl ? fl.x + fl.w * 0.24 : null;
          if (front !== null && front - g.p.x <= lead) { g.press(); jumped = true; jt = 0; }
        } else if (jumped) {
          jt += DT2;
          if (!released && jt >= hold) { g.release(); released = true; }
          if (dbl && !doubled && jt >= dblT) { g.press(); doubled = true; }
        }
        g.update(DT2);
        if (g.mode === 'end' && !g.won) { clean = false; break; }
        const roof = g.obs.find((o) => o.type === 'c'), fl = g.obs.find((o) => o.type === 'g');
        if (roof && fl) {
          const a = g.p.ang, hy = (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))) * 12;
          const cx = PX + 12, cy = g.p.y + 12;
          const pL = cx - hy, pR = cx + hy, pTop = cy - hy, pBot = cy + hy;
          const hc = roof.x + roof.w / 2;
          const oL = Math.max(pL, roof.x), oR = Math.min(pR, roof.x + roof.w);
          if (oR > oL) {
            crossed = true;
            const col = Math.max(oL, Math.min(oR, hc));      // tightest column in the overlap
            const f = Math.abs(col - hc) / (roof.w / 2);     // 0 at centre .. 1 at edge
            const ceilLow = roof.h * (1 - f);                // ceiling triangle lower edge here
            const floorUp = fl.y + fl.h * f;                 // floor triangle upper edge here
            if (pTop < ceilLow - 1e-6 || pBot > floorUp + 1e-6) { clean = false; break; }
          }
        }
        if (g.obs.every((o) => o.x + o.w < g.p.x)) { passed = true; break; }
      }
      if (passed && clean && crossed) return true;
    }
  }
  return false;
}

test('flappy gate is visibly threadable: the rendered player clears both horns at every speed', () => {
  for (const sv of [330, 460, 590]) {
    const { g } = fresh();
    assert.ok(
      gateVisiblyThreadable(g, sv),
      `an attainable jump must thread the gate without the rendered player overlapping either horn at speed ${sv}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2 (spacing). Real generator: meaningful recovery windows, no saw overtaking.
// ---------------------------------------------------------------------------
function zone(o) { return o.type === 's' ? [o.x, o.x + o.w] : [o.x + o.w * 0.24, o.x + o.w * 0.76]; }
function spacing(distLock) {
  const { g } = fresh();
  g.startRun();
  const recs = new Map();
  const frames = Math.round(60 / DT);
  for (let f = 0; f < frames; f++) {
    g.update(DT);
    g.dist = distLock;             // lock difficulty + speed tier
    g.p.y = -1000;                 // park probe player so obstacles just scroll by
    for (const o of g.obs) {
      const [zl, zr] = zone(o);
      if (zl < 194 && zr > 170) {
        const r = recs.get(o);
        if (!r) recs.set(o, { type: o.type, enter: f * DT, exit: f * DT, h: o.h, gate: o.gate });
        else r.exit = f * DT;
      }
    }
  }
  const all = [...recs.values()].sort((a, b) => a.enter - b.enter);
  const action = all.filter((r) => r.type !== 'c');
  const ceil = all.filter((r) => r.type === 'c');
  const ev = [];
  for (const r of action) {
    const last = ev[ev.length - 1];
    const tall = r.type === 'g' && r.h > 120;
    if (last && r.enter - last.exit < 0.18) { last.exit = Math.max(last.exit, r.exit); last.tall = last.tall || tall; }
    else ev.push({ enter: r.enter, exit: r.exit, tall });
  }
  let minGap = Infinity;
  for (let i = 1; i < ev.length; i++) {
    const gap = ev[i].enter - ev[i - 1].exit;
    const need = ev[i - 1].tall ? 0.5 : 0.34;            // physics-derived land+react time
    assert.ok(gap >= need, `recovery gap ${gap.toFixed(3)}s < required ${need}s at dist ${distLock}`);
    minGap = Math.min(minGap, gap);
  }
  for (const c of ceil) for (const a of action) {
    if (c.gate) continue;                                  // gates deliberately align a ceiling horn over a floor horn with a jumpable corridor
    assert.ok(!(c.enter < a.exit && c.exit > a.enter), 'ceiling overlaps an action hazard in the player lane');
  }
  return { obstacles: all.length, types: [...new Set(all.map((r) => r.type))].join(''), minGap };
}
test('generator keeps fair recovery windows and no saw overtaking', () => {
  for (const d of [300, 700, 1400]) {                    // low / mid / max-speed tiers
    const s = spacing(d);
    assert.ok(s.obstacles > 20, `enough obstacles sampled at dist ${d}`);
    assert.ok(s.minGap >= 0.34, `min recovery gap healthy at dist ${d} (${s.minGap.toFixed(3)}s)`);
  }
});

// ---------------------------------------------------------------------------
// Rage-bait elements: bashful platform, hostile power-up, reverse boost,
// petty wind gust, nearly helpful spring.
// ---------------------------------------------------------------------------
const RAGE = ['bash', 'spring', 'wind', 'lure', 'rev'];

test('startRun clears every rage-bait entity array and effect timer', () => {
  const { g } = fresh();
  g.startRun();
  for (const id of RAGE) g.emit(id, 900);
  g.boostT = 1; g.revT = 1; g.p.ox = -50; g.p.spr = 0.2;
  assert.equal(g.plats.length, 1);
  assert.equal(g.springs.length, 1);
  assert.equal(g.winds.length, 1);
  assert.equal(g.ups.length, 2);
  g.startRun();
  assert.equal(g.plats.length, 0);
  assert.equal(g.springs.length, 0);
  assert.equal(g.winds.length, 0);
  assert.equal(g.ups.length, 0);
  assert.equal(g.boostT, 0);
  assert.equal(g.revT, 0);
  assert.equal(g.p.ox, 0);
  assert.equal(g.p.spr, 0);
});

test('rage-bait templates emit readable, non-lethal, unscored shapes with real gaps', () => {
  const { g } = fresh();
  for (const id of RAGE) {
    g.startRun(); g.speed = 400;
    const end = g.emit(id, 900);
    assert.equal(g.obs.length, 0, `${id} must never emit a lethal obstacle`);
    assert.equal(g.coins.length, 0, `${id} must never emit a scoring coin`);
    assert.ok(end > 900, `${id} advances the spawn cursor`);
    const gap = g.gapFor(id);
    assert.ok(Number.isFinite(gap) && gap >= 190 + 400 * 0.55, `${id} gap ${gap}`);
  }
  // Bashful platform sits within a single full-hold jump (apex ~93px).
  g.startRun(); g.emit('bash', 900);
  const pl = g.plats[0];
  assert.ok(448 - pl.y < 93 && 448 - pl.y > 40, `platform reachable (${448 - pl.y}px up)`);
  assert.equal(pl.shy, 0);
  // Spring rests on the ground; wind is a wide telegraphed zone.
  g.startRun(); g.emit('spring', 900);
  assert.equal(g.springs[0].y + g.springs[0].h, 448);
  g.startRun(); g.emit('wind', 900);
  assert.ok(g.winds[0].warn > 0.5, 'wind warns before it acts');
  assert.ok(g.winds[0].w > 100);
  // Power-ups sit at coin height so they read as tempting.
  g.startRun(); g.emit('lure', 900); g.emit('rev', 900);
  assert.equal(g.ups[0].k, 1, 'lure is the hostile kind');
  assert.equal(g.ups[1].k, 0, 'rev is the reverse kind');
  assert.equal(g.ups[0].y, 343);
  assert.equal(g.ups[1].y, 343);
});

test('bashful platform supports a top landing and refreshes jumps', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.plats.push({ x: 160, y: 370, w: 70, h: 12, dy: 0, shy: 0 });
  Object.assign(g.p, { on: false, coy: -1, j: 1, y: 344, vy: 300 });
  g.update(DT);
  assert.equal(g.p.on, 1, 'landed on the platform top');
  assert.ok(Math.abs(g.p.y - (370 - 24)) < 1e-9);
  assert.equal(g.p.vy, 0);
  assert.equal(g.p.j, 0, 'landing restores both jumps');
  assert.equal(g.mode, 'play', 'the platform is never lethal');
  assert.equal(g.bonus, 0);
  assert.equal(g.combo, 0);
});

test('bashful platform stays put until approached, then retreats and drops', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.plats.push({ x: 620, y: 370, w: 70, h: 12, dy: 0, shy: 0 });
  const q = g.plats[0];
  for (let i = 0; i < 30; i++) { g.update(DT); assert.equal(q.shy, 0, 'readable while still far away'); }
  assert.equal(q.y, 370, 'no vertical drift before the trigger');
  let frames = 0;
  while (!q.shy && frames < 300) { g.update(DT); frames++; }
  assert.equal(q.shy, 1, 'gets shy as the player closes in');
  const y0 = q.y, x0 = q.x;
  for (let i = 0; i < 25; i++) g.update(DT);
  assert.ok(q.y > y0 + 10, `visibly drops away (${(q.y - y0).toFixed(1)}px)`);
  assert.ok(q.x > x0 - g.speed * 25 * DT + 15, 'also retreats against the scroll');
  assert.equal(g.mode, 'play');
  assert.equal(g.p.on, 1, 'a grounded player is never touched by it');
  assert.equal(g.bonus, 0);
});

test('hostile power-up: no death, no points, only faster world motion', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.ob(700, 26, 46, 'g');
  g.ups.push({ x: 180, y: 435, k: 1, got: 0 });   // overlaps the grounded player
  const o = g.obs[0], x0 = o.x, d0 = g.dist, sp0 = g.speed;
  g.update(DT);
  assert.equal(g.mode, 'play', 'the lure never kills');
  assert.equal(g.combo, 0, 'no combo');
  assert.equal(g.bonus, 0, 'no bonus points');
  assert.ok(g.boostT > 0, 'boost armed on pickup');
  assert.ok(Math.abs(g.dist - (d0 + sp0 * DT / 20)) < 1e-9, 'base distance progression untouched');
  const x1 = o.x, sp1 = g.speed;
  assert.ok(Math.abs((x0 - x1) - sp1 * DT) < 1e-9, 'pickup frame is not applied retroactively');
  const dB = g.dist, spB = g.speed;
  g.update(DT);
  assert.ok(Math.abs((x1 - o.x) - g.speed * 1.5 * DT) < 1e-9, 'obstacles move 1.5x while boosted');
  assert.ok(Math.abs(g.dist - (dB + spB * DT / 20)) < 1e-9, 'scoring pace unchanged while boosted');
  g.obs.length = 0;
  for (let i = 0; i < 120; i++) g.update(DT);
  assert.ok(g.boostT <= 0, 'boost is temporary');
  assert.equal(g.bonus, 0);
  assert.equal(g.combo, 0);
});

test('reverse boost scrolls the world right without corrupting generation or distance', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.next = 1200;
  g.ob(700, 26, 46, 'g'); g.addCoin(760);
  g.plats.push({ x: 800, y: 370, w: 70, h: 12, dy: 0, shy: 0 });
  g.springs.push({ x: 900, y: 422, w: 44, h: 26, c: 0 });
  g.winds.push({ x: 1000, w: 170, warn: 0.95, hit: 0 });
  g.ups.push({ x: 180, y: 435, k: 0, got: 0 });
  g.update(DT);
  assert.ok(g.revT > 0, 'reverse armed on pickup');
  assert.equal(g.mode, 'play');
  assert.equal(g.bonus, 0, 'reverse awards no points');
  assert.equal(g.combo, 0);
  const snap = {
    n: g.obs.length, o: g.obs[0].x, c: g.coins[0].x, pl: g.plats[0].x,
    sp: g.springs[0].x, wd: g.winds[0].x, next: g.next,
  };
  let prev = g.dist;
  for (let i = 0; i < 20; i++) {
    const db = g.dist, spb = g.speed;
    g.update(DT);
    assert.ok(Math.abs(g.dist - (db + spb * DT / 20)) < 1e-9, 'base distance progression during reverse');
    assert.ok(g.dist > prev, 'distance never decreases');
    prev = g.dist;
  }
  const d = g.obs[0].x - snap.o;
  assert.ok(d > 0, 'obstacles move right');
  assert.ok(Math.abs((g.coins[0].x - snap.c) - d) < 1e-9, 'coins move with the world');
  assert.ok(Math.abs((g.plats[0].x - snap.pl) - d) < 1e-9, 'platforms move with the world');
  assert.ok(Math.abs((g.springs[0].x - snap.sp) - d) < 1e-9, 'springs move with the world');
  assert.ok(Math.abs((g.winds[0].x - snap.wd) - d) < 1e-9, 'wind zones move with the world');
  assert.ok(Math.abs((g.next - snap.next) - d) < 1e-9, 'spawn cursor moves with the world');
  assert.equal(g.obs.length, snap.n, 'no extra or duplicated spawns while reversed');
  assert.equal(g.coins.length, 1);
  assert.ok(g.p.ox < -20, 'player is visually displaced backward');
  // Let it expire; the player is restored and the world resumes forward motion.
  g.obs.length = 0; g.coins.length = 0; g.next = 1e9;
  for (let i = 0; i < 150; i++) g.update(DT);
  assert.ok(g.revT <= 0, 'reverse is temporary');
  assert.ok(Math.abs(g.p.ox) < 1, `player restored (ox ${g.p.ox.toFixed(3)})`);
  const px = g.plats[0].x;
  g.update(DT);
  assert.ok(g.plats[0].x < px, 'world scrolls forward again');
});

test('reduced motion drops the cosmetic reverse displacement but keeps the mechanic', () => {
  const { g, env } = fresh();
  sandbox(g, 400);
  env.reducedMotion(true);
  g.ob(700, 26, 46, 'g');
  g.ups.push({ x: 180, y: 435, k: 0, got: 0 });
  g.update(DT);
  assert.ok(g.revT > 0);
  const x0 = g.obs[0].x;
  for (let i = 0; i < 10; i++) { g.update(DT); assert.equal(g.p.ox, 0, 'no cosmetic displacement'); }
  assert.ok(g.obs[0].x > x0, 'world still reverses under reduced motion');
  env.reducedMotion(false);
});

test('wind tunnel: warning is inert, then live entry snaps to the ceiling and inverts gravity', () => {
  let { g } = fresh();
  sandbox(g, 400);
  // A grounded player under a still-telegraphing tunnel is untouched.
  g.winds.push({ x: 120, w: 400, warn: 5, hit: 0 });
  for (let i = 0; i < 20; i++) g.update(DT);
  assert.equal(g.p.on, 1, 'warning gust leaves a grounded player grounded');
  assert.equal(g.p.inv, 0, 'no inversion while still warning');
  assert.equal(g.p.vy, 0, 'no vertical impulse while warning');

  // Live tunnel over the player: snap to the top ONCE and flip gravity upward.
  g.winds[0].warn = 0;
  g.update(DT);
  assert.equal(g.p.inv, 1, 'entering a live tunnel inverts gravity');
  assert.ok(Math.abs(g.p.y - 48) < 1e-9, 'player is snapped to the ceiling line');
  assert.equal(g.p.on, 1, 'rests against the ceiling');
  assert.equal(g.p.j, 0, 'jumps refreshed on the ceiling');
  // The snap happens once, not every frame: shove the player down and confirm no re-snap.
  g.p.y = 120; g.p.on = 0;
  g.update(DT);
  assert.ok(g.p.y > 60, 'no per-frame re-snap to the ceiling');
  assert.ok(g.p.vy < 0, 'gravity now pulls the player back up toward the ceiling');
});

test('wind tunnel: an inverted jump pushes down, holds/doubles sign-aware, and lands back on the ceiling', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.winds.push({ x: 120, w: 400, warn: 0, hit: 0 });
  g.update(DT);                                   // enter tunnel, pinned to ceiling
  assert.equal(g.p.inv, 1);
  // A jump inside the tunnel launches DOWNWARD (away from the ceiling).
  g.press(); g.update(DT);
  assert.ok(g.p.vy > 0, 'inverted jump velocity is downward (away from ceiling)');
  const vFull = g.p.vy;
  // A hold-release inside the tunnel cuts the downward launch, mirroring the normal short hop.
  const { g: g2 } = fresh();
  sandbox(g2, 400);
  g2.winds.push({ x: 120, w: 400, warn: 0, hit: 0 });
  g2.update(DT);
  g2.press(); g2.update(DT); g2.release();
  assert.ok(g2.p.vy < vFull && g2.p.vy > 0, 'sign-aware release cuts the inverted rise');
  // Double jump is available in the air and adds more downward speed.
  g.press(); g.update(DT);
  assert.equal(g.p.j, 2, 'second inverted jump consumed');
  // Falling back "up" lands and refreshes jumps on the ceiling.
  let landed = false;
  for (let i = 0; i < 200; i++) { g.update(DT); if (g.p.on && Math.abs(g.p.y - 48) < 1) { landed = true; break; } }
  assert.ok(landed, 'returns to and lands on the ceiling');
  assert.equal(g.p.j, 0, 'ceiling landing restores jumps');
  assert.equal(g.mode, 'play', 'the tunnel is never lethal on its own');
});

test('wind tunnel: exit restores downward gravity naturally without snapping to the floor', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.winds.push({ x: 150, w: 120, warn: 0, hit: 0 });
  g.update(DT);
  assert.equal(g.p.inv, 1, 'inverted while inside');
  const yIn = g.p.y;
  assert.ok(Math.abs(yIn - 48) < 1e-9, 'pinned to the ceiling inside');
  // Scroll the tunnel fully past the player.
  let exited = false;
  for (let i = 0; i < 200; i++) { g.update(DT); if (!g.p.inv) { exited = true; break; } }
  assert.ok(exited, 'inversion clears once the tunnel scrolls away');
  assert.ok(g.p.y < 200, 'player is NOT snapped down to the floor on exit');
  // Gravity is downward again: the player falls and eventually lands on the ground.
  let onGround = false;
  for (let i = 0; i < 200; i++) { g.update(DT); if (g.p.on && Math.abs((g.p.y + g.p.h) - 448) < 1) { onGround = true; break; } }
  assert.ok(onGround, 'normal downward gravity returns and the player lands on the ground');
  assert.equal(g.mode, 'play');
});

test('wind tunnel: an idle player is carried up, never killed, and restarts clear the inversion', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.winds.push({ x: 120, w: 300, warn: 0, hit: 0 });
  for (let i = 0; i < 300; i++) { g.update(DT); if (g.mode !== 'play') break; }
  assert.equal(g.mode, 'play', 'a passive player survives the whole tunnel');
  assert.equal(g.bonus, 0, 'the tunnel scores nothing');
  // A fresh run always clears the inverted-gravity flag.
  g.p.inv = 1;
  g.startRun();
  assert.equal(g.p.inv, 0, 'restart resets inverted gravity');
});

test('nearly helpful spring: weak bounce, cut rise, double jump kept, no points', () => {
  let { g } = fresh();
  sandbox(g, 400);
  g.springs.push({ x: 160, y: 422, w: 44, h: 26, c: 0 });
  Object.assign(g.p, { on: false, coy: -1, j: 1, y: 396, vy: 300 });
  g.update(DT);
  assert.ok(Math.abs(g.p.vy + 360) < 1e-9, 'bounce is weaker than a -520 jump');
  assert.equal(g.p.on, 0);
  assert.equal(g.p.j, 1, 'one air jump is still owed');
  assert.ok(g.p.spr > 0, 'rise-cut timer armed');
  assert.equal(g.bonus, 0);
  assert.equal(g.combo, 0);
  const y0 = g.p.y;
  let minY = y0;
  for (let i = 0; i < 120; i++) { g.update(DT); minY = Math.min(minY, g.p.y); if (g.p.on) break; }
  const rise = y0 - minY;
  assert.ok(rise > 20, `spring still bounces (${rise.toFixed(1)}px)`);
  assert.ok(rise < 60, `rise is cut well below a normal ~93px jump (${rise.toFixed(1)}px)`);
  assert.equal(g.mode, 'play');
  assert.equal(g.bonus, 0);

  ({ g } = fresh());
  sandbox(g, 400);
  g.springs.push({ x: 160, y: 422, w: 44, h: 26, c: 0 });
  Object.assign(g.p, { on: false, coy: -1, j: 1, y: 396, vy: 300 });
  g.update(DT);
  g.press(); g.update(DT);
  assert.equal(g.p.j, 2, 'double jump still available off a spring');
  assert.ok(g.p.vy < -400, 'the air jump has full strength');
});

test('rage-bait templates never kill an idle player at any speed or rng extreme', () => {
  const { g, env } = fresh();
  for (const id of RAGE) {
    for (const sv of [330, 460, 590]) {
      for (const rv of [0.001, 0.5, 0.999]) {
        env.setRandom(() => rv);
        sandbox(g, sv);
        g.emit(id, 880);
        for (let i = 0; i < 420; i++) { g.update(DT); if (g.mode !== 'play') break; }
        assert.equal(g.mode, 'play', `${id} killed an idle player at speed ${sv}, rng ${rv}`);
        assert.equal(g.bonus, 0, `${id} awarded points at speed ${sv}`);
        assert.equal(g.combo, 0, `${id} awarded combo at speed ${sv}`);
      }
    }
  }
  env.setRandom(null);
});

test('generator unlocks each rage-bait element gradually', () => {
  const { g, env } = fresh();
  const bands = [[0.86, 'plats', 0.28], [0.90, 'springs', 0.4], [0.93, 'winds', 0.5], [0.965, 'ups', 0.6], [0.99, 'ups', 0.7]];
  for (const [r, arr, unlock] of bands) {
    env.setRandom(() => r);
    g.startRun(); g.dist = (unlock - 0.05) * 900; g.next = 500;
    g.pattern();
    assert.equal(g[arr].length, 0, `band ${r} still locked below dist ratio ${unlock}`);
    assert.ok(g.obs.length > 0, `band ${r} falls back to a normal obstacle while locked`);
    g.startRun(); g.dist = (unlock + 0.05) * 900; g.next = 500;
    g.pattern();
    assert.equal(g[arr].length, 1, `band ${r} unlocked above dist ratio ${unlock}`);
    assert.equal(g.obs.length, 0, `band ${r} emits no lethal obstacle`);
    assert.ok(g.next > 500, 'cursor advanced by shape + gap');
  }
  env.setRandom(() => 0.965);
  g.startRun(); g.dist = 900; g.next = 500; g.pattern();
  assert.equal(g.ups[0].k, 1, 'the earlier power-up band is the hostile one');
  env.setRandom(() => 0.99);
  g.startRun(); g.dist = 900; g.next = 500; g.pattern();
  assert.equal(g.ups[0].k, 0, 'the last power-up band is the reverse one');
  env.setRandom(null);
});

test('normal obstacle rhythm stays dominant once everything is unlocked', () => {
  const { g, env } = fresh();
  let withObs = 0, withTerrain = 0;
  for (let i = 0; i < 100; i++) {
    env.setRandom(() => i / 100);
    g.startRun(); g.dist = 1200; g.next = 500;
    g.pattern();
    if (g.obs.length > 0) withObs++;
    if (g.solids.length > 0 || g.pits.length > 0) withTerrain++;
  }
  env.setRandom(null);
  assert.ok(withObs >= 65, `normal templates dominate (${withObs}/100)`);
  assert.ok(withObs > withTerrain, `obstacles outnumber terrain (${withObs} vs ${withTerrain})`);
  assert.ok(withTerrain > 0, 'procedural terrain does appear once unlocked');
});

test('every rage-bait element renders in both motion modes without throwing', () => {
  const { g, env } = fresh();
  for (const reduced of [false, true]) {
    env.reducedMotion(reduced);
    g.startRun(); g.next = 1e9;
    for (const id of RAGE) g.emit(id, 300 + RAGE.indexOf(id) * 130);
    g.emit('single', 60); g.emit('ceil', 700); g.emit('saw', 820);
    g.plats[0].shy = 1; g.springs[0].c = 0.12; g.winds[0].warn = 0;
    g.draw();
    g.winds[0].warn = 0.5;
    g.boostT = 1; g.revT = 1;
    g.update(DT);
    g.draw();
    g.winds[0].warn = 0; g.p.inv = 1; g.draw();   // live tunnel + upside-down player
    g.p.inv = 0;
    g.mode = 'end'; g.draw(); g.mode = 'play';
  }
  env.reducedMotion(false);
});

// ---------------------------------------------------------------------------
// Procedural terrain: ordinary solids/slabs, stair steps, and real ground pits.
// ---------------------------------------------------------------------------
const G_LINE = 448, WORLD_H = 540;

test('startRun resets procedural terrain arrays with the rest of the world', () => {
  const { g } = fresh();
  g.startRun();
  g.emit('plat', 900); g.emit('stairs', 1100); g.emit('gap', 1400);
  assert.ok(g.solids.length >= 4, 'plat + 3 stair blocks emitted');
  assert.equal(g.pits.length, 1);
  g.startRun();
  assert.equal(g.solids.length, 0, 'solids cleared on restart');
  assert.equal(g.pits.length, 0, 'pits cleared on restart');
});

test('terrain templates emit readable, unscored, non-lethal shapes with real gaps', () => {
  const { g } = fresh();
  for (const id of ['plat', 'stairs', 'gap']) {
    g.startRun(); g.speed = 400;
    const end = g.emit(id, 900);
    assert.equal(g.obs.length, 0, `${id} must never emit a lethal obstacle`);
    assert.equal(g.coins.length, 0, `${id} must never emit a scoring coin`);
    assert.ok(end > 900, `${id} advances the spawn cursor`);
    const gap = g.gapFor(id);
    assert.ok(Number.isFinite(gap) && gap >= 190 + 400 * 0.55, `${id} recovery gap ${gap}`);
  }
  // A plain slab is a solid block resting on the ground, within jump reach.
  g.startRun(); g.emit('plat', 900);
  const s = g.solids[0];
  assert.equal(s.y + s.h, G_LINE, 'slab bottom sits on the ground line');
  assert.ok(G_LINE - s.y <= 93 && G_LINE - s.y >= 30, `slab top is jump-reachable (${G_LINE - s.y}px)`);
  assert.equal(s.shy, undefined, 'ordinary solids have no bashful retreat state');
  // A staircase is an ascending run of ground-anchored steps.
  g.startRun(); g.emit('stairs', 900);
  assert.equal(g.solids.length, 3, 'three steps');
  for (let i = 0; i < 3; i++) {
    assert.equal(g.solids[i].y + g.solids[i].h, G_LINE, 'each step is anchored to the ground');
    if (i) assert.ok(g.solids[i].y < g.solids[i - 1].y, 'steps ascend');
    assert.ok(G_LINE - g.solids[i].y <= 96, 'no step is out of reach');
  }
  // A gap is a genuine ground pit of clearable width.
  g.startRun(); g.emit('gap', 900);
  assert.equal(g.pits.length, 1);
  assert.ok(g.pits[0].w >= 100 && g.pits[0].w <= 170, `pit width ${g.pits[0].w} clearable`);
});

test('ordinary solids give a stable top landing that restores jumps, no retreat/drop', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.solids.push({ x: 160, y: 370, w: 80, h: G_LINE - 370 });
  Object.assign(g.p, { on: false, coy: -1, j: 2, y: 344, vy: 300 });
  g.update(DT);
  assert.equal(g.p.on, 1, 'landed on the solid top');
  assert.ok(Math.abs(g.p.y - (370 - 24)) < 1e-9, 'rests exactly on the surface');
  assert.equal(g.p.vy, 0);
  assert.equal(g.p.j, 0, 'landing restores both jumps');
  assert.equal(g.mode, 'play', 'solids are never lethal');
  assert.equal(g.bonus, 0);
  // Unlike the bashful platform, a solid never gets shy, never drops, never flees.
  const y0 = g.solids[0].y;
  let prevX = g.solids[0].x, retreated = false;
  for (let i = 0; i < 40; i++) { g.update(DT); if (g.solids[0].x > prevX + 1e-9) retreated = true; prevX = g.solids[0].x; }
  assert.equal(g.solids[0].y, y0, 'solid never drops away');
  assert.ok(!retreated, 'solid only scrolls with the world, never retreats against it');
});

test('a grounded player standing under/through a solid is never killed by it', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.solids.push({ x: 150, y: 400, w: 90, h: G_LINE - 400 }); // overlaps the grounded player column
  for (let i = 0; i < 30; i++) g.update(DT);
  assert.equal(g.mode, 'play', 'solid side contact is not a hazard');
  assert.equal(g.p.on, 1, 'grounded player stays grounded');
});

test('stairs can be mounted (first step landing) and never kill an idle player', () => {
  const { g } = fresh();
  sandbox(g, 400);
  const y = G_LINE - 30;
  g.solids.push({ x: 150, y, w: 46, h: 30 });   // lowest step under the player
  Object.assign(g.p, { on: false, coy: -1, j: 2, y: 392, vy: 250 });
  let landed = false;
  for (let i = 0; i < 30; i++) { g.update(DT); if (g.p.on && Math.abs(g.p.y - (y - 24)) < 1) landed = true; if (g.p.on) break; }
  assert.ok(landed, 'player can stand on the first step');
  assert.equal(g.mode, 'play', 'stairs are non-lethal');
});

test('a grounded runner climbs a real emitted staircase step by step as it scrolls in', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.emit('stairs', 260);                         // real production template, ahead of the player
  const tops = Array.from(g.solids, (s) => s.y).sort((a, b) => b - a);
  assert.equal(g.solids.length, 3, 'three ascending steps emitted');
  assert.deepEqual(tops, [G_LINE - 30, G_LINE - 60, G_LINE - 90], 'steps at +30/+60/+90');
  assert.equal(g.p.on, 1, 'player starts grounded');
  assert.ok(Math.abs((g.p.y + g.p.h) - G_LINE) < 1e-9, 'feet start on the ground line');
  // Drive the REAL update loop, never jumping, and record every grounded foot level.
  const feet = new Set();
  for (let i = 0; i < 240; i++) {
    g.update(DT);
    assert.ok(!(g.p.vy < 0), 'ascent is a step-up, never a jump (vy stays non-negative)');
    if (g.p.on) feet.add(Math.round(g.p.y + g.p.h));
    if (g.mode === 'end') break;
  }
  assert.equal(g.mode, 'play', 'climbing the stairs is non-lethal');
  // The runner must actually rest on each successive step, not just the ground.
  for (const top of [G_LINE, G_LINE - 30, G_LINE - 60, G_LINE - 90]) {
    assert.ok(feet.has(top), `stood with feet at ${top} (step top)`);
  }
});

test('adjacent higher solids only step up a fair amount, never teleport off tall slabs', () => {
  // A single ordinary slab taller than one stair step must NOT be climbed by side contact.
  for (const h of [44, 84, 150]) {
    const { g } = fresh();
    sandbox(g, 400);
    g.solids.push({ x: 260, y: G_LINE - h, w: 80, h }); // grounded slab ahead of the player
    let raised = false;
    for (let i = 0; i < 240; i++) {
      g.update(DT);
      if (g.p.on && g.p.y + g.p.h < G_LINE - 1) raised = true; // ever stood above the ground line?
      if (g.mode === 'end') break;
    }
    assert.equal(g.mode, 'play', `${h}px slab side contact is non-lethal`);
    assert.ok(!raised, `a ${h}px slab is never mounted by walking into its side`);
  }
});

test('a pit removes ground support and kills by falling below the world', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.pits.push({ x: 120, w: 300 });  // wide gap already under the grounded player
  assert.equal(g.p.on, 1);
  let fell = false;
  for (let i = 0; i < 120; i++) {
    g.update(DT);
    if (g.p.y > G_LINE) fell = true;   // dropped below the ground line
    if (g.mode === 'end') break;
  }
  assert.ok(fell, 'player falls through the missing ground');
  assert.equal(g.mode, 'end', 'falling below the world is lethal');
  assert.ok(!g.won, 'a pit death is a real death, not a win');
});

test('ground support is restored on the far side of a pit', () => {
  const { g } = fresh();
  sandbox(g, 400);
  // Narrow pit whose right (far) edge is already past the player's centre.
  g.pits.push({ x: PX_CENTER - 200, w: 210 });
  for (let i = 0; i < 60; i++) g.update(DT);
  assert.equal(g.mode, 'play', 'player over solid ground survives');
  assert.equal(g.p.on, 1, 'stays grounded once the gap has scrolled past');
});

// Gap fairness: reachable by jumping at every speed / rng extreme.
function clearsGap(g, sv, w) {
  const leads = [120, 150, 180, 210, 240];
  const holds = [0.05, 0.14, 0.6];
  for (const lead of leads) for (const hold of holds) for (const dbl of [false, true]) {
    for (const dblT of dbl ? [0.28, 0.36] : [0]) {
      sandbox(g, sv);
      g.pits.push({ x: 720, w });
      let jumped = false, jt = 0, released = false, doubled = false, ok = true;
      for (let time = 0; time < 6; time += DT) {
        const pit = g.pits[0];
        if (!jumped && g.p.on && pit && pit.x - PX_CENTER <= lead) { g.press(); jumped = true; jt = 0; }
        else if (jumped) {
          jt += DT;
          if (!released && jt >= hold) { g.release(); released = true; }
          if (dbl && !doubled && jt >= dblT) { g.press(); doubled = true; }
        }
        g.update(DT);
        if (g.mode === 'end' && !g.won) { ok = false; break; }
        if (g.pits.length === 0) break;   // pit scrolled safely past
      }
      if (ok && g.mode === 'play') return true;
    }
  }
  return false;
}
test('every generated pit width is jumpable at min/mid/max speed and rng extremes', () => {
  const { g, env } = fresh();
  for (const sv of [330, 460, 590]) {
    for (const rv of [0.001, 0.5, 0.999]) {
      env.setRandom(() => rv);
      g.startRun(); g.speed = sv;
      g.emit('gap', 900);
      const w = g.pits[0].w;
      assert.ok(clearsGap(g, sv, w), `pit width ${w} unclearable at speed ${sv}, rng ${rv}`);
    }
    env.setRandom(null);
  }
});

// Deterministic seeded PRNG (mulberry32) so terrain generation is reproducible
// and the overlap sweep provably exercises both pits and solids every run.
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
test('generator never overlaps a pit with an obstacle, solid, or another pit', () => {
  // A single unseeded run is nondeterministic: it can generate zero pits or
  // zero solids by chance and fail the coverage guards for no real reason.
  // Instead sweep a FIXED seed set with a controlled RNG so every run visits
  // the same fully-unlocked worlds and provably accumulates both pit and solid
  // coverage while asserting the overlap invariants each frame.
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  let pitSamples = 0, solidSamples = 0;
  for (const seed of SEEDS) {
    const { g, env } = fresh();
    env.setRandom(mulberry32(seed));
    g.startRun();
    for (let f = 0; f < 900; f++) {
      g.update(DT);
      g.dist = 900;      // lock to a fully-unlocked, mid/high tier
      g.p.y = -1000;     // park the probe player so terrain just scrolls by, never dies
      pitSamples += g.pits.length;
      solidSamples += g.solids.length;
      // A live pit must never share horizontal space with an obstacle, a solid,
      // or another pit at the same instant.
      for (let i = 0; i < g.pits.length; i++) {
        const pt = g.pits[i];
        for (const o of g.obs) assert.ok(!(pt.x < o.x + o.w && pt.x + pt.w > o.x), `pit overlaps an obstacle (seed ${seed})`);
        for (const s of g.solids) assert.ok(!(pt.x < s.x + s.w && pt.x + pt.w > s.x), `pit overlaps a solid (seed ${seed})`);
        for (let j = i + 1; j < g.pits.length; j++) {
          const q = g.pits[j];
          assert.ok(!(pt.x < q.x + q.w && pt.x + pt.w > q.x), `two pits overlap (seed ${seed})`);
        }
      }
    }
  }
  // Guaranteed by the fixed seed set above (currently 859 pit / 3522 solid
  // samples), so these guards can never flake on an empty run.
  assert.ok(pitSamples > 0, 'pits were actually generated in the sample');
  assert.ok(solidSamples > 0, 'solids were actually generated in the sample');
});

test('terrain scrolls with the world and freezes under pause exactly like everything else', () => {
  const { g } = fresh();
  sandbox(g, 400);
  g.solids.push({ x: 800, y: 380, w: 80, h: G_LINE - 380 });
  g.pits.push({ x: 1000, w: 140 });
  // Forward scroll.
  let sx = g.solids[0].x, px = g.pits[0].x;
  g.update(DT);
  assert.ok(Math.abs((sx - g.solids[0].x) - g.speed * DT) < 1e-9, 'solid scrolls left at world speed');
  assert.ok(Math.abs((px - g.pits[0].x) - g.speed * DT) < 1e-9, 'pit scrolls left at world speed');
  // Hostile boost: 1.5x world motion.
  g.boostT = 1;
  sx = g.solids[0].x; px = g.pits[0].x;
  g.update(DT);
  assert.ok(Math.abs((sx - g.solids[0].x) - g.speed * 1.5 * DT) < 1e-9, 'solid moves 1.5x while boosted');
  assert.ok(Math.abs((px - g.pits[0].x) - g.speed * 1.5 * DT) < 1e-9, 'pit moves 1.5x while boosted');
  g.boostT = 0;
  // Reverse boost: world (and terrain) slides right.
  g.revT = 1;
  sx = g.solids[0].x; px = g.pits[0].x;
  g.update(DT);
  assert.ok(g.solids[0].x > sx, 'solid slides right during reverse');
  assert.ok(g.pits[0].x > px, 'pit slides right during reverse');
  g.revT = 0;
  // Freeze: no terrain motion at all.
  g.frozen = 1;
  sx = g.solids[0].x; px = g.pits[0].x;
  g.update(5);
  assert.equal(g.solids[0].x, sx, 'frozen solid does not move');
  assert.equal(g.pits[0].x, px, 'frozen pit does not move');
});

test('terrain renders in both motion modes without throwing', () => {
  const { g, env } = fresh();
  for (const reduced of [false, true]) {
    env.reducedMotion(reduced);
    g.startRun(); g.next = 1e9;
    g.emit('plat', 300); g.emit('stairs', 500); g.emit('gap', 700);
    g.emit('single', 60);
    g.draw();
    g.update(DT);
    g.draw();
  }
  env.reducedMotion(false);
});


test('package.py emits a reproducible <=13000B archive of exactly index.html', () => {
  execFileSync('python3', ['scripts/package.py'], { cwd: ROOT });
  const zip1 = fs.readFileSync(`${ROOT}/dist/1337.zip`);
  assert.ok(zip1.length <= 13000, `archive ${zip1.length} > 13000`);
  execFileSync('python3', ['scripts/package.py'], { cwd: ROOT });
  const zip2 = fs.readFileSync(`${ROOT}/dist/1337.zip`);
  assert.ok(zip1.equals(zip2), 'archive is not reproducible');
  // Verify contents == source, and the only entry, via python stdlib.
  const out = execFileSync('python3', ['-c',
    'import zipfile,sys;z=zipfile.ZipFile("dist/1337.zip");n=z.namelist();' +
    'src=open("index.html","rb").read();' +
    'print("OK" if n==["index.html"] and z.read("index.html")==src else "MISMATCH:"+repr(n))',
  ], { cwd: ROOT }).toString().trim();
  assert.equal(out, 'OK');
});
