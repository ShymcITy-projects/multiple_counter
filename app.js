(() => {
  const STORAGE_KEY = 'counterPwaState';
  const CIRCUMFERENCE = 2 * Math.PI * 90;
  const BEAD_COUNT = 11;

  const el = {
    tapButtonEl: document.querySelector('.tap-button'),
    tapSurface: document.getElementById('tapSurface'),
    countValue: document.getElementById('countValue'),
    targetLabel: document.getElementById('targetLabel'),
    ringProgress: document.getElementById('ringProgress'),
    beadsGroup: document.getElementById('beads'),
    nameInput: document.getElementById('nameInput'),
    startInput: document.getElementById('startInput'),
    targetInput: document.getElementById('targetInput'),
    resetBtn: document.getElementById('resetBtn'),
    muteBtn: document.getElementById('muteBtn'),
    muteIconOn: document.getElementById('muteIconOn'),
    muteIconOff: document.getElementById('muteIconOff'),
    reachedBanner: document.getElementById('reachedBanner'),
    keepGoingBtn: document.getElementById('keepGoingBtn'),
    flashOverlay: document.getElementById('flashOverlay'),
    resetConfirm: document.getElementById('resetConfirm'),
    resetConfirmTitle: document.getElementById('resetConfirmTitle'),
    resetConfirmSub: document.getElementById('resetConfirmSub'),
    resetCancelBtn: document.getElementById('resetCancelBtn'),
    resetConfirmBtn: document.getElementById('resetConfirmBtn'),
    todayStat: document.getElementById('todayStat'),
    yesterdayStat: document.getElementById('yesterdayStat'),
    resetTodayBtn: document.getElementById('resetTodayBtn'),
  };

  let state = loadState();
  let audioCtx = null;
  let pendingConfirmAction = null;

  function getAudioContext() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
  }

  // Unlock/create the audio context on the very first tap anywhere in the app.
  // iOS Safari only allows audio to start inside a direct user-gesture handler,
  // so creating it lazily on first interaction (rather than only when a target
  // is reached) makes sure it's ready and un-suspended by the time it's needed.
  document.addEventListener('pointerdown', function unlockAudio() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    document.removeEventListener('pointerdown', unlockAudio);
  }, { once: true });

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const daily = parsed.daily && typeof parsed.daily === 'object'
          ? {
              date: typeof parsed.daily.date === 'string' ? parsed.daily.date : todayKey(),
              today: Number.isFinite(parsed.daily.today) ? parsed.daily.today : 0,
              yesterday: Number.isFinite(parsed.daily.yesterday) ? parsed.daily.yesterday : 0,
            }
          : { date: todayKey(), today: 0, yesterday: 0 };
        return {
          name: typeof parsed.name === 'string' ? parsed.name : '',
          count: Number.isFinite(parsed.count) ? parsed.count : 0,
          target: Number.isFinite(parsed.target) ? parsed.target : null,
          dismissedReached: !!parsed.dismissedReached,
          muted: !!parsed.muted,
          daily,
        };
      }
    } catch (e) { /* ignore corrupt state */ }
    return { name: '', count: 0, target: null, dismissedReached: false, muted: false, daily: { date: todayKey(), today: 0, yesterday: 0 } };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // Roll the today/yesterday tally forward if the calendar date has changed
  // since the state was last saved (e.g. the app was opened the next day).
  function rolloverDailyIfNeeded() {
    const key = todayKey();
    if (state.daily.date === key) return;
    const prev = new Date(state.daily.date + 'T00:00:00');
    const cur = new Date(key + 'T00:00:00');
    const diffDays = Math.round((cur - prev) / 86400000);
    state.daily = diffDays === 1
      ? { date: key, today: 0, yesterday: state.daily.today }
      : { date: key, today: 0, yesterday: 0 };
    saveState();
  }

  function buildBeads() {
    el.beadsGroup.innerHTML = '';
    for (let i = 0; i < BEAD_COUNT; i++) {
      const angle = -Math.PI / 2 + i * (2 * Math.PI / BEAD_COUNT);
      const x = 100 + 90 * Math.cos(angle);
      const y = 100 + 90 * Math.sin(angle);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x.toFixed(2));
      circle.setAttribute('cy', y.toFixed(2));
      circle.setAttribute('r', '5');
      circle.classList.add('bead');
      el.beadsGroup.appendChild(circle);
    }
  }

  function render() {
    el.countValue.textContent = state.count;
    el.nameInput.value = state.name;
    el.targetInput.value = state.target ?? '';
    if (document.activeElement !== el.startInput) {
      el.startInput.value = state.count;
    }
    el.todayStat.textContent = state.daily.today;
    el.yesterdayStat.textContent = state.daily.yesterday;

    const hasTarget = !!state.target && state.target > 0;
    const reached = hasTarget && state.count >= state.target;

    if (hasTarget) {
      const pct = Math.min(state.count / state.target, 1);
      el.ringProgress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - pct));
      el.targetLabel.textContent = `of ${state.target}`;
      const beads = el.beadsGroup.querySelectorAll('.bead');
      beads.forEach((b, i) => {
        const threshold = (i + 1) / BEAD_COUNT;
        b.classList.toggle('filled', pct >= threshold - 0.0001);
      });
    } else {
      el.ringProgress.style.strokeDashoffset = String(CIRCUMFERENCE);
      el.targetLabel.textContent = '';
      el.beadsGroup.querySelectorAll('.bead').forEach(b => b.classList.remove('filled'));
    }

    el.tapButtonEl.classList.toggle('reached', reached);
    el.reachedBanner.hidden = !(reached && !state.dismissedReached);

    el.muteBtn.setAttribute('aria-pressed', String(state.muted));
    el.muteBtn.setAttribute('aria-label', state.muted ? 'Unmute signal' : 'Mute signal');
    el.muteIconOn.hidden = state.muted;
    el.muteIconOff.hidden = !state.muted;
  }

  function signalTargetReached() {
    flashScreen();
    if (state.muted) return;
    if (navigator.vibrate) {
      navigator.vibrate([80, 60, 80, 60, 160]);
    }
    playTone();
  }

  function flashScreen() {
    el.flashOverlay.classList.remove('flash');
    // force reflow so the animation restarts if triggered again quickly
    void el.flashOverlay.offsetWidth;
    el.flashOverlay.classList.add('flash');
  }

  function playTone() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const start = () => {
        const notes = [880, 1108.73];
        let t = ctx.currentTime;
        notes.forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.4);
          t += 0.22;
        });
      };
      if (ctx.state === 'suspended') {
        ctx.resume().then(start).catch(() => {});
      } else {
        start();
      }
    } catch (e) { /* audio unavailable, vibration/visual signal still fires */ }
  }

  // A real tap: advances the running count AND counts as one prayer done today.
  function increment() {
    rolloverDailyIfNeeded();
    const hasTarget = !!state.target && state.target > 0;
    const wasReached = hasTarget && state.count >= state.target;
    state.count += 1;
    state.daily.today += 1;
    const nowReached = hasTarget && state.count >= state.target;

    if (nowReached && !wasReached) {
      state.dismissedReached = false;
      signalTargetReached();
    }
    saveState();
    render();
  }

  // Directly setting the count (via the Start field) is not itself a prayer,
  // so it does not touch today's/yesterday's tally — only the running count.
  function setCount(newCount) {
    const hasTarget = !!state.target && state.target > 0;
    const wasReached = hasTarget && state.count >= state.target;
    state.count = Math.max(0, Math.round(newCount));
    const nowReached = hasTarget && state.count >= state.target;

    if (nowReached && !wasReached) {
      state.dismissedReached = false;
      signalTargetReached();
    } else if (!nowReached) {
      state.dismissedReached = false;
    }
    saveState();
    render();
  }

  function openResetConfirm() {
    el.resetConfirmTitle.textContent = 'Reset count to 0?';
    el.resetConfirmSub.textContent = 'The name and target stay the same.';
    pendingConfirmAction = 'count';
    el.resetConfirm.hidden = false;
  }

  function openResetTodayConfirm() {
    el.resetConfirmTitle.textContent = "Reset today's count to 0?";
    el.resetConfirmSub.textContent = "Yesterday's count stays the same.";
    pendingConfirmAction = 'today';
    el.resetConfirm.hidden = false;
  }

  function closeResetConfirm() {
    el.resetConfirm.hidden = true;
    pendingConfirmAction = null;
  }

  function performReset() {
    state.count = 0;
    state.dismissedReached = false;
    saveState();
    render();
    closeResetConfirm();
  }

  function performResetToday() {
    rolloverDailyIfNeeded();
    state.daily.today = 0;
    saveState();
    render();
    closeResetConfirm();
  }

  el.tapSurface.addEventListener('click', increment);

  el.startInput.addEventListener('input', () => {
    const val = parseInt(el.startInput.value, 10);
    if (Number.isFinite(val)) {
      setCount(val);
    }
  });

  el.resetBtn.addEventListener('click', openResetConfirm);
  el.resetTodayBtn.addEventListener('click', openResetTodayConfirm);
  el.resetCancelBtn.addEventListener('click', closeResetConfirm);
  el.resetConfirmBtn.addEventListener('click', () => {
    if (pendingConfirmAction === 'today') {
      performResetToday();
    } else {
      performReset();
    }
  });
  el.resetConfirm.addEventListener('click', (e) => {
    if (e.target === el.resetConfirm) closeResetConfirm();
  });

  el.muteBtn.addEventListener('click', () => {
    state.muted = !state.muted;
    saveState();
    render();
  });

  el.keepGoingBtn.addEventListener('click', () => {
    state.dismissedReached = true;
    saveState();
    render();
  });

  el.nameInput.addEventListener('input', () => {
    state.name = el.nameInput.value;
    saveState();
  });

  el.targetInput.addEventListener('input', () => {
    const val = parseInt(el.targetInput.value, 10);
    state.target = Number.isFinite(val) && val > 0 ? val : null;
    state.dismissedReached = false;
    saveState();
    render();
  });

  rolloverDailyIfNeeded();
  buildBeads();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
