(() => {
  const STORAGE_KEY = 'counterPwaState';
  const CIRCUMFERENCE = 2 * Math.PI * 90;
  const BEAD_COUNT = 11;
  const TAB_COUNT = 5;
  const STAT_DAYS = 4; // today + 3 previous days shown in the stats row
  const LOG_RETENTION_DAYS = 14; // how far back a tab's daily log is kept on disk

  const el = {
    tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
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
    resetTodayBtn: document.getElementById('resetTodayBtn'),
    dayStats: [
      document.getElementById('dayStat0'),
      document.getElementById('dayStat1'),
      document.getElementById('dayStat2'),
      document.getElementById('dayStat3'),
    ],
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

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function todayKey() {
    return dateKey(new Date());
  }

  // Calendar date, `offset` days before today ("0" = today).
  function keyForOffset(offset) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return dateKey(d);
  }

  function defaultTab() {
    return { name: '', count: 0, target: null, dismissedReached: false, dailyLog: [] };
  }

  function normalizeTab(raw) {
    if (!raw || typeof raw !== 'object') return defaultTab();
    let dailyLog = [];
    if (Array.isArray(raw.dailyLog)) {
      dailyLog = raw.dailyLog
        .filter(e => e && typeof e.date === 'string' && Number.isFinite(e.count))
        .map(e => ({ date: e.date, count: e.count }));
    } else if (raw.daily && typeof raw.daily === 'object') {
      // Migrate the older today/yesterday-only format.
      const d = raw.daily;
      if (typeof d.date === 'string') {
        if (Number.isFinite(d.today)) dailyLog.push({ date: d.date, count: d.today });
        if (Number.isFinite(d.yesterday)) {
          const prev = new Date(d.date + 'T00:00:00');
          prev.setDate(prev.getDate() - 1);
          dailyLog.push({ date: dateKey(prev), count: d.yesterday });
        }
      }
    }
    return {
      name: typeof raw.name === 'string' ? raw.name : '',
      count: Number.isFinite(raw.count) ? raw.count : 0,
      target: Number.isFinite(raw.target) ? raw.target : null,
      dismissedReached: !!raw.dismissedReached,
      dailyLog,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);

        // Multi-tab format (with or without the dailyLog upgrade).
        if (Array.isArray(parsed.tabs)) {
          const tabs = [];
          for (let i = 0; i < TAB_COUNT; i++) {
            tabs.push(normalizeTab(parsed.tabs[i]));
          }
          const activeTab = Number.isInteger(parsed.activeTab) && parsed.activeTab >= 0 && parsed.activeTab < TAB_COUNT
            ? parsed.activeTab
            : 0;
          return { activeTab, muted: !!parsed.muted, tabs };
        }

        // Legacy single-counter format — migrate it into Tab 1, keep the rest empty.
        if (typeof parsed.count !== 'undefined') {
          const tabs = [normalizeTab(parsed)];
          for (let i = 1; i < TAB_COUNT; i++) tabs.push(defaultTab());
          return { activeTab: 0, muted: !!parsed.muted, tabs };
        }
      }
    } catch (e) { /* ignore corrupt state */ }

    const tabs = [];
    for (let i = 0; i < TAB_COUNT; i++) tabs.push(defaultTab());
    return { activeTab: 0, muted: false, tabs };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function currentTab() {
    return state.tabs[state.activeTab];
  }

  function findLogEntry(tab, key) {
    return tab.dailyLog.find(e => e.date === key);
  }

  function getOrCreateTodayEntry(tab) {
    const key = todayKey();
    let entry = findLogEntry(tab, key);
    if (!entry) {
      entry = { date: key, count: 0 };
      tab.dailyLog.unshift(entry);
      pruneLog(tab);
    }
    return entry;
  }

  function pruneLog(tab) {
    const cutoffKey = keyForOffset(LOG_RETENTION_DAYS);
    tab.dailyLog = tab.dailyLog.filter(e => e.date >= cutoffKey);
  }

  function countsForLastDays(tab) {
    const result = [];
    for (let i = 0; i < STAT_DAYS; i++) {
      const entry = findLogEntry(tab, keyForOffset(i));
      result.push(entry ? entry.count : 0);
    }
    return result;
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

  function renderTabBar() {
    el.tabButtons.forEach((btn, i) => {
      const tab = state.tabs[i];
      const label = tab.name.trim() || String(i + 1);
      btn.textContent = label;
      btn.classList.toggle('active', i === state.activeTab);
      btn.setAttribute('aria-selected', String(i === state.activeTab));
    });
  }

  function render() {
    const tab = currentTab();

    renderTabBar();

    el.countValue.textContent = tab.count;
    el.nameInput.value = tab.name;
    el.targetInput.value = tab.target ?? '';
    if (document.activeElement !== el.startInput) {
      el.startInput.value = tab.count;
    }

    const counts = countsForLastDays(tab);
    el.dayStats.forEach((node, i) => { node.textContent = counts[i]; });

    const hasTarget = !!tab.target && tab.target > 0;
    const reached = hasTarget && tab.count >= tab.target;

    if (hasTarget) {
      const pct = Math.min(tab.count / tab.target, 1);
      el.ringProgress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - pct));
      el.targetLabel.textContent = `of ${tab.target}`;
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
    el.reachedBanner.hidden = !(reached && !tab.dismissedReached);

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
    const tab = currentTab();
    const hasTarget = !!tab.target && tab.target > 0;
    const wasReached = hasTarget && tab.count >= tab.target;
    tab.count += 1;
    getOrCreateTodayEntry(tab).count += 1;
    const nowReached = hasTarget && tab.count >= tab.target;

    if (nowReached && !wasReached) {
      tab.dismissedReached = false;
      signalTargetReached();
    }
    saveState();
    render();
  }

  // Directly setting the count (via the Start field) is not itself a prayer,
  // so it does not touch the daily log — only the running count.
  function setCount(newCount) {
    const tab = currentTab();
    const hasTarget = !!tab.target && tab.target > 0;
    const wasReached = hasTarget && tab.count >= tab.target;
    tab.count = Math.max(0, Math.round(newCount));
    const nowReached = hasTarget && tab.count >= tab.target;

    if (nowReached && !wasReached) {
      tab.dismissedReached = false;
      signalTargetReached();
    } else if (!nowReached) {
      tab.dismissedReached = false;
    }
    saveState();
    render();
  }

  function switchTab(index) {
    if (index === state.activeTab) return;
    state.activeTab = index;
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
    el.resetConfirmSub.textContent = 'The previous days stay the same.';
    pendingConfirmAction = 'today';
    el.resetConfirm.hidden = false;
  }

  function closeResetConfirm() {
    el.resetConfirm.hidden = true;
    pendingConfirmAction = null;
  }

  function performReset() {
    const tab = currentTab();
    tab.count = 0;
    tab.dismissedReached = false;
    saveState();
    render();
    closeResetConfirm();
  }

  function performResetToday() {
    const tab = currentTab();
    getOrCreateTodayEntry(tab).count = 0;
    saveState();
    render();
    closeResetConfirm();
  }

  el.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(Number(btn.dataset.index));
    });
  });

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
    currentTab().dismissedReached = true;
    saveState();
    render();
  });

  el.nameInput.addEventListener('input', () => {
    currentTab().name = el.nameInput.value;
    saveState();
    renderTabBar();
  });

  el.targetInput.addEventListener('input', () => {
    const val = parseInt(el.targetInput.value, 10);
    const tab = currentTab();
    tab.target = Number.isFinite(val) && val > 0 ? val : null;
    tab.dismissedReached = false;
    saveState();
    render();
  });

  state.tabs.forEach(pruneLog);
  saveState();
  buildBeads();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
