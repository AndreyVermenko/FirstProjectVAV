/*
 * engine.js — чистая игровая логика космолёта.
 *
 * Здесь нет ни Canvas, ни DOM: только математика мира.
 * Благодаря этому функции можно покрыть unit-тестами в Node
 * и одновременно использовать в браузере через тег <script>.
 *
 * Модель мира:
 *   - Камера = кабина космолёта, её положение {x, y} в мировых единицах.
 *     Игрок двигает кабину стрелками вверх/вниз/влево/вправо.
 *   - Астероид имеет мировые координаты {x, y, z}. Координата z — это
 *     расстояние «вглубь экрана»: чем больше z, тем дальше астероид.
 *     Со временем z уменьшается — астероид приближается к кабине.
 *   - Столкновение проверяется на плоскости кабины (z ≈ 0):
 *     если центр астероида ближе к камере, чем сумма радиусов, — это удар.
 */
;(function (global) {
  'use strict';

  // Детерминированный генератор псевдослучайных чисел (mulberry32).
  // Нужен, чтобы тесты были воспроизводимыми, а игра — не зависела от Math.random.
  function createRNG(seed) {
    let a = seed >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Ограничить значение диапазоном [min, max].
  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  // Случайное число с плавающей точкой в диапазоне [min, max).
  function randRange(rng, min, max) {
    return min + (max - min) * rng();
  }

  // Перспективная проекция мировой точки на экран.
  //   camera — положение кабины {x, y};
  //   view   — {centerX, centerY, focal} (центр экрана и фокусное расстояние).
  // Возвращает экранные координаты {x, y} и коэффициент масштаба scale.
  function project(point, camera, view) {
    var z = point.z <= 0.0001 ? 0.0001 : point.z;
    var scale = view.focal / z;
    return {
      x: view.centerX + (point.x - camera.x) * scale,
      y: view.centerY + (point.y - camera.y) * scale,
      scale: scale
    };
  }

  // Проверка столкновения в мировых координатах на плоскости кабины.
  // Истина, если центр астероида ближе к кораблю, чем сумма их радиусов.
  function willCollide(asteroid, camera, shipRadius) {
    var dx = asteroid.x - camera.x;
    var dy = asteroid.y - camera.y;
    var distance = Math.sqrt(dx * dx + dy * dy);
    return distance < asteroid.radius + shipRadius;
  }

  // Создать новый астероид далеко впереди со случайными параметрами.
  function spawnAsteroid(rng, config) {
    return {
      x: randRange(rng, -config.spawnRangeX, config.spawnRangeX),
      y: randRange(rng, -config.spawnRangeY, config.spawnRangeY),
      z: config.farZ,
      radius: randRange(rng, config.minRadius, config.maxRadius),
      spin: randRange(rng, -1.2, 1.2),
      angle: randRange(rng, 0, Math.PI * 2),
      // Набор вершин для рисования «рваного» силуэта камня (0.75..1.0 от радиуса).
      shape: makeShape(rng)
    };
  }

  // Сгенерировать форму астероида — массив множителей радиуса по кругу.
  function makeShape(rng) {
    var points = 10;
    var shape = [];
    for (var i = 0; i < points; i++) {
      shape.push(0.74 + rng() * 0.28);
    }
    return shape;
  }

  // Продвинуть астероид к кабине на один кадр.
  //   speed — скорость сближения (мировых единиц в секунду);
  //   dt    — длительность кадра в секундах;
  //   collisionZ — плоскость кабины, на которой проверяется удар.
  // Возвращает {reached, hit}:
  //   reached=false — астероид ещё летит;
  //   reached=true, hit=true  — астероид достиг кабины и попал;
  //   reached=true, hit=false — астероид достиг кабины, но игрок уклонился.
  function advanceAsteroid(asteroid, speed, dt, camera, shipRadius, collisionZ) {
    asteroid.z -= speed * dt;
    asteroid.angle += asteroid.spin * dt;
    if (asteroid.z > collisionZ) {
      return { reached: false, hit: false };
    }
    return { reached: true, hit: willCollide(asteroid, camera, shipRadius) };
  }

  // Кривая нарастания сложности: значение плавно идёт от start к end
  // по мере накопления времени t (в секундах) с характерным масштабом ramp.
  function difficultyCurve(start, end, t, ramp) {
    var k = 1 - Math.exp(-t / ramp); // 0 → 1 со временем
    return start + (end - start) * k;
  }

  var Engine = {
    createRNG: createRNG,
    clamp: clamp,
    randRange: randRange,
    project: project,
    willCollide: willCollide,
    spawnAsteroid: spawnAsteroid,
    makeShape: makeShape,
    advanceAsteroid: advanceAsteroid,
    difficultyCurve: difficultyCurve
  };

  // UMD-экспорт: работает и в Node (require), и в браузере (window.CosmoEngine).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Engine;
  } else {
    global.CosmoEngine = Engine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
