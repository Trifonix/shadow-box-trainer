(function () {
  'use strict';

  const PHASES = [
    { type: 'work', title: 'Скакалка', hint: 'Прыжки на месте, если нет скакалки', exercise: 'jumprope' },
    { type: 'rest', title: 'Отдых', hint: 'Восстанови дыхание, пей воду', exercise: 'rest' },
    { type: 'work', title: 'Бой с тенью', hint: 'Удары, уклоны, работа ногами', exercise: 'shadowbox' },
    { type: 'rest', title: 'Отдых', hint: 'Готовься к следующему раунду', exercise: 'rest' },
    { type: 'work', title: 'Отжимания', hint: 'Ровная спина, контролируй темп', exercise: 'pushups' },
    { type: 'rest', title: 'Отдых', hint: 'Расслабь плечи и руки', exercise: 'rest' },
    { type: 'work', title: 'Приседания', hint: 'Колени не выходят за носки', exercise: 'squats' },
  ];

  const WORKOUTS = {
    normal: { work: 600, rest: 120, label: 'Самостоятельная тренировка · 46 минут' },
    test: { work: 10, rest: 2, label: 'Тестовый режим · 10 с / 2 с' },
  };

  const CIRCUMFERENCE = 2 * Math.PI * 90;
  const GROUND_RATIO = 0.84;

  const $ = (id) => document.getElementById(id);

  const els = {
    progressTrack: $('progressTrack'),
    phaseCard: $('phaseCard'),
    phaseTitle: $('phaseTitle'),
    phaseHint: $('phaseHint'),
    timerValue: $('timerValue'),
    timerProgress: $('timerProgress'),
    canvas: $('exerciseCanvas'),
    btnStart: $('btnStart'),
    btnTestStart: $('btnTestStart'),
    btnPause: $('btnPause'),
    controlsIdle: $('controlsIdle'),
    controlsActive: $('controlsActive'),
    completeOverlay: $('completeOverlay'),
    btnRestart: $('btnRestart'),
  };

  const ctx = els.canvas.getContext('2d');

  let workout = [];
  let mode = 'normal';

  let state = {
    phaseIndex: 0,
    remaining: 0,
    totalInPhase: 0,
    running: false,
    paused: false,
    tickId: null,
    lastTick: 0,
    animFrame: null,
  };

  let scene = { w: 400, h: 240, ground: 210 };
  let audioCtx = null;

  function buildWorkout(kind) {
    const cfg = WORKOUTS[kind];
    return PHASES.map((p) => ({
      ...p,
      duration: p.type === 'work' ? cfg.work : cfg.rest,
    }));
  }

  function setMode(kind) {
    mode = kind;
    workout = buildWorkout(kind);
    initProgressBar();
  }

  function initProgressBar() {
    els.progressTrack.innerHTML = '';
    workout.forEach((phase, i) => {
      const seg = document.createElement('div');
      seg.className = 'progress-segment';
      seg.dataset.index = i;
      seg.title = phase.title;
      els.progressTrack.appendChild(seg);
    });
  }

  function resizeCanvas() {
    const rect = els.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (els.canvas.width !== w || els.canvas.height !== h) {
      els.canvas.width = w;
      els.canvas.height = h;
    }
    scene.w = w;
    scene.h = h;
    scene.ground = h * GROUND_RATIO;
    if (!state.running) drawIdle();
  }

  function updateProgressBar() {
    const segments = els.progressTrack.querySelectorAll('.progress-segment');
    segments.forEach((seg, i) => {
      seg.classList.remove('active', 'rest', 'done');
      if (i < state.phaseIndex) seg.classList.add('done');
      else if (i === state.phaseIndex) {
        seg.classList.add('active');
        if (workout[i].type === 'rest') seg.classList.add('rest');
      }
    });
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function updateTimerRing() {
    const progress = state.totalInPhase > 0 ? state.remaining / state.totalInPhase : 0;
    els.timerProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
  }

  function updateUI() {
    const phase = workout[state.phaseIndex];
    if (!phase) return;

    const isRest = phase.type === 'rest';
    els.phaseCard.className = 'phase-card ' + (isRest ? 'rest' : 'work');
    els.phaseTitle.textContent = phase.title;
    els.phaseHint.textContent = phase.hint;
    els.timerValue.textContent = formatTime(state.remaining);
    els.timerProgress.classList.toggle('rest', isRest);

    const modeTag = mode === 'test' ? ' · тест' : '';

    updateTimerRing();
    updateProgressBar();
  }

  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, duration, type = 'sine', volume = 0.3) {
    try {
      const ac = getAudio();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + duration);
    } catch (_) { /* audio unavailable */ }
  }

  function playPhaseStart() {
    playTone(523, 0.15);
    setTimeout(() => playTone(659, 0.15), 150);
    setTimeout(() => playTone(784, 0.25), 300);
  }

  function playRestStart() {
    playTone(392, 0.3, 'triangle', 0.25);
    setTimeout(() => playTone(330, 0.4, 'triangle', 0.2), 200);
  }

  function playCountdownBeep() {
    playTone(880, 0.1, 'square', 0.15);
  }

  function playComplete() {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => playTone(f, 0.3, 'sine', 0.25), i * 150);
    });
  }

  function showIdleControls() {
    els.controlsIdle.classList.remove('hidden');
    els.controlsActive.classList.add('hidden');
  }

  function showActiveControls() {
    els.controlsIdle.classList.add('hidden');
    els.controlsActive.classList.remove('hidden');
  }

  function startPhase(index) {
    if (index >= workout.length) {
      finishWorkout();
      return;
    }

    const phase = workout[index];
    state.phaseIndex = index;
    state.remaining = phase.duration;
    state.totalInPhase = phase.duration;

    if (phase.type === 'rest') playRestStart();
    else playPhaseStart();

    updateUI();
  }

  function nextPhase() {
    startPhase(state.phaseIndex + 1);
  }

  function finishWorkout() {
    stopTimer();
    state.running = false;
    showIdleControls();
    playComplete();
    els.completeOverlay.classList.remove('hidden');
  }

  function tick(now) {
    if (!state.running || state.paused) return;

    if (!state.lastTick) state.lastTick = now;
    const elapsed = now - state.lastTick;

    if (elapsed >= 1000) {
      state.lastTick = now - (elapsed % 1000);
      state.remaining--;

      if (state.remaining <= 3 && state.remaining > 0) playCountdownBeep();

      if (state.remaining <= 0) {
        nextPhase();
        if (state.phaseIndex >= workout.length) return;
      }

      updateUI();
    }

    state.tickId = requestAnimationFrame(tick);
  }

  function startTimer() {
    state.lastTick = 0;
    state.tickId = requestAnimationFrame(tick);
  }

  function stopTimer() {
    if (state.tickId) {
      cancelAnimationFrame(state.tickId);
      state.tickId = null;
    }
  }

  function startWorkout(isTest) {
    if (!state.running) {
      setMode(isTest ? 'test' : 'normal');
      startPhase(0);
    }

    getAudio().resume();
    state.running = true;
    state.paused = false;
    showActiveControls();
    els.btnPause.textContent = 'ПАУЗА';
    els.btnPause.classList.remove('paused');
    els.completeOverlay.classList.add('hidden');

    startTimer();
    startAnimation();
    updateUI();
  }

  function togglePause() {
    state.paused = !state.paused;
    if (state.paused) {
      stopTimer();
      els.btnPause.textContent = 'ПРОДОЛЖИТЬ';
      els.btnPause.classList.add('paused');
    } else {
      state.lastTick = 0;
      startTimer();
      startAnimation();
      els.btnPause.textContent = 'ПАУЗА';
      els.btnPause.classList.remove('paused');
    }
    updateUI();
  }

  function resetWorkout() {
    stopTimer();
    stopAnimation();
    setMode('normal');
    state = {
      phaseIndex: 0,
      remaining: workout[0].duration,
      totalInPhase: workout[0].duration,
      running: false,
      paused: false,
      tickId: null,
      lastTick: 0,
      animFrame: null,
    };
    showIdleControls();
    els.completeOverlay.classList.add('hidden');
    els.phaseTitle.textContent = 'Нажми СТАРТ';
    els.phaseHint.textContent = 'скакалка → тень → отжимания → приседания';
    els.phaseCard.className = 'phase-card';
    updateUI();
    drawIdle();
  }

  /* ── Figure renderer: angle 0 = вверх, по часовой ── */

  const BODY = {
    torso: 46,
    neck: 9,
    head: 13,
    shoulderW: 11,
    upperArm: 25,
    forearm: 23,
    thigh: 38,
    shin: 36,
    footSpread: 15,
  };

  function figureScale() {
    const usable = scene.ground - scene.h * 0.11;
    const naturalH = BODY.thigh + BODY.shin + BODY.torso + BODY.neck + BODY.head * 2;
    return (usable * 0.8) / naturalH;
  }

  function len(part) {
    return BODY[part] * figureScale();
  }

  function lineW() {
    return Math.max(2.5, 3.2 * figureScale());
  }

  /** Точка на расстоянии len от (x,y) под углом angle (0 = вверх) */
  function joint(from, length, angle) {
    return {
      x: from.x + Math.sin(angle) * length,
      y: from.y - Math.cos(angle) * length,
    };
  }

  function strokeSeg(a, b, w) {
    ctx.lineWidth = w ?? lineW();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  /**
   * Фигура анфас: ноги от пола вверх, углы абсолютные (0 = вверх).
   */
  function drawPerson(opts) {
    const {
      cx,
      groundY,
      jump = 0,
      torso = 0,
      head = 0,
      lua = 3.15,
      lla = 3.3,
      rua = 0.2,
      rla = 0.35,
      lsh = 0.32,
      lth = -0.12,
      rsh = -0.32,
      rth = 0.12,
    } = opts;

    const gy = (groundY ?? scene.ground) - jump;
    const spread = len('footSpread');

    const lFoot = { x: cx - spread, y: gy };
    const rFoot = { x: cx + spread, y: gy };
    const lKnee = joint(lFoot, len('shin'), lsh);
    const rKnee = joint(rFoot, len('shin'), rsh);
    const lHipPt = joint(lKnee, len('thigh'), lth);
    const rHipPt = joint(rKnee, len('thigh'), rth);
    const hip = { x: cx, y: (lHipPt.y + rHipPt.y) / 2 };

    const shoulder = joint(hip, len('torso'), torso);
    const neck = joint(shoulder, len('neck'), torso + head);
    const headC = joint(neck, len('head'), torso + head);

    const lSh = { x: shoulder.x - len('shoulderW'), y: shoulder.y };
    const rSh = { x: shoulder.x + len('shoulderW'), y: shoulder.y };

    const lElbow = joint(lSh, len('upperArm'), lua);
    const rElbow = joint(rSh, len('upperArm'), rua);
    const lHand = joint(lElbow, len('forearm'), lla);
    const rHand = joint(rElbow, len('forearm'), rla);

    ctx.strokeStyle = '#f1f1f4';
    ctx.fillStyle = '#f1f1f4';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const w = lineW();
    strokeSeg(hip, shoulder, w);
    strokeSeg(lSh, rSh, w * 0.85);
    strokeSeg(lSh, lElbow, w);
    strokeSeg(lElbow, lHand, w);
    strokeSeg(rSh, rElbow, w);
    strokeSeg(rElbow, rHand, w);
    strokeSeg(hip, lKnee, w);
    strokeSeg(lKnee, lFoot, w);
    strokeSeg(hip, rKnee, w);
    strokeSeg(rKnee, rFoot, w);

    ctx.beginPath();
    ctx.arc(headC.x, headC.y, len('head'), 0, Math.PI * 2);
    ctx.stroke();

    return { lHand, rHand, lFoot, rFoot, hip, shoulder, headC };
  }

  function clearCanvas() {
    ctx.fillStyle = '#14141f';
    ctx.fillRect(0, 0, scene.w, scene.h);
  }

  function drawGround() {
    const g = scene.ground;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(scene.w * 0.08, g);
    ctx.lineTo(scene.w * 0.92, g);
    ctx.stroke();
    return g;
  }

  function drawLabel(text, color = '#8b8b9e') {
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.max(11, scene.h * 0.048)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(text, scene.w / 2, scene.ground + scene.h * 0.042);
  }

  function easeJump(x) {
    return x <= 0 ? 0 : Math.sin(x * Math.PI);
  }

  function animateJumpRope(t) {
    clearCanvas();
    const ground = drawGround();
    const cx = scene.w / 2;
    const s = figureScale();

    // Скорость вращения скакалки
    const phase = (t * 0.007) % (Math.PI * 2);

    // Положение скакалки по вертикали: 1 = в самом низу, -1 = в самом верху
    const ropeAtBottom = Math.cos(phase);

    // Прыжок: максимален (1), когда скакалка находится ровно под ногами
    const jumpFactor = Math.max(0, (ropeAtBottom - 0.4) / 0.6);
    const jump = jumpFactor * 32 * s;

    // Динамика ног: пружинят при приземлении, выпрямляются в высшей точке прыжка
    const legBend = 1 - jumpFactor;
    const lshVal = 0.1 + legBend * 0.15;
    const lthVal = -0.05 - legBend * 0.1;
    const rshVal = -0.1 - legBend * 0.15;
    const rthVal = 0.05 + legBend * 0.1;

    // Небольшое раскачивание рук кистями в такт вращению
    const armSway = Math.sin(phase) * 0.08;

    const fig = drawPerson({
        cx,
        groundY: ground,
        jump,
        torso: 0.02 + legBend * 0.04, // Легкий наклон корпуса вперед при приземлении
        head: -0.02,
        // Естественное положение рук для удержания скакалки (вниз и слегка в стороны)
        lua: 3.44 + armSway,
        lla: 3.64 + armSway,
        rua: 2.84 - armSway,
        rla: 2.64 - armSway,
        lsh: lshVal,
        lth: lthVal,
        rsh: rshVal,
        rth: rthVal,
    });

    // Отрисовка самой скакалки
    // arcY двигается от положения высоко над головой до положения чуть ниже стоп
    const arcY = ground - 110 * s + ropeAtBottom * 140 * s;
    
    // Псевдо-3D: определяем, где сейчас скакалка — перед персонажем или за его спиной
    const isBehind = Math.sin(phase) > 0; 

    // Делаем скакалку темнее и тоньше, когда она уходит на задний план
    ctx.strokeStyle = isBehind ? '#8b222f' : '#e63946';
    ctx.lineWidth = Math.max(1.5, (isBehind ? 2 : 3) * s);

    ctx.beginPath();
    ctx.moveTo(fig.lHand.x, fig.lHand.y);

    // Используем кубическую кривую Безье (вместо квадратичной) 
    // для создания реалистичной округлой формы петли
    const spreadX = 45 * s;
    ctx.bezierCurveTo(
        cx - spreadX, arcY,
        cx + spreadX, arcY,
        fig.rHand.x, fig.rHand.y
    );
    ctx.stroke();

  }

  function animateShadowBox(t) {
    clearCanvas();
    const ground = drawGround();
    const cx = scene.w / 2;
    const s = figureScale();

    const cycle = Math.sin(t * 0.005);
    const punchL = Math.max(0, cycle);
    const punchR = Math.max(0, -cycle);
    const sway = Math.sin(t * 0.003) * 0.05;
    const step = Math.sin(t * 0.004) * 0.08;

    const guard = { lua: 1.15, lla: 0.85, rua: 1.95, rla: 2.25 };
    let arms = { ...guard };

    if (punchL > 0.15) {
      const e = (punchL - 0.15) / 0.85;
      arms = {
        lua: 4.5 - 0.25 * (1 - e),
        lla: 4.35 - 0.2 * (1 - e),
        rua: 1.95,
        rla: 2.15,
      };
    } else if (punchR > 0.15) {
      const e = (punchR - 0.15) / 0.85;
      arms = {
        lua: 1.15,
        lla: 0.85,
        rua: 0.4 + 0.25 * (1 - e),
        rla: 0.55 + 0.2 * (1 - e),
      };
    }

    const fig = drawPerson({
      cx,
      groundY: ground,
      torso: sway + (punchL > punchR ? -0.08 * punchL : 0.08 * punchR),
      head: sway * 0.4,
      ...arms,
      lsh: 0.32 + step,
      lth: -0.12,
      rsh: -0.32 - step,
      rth: 0.12,
    });

    const active = punchL > punchR ? punchL : punchR;
    if (active > 0.5) {
      const side = punchL > punchR ? -1 : 1;
      const hx = fig.shoulder.x + side * len('upperArm') * 1.6;
      const hy = fig.shoulder.y - len('torso') * 0.15;
      ctx.fillStyle = `rgba(230, 57, 70, ${0.2 + active * 0.35})`;
      ctx.beginPath();
      ctx.arc(hx, hy, (8 + active * 12) * s, 0, Math.PI * 2);
      ctx.fill();
    }

  }

  function animatePushups(t) {
    clearCanvas();
    const ground = drawGround();
    const cx = scene.w / 2;
    const s = figureScale();
    const down = (Math.sin(t * 0.0045) + 1) / 2;

    const boardY = ground - s * 8;
    const bodyLift = down * s * 28;
    const angle = -0.55 - down * 0.32;

    ctx.save();
    ctx.translate(cx, boardY - bodyLift);
    ctx.rotate(angle);
    ctx.scale(s, s);

    const hip = { x: 0, y: 0 };
    const shoulder = { x: 42, y: -2 };
    const headPt = { x: 56, y: -6 };
    const lHand = { x: 34, y: 20 };
    const rHand = { x: 14, y: 22 };
    const lKnee = { x: -30, y: 4 };
    const rKnee = { x: -20, y: 6 };
    const lFoot = { x: -46, y: 16 };
    const rFoot = { x: -36, y: 18 };

    ctx.strokeStyle = '#f1f1f4';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    strokeSeg(hip, shoulder, 3);
    strokeSeg(shoulder, headPt, 2.5);
    strokeSeg(shoulder, lHand, 3);
    strokeSeg(shoulder, rHand, 3);
    strokeSeg(hip, lKnee, 3);
    strokeSeg(lKnee, lFoot, 3);
    strokeSeg(hip, rKnee, 3);
    strokeSeg(rKnee, rFoot, 3);
    ctx.beginPath();
    ctx.arc(headPt.x + 6, headPt.y, 11, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function animateSquats(t) {
    clearCanvas();
    const ground = drawGround();
    const cx = scene.w / 2;
    const depth = (Math.sin(t * 0.0035) + 1) / 2;
    const d = depth * depth;

    drawPerson({
      cx,
      groundY: ground,
      torso: 0.08 + d * 0.35,
      head: -0.04 - d * 0.08,
      lua: 1.35 + d * 0.45,
      lla: 1.05 + d * 0.35,
      rua: 1.8 - d * 0.45,
      rla: 2.1 - d * 0.35,
      lsh: 0.55 + d * 0.55,
      lth: 0.35 + d * 0.45,
      rsh: -0.55 - d * 0.55,
      rth: -0.35 - d * 0.45,
    });

  }

  function animateRest(t) {
    clearCanvas();
    const ground = drawGround();
    const cx = scene.w / 2;
    const s = figureScale();
    const breath = Math.sin(t * 0.002);
    const figCenterY = ground - len('thigh') - len('shin') - len('torso') * 0.45;

    ctx.strokeStyle = '#4cc9f0';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.18 + (breath + 1) * 0.1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, figCenterY, len('torso') * (0.9 + i * 0.45) + breath * s * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    drawPerson({
      cx,
      groundY: ground,
      torso: breath * 0.04,
      lua: 3.1,
      lla: 3.25,
      rua: 0.25,
      rla: 0.4,
    });

  }

  function drawIdle() {
    clearCanvas();
    const ground = drawGround();
    drawPerson({ cx: scene.w / 2, groundY: ground });
  }

  const animators = {
    jumprope: animateJumpRope,
    shadowbox: animateShadowBox,
    pushups: animatePushups,
    squats: animateSquats,
    rest: animateRest,
  };

  function animationLoop(now) {
    if (!state.running || state.paused) return;
    const phase = workout[state.phaseIndex];
    const fn = phase ? animators[phase.exercise] : drawIdle;
    if (fn) fn(now);
    state.animFrame = requestAnimationFrame(animationLoop);
  }

  function startAnimation() {
    stopAnimation();
    state.animFrame = requestAnimationFrame(animationLoop);
  }

  function stopAnimation() {
    if (state.animFrame) {
      cancelAnimationFrame(state.animFrame);
      state.animFrame = null;
    }
  }

  function init() {
    setMode('normal');
    state.remaining = workout[0].duration;
    state.totalInPhase = workout[0].duration;
    resizeCanvas();
    updateUI();
    drawIdle();

    els.btnStart.addEventListener('click', () => startWorkout(false));
    els.btnTestStart.addEventListener('click', () => startWorkout(true));
    els.btnPause.addEventListener('click', togglePause);
    els.btnRestart.addEventListener('click', resetWorkout);

    window.addEventListener('resize', resizeCanvas);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', resizeCanvas);
    }
  }

  init();
})();
