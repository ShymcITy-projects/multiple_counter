(() => {
  const STORAGE_KEY = 'counterPwaState';
  const CIRCUMFERENCE = 2 * Math.PI * 90;
  const BEAD_COUNT = 11;

  const el = {
    tapBtn: document.getElementById('tapBtn'),
    countValue: document.getElementById('countValue'),
    targetLabel: document.getElementById('targetLabel'),
    ringProgress: document.getElementById('ringProgress'),
    beadsGroup: document.getElementById('beads'),
    nameInput: document.getElementById('nameInput'),
    targetInput: document.getElementById('targetInput'),
    resetBtn: document.getElementById('resetBtn'),
    muteBtn: document.getElementById('muteBtn'),
    muteIconOn: document.getElementById('muteIconOn'),
    muteIconOff: document.getElementById('muteIconOff'),
    reachedBanner: document.getElementById('reachedBanner'),
    keepGoingBtn: document.getElementById('keepGoingBtn'),
    undoToast: document.getElementById('undoToast'),
    undoText: document.getElementById('undoText'),
    undoBtn: document.getElementById('undoBtn'),
    flashOverlay: document.getElementById('flashOverlay'),
  };

  let state = loadState();
  let undoTimer = null;
  let pendingUndo = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          name: typeof parsed.name === 'string' ? parsed.name : '',
          count: Number.isFinite(parsed.count) ? parsed.count : 0,
          target: Number.isFinite(parsed.target) ? parsed.target : null,
          dismissedReached: !!parsed.dismissedReached,
          muted: !!parsed.muted,
        };
      }
    } catch (e) { /* ignore corrupt state */ }
    return { name: '', count: 0, target: null, dismissedReached: false, muted: false };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

    el.tapBtn.classList.toggle('reached', reached);
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
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const notes = [880, 1108.73];
      let t = ctx.currentTime;
      notes.forEach((freq, i) => {
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
      setTimeout(() => ctx.close(), 900);
    } catch (e) { /* audio unavailable, vibration/visual signal still fires */ }
  }

  function increment() {
    const hasTarget = !!state.target && state.target > 0;
    const wasReached = hasTarget && state.count >= state.target;
    state.count += 1;
    const nowReached = hasTarget && state.count >= state.target;

    if (nowReached && !wasReached) {
      state.dismissedReached = false;
      signalTargetReached();
    }
    saveState();
    render();
  }

  function reset() {
    if (state.count === 0) return;
    pendingUndo = { count: state.count, dismissedReached: state.dismissedReached };
    state.count = 0;
    state.dismissedReached = false;
    saveState();
    render();
    showUndo();
  }

  function showUndo() {
    el.undoToast.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      el.undoToast.hidden = true;
      pendingUndo = null;
    }, 5000);
  }

  el.undoBtn.addEventListener('click', () => {
    if (pendingUndo) {
      state.count = pendingUndo.count;
      state.dismissedReached = pendingUndo.dismissedReached;
      saveState();
      render();
    }
    el.undoToast.hidden = true;
    clearTimeout(undoTimer);
    pendingUndo = null;
  });

  el.tapBtn.addEventListener('click', increment);

  el.resetBtn.addEventListener('click', reset);

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

  buildBeads();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
