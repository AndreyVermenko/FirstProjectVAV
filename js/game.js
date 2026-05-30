/*
 * game.js — отрисовка и управление игрой «Космолёт».
 *
 * Использует чистую логику из engine.js (window.CosmoEngine).
 * Здесь — Canvas-рендер (звёзды, астероиды, кабина, приборная панель),
 * игровой цикл, обработка стрелок и состояния «старт / игра / конец».
 */
;(function () {
  'use strict';

  var E = window.CosmoEngine;

  // ----------------------------------------------------------------------
  // Настройки игры. Значения подобраны так, чтобы игра была динамичной,
  // но проходимой. Их можно безопасно менять для регулировки сложности.
  // ----------------------------------------------------------------------
  var CONFIG = {
    focal: 320, // фокусное расстояние «объектива» кабины
    farZ: 1150, // глубина появления астероидов
    collisionZ: 0, // плоскость кабины, где проверяется столкновение
    shipRadius: 24, // радиус корабля для столкновений (мировые единицы)

    spawnRangeX: 360, // разброс появления астероидов по горизонтали
    spawnRangeY: 280, // ...и по вертикали
    minRadius: 26, // минимальный радиус астероида
    maxRadius: 70, // максимальный радиус астероида

    rangeX: 300, // насколько далеко кабина может смещаться по X
    rangeY: 230, // ...и по Y
    moveSpeed: 560, // максимальная скорость смещения кабины (ед/с)
    accel: 9, // плавность разгона/торможения кабины

    speedStart: 230, // стартовая скорость сближения астероидов
    speedEnd: 620, // максимальная скорость сближения
    spawnStart: 1.15, // стартовый интервал появления (с)
    spawnEnd: 0.42, // минимальный интервал появления (с)
    ramp: 55, // характерное время нарастания сложности (с)

    lives: 3, // запас прочности корпуса
    invuln: 1.3, // неуязвимость после удара (с)
    maxBank: 0.09, // максимальный крен мира при манёвре (рад)
    starCount: 220 // количество звёзд
  };

  // ----------------------------------------------------------------------
  // Состояние игры.
  // ----------------------------------------------------------------------
  var state = null;

  function createState() {
    return {
      mode: 'start', // 'start' | 'playing' | 'over'
      time: 0, // прожитое в забеге время (с)
      score: 0, // счёт = пройденная дистанция + бонусы за уклонения
      best: loadBest(), // лучший результат (localStorage)
      lives: CONFIG.lives,
      dodged: 0, // сколько астероидов успешно пропущено мимо
      camera: { x: 0, y: 0 }, // положение кабины
      vel: { x: 0, y: 0 }, // её текущая скорость
      asteroids: [],
      stars: [],
      spawnTimer: 0,
      invuln: 0, // оставшаяся неуязвимость (с)
      hitFlash: 0, // яркость красной вспышки удара
      bank: 0, // текущий крен мира
      rng: E.createRNG(seedFromTime())
    };
  }

  // ----------------------------------------------------------------------
  // Canvas и адаптация под размер окна / Retina.
  // ----------------------------------------------------------------------
  var canvas, ctx, view = { centerX: 0, centerY: 0, focal: CONFIG.focal };
  var cssW = 0, cssH = 0, dpr = 1;

  function setupCanvas() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = canvas.clientWidth || window.innerWidth;
    cssH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.centerX = cssW / 2;
    view.centerY = cssH / 2;
  }

  // ----------------------------------------------------------------------
  // Простой и устойчивый к ошибкам звук (WebAudio). Никогда не валит игру.
  // ----------------------------------------------------------------------
  var audio = (function () {
    var actx = null, enabled = true;
    function ensure() {
      if (!actx) {
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) actx = new AC();
        } catch (e) { actx = null; }
      }
      return actx;
    }
    function tone(freq, dur, type, gain) {
      if (!enabled) return;
      var c = ensure();
      if (!c) return;
      try {
        var o = c.createOscillator();
        var g = c.createGain();
        o.type = type || 'sine';
        o.frequency.value = freq;
        var t = c.currentTime;
        g.gain.setValueAtTime(gain || 0.04, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(c.destination);
        o.start(t);
        o.stop(t + dur);
      } catch (e) { /* молча игнорируем */ }
    }
    return {
      hit: function () { tone(110, 0.45, 'sawtooth', 0.14); },
      dodge: function () { tone(680, 0.05, 'triangle', 0.025); },
      start: function () { ensure(); tone(520, 0.12, 'sine', 0.05); },
      over: function () { tone(160, 0.6, 'sine', 0.12); },
      toggle: function () { enabled = !enabled; return enabled; },
      isOn: function () { return enabled; }
    };
  })();

  // ----------------------------------------------------------------------
  // Ввод: стрелки (и дублирующие WASD).
  // ----------------------------------------------------------------------
  var keys = { left: false, right: false, up: false, down: false };

  function setupInput() {
    window.addEventListener('keydown', onKey(true));
    window.addEventListener('keyup', onKey(false));

    var startBtn = document.getElementById('start-btn');
    var retryBtn = document.getElementById('retry-btn');
    if (startBtn) startBtn.addEventListener('click', startGame);
    if (retryBtn) retryBtn.addEventListener('click', startGame);

    var muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
      muteBtn.addEventListener('click', function () {
        muteBtn.textContent = audio.toggle() ? '🔊' : '🔈';
      });
    }
  }

  function onKey(isDown) {
    return function (e) {
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': keys.left = isDown; e.preventDefault(); break;
        case 'ArrowRight': case 'd': case 'D': keys.right = isDown; e.preventDefault(); break;
        case 'ArrowUp': case 'w': case 'W': keys.up = isDown; e.preventDefault(); break;
        case 'ArrowDown': case 's': case 'S': keys.down = isDown; e.preventDefault(); break;
        case ' ': case 'Enter':
          if (isDown && (state.mode === 'start' || state.mode === 'over')) startGame();
          e.preventDefault();
          break;
        case 'm': case 'M':
          if (isDown) {
            var mb = document.getElementById('mute-btn');
            var on = audio.toggle();
            if (mb) mb.textContent = on ? '🔊' : '🔈';
          }
          break;
        default: break;
      }
    };
  }

  // ----------------------------------------------------------------------
  // Управление состояниями игры.
  // ----------------------------------------------------------------------
  function startGame() {
    audio.start();
    state.mode = 'playing';
    state.time = 0;
    state.score = 0;
    state.lives = CONFIG.lives;
    state.dodged = 0;
    state.camera.x = 0; state.camera.y = 0;
    state.vel.x = 0; state.vel.y = 0;
    state.asteroids.length = 0;
    state.spawnTimer = 0;
    state.invuln = 0;
    state.hitFlash = 0;
    state.bank = 0;
    state.rng = E.createRNG(seedFromTime());
    initStars();
    showOverlay(null);
  }

  function gameOver() {
    state.mode = 'over';
    audio.over();
    if (state.score > state.best) {
      state.best = Math.floor(state.score);
      saveBest(state.best);
    }
    var finalScore = document.getElementById('final-score');
    var finalBest = document.getElementById('final-best');
    var finalDodged = document.getElementById('final-dodged');
    if (finalScore) finalScore.textContent = Math.floor(state.score);
    if (finalBest) finalBest.textContent = state.best;
    if (finalDodged) finalDodged.textContent = state.dodged;
    showOverlay('over');
  }

  function showOverlay(which) {
    var start = document.getElementById('start-screen');
    var over = document.getElementById('over-screen');
    if (start) start.classList.toggle('hidden', which !== 'start');
    if (over) over.classList.toggle('hidden', which !== 'over');
    var overlay = document.getElementById('overlay');
    if (overlay) overlay.classList.toggle('hidden', which === null);
  }

  // ----------------------------------------------------------------------
  // Звёздное поле — ощущение полёта в открытом космосе.
  // ----------------------------------------------------------------------
  function initStars() {
    state.stars.length = 0;
    for (var i = 0; i < CONFIG.starCount; i++) {
      state.stars.push(newStar(true));
    }
  }

  function newStar(anyDepth) {
    return {
      x: E.randRange(state.rng, -900, 900),
      y: E.randRange(state.rng, -700, 700),
      z: anyDepth ? E.randRange(state.rng, 1, 1700) : 1700
    };
  }

  // ----------------------------------------------------------------------
  // Обновление мира за один кадр.
  // ----------------------------------------------------------------------
  function update(dt) {
    if (state.mode !== 'playing') return;

    state.time += dt;
    state.score += dt * 14; // дистанция растёт со временем

    var speed = E.difficultyCurve(CONFIG.speedStart, CONFIG.speedEnd, state.time, CONFIG.ramp);
    var spawnInterval = E.difficultyCurve(CONFIG.spawnStart, CONFIG.spawnEnd, state.time, CONFIG.ramp);

    updateShip(dt);
    updateStars(dt, speed);

    // Появление новых астероидов.
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      state.asteroids.push(E.spawnAsteroid(state.rng, CONFIG));
      state.spawnTimer = spawnInterval;
    }

    // Продвижение астероидов и проверка столкновений.
    if (state.invuln > 0) state.invuln -= dt;
    if (state.hitFlash > 0) state.hitFlash = Math.max(0, state.hitFlash - dt * 2.2);

    for (var i = state.asteroids.length - 1; i >= 0; i--) {
      var a = state.asteroids[i];
      var r = E.advanceAsteroid(a, speed, dt, state.camera, CONFIG.shipRadius, CONFIG.collisionZ);
      if (!r.reached) continue;

      state.asteroids.splice(i, 1);
      if (r.hit && state.invuln <= 0) {
        registerHit();
      } else if (!r.hit) {
        state.dodged += 1;
        state.score += 5; // бонус за уклонение
        audio.dodge();
      }
    }
  }

  function registerHit() {
    state.lives -= 1;
    state.invuln = CONFIG.invuln;
    state.hitFlash = 1;
    audio.hit();
    if (state.lives <= 0) {
      state.lives = 0;
      gameOver();
    }
  }

  function updateShip(dt) {
    var ax = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var ay = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    var desiredX = ax * CONFIG.moveSpeed;
    var desiredY = ay * CONFIG.moveSpeed;

    var k = Math.min(1, CONFIG.accel * dt);
    state.vel.x += (desiredX - state.vel.x) * k;
    state.vel.y += (desiredY - state.vel.y) * k;

    state.camera.x += state.vel.x * dt;
    state.camera.y += state.vel.y * dt;

    if (state.camera.x < -CONFIG.rangeX) { state.camera.x = -CONFIG.rangeX; state.vel.x = 0; }
    if (state.camera.x > CONFIG.rangeX) { state.camera.x = CONFIG.rangeX; state.vel.x = 0; }
    if (state.camera.y < -CONFIG.rangeY) { state.camera.y = -CONFIG.rangeY; state.vel.y = 0; }
    if (state.camera.y > CONFIG.rangeY) { state.camera.y = CONFIG.rangeY; state.vel.y = 0; }

    // Лёгкий крен мира в сторону манёвра для ощущения полёта.
    var targetBank = E.clamp(-state.vel.x / CONFIG.moveSpeed, -1, 1) * CONFIG.maxBank;
    state.bank += (targetBank - state.bank) * Math.min(1, 6 * dt);
  }

  function updateStars(dt, speed) {
    var starSpeed = speed * 1.4;
    for (var i = 0; i < state.stars.length; i++) {
      var s = state.stars[i];
      s.z -= starSpeed * dt;
      if (s.z <= 1) {
        var ns = newStar(false);
        s.x = ns.x; s.y = ns.y; s.z = ns.z;
      }
    }
  }

  // ----------------------------------------------------------------------
  // Отрисовка кадра.
  // ----------------------------------------------------------------------
  function render() {
    drawBackground();

    // Мир (звёзды + астероиды) рисуем с лёгким креном вокруг центра экрана.
    ctx.save();
    ctx.translate(view.centerX, view.centerY);
    ctx.rotate(state.bank);
    ctx.translate(-view.centerX, -view.centerY);
    drawStars();
    drawAsteroids();
    ctx.restore();

    drawReticle();
    drawCockpit();
    drawHUD();

    if (state.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255, 60, 60,' + (state.hitFlash * 0.45) + ')';
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }

  function drawBackground() {
    var g = ctx.createRadialGradient(
      view.centerX, view.centerY * 0.8, 40,
      view.centerX, view.centerY, Math.max(cssW, cssH) * 0.75
    );
    g.addColorStop(0, '#0a1430');
    g.addColorStop(0.55, '#060a1c');
    g.addColorStop(1, '#01030a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  function drawStars() {
    for (var i = 0; i < state.stars.length; i++) {
      var s = state.stars[i];
      var p = E.project(s, state.camera, view);
      if (p.x < -50 || p.x > cssW + 50 || p.y < -50 || p.y > cssH + 50) continue;

      // Хвост-штрих: проекция «более старой» (дальней) позиции звезды.
      var pPrev = E.project({ x: s.x, y: s.y, z: s.z + 60 }, state.camera, view);
      var alpha = E.clamp(p.scale * 1.6, 0.05, 1);
      var wdt = E.clamp(p.scale * 1.7, 0.4, 2.4);

      ctx.strokeStyle = 'rgba(200, 225, 255,' + alpha + ')';
      ctx.lineWidth = wdt;
      ctx.beginPath();
      ctx.moveTo(pPrev.x, pPrev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  function drawAsteroids() {
    // Рисуем от дальних к ближним (массив пополняется в конце — дальние позже).
    for (var i = 0; i < state.asteroids.length; i++) {
      drawAsteroid(state.asteroids[i]);
    }
  }

  function drawAsteroid(a) {
    var p = E.project(a, state.camera, view);
    var sr = a.radius * p.scale;
    if (sr < 0.6) return;
    if (p.x < -sr - 40 || p.x > cssW + sr + 40 || p.y < -sr - 40 || p.y > cssH + sr + 40) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a.angle);

    // Силуэт камня по сохранённой «рваной» форме.
    var shape = a.shape;
    var n = shape.length;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2;
      var rr = sr * shape[i];
      var x = Math.cos(ang) * rr;
      var y = Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Объёмная заливка: свет сверху-слева.
    var grad = ctx.createRadialGradient(-sr * 0.35, -sr * 0.35, sr * 0.1, 0, 0, sr * 1.1);
    grad.addColorStop(0, '#9a958c');
    grad.addColorStop(0.5, '#6d6760');
    grad.addColorStop(1, '#33302c');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = Math.max(1, sr * 0.04);
    ctx.strokeStyle = 'rgba(20, 18, 16, 0.8)';
    ctx.stroke();

    // Кратеры — детерминированно от формы, чтобы не «дрожали».
    if (sr > 14) {
      ctx.fillStyle = 'rgba(40, 37, 33, 0.55)';
      for (var c = 0; c < 3; c++) {
        var cang = shape[c] * 6.0 + c;
        var cdist = sr * (0.15 + 0.18 * c);
        var crad = sr * (0.12 + 0.05 * shape[c + 3]);
        ctx.beginPath();
        ctx.arc(Math.cos(cang) * cdist, Math.sin(cang) * cdist, crad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Прицел в центре — где находится наш космолёт.
  function drawReticle() {
    var cx = view.centerX, cy = view.centerY;
    var danger = state.invuln > 0 && Math.floor(state.invuln * 10) % 2 === 0;
    var col = danger ? 'rgba(255,90,90,0.9)' : 'rgba(120,235,255,0.55)';
    var g = 14, len = 9;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Уголки прицела.
    ctx.moveTo(cx - g, cy - g + len); ctx.lineTo(cx - g, cy - g); ctx.lineTo(cx - g + len, cy - g);
    ctx.moveTo(cx + g - len, cy - g); ctx.lineTo(cx + g, cy - g); ctx.lineTo(cx + g, cy - g + len);
    ctx.moveTo(cx - g, cy + g - len); ctx.lineTo(cx - g, cy + g); ctx.lineTo(cx - g + len, cy + g);
    ctx.moveTo(cx + g - len, cy + g); ctx.lineTo(cx + g, cy + g); ctx.lineTo(cx + g, cy + g - len);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  }

  // ----------------------------------------------------------------------
  // Кабина космолёта: корпус, остекление, приборная панель.
  // ----------------------------------------------------------------------
  function cockpitLayout() {
    var dashH = E.clamp(cssH * 0.2, 96, 200);
    var margin = Math.min(cssW, cssH) * 0.035;
    return {
      dashH: dashH,
      margin: margin,
      cx: margin,
      cy: margin,
      cw: cssW - margin * 2,
      ch: cssH - dashH - margin,
      cr: Math.min(cssW, cssH) * 0.07
    };
  }

  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function drawCockpit() {
    var L = cockpitLayout();

    // Блик на «стекле» — мягкая диагональная подсветка внутри остекления.
    ctx.save();
    ctx.beginPath();
    roundRectPath(L.cx, L.cy, L.cw, L.ch, L.cr);
    ctx.clip();
    var glass = ctx.createLinearGradient(L.cx, L.cy, L.cx + L.cw, L.cy + L.ch);
    glass.addColorStop(0, 'rgba(120, 180, 255, 0.05)');
    glass.addColorStop(0.4, 'rgba(120, 180, 255, 0)');
    ctx.fillStyle = glass;
    ctx.fillRect(L.cx, L.cy, L.cw, L.ch);
    ctx.restore();

    // Виньетка по краям остекления.
    ctx.save();
    ctx.beginPath();
    roundRectPath(L.cx, L.cy, L.cw, L.ch, L.cr);
    ctx.clip();
    var vg = ctx.createRadialGradient(
      view.centerX, view.centerY, Math.min(L.cw, L.ch) * 0.25,
      view.centerX, view.centerY, Math.max(L.cw, L.ch) * 0.62
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(L.cx, L.cy, L.cw, L.ch);
    ctx.restore();

    // Корпус: всё, что снаружи остекления (правило even-odd — «кольцо»).
    ctx.beginPath();
    ctx.rect(0, 0, cssW, cssH);
    roundRectPath(L.cx, L.cy, L.cw, L.ch, L.cr);
    var hull = ctx.createLinearGradient(0, 0, 0, cssH);
    hull.addColorStop(0, '#2b313d');
    hull.addColorStop(0.5, '#1b2029');
    hull.addColorStop(1, '#0d1016');
    ctx.fillStyle = hull;
    ctx.fill('evenodd');

    // Внутренняя фаска остекления (подсветка кромки + тень).
    ctx.beginPath();
    roundRectPath(L.cx, L.cy, L.cw, L.ch, L.cr);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(90, 110, 140, 0.55)';
    ctx.stroke();
    ctx.beginPath();
    roundRectPath(L.cx + 4, L.cy + 4, L.cw - 8, L.ch - 8, L.cr - 4);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.stroke();

    drawBolts(L);
    drawDashboard(L);
  }

  // Заклёпки по углам остекления.
  function drawBolts(L) {
    var pad = L.cr * 0.5;
    var pts = [
      [L.cx + pad, L.cy + pad],
      [L.cx + L.cw - pad, L.cy + pad],
      [L.cx + pad, L.cy + L.ch - pad],
      [L.cx + L.cw - pad, L.cy + L.ch - pad]
    ];
    for (var i = 0; i < pts.length; i++) {
      var bx = pts[i][0], by = pts[i][1];
      ctx.beginPath();
      ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#3a4250';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx - 1, by - 1, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(150,170,200,0.8)';
      ctx.fill();
    }
  }

  // Приборная панель снизу: консоль, индикаторы и показания HUD.
  function drawDashboard(L) {
    var top = cssH - L.dashH;

    var panel = ctx.createLinearGradient(0, top, 0, cssH);
    panel.addColorStop(0, '#232935');
    panel.addColorStop(0.12, '#161b24');
    panel.addColorStop(1, '#080b11');
    ctx.fillStyle = panel;
    ctx.fillRect(0, top, cssW, L.dashH);

    // Подсвеченная верхняя кромка панели.
    ctx.fillStyle = 'rgba(120, 200, 255, 0.25)';
    ctx.fillRect(0, top, cssW, 2);

    // Ряд индикаторов-лампочек.
    var lampY = top + 16;
    var lamps = 7;
    var step = 26;
    var startX = view.centerX - ((lamps - 1) * step) / 2;
    for (var i = 0; i < lamps; i++) {
      var blink = (Math.floor(state.time * 3) + i) % lamps === 0;
      var on = state.mode === 'playing';
      var color;
      if (state.lives <= 1 && on) {
        color = blink ? '#ff5a5a' : '#5a1f1f';
      } else {
        color = (on && blink) ? '#7ef0c0' : 'rgba(80, 130, 120, 0.6)';
      }
      ctx.beginPath();
      ctx.arc(startX + i * step, lampY, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      if (on) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Текстовый HUD на приборной панели: дистанция, скорость, прочность.
  function drawHUD() {
    if (state.mode !== 'playing') return;
    var L = cockpitLayout();
    var baseY = cssH - L.dashH;
    var fs = E.clamp(Math.min(cssW, cssH) * 0.03, 13, 22);
    var pad = Math.max(18, cssW * 0.04);

    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(110, 230, 255, 0.7)';
    ctx.shadowBlur = 8;

    // Слева — дистанция.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(150, 230, 255, 0.7)';
    ctx.font = (fs * 0.7) + 'px ' + HUD_FONT;
    ctx.fillText('ДИСТАНЦИЯ', pad, baseY + L.dashH * 0.55);
    ctx.fillStyle = '#aef3ff';
    ctx.font = 'bold ' + (fs * 1.25) + 'px ' + HUD_FONT;
    ctx.fillText(Math.floor(state.score) + ' КМ', pad, baseY + L.dashH * 0.85);

    // По центру — скорость.
    var speed = E.difficultyCurve(CONFIG.speedStart, CONFIG.speedEnd, state.time, CONFIG.ramp);
    var speedPct = (speed - CONFIG.speedStart) / (CONFIG.speedEnd - CONFIG.speedStart);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(150, 230, 255, 0.7)';
    ctx.font = (fs * 0.7) + 'px ' + HUD_FONT;
    ctx.fillText('СКОРОСТЬ', view.centerX, baseY + L.dashH * 0.55);
    ctx.shadowBlur = 0;
    var barW = Math.min(180, cssW * 0.2), barH = 8;
    var barX = view.centerX - barW / 2, barY = baseY + L.dashH * 0.68;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#7ef0c0';
    ctx.fillRect(barX, barY, barW * E.clamp(0.15 + speedPct * 0.85, 0, 1), barH);

    // Справа — прочность корпуса в виде иконок-кораблей.
    ctx.shadowColor = 'rgba(110, 230, 255, 0.7)';
    ctx.shadowBlur = 8;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(150, 230, 255, 0.7)';
    ctx.font = (fs * 0.7) + 'px ' + HUD_FONT;
    ctx.fillText('КОРПУС', cssW - pad, baseY + L.dashH * 0.55);
    ctx.shadowBlur = 0;
    var iconY = baseY + L.dashH * 0.8;
    for (var i = 0; i < CONFIG.lives; i++) {
      var alive = i < state.lives;
      drawShipIcon(cssW - pad - i * 26, iconY, alive);
    }
  }

  function drawShipIcon(x, y, alive) {
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x - 7, y + 6);
    ctx.lineTo(x, y + 2);
    ctx.lineTo(x + 7, y + 6);
    ctx.closePath();
    ctx.fillStyle = alive ? '#7ef0c0' : 'rgba(120,130,140,0.35)';
    ctx.fill();
  }

  var HUD_FONT = '"Consolas", "DejaVu Sans Mono", "Courier New", monospace';

  // ----------------------------------------------------------------------
  // Игровой цикл.
  // ----------------------------------------------------------------------
  var lastTime = 0;
  function loop(now) {
    if (!lastTime) lastTime = now;
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05; // защита от скачков (свёрнутая вкладка)

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ----------------------------------------------------------------------
  // Сохранение лучшего результата.
  // ----------------------------------------------------------------------
  function loadBest() {
    try { return parseInt(localStorage.getItem('cosmo-best') || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('cosmo-best', String(v)); } catch (e) { /* нет доступа */ }
  }

  // Зерно RNG из времени (без Math.random — детерминированно в рамках кадра).
  function seedFromTime() {
    return (Date.now() & 0x7fffffff) || 12345;
  }

  // ----------------------------------------------------------------------
  // Инициализация.
  // ----------------------------------------------------------------------
  function init() {
    state = createState();
    setupCanvas();
    setupInput();
    initStars();
    showOverlay('start');

    // Лучший результат на стартовом экране.
    var sb = document.getElementById('start-best');
    if (sb) sb.textContent = state.best;

    requestAnimationFrame(loop);

    // Небольшой хук для автоматических тестов (Playwright/консоль).
    window.CosmoGame = {
      start: startGame,
      getState: function () { return state; },
      setKey: function (name, v) { if (name in keys) keys[name] = !!v; },
      config: CONFIG
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
