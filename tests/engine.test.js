/*
 * Unit-тесты чистой игровой логики (js/engine.js).
 * Запуск: npm test  (использует встроенный node:test, без зависимостей).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const E = require('../js/engine.js');

test('createRNG: детерминирован и стабилен при одном зерне', () => {
  const a = E.createRNG(42);
  const b = E.createRNG(42);
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(a(), b(), 'один seed -> одинаковая последовательность');
  }
});

test('createRNG: значения в диапазоне [0, 1)', () => {
  const r = E.createRNG(7);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, 'значение должно быть в [0,1): ' + v);
  }
});

test('clamp: ограничивает значение диапазоном', () => {
  assert.strictEqual(E.clamp(5, 0, 10), 5);
  assert.strictEqual(E.clamp(-3, 0, 10), 0);
  assert.strictEqual(E.clamp(99, 0, 10), 10);
});

test('randRange: попадает в [min, max)', () => {
  const r = E.createRNG(123);
  for (let i = 0; i < 500; i++) {
    const v = E.randRange(r, -50, 50);
    assert.ok(v >= -50 && v < 50, 'вне диапазона: ' + v);
  }
});

test('project: точка по центру остаётся в центре экрана', () => {
  const view = { centerX: 400, centerY: 300, focal: 320 };
  const camera = { x: 0, y: 0 };
  const p = E.project({ x: 0, y: 0, z: 500 }, camera, view);
  assert.strictEqual(p.x, 400);
  assert.strictEqual(p.y, 300);
});

test('project: ближний объект масштабируется сильнее дальнего', () => {
  const view = { centerX: 0, centerY: 0, focal: 320 };
  const camera = { x: 0, y: 0 };
  const near = E.project({ x: 100, y: 0, z: 100 }, camera, view);
  const far = E.project({ x: 100, y: 0, z: 1000 }, camera, view);
  assert.ok(near.scale > far.scale, 'ближний масштаб больше');
  assert.ok(Math.abs(near.x) > Math.abs(far.x), 'ближний смещён сильнее');
});

test('project: смещение камеры сдвигает объект в противоположную сторону', () => {
  const view = { centerX: 0, centerY: 0, focal: 320 };
  const centered = E.project({ x: 0, y: 0, z: 300 }, { x: 0, y: 0 }, view);
  const moved = E.project({ x: 0, y: 0, z: 300 }, { x: 50, y: 0 }, view);
  assert.strictEqual(centered.x, 0);
  assert.ok(moved.x < 0, 'сместив кабину вправо, объект уходит влево');
});

test('project: не делит на ноль при z <= 0', () => {
  const view = { centerX: 0, centerY: 0, focal: 320 };
  const p = E.project({ x: 10, y: 10, z: 0 }, { x: 0, y: 0 }, view);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'координаты конечны');
});

test('willCollide: попадание при наложении радиусов', () => {
  const asteroid = { x: 0, y: 0, radius: 40 };
  assert.strictEqual(E.willCollide(asteroid, { x: 0, y: 0 }, 24), true);
  assert.strictEqual(E.willCollide(asteroid, { x: 50, y: 0 }, 24), true); // 50 < 64
});

test('willCollide: уклонение, когда центр дальше суммы радиусов', () => {
  const asteroid = { x: 0, y: 0, radius: 40 };
  assert.strictEqual(E.willCollide(asteroid, { x: 100, y: 0 }, 24), false);
  assert.strictEqual(E.willCollide(asteroid, { x: 0, y: 100 }, 24), false);
});

test('spawnAsteroid: параметры в заданных границах', () => {
  const rng = E.createRNG(99);
  const cfg = {
    spawnRangeX: 360, spawnRangeY: 280, farZ: 1150,
    minRadius: 26, maxRadius: 70
  };
  for (let i = 0; i < 200; i++) {
    const a = E.spawnAsteroid(rng, cfg);
    assert.ok(a.x >= -360 && a.x <= 360, 'x в диапазоне');
    assert.ok(a.y >= -280 && a.y <= 280, 'y в диапазоне');
    assert.strictEqual(a.z, 1150, 'z = farZ при появлении');
    assert.ok(a.radius >= 26 && a.radius <= 70, 'радиус в диапазоне');
    assert.ok(Array.isArray(a.shape) && a.shape.length > 4, 'есть форма');
  }
});

test('advanceAsteroid: пока z > плоскости — не достигает кабины', () => {
  const a = { x: 0, y: 0, z: 500, radius: 40, spin: 0, angle: 0 };
  const res = E.advanceAsteroid(a, 200, 0.1, { x: 0, y: 0 }, 24, 0);
  assert.strictEqual(res.reached, false);
  assert.ok(a.z < 500, 'z уменьшился');
});

test('advanceAsteroid: достижение кабины по центру = удар', () => {
  const a = { x: 0, y: 0, z: 5, radius: 40, spin: 0, angle: 0 };
  const res = E.advanceAsteroid(a, 200, 0.1, { x: 0, y: 0 }, 24, 0);
  assert.strictEqual(res.reached, true);
  assert.strictEqual(res.hit, true);
});

test('advanceAsteroid: уклонение, если кабина отъехала в сторону', () => {
  const a = { x: 0, y: 0, z: 5, radius: 40, spin: 0, angle: 0 };
  const res = E.advanceAsteroid(a, 200, 0.1, { x: 200, y: 0 }, 24, 0);
  assert.strictEqual(res.reached, true);
  assert.strictEqual(res.hit, false);
});

test('difficultyCurve: монотонно идёт от start к end', () => {
  const start = 200, end = 600, ramp = 55;
  assert.ok(Math.abs(E.difficultyCurve(start, end, 0, ramp) - start) < 1e-9, 'в t=0 равно start');
  const mid = E.difficultyCurve(start, end, 30, ramp);
  const late = E.difficultyCurve(start, end, 200, ramp);
  assert.ok(mid > start && mid < end, 'в середине между start и end');
  assert.ok(late > mid, 'со временем растёт');
  assert.ok(late < end, 'не превышает end');
});
