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

  let sbState = { lastT: 0, combo: [], actionIdx: 0, actionTime: 0, bobbing: 0 };
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
      sbState.lastT = 0;
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
    sbState = { lastT: 0, combo: [], actionIdx: 0, actionTime: 0, bobbing: 0 };
    showIdleControls();
    els.completeOverlay.classList.add('hidden');
    els.phaseTitle.textContent = 'Нажми СТАРТ';
    els.phaseHint.textContent = 'скакалка → тень → отжимания → приседания';
    els.phaseCard.className = 'phase-card';
    updateUI();
    drawIdle();
  }

  /* ── Figure renderer ── */
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

  function drawPerson(opts) {
    const {
      cx,
      groundY,
      jump = 0,
      torso = 0,
      head = 0,
      lua = Math.PI,
      lla = Math.PI,
      rua = Math.PI,
      rla = Math.PI,
      lsh = 0,
      lth = 0,
      rsh = 0,
      rth = 0,
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

  function animateJumpRope(t) {
    clearCanvas();
    const ground = drawGround();
    const cx = scene.w / 2;
    const s = figureScale();

    const phase = (t * 0.007) % (Math.PI * 2);
    const ropeAtBottom = Math.cos(phase);
    const jumpFactor = Math.max(0, (ropeAtBottom - 0.4) / 0.6);
    const jump = jumpFactor * 32 * s;

    const legBend = 1 - jumpFactor;
    const lshVal = 0.1 + legBend * 0.15;
    const lthVal = -0.05 - legBend * 0.1;
    const rshVal = -0.1 - legBend * 0.15;
    const rthVal = 0.05 + legBend * 0.1;

    const armSway = Math.sin(phase) * 0.08;

    const fig = drawPerson({
      cx,
      groundY: ground,
      jump,
      torso: 0.02 + legBend * 0.04,
      head: -0.02,
      lua: 3.44 + armSway,
      lla: 3.64 + armSway,
      rua: 2.84 - armSway,
      rla: 2.64 - armSway,
      lsh: lshVal,
      lth: lthVal,
      rsh: rshVal,
      rth: rthVal,
    });

    const arcY = ground - 110 * s + ropeAtBottom * 140 * s;
    const isBehind = Math.sin(phase) > 0;
    ctx.strokeStyle = isBehind ? '#8b222f' : '#e63946';
    ctx.lineWidth = Math.max(1.5, (isBehind ? 2 : 3) * s);
    ctx.beginPath();
    ctx.moveTo(fig.lHand.x, fig.lHand.y);
    const spreadX = 45 * s;
    ctx.bezierCurveTo(cx - spreadX, arcY, cx + spreadX, arcY, fig.rHand.x, fig.rHand.y);
    ctx.stroke();
  }

  function animateShadowBox(t) {
    clearCanvas();
    const ground = drawGround();
    const cx = scene.w / 2;
    const s = figureScale();

    if (!sbState.lastT) sbState.lastT = t;
    let dt = t - sbState.lastT;
    sbState.lastT = t;
    if (dt > 100) dt = 16;

    sbState.bobbing += dt * 0.005;

    const BOXING_COMBOS = [
      ['L', 'R'],
      ['L', 'L', 'R'],
      ['L', 'D', 'R'],
      ['L', 'L', 'D', 'R']
    ];

    if (!sbState.combo || sbState.combo.length === 0 || sbState.actionIdx >= sbState.combo.length) {
      const randomCombo = BOXING_COMBOS[Math.floor(Math.random() * BOXING_COMBOS.length)];
      sbState.combo = [...randomCombo, 'P'];
      sbState.actionIdx = 0;
      sbState.actionTime = 0;
    }

    let currentAction = sbState.combo[sbState.actionIdx];
    sbState.actionTime += dt;

    let duration = 320; 
    if (currentAction === 'D') duration = 500;
    if (currentAction === 'P') duration = 850;

    if (sbState.actionTime >= duration) {
      sbState.actionIdx++;
      sbState.actionTime = 0;
      if (sbState.actionIdx >= sbState.combo.length) {
        currentAction = 'P';
        duration = 850;
      } else {
        currentAction = sbState.combo[sbState.actionIdx];
      }
    }

    let progress = sbState.actionTime / duration;
    if (progress > 1) progress = 1;

    let lua = 1.15, lla = 0.85;
    let rua = 1.95, rla = 2.25;

    let torso = Math.sin(sbState.bobbing) * 0.04;
    let head = Math.cos(sbState.bobbing) * 0.03;
    let jump = Math.abs(Math.sin(sbState.bobbing * 1.5)) * 4 * s;

    let lsh = 0.32, lth = -0.12, rsh = -0.32, rth = 0.12;

    let punchE = 0;
    if (progress < 0.3) {
      punchE = progress / 0.3;
    } else {
      punchE = 1 - (progress - 0.3) / 0.7;
    }

    if (currentAction === 'L') {
      lua = lua + (1.4 - lua) * punchE;
      lla = lla + (1.5 - lla) * punchE;
      torso -= 0.14 * punchE; 
      head += 0.04 * punchE;
    } else if (currentAction === 'R') {
      rua = rua + (0.4 - rua) * punchE;
      rla = rla + (0.55 - rla) * punchE;
      torso += 0.18 * punchE; 
      head -= 0.04 * punchE;
    } else if (currentAction === 'D') {
      let duckFactor = Math.sin(progress * Math.PI);
      jump -= duckFactor * 16 * s;
      torso += Math.sin(progress * Math.PI * 2) * 0.12;
      lsh += duckFactor * 0.22;
      rsh -= duckFactor * 0.22;
    }

    const fig = drawPerson({ cx, groundY: ground, jump, torso, head, lua, lla, rua, rla, lsh, lth, rsh, rth });

    if ((currentAction === 'L' || currentAction === 'R') && progress > 0.18 && progress < 0.45) {
      const glove = currentAction === 'L' ? fig.lHand : fig.rHand;
      const intensity = Math.sin((progress - 0.18) / 0.27 * Math.PI);
      ctx.fillStyle = `rgba(230, 57, 70, ${0.2 + intensity * 0.45})`;
      ctx.beginPath();
      ctx.arc(glove.x, glove.y, (8 + intensity * 14) * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function animatePushups(t) {
    clearCanvas();
    const ground = drawGround();
    const cx = scene.w / 2;
    const s = figureScale();

    // Колебание фазы: 0 = верхняя точка, 1 = грудь у пола
    const down = (Math.sin(t * 0.0045) + 1) / 2;
    const theta = 0.24 - down * 0.19; // Динамический наклон тела

    const totalLen = len('shin') + len('thigh') + len('torso');
    const footX = cx - totalLen * 0.45;

    // Стопы стабильно уперты в землю
    const lFoot = { x: footX, y: ground };
    const rFoot = { x: footX + 4 * s, y: ground - 1 * s };

    const shoulderL = {
      x: lFoot.x + Math.cos(theta) * totalLen,
      y: lFoot.y - Math.sin(theta) * totalLen
    };
    const shoulderR = { x: shoulderL.x + 5 * s, y: shoulderL.y - 2 * s };

    const hipRatio = (len('shin') + len('thigh')) / totalLen;
    const kneeRatio = len('shin') / totalLen;

    const lHip = { x: lFoot.x + (shoulderL.x - lFoot.x) * hipRatio, y: lFoot.y + (shoulderL.y - lFoot.y) * hipRatio };
    const rHip = { x: rFoot.x + (shoulderR.x - rFoot.x) * hipRatio, y: rFoot.y + (shoulderR.y - rFoot.y) * hipRatio };

    const lKnee = { x: lFoot.x + (shoulderL.x - lFoot.x) * kneeRatio, y: lFoot.y + (shoulderL.y - lFoot.y) * kneeRatio };
    const rKnee = { x: rFoot.x + (shoulderR.x - rFoot.x) * kneeRatio, y: rFoot.y + (shoulderR.y - rFoot.y) * kneeRatio };

    const headLen = len('neck') + len('head');
    const headC = {
      x: shoulderL.x + Math.cos(theta) * headLen,
      y: shoulderL.y - Math.sin(theta) * headLen
    };

    // Опорные точки ладоней строго зафиксированы на линии пола
    const handX = lFoot.x + Math.cos(0.05) * totalLen + 1 * s;
    const lHand = { x: handX, y: ground };
    const rHand = { x: handX + 7 * s, y: ground };

    // Локти сгибаются назад и вверх в зависимости от фазы опускания
    const lElbow = {
      x: shoulderL.x - len('upperArm') * (0.2 + 0.45 * down),
      y: shoulderL.y + len('upperArm') * (0.8 - 0.25 * down)
    };
    const rElbow = {
      x: shoulderR.x - len('upperArm') * (0.2 + 0.45 * down),
      y: shoulderR.y + len('upperArm') * (0.8 - 0.25 * down)
    };

    ctx.strokeStyle = '#f1f1f4';
    ctx.fillStyle = '#f1f1f4';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const w = lineW();

    // Рендеринг дальней стороны (правые конечности)
    strokeSeg(rHip, shoulderR, w * 0.85);
    strokeSeg(shoulderR, rElbow, w * 0.85);
    strokeSeg(rElbow, rHand, w * 0.85);
    strokeSeg(rHip, rKnee, w * 0.85);
    strokeSeg(rKnee, rFoot, w * 0.85);

    // Рендеринг ближней стороны (левые конечности и осевая линия)
    strokeSeg(lHip, shoulderL, w);
    strokeSeg(shoulderL, lElbow, w);
    strokeSeg(lElbow, lHand, w);
    strokeSeg(lHip, lKnee, w);
    strokeSeg(lKnee, lFoot, w);

    // Голова
    ctx.beginPath();
    ctx.arc(headC.x, headC.y, len('head'), 0, Math.PI * 2);
    ctx.stroke();
  }

  function animateSquats(t) {
    clearCanvas();
    const ground = drawGround();
    const cx = scene.w / 2;

    const depth = (Math.sin(t * 0.0035) + 1) / 2; 
    const d = depth * depth; // Нелинейное сглаживание в нижней точке

    // Колени разводятся в стороны (влево/вправо), таз опускается строго по вертикали
    const lshVal = -0.05 - d * 0.95; 
    const lthVal = 0.05 + d * 0.95;  
    const rshVal = 0.05 + d * 0.95;  
    const rthVal = -0.05 - d * 0.95; 

    // Руки поднимаются вперед-вверх для удержания баланса
    const luaVal = Math.PI - d * 1.75; 
    const llaVal = Math.PI - d * 1.85; 
    const ruaVal = Math.PI + d * 1.75; 
    const rlaVal = Math.PI + d * 1.85; 

    // Естественный небольшой наклон корпуса и головы вперед при седе
    const torsoVal = d * 0.06;
    const headVal = -d * 0.03;

    drawPerson({
      cx,
      groundY: ground,
      torso: torsoVal,
      head: headVal,
      lua: luaVal,
      lla: llaVal,
      rua: ruaVal,
      rla: rlaVal,
      lsh: lshVal,
      lth: lthVal,
      rsh: rshVal,
      rth: rthVal,
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
      rua: 3.2,
      rla: 3.1,
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
