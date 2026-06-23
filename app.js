/* ── DevFlow App Logic ── */
'use strict';

// ══════════════════════════════════════════════
// Storage keys
// ══════════════════════════════════════════════
const KEYS = {
  categories: 'df_categories',
  projects:   'df_projects',
  sessions:   'df_sessions',
  settings:   'df_settings',
  timerState: 'df_timer_state',
};

// ══════════════════════════════════════════════
// Defaults
// ══════════════════════════════════════════════
const DEFAULT_SETTINGS = {
  focus: 25, short: 5, long: 15,
  soundEnabled: true, autoStart: false,
};

const DEFAULT_CATEGORIES = [
  { id: 'c1', name: 'Premerg',     color: '#7aa2f7', isDistraction: false },
  { id: 'c2', name: 'Study',       color: '#9ece6a', isDistraction: false },
  { id: 'c3', name: 'Personal',    color: '#bb9af7', isDistraction: false },
  { id: 'c4', name: 'Distractions',color: '#f7768e', isDistraction: true  },
];

const DEFAULT_PROJECTS = [
  { id: 'p1', name: 'Premerg',      categoryId: 'c1', color: '#7aa2f7', goal: 480, focus: 50, short: 10, long: 20 },
  { id: 'p2', name: 'Personal',     categoryId: 'c3', color: '#bb9af7', goal: 120, focus: 25, short: 5,  long: 15 },
  { id: 'p3', name: 'Study',        categoryId: 'c2', color: '#9ece6a', goal: 60,  focus: 30, short: 5,  long: 15 },
  { id: 'p4', name: 'Distractions', categoryId: 'c4', color: '#f7768e', goal: 0,   focus: 25, short: 5,  long: 15 },
];

// ══════════════════════════════════════════════
// Persistence helpers
// ══════════════════════════════════════════════
function load(key, fallback) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ══════════════════════════════════════════════
// App data
// ══════════════════════════════════════════════
let categories = load(KEYS.categories, DEFAULT_CATEGORIES);
let projects   = load(KEYS.projects,   DEFAULT_PROJECTS);
let sessions   = load(KEYS.sessions,   []);
let settings   = { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) };

// Back-fill categoryId for old sessions that stored a 'category' string
sessions.forEach(s => {
  if (!s.categoryId && s.category) {
    const cat = categories.find(c => c.name.toLowerCase() === s.category.toLowerCase());
    s.categoryId = cat?.id || null;
  }
});

// ══════════════════════════════════════════════
// Category helpers
// ══════════════════════════════════════════════
const getCat     = id  => categories.find(c => c.id === id) || null;
const isDistract = cat => cat?.isDistraction === true;

// ══════════════════════════════════════════════
// Timer state
// ══════════════════════════════════════════════
const state = {
  mode:            'focus',
  running:         false,
  totalSeconds:    settings.focus * 60,
  remaining:       settings.focus * 60,
  intervalId:      null,
  sessionInCycle:  0,
  activeProjectId: projects[0]?.id || null,
  activeLabel:     '',
  activeStart:     null,
  todayFocusSessions: 0,
  todayFocusMinutes:  0,
  streak:             0,
  hourlyBuckets:      new Array(12).fill(0),
  currentHour:        new Date().getHours(),
  goalCelebrated:     load('df_goal_celebrated', {}),
};

// Restore mid-session timer across page reloads
const savedTimer = load(KEYS.timerState, null);
if (savedTimer?.activeStart && savedTimer.mode === 'focus') {
  const elapsed = Math.floor((Date.now() - savedTimer.activeStart) / 1000);
  const dur = savedTimer.totalSeconds || settings.focus * 60;
  const rem = dur - elapsed;
  if (rem > 0) {
    state.mode            = savedTimer.mode;
    state.totalSeconds    = dur;
    state.remaining       = rem;
    state.activeStart     = savedTimer.activeStart;
    state.activeProjectId = savedTimer.activeProjectId || state.activeProjectId;
    state.activeLabel     = savedTimer.activeLabel || '';
    state.sessionInCycle  = savedTimer.sessionInCycle || 0;
  }
}

// ══════════════════════════════════════════════
// Date / format helpers
// ══════════════════════════════════════════════
const todayStr = () => new Date().toISOString().slice(0, 10);

function weekStr(date) {
  const d = new Date(date); const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1); return d.toISOString().slice(0, 10);
}

function fmtDuration(minutes) {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}hr ${m}min` : `${h}hr`;
}

function fmtDurationShort(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h === 0) return `${m}m`; if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTime(seconds) {
  return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
}

// ══════════════════════════════════════════════
// Stats
// ══════════════════════════════════════════════
function recomputeStats() {
  const today = todayStr();
  // Only count non-distraction sessions as "focus" in stats
  const focusSess = sessions.filter(s => {
    if (s.date !== today || s.type !== 'focus') return false;
    const proj = projects.find(p => p.id === s.projectId);
    return !isDistract(getCat(proj?.categoryId));
  });
  state.todayFocusSessions = focusSess.length;
  state.todayFocusMinutes  = focusSess.reduce((a, s) => a + s.durationMin, 0);

  const buckets = new Array(12).fill(0);
  const nowH = new Date().getHours();
  focusSess.forEach(s => {
    const diff = nowH - new Date(s.startTs).getHours();
    if (diff >= 0 && diff < 12) buckets[11 - diff]++;
  });
  state.hourlyBuckets = buckets;

  const allFocusDays = [...new Set(
    sessions.filter(s => s.type === 'focus' && !isDistract(getCat(projects.find(p => p.id === s.projectId)?.categoryId))).map(s => s.date)
  )].sort();
  let streak = 0; const check = new Date();
  for (let i = 0; i < 365; i++) {
    const d = check.toISOString().slice(0, 10);
    if (allFocusDays.includes(d)) { streak++; check.setDate(check.getDate() - 1); } else break;
  }
  state.streak = streak;
}

function getProjectMinutesToday(projectId) {
  const today = todayStr();
  return sessions
    .filter(s => s.date === today && s.type === 'focus' && s.projectId === projectId)
    .reduce((a, s) => a + s.durationMin, 0);
}

function getCategoryMinutesToday(categoryId) {
  const today = todayStr();
  const projIds = projects.filter(p => p.categoryId === categoryId).map(p => p.id);
  return sessions
    .filter(s => s.date === today && s.type === 'focus' && projIds.includes(s.projectId))
    .reduce((a, s) => a + s.durationMin, 0);
}

// ══════════════════════════════════════════════
// DOM refs
// ══════════════════════════════════════════════
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const els = {
  timeDisplay:    $('time-display'),
  modeLabel:      $('mode-label'),
  sessionDots:    $('session-dots'),
  ringProgress:   $('ring-progress'),
  tickMarks:      $('tick-marks'),
  btnStart:       $('btn-start'),
  iconPlay:       document.querySelector('.icon-play'),
  iconPause:      document.querySelector('.icon-pause'),
  btnReset:       $('btn-reset'),
  btnSkip:        $('btn-skip'),
  btnApply:       $('btn-apply'),
  logTerminal:    $('log-terminal'),
  btnClearLog:    $('btn-clear-log'),
  tabFocus:       $('tab-focus'),
  tabShort:       $('tab-short'),
  tabLong:        $('tab-long'),
  settingFocus:   $('setting-focus'),
  settingShort:   $('setting-short'),
  settingLong:    $('setting-long'),
  statFocusCount: $('stat-focus-count'),
  statFocusTime:  $('stat-focus-time'),
  statBreaks:     $('stat-breaks'),
  statStreak:     $('stat-streak'),
  statTotal:      $('stat-total'),
  barChart:       $('bar-chart'),
  tagDisplay:     $('tag-display'),
  soundToggle:    $('sound-toggle'),
  autostartToggle:$('autostart-toggle'),
  completionOverlay: $('completion-overlay'),
  completionTitle:   $('completion-title'),
  completionMsg:     $('completion-msg'),
  completionCode:    $('completion-code'),
  completionIcon:    $('completion-icon'),
  btnCompletionOk:   $('btn-completion-ok'),
  projectSelect:  $('project-select'),
  labelInput:     $('label-input'),
  btnNewProject:  $('btn-new-project'),
  projectsPanel:  $('projects-panel'),
  categoryPanel:  $('category-panel'),
  reportPanel:    $('report-panel'),
  btnTabTimer:    $('btn-tab-timer'),
  btnTabReport:   $('btn-tab-report'),
  reportOutput:   $('report-output'),
  btnCopyReport:  $('btn-copy-report'),
  reportDatePick: $('report-date'),
  reportViewDay:  $('report-view-day'),
  reportViewWeek: $('report-view-week'),
  btnTheme:       $('btn-theme'),
  // Project modal
  newProjectModal:$('new-project-modal'),
  modalProjTitle: $('modal-proj-title'),
  npName:         $('np-name'),
  npCategoryId:   $('np-category-id'),
  npGoal:         $('np-goal'),
  npFocus:        $('np-focus'),
  npShort:        $('np-short'),
  npLong:         $('np-long'),
  npColor:        $('np-color'),
  btnNpSave:      $('btn-np-save'),
  btnNpCancel:    $('btn-np-cancel'),
  btnNpDelete:    $('btn-np-delete'),
  btnManageCats:  $('btn-manage-cats'),
  // Category modal
  catModal:       $('cat-modal'),
  catList:        $('cat-list'),
  catName:        $('cat-name'),
  catColor:       $('cat-color'),
  catIsDistract:  $('cat-is-distract'),
  btnCatAdd:      $('btn-cat-add'),
  btnCatClose:    $('btn-cat-close'),
  // Quick-log
  quickLogBar:    $('quick-log-bar'),
  quickLogInput:  $('quick-log-input'),
  quickLogDur:    $('quick-log-dur'),
  btnQuickLog:    $('btn-quick-log'),
  btnQuickLogClose: $('btn-quick-log-close'),
  btnDistract:    $('btn-distract'),
};

// ══════════════════════════════════════════════
// Ring
// ══════════════════════════════════════════════
const CIRCUMFERENCE = 2 * Math.PI * 104;

function setRingProgress(fraction) {
  els.ringProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - fraction);
  els.ringProgress.style.strokeDasharray  = CIRCUMFERENCE;
}

function buildTickMarks() {
  els.tickMarks.innerHTML = '';
  const cx = 120, cy = 120, r = 104;
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const isMajor = i % 5 === 0;
    const r1 = isMajor ? r - 10 : r - 6;
    const x1 = cx + r1 * Math.cos(angle), y1 = cy + r1 * Math.sin(angle);
    const x2 = cx + (r+1) * Math.cos(angle), y2 = cy + (r+1) * Math.sin(angle);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1.toFixed(2)); line.setAttribute('y1', y1.toFixed(2));
    line.setAttribute('x2', x2.toFixed(2)); line.setAttribute('y2', y2.toFixed(2));
    line.setAttribute('stroke-width', isMajor ? '2' : '1');
    els.tickMarks.appendChild(line);
  }
}

// ══════════════════════════════════════════════
// Display
// ══════════════════════════════════════════════
function updateDisplay() {
  els.timeDisplay.textContent = formatTime(state.remaining);
  document.title = `${formatTime(state.remaining)} — DevFlow`;
  setRingProgress(state.remaining / state.totalSeconds);
}

function updateSessionDots() {
  els.sessionDots.querySelectorAll('.dot').forEach((dot, i) => {
    dot.classList.toggle('filled', i < state.sessionInCycle);
  });
}

function updateStatsUI() {
  recomputeStats();
  els.statFocusCount.textContent = state.todayFocusSessions;
  els.statFocusTime.textContent  = fmtDurationShort(state.todayFocusMinutes);
  els.statStreak.textContent     = `🔥 ${state.streak}`;
  const today = todayStr();
  const breaks = sessions.filter(s => s.date === today && s.type === 'break').length;
  els.statBreaks.textContent = breaks;
  els.statTotal.textContent  = state.todayFocusSessions + breaks;
  renderBarChart();
  renderCategoryPanel();
  renderProjectsPanel();
}

function renderBarChart() {
  els.barChart.innerHTML = '';
  const maxVal = Math.max(...state.hourlyBuckets, 1);
  const nowH = new Date().getHours();
  state.hourlyBuckets.forEach((val, i) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    const hour = (nowH - 11 + i + 24) % 24;
    bar.style.height = Math.max(4, (val / maxVal) * 36) + 'px';
    if (hour === nowH) bar.classList.add('active');
    const lbl = document.createElement('span');
    lbl.className = 'bar-label';
    lbl.textContent = hour % 12 || 12;
    bar.appendChild(lbl);
    els.barChart.appendChild(bar);
  });
}

// ══════════════════════════════════════════════
// Category panel (sidebar summary)
// ══════════════════════════════════════════════
function renderCategoryPanel() {
  els.categoryPanel.innerHTML = '';
  let any = false;
  categories.forEach(cat => {
    const mins = getCategoryMinutesToday(cat.id);
    if (!mins) return;
    any = true;
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.style.setProperty('--cat-color', cat.color);
    row.innerHTML = `
      <span class="cat-dot" style="background:${cat.color}"></span>
      <span class="cat-name">${escHtml(cat.name)}</span>
      ${cat.isDistraction ? '<span class="cat-distract-tag">distraction</span>' : ''}
      <span class="cat-time">${fmtDurationShort(mins)}</span>
    `;
    els.categoryPanel.appendChild(row);
  });
  if (!any) {
    els.categoryPanel.innerHTML = '<span class="cat-empty">no sessions yet today</span>';
  }
}

// ══════════════════════════════════════════════
// Projects panel (sidebar per-project)
// ══════════════════════════════════════════════
function renderProjectsPanel() {
  const today = todayStr();
  els.projectsPanel.innerHTML = '';
  projects.forEach(proj => {
    const mins = getProjectMinutesToday(proj.id);
    const goal = proj.goal || 0;
    const pct  = goal > 0 ? Math.min(100, (mins / goal) * 100) : 0;
    const done = goal > 0 && mins >= goal;
    const cat  = getCat(proj.categoryId);

    const row = document.createElement('div');
    row.className = 'proj-row' + (done ? ' proj-done' : '') + (proj.id === state.activeProjectId ? ' proj-active' : '');
    row.dataset.projId = proj.id;
    row.innerHTML = `
      <div class="proj-header">
        <span class="proj-dot" style="background:${proj.color}"></span>
        <span class="proj-name">${escHtml(proj.name)}</span>
        ${cat ? `<span class="proj-cat-badge" style="color:${cat.color};border-color:${cat.color}22;background:${cat.color}11">${escHtml(cat.name)}</span>` : ''}
        <span class="proj-time">${fmtDurationShort(mins)}${goal ? ' / ' + fmtDurationShort(goal) : ''}</span>
        ${done ? '<span class="proj-goal-badge">✓</span>' : ''}
        <button class="proj-edit-btn" data-id="${proj.id}" title="Edit project" aria-label="Edit ${escHtml(proj.name)}">✎</button>
      </div>
      ${goal > 0 ? `<div class="proj-progress-track"><div class="proj-progress-bar" style="width:${pct}%;background:${proj.color}"></div></div>` : ''}
    `;
    row.querySelector('.proj-edit-btn').addEventListener('click', e => {
      e.stopPropagation();
      openEditProjectModal(e.currentTarget.dataset.id);
    });
    row.addEventListener('click', () => switchActiveProject(proj.id));
    els.projectsPanel.appendChild(row);

    if (done && state.goalCelebrated[proj.id] !== today) {
      state.goalCelebrated[proj.id] = today;
      save('df_goal_celebrated', state.goalCelebrated);
      triggerGoalCelebration(proj);
    }
  });
}

function switchActiveProject(projId) {
  state.activeProjectId = projId;
  els.projectSelect.value = projId;
  const proj = projects.find(p => p.id === projId);
  applyProjectDurations(proj);
  if (!state.running) {
    state.totalSeconds = settings[state.mode] * 60;
    state.remaining = state.totalSeconds;
    updateDisplay();
  }
  persistTimerState();
  renderProjectsPanel();
}

function triggerGoalCelebration(proj) {
  const banner = document.createElement('div');
  banner.className = 'goal-banner';
  banner.innerHTML = `🎯 <strong>${escHtml(proj.name)}</strong> daily goal reached!`;
  document.body.appendChild(banner);
  setTimeout(() => banner.classList.add('visible'), 50);
  setTimeout(() => { banner.classList.remove('visible'); setTimeout(() => banner.remove(), 400); }, 4000);
  playChime();
}

// ══════════════════════════════════════════════
// Project selector dropdown
// ══════════════════════════════════════════════
function rebuildProjectSelect() {
  els.projectSelect.innerHTML = '';
  // Group by category
  const grouped = {};
  projects.forEach(p => { (grouped[p.categoryId || ''] = grouped[p.categoryId || ''] || []).push(p); });

  // First render projects with a category (grouped), then ungrouped
  categories.forEach(cat => {
    const group = grouped[cat.id];
    if (!group?.length) return;
    const optgroup = document.createElement('optgroup');
    optgroup.label = cat.name + (cat.isDistraction ? ' ⚡' : '');
    group.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      if (p.id === state.activeProjectId) opt.selected = true;
      optgroup.appendChild(opt);
    });
    els.projectSelect.appendChild(optgroup);
  });
  // Uncategorized
  const uncat = grouped[''] || [];
  uncat.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    if (p.id === state.activeProjectId) opt.selected = true;
    els.projectSelect.appendChild(opt);
  });
}

function applyProjectDurations(proj) {
  if (!proj) return;
  if (proj.focus) settings.focus = proj.focus;
  if (proj.short) settings.short = proj.short;
  if (proj.long)  settings.long  = proj.long;
  els.settingFocus.value = settings.focus;
  els.settingShort.value = settings.short;
  els.settingLong.value  = settings.long;
}

// ══════════════════════════════════════════════
// Category modal
// ══════════════════════════════════════════════
function openCatModal() {
  renderCatList();
  els.catName.value = '';
  els.catColor.value = '#7aa2f7';
  els.catIsDistract.checked = false;
  els.catModal.classList.add('visible');
  els.catModal.setAttribute('aria-hidden', 'false');
  els.catName.focus();
}

function closeCatModal() {
  els.catModal.classList.remove('visible');
  els.catModal.setAttribute('aria-hidden', 'true');
  // Refresh category dropdown in project modal if open
  rebuildCategorySelect();
}

function renderCatList() {
  els.catList.innerHTML = '';
  categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'cat-list-row';
    row.innerHTML = `
      <span class="cat-list-dot" style="background:${cat.color}"></span>
      <span class="cat-list-name">${escHtml(cat.name)}</span>
      ${cat.isDistraction ? '<span class="cat-list-tag">distraction</span>' : ''}
      <button class="cat-list-del" data-id="${cat.id}" title="Delete category" aria-label="Delete ${escHtml(cat.name)}">✕</button>
    `;
    row.querySelector('.cat-list-del').addEventListener('click', e => {
      const id = e.currentTarget.dataset.id;
      // Don't delete if projects use it
      const inUse = projects.some(p => p.categoryId === id);
      if (inUse) {
        row.classList.add('shake');
        row.title = 'Remove projects from this category first';
        setTimeout(() => row.classList.remove('shake'), 600);
        return;
      }
      categories = categories.filter(c => c.id !== id);
      save(KEYS.categories, categories);
      renderCatList();
    });
    els.catList.appendChild(row);
  });
}

function addCategory() {
  const name = els.catName.value.trim();
  if (!name) { els.catName.focus(); return; }
  const color = els.catColor.value || '#7aa2f7';
  const isDistraction = els.catIsDistract.checked;
  categories.push({ id: genId(), name, color, isDistraction });
  save(KEYS.categories, categories);
  els.catName.value = '';
  els.catIsDistract.checked = false;
  renderCatList();
  rebuildCategorySelect();
  updateStatsUI();
}

function rebuildCategorySelect() {
  if (!els.npCategoryId) return;
  const cur = els.npCategoryId.value;
  els.npCategoryId.innerHTML = '<option value="">— none —</option>';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name + (cat.isDistraction ? ' ⚡' : '');
    if (cat.id === cur) opt.selected = true;
    els.npCategoryId.appendChild(opt);
  });
}

// ══════════════════════════════════════════════
// Theme
// ══════════════════════════════════════════════
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  save('df_theme', theme);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'night';
  applyTheme(cur === 'night' ? 'day' : 'night');
}

// ══════════════════════════════════════════════
// Mode switching
// ══════════════════════════════════════════════
const MODES = {
  focus: { label: 'DEEP WORK' },
  short: { label: 'COFFEE BREAK' },
  long:  { label: 'LONG BREAK' },
};

function switchMode(mode, fromUser = true) {
  if (state.running && fromUser) stopTimer(false);
  state.mode = mode;
  state.totalSeconds = settings[mode] * 60;
  state.remaining    = state.totalSeconds;
  [els.tabFocus, els.tabShort, els.tabLong].forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active);
  });
  els.modeLabel.textContent = MODES[mode].label;
  document.body.className   = `mode-${mode}`;
  updateDisplay(); updateStatsUI(); persistTimerState();
}

// ══════════════════════════════════════════════
// Timer controls
// ══════════════════════════════════════════════
function persistTimerState() {
  save(KEYS.timerState, {
    mode: state.mode, totalSeconds: state.totalSeconds,
    activeStart: state.activeStart, activeProjectId: state.activeProjectId,
    activeLabel: state.activeLabel, sessionInCycle: state.sessionInCycle,
  });
}

function startTimer() {
  if (state.running) return;
  state.running = true;
  state.activeStart = state.activeStart || Date.now();
  document.body.classList.add('running');
  els.iconPlay.classList.add('hidden');
  els.iconPause.classList.remove('hidden');
  persistTimerState();
  state.intervalId = setInterval(() => {
    state.remaining--;
    updateDisplay();
    if (state.remaining <= 0) onSessionComplete();
  }, 1000);
}

function stopTimer(log = true) {
  if (!state.running) return;
  state.running = false;
  document.body.classList.remove('running');
  clearInterval(state.intervalId);
  state.intervalId = null;
  els.iconPlay.classList.remove('hidden');
  els.iconPause.classList.add('hidden');
  if (log && state.mode === 'focus' && state.activeStart) {
    const elapsed = Math.floor((Date.now() - state.activeStart) / 1000 / 60);
    if (elapsed >= 1) commitFocusSession(elapsed);
  }
  state.activeStart = null;
  persistTimerState();
}

function resetTimer() {
  stopTimer(false);
  state.activeStart  = null;
  state.totalSeconds = settings[state.mode] * 60;
  state.remaining    = state.totalSeconds;
  updateDisplay();
  addLog('reset', 'RESET', 'Timer reset.');
  persistTimerState();
}

function skipSession() {
  stopTimer(false);
  state.activeStart = null;
  addLog('skip', 'SKIP', `Skipped ${MODES[state.mode].label.toLowerCase()}.`);
  advanceToNextMode();
}

function onSessionComplete() {
  stopTimer(false);
  playChime();
  if (state.mode === 'focus') {
    commitFocusSession(settings.focus);
    state.sessionInCycle = (state.sessionInCycle + 1) % 4;
    const proj = projects.find(p => p.id === state.activeProjectId);
    const label = state.activeLabel.trim();
    addLog('focus', 'DONE', `[${proj?.name || '?'}]${label ? ' ' + label : ''} — ${settings.focus}min`);
    showCompletion('🎯', 'Session Complete!', `Done on ${proj?.name || 'project'}. Time to recharge.`, randomCommitMsg());
  } else {
    sessions.push({ id: genId(), type: 'break', date: todayStr(), startTs: Date.now() - settings[state.mode] * 60000, durationMin: settings[state.mode] });
    save(KEYS.sessions, sessions);
    addLog('break', 'BREAK', `${MODES[state.mode].label} done.`);
    showCompletion('☕', 'Break Over!', randomBreakMsg(), 'git checkout main  # back to the grind');
  }
  state.activeStart = null;
  updateSessionDots(); updateStatsUI(); persistTimerState();
}

function commitFocusSession(durationMin) {
  if (durationMin < 1) return;
  const proj = projects.find(p => p.id === state.activeProjectId);
  const label = state.activeLabel.trim();
  const { task, tags } = parseLabel(label);
  sessions.push({
    id: genId(), type: 'focus', date: todayStr(),
    startTs: state.activeStart || (Date.now() - durationMin * 60000),
    endTs: Date.now(), durationMin,
    projectId: state.activeProjectId,
    projectName: proj?.name || 'unknown',
    categoryId: proj?.categoryId || null,
    task, tags, label,
  });
  save(KEYS.sessions, sessions);
}

// ══════════════════════════════════════════════
// Label parser: "PRE-8555 #feature" → { task, tags }
// ══════════════════════════════════════════════
function parseLabel(label) {
  const tagRe = /#[\w-]+/g;
  return { tags: label.match(tagRe) || [], task: label.replace(tagRe, '').trim() };
}

function advanceToNextMode() {
  if (state.mode === 'focus') {
    const total = sessions.filter(s => s.type === 'focus' && s.date === todayStr()).length;
    switchMode(state.sessionInCycle === 0 && total > 0 && total % 4 === 0 ? 'long' : 'short', false);
  } else { switchMode('focus', false); }
  if (settings.autoStart) setTimeout(startTimer, 800);
}

// ══════════════════════════════════════════════
// Completion overlay
// ══════════════════════════════════════════════
const COMMIT_MSGS = [
  'feat: focused work session committed ✓','fix: brain recharged, bugs beware 🐛',
  'chore: productive session committed 💪','refactor: mental model updated 🧠',
  'perf: deep work loop optimized ⚡','test: session assertions passed ✅',
  'docs: knowledge base updated 📚','ci: pipeline running smoothly 🚀',
];
const BREAK_MSGS = [
  'Take a walk. Your code will still be there.',
  'Grab some water. Hydrated devs ship better code.',
  'Rest your eyes. Screen fatigue is real.',
  'Stretch it out. RSI is not a feature.',
  'Step outside. Fresh air = fresh perspective.',
];
const randomCommitMsg = () => COMMIT_MSGS[Math.floor(Math.random() * COMMIT_MSGS.length)];
const randomBreakMsg  = () => BREAK_MSGS[Math.floor(Math.random() * BREAK_MSGS.length)];

function showCompletion(icon, title, msg, code) {
  els.completionIcon.textContent = icon; els.completionTitle.textContent = title;
  els.completionMsg.textContent  = msg;  els.completionCode.textContent  = code;
  els.completionOverlay.classList.add('visible');
  els.completionOverlay.setAttribute('aria-hidden', 'false');
}
function hideCompletion() {
  els.completionOverlay.classList.remove('visible');
  els.completionOverlay.setAttribute('aria-hidden', 'true');
  advanceToNextMode();
}

// ══════════════════════════════════════════════
// Activity log
// ══════════════════════════════════════════════
const LOG_BADGE_MAP = {
  focus:'badge-focus', break:'badge-break', reset:'badge-reset',
  skip:'badge-skip', system:'badge-system', distract:'badge-distract',
};
function addLog(type, badge, msg) {
  const time = new Date().toTimeString().slice(0, 8);
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-badge ${LOG_BADGE_MAP[type] || 'badge-system'}">${badge}</span>
    <span class="log-msg">${escHtml(msg)}</span>
  `;
  els.logTerminal.appendChild(entry);
  els.logTerminal.scrollTop = els.logTerminal.scrollHeight;
  const all = els.logTerminal.querySelectorAll('.log-entry');
  if (all.length > 100) all[0].remove();
}

// ══════════════════════════════════════════════
// Quick-log distraction
// ══════════════════════════════════════════════
function openQuickLog() {
  els.quickLogBar.classList.remove('hidden');
  els.quickLogInput.focus();
}
function closeQuickLog() {
  els.quickLogBar.classList.add('hidden');
  els.quickLogInput.value = '';
  els.quickLogDur.value = '5';
}
function commitQuickLog() {
  const label = els.quickLogInput.value.trim();
  const dur   = Math.max(1, parseInt(els.quickLogDur.value, 10) || 5);
  // Find first distraction-flagged project, fall back to any project
  const distProj = projects.find(p => isDistract(getCat(p.categoryId))) || projects[0];
  const { task, tags } = parseLabel(label);
  sessions.push({
    id: genId(), type: 'focus', date: todayStr(),
    startTs: Date.now() - dur * 60000, endTs: Date.now(), durationMin: dur,
    projectId: distProj.id, projectName: distProj.name,
    categoryId: distProj.categoryId, task, tags, label, quickLog: true,
  });
  save(KEYS.sessions, sessions);
  const tagStr = tags.length ? ' ' + tags.join(' ') : '';
  addLog('distract', 'DIST', `${fmtDurationShort(dur)} — ${task || 'distraction'}${tagStr}`);
  updateStatsUI();
  closeQuickLog();
}

// ══════════════════════════════════════════════
// Project modal
// ══════════════════════════════════════════════
let editingProjectId = null;

function openNewProjectModal() {
  editingProjectId = null;
  els.modalProjTitle.textContent = 'new project';
  els.btnNpSave.textContent = 'create';
  els.btnNpDelete.classList.add('hidden');
  els.npName.value = ''; els.npGoal.value = '120';
  els.npFocus.value = '25'; els.npShort.value = '5'; els.npLong.value = '15';
  els.npColor.value = '#7aa2f7';
  rebuildCategorySelect();
  els.newProjectModal.classList.add('visible');
  els.newProjectModal.setAttribute('aria-hidden', 'false');
  els.npName.focus();
}

function openEditProjectModal(projId) {
  const proj = projects.find(p => p.id === projId);
  if (!proj) return;
  editingProjectId = projId;
  els.modalProjTitle.textContent = 'edit project';
  els.btnNpSave.textContent = 'save';
  els.btnNpDelete.classList.remove('hidden');
  els.npName.value  = proj.name;
  els.npGoal.value  = proj.goal  || 0;
  els.npFocus.value = proj.focus || 25;
  els.npShort.value = proj.short || 5;
  els.npLong.value  = proj.long  || 15;
  els.npColor.value = proj.color || '#7aa2f7';
  rebuildCategorySelect();
  if (proj.categoryId) els.npCategoryId.value = proj.categoryId;
  els.newProjectModal.classList.add('visible');
  els.newProjectModal.setAttribute('aria-hidden', 'false');
  els.npName.focus();
}

function closeProjectModal() {
  els.newProjectModal.classList.remove('visible');
  els.newProjectModal.setAttribute('aria-hidden', 'true');
  editingProjectId = null;
}

function saveProject() {
  const name = els.npName.value.trim();
  if (!name) { els.npName.focus(); return; }
  const categoryId = els.npCategoryId.value || null;
  const goal  = parseInt(els.npGoal.value,  10) || 0;
  const focus = parseInt(els.npFocus.value, 10) || 25;
  const short = parseInt(els.npShort.value, 10) || 5;
  const long  = parseInt(els.npLong.value,  10) || 15;
  const color = els.npColor.value || '#7aa2f7';
  const cat   = getCat(categoryId);

  if (editingProjectId) {
    const proj = projects.find(p => p.id === editingProjectId);
    if (proj) {
      Object.assign(proj, { name, categoryId, goal, focus, short, long, color });
      save(KEYS.projects, projects);
      if (proj.id === state.activeProjectId) applyProjectDurations(proj);
      addLog('system', 'CFG', `Updated: ${name}${cat ? ' [' + cat.name + ']' : ''} focus=${focus}m`);
    }
  } else {
    projects.push({ id: genId(), name, categoryId, color, goal, focus, short, long });
    save(KEYS.projects, projects);
    addLog('system', 'CFG', `Created: ${name}${cat ? ' [' + cat.name + ']' : ''} focus=${focus}m`);
  }
  rebuildProjectSelect(); updateStatsUI(); closeProjectModal();
}

function deleteProject(projId) {
  const proj = projects.find(p => p.id === projId);
  if (!proj) return;
  if (!confirm(`Delete project "${proj.name}"?\n\nPast sessions are kept in your history but no new sessions can be logged to it.`)) return;
  projects = projects.filter(p => p.id !== projId);
  save(KEYS.projects, projects);
  // If we deleted the active project, switch to the first available one
  if (state.activeProjectId === projId) {
    state.activeProjectId = projects[0]?.id || null;
  }
  addLog('system', 'CFG', `Deleted project: ${proj.name}`);
  rebuildProjectSelect(); updateStatsUI(); closeProjectModal();
}

// ══════════════════════════════════════════════
// Settings
// ══════════════════════════════════════════════
function applySettings() {
  const f = parseInt(els.settingFocus.value, 10);
  const s = parseInt(els.settingShort.value, 10);
  const l = parseInt(els.settingLong.value,  10);
  if (f >= 1 && f <= 180) settings.focus = f;
  if (s >= 1 && s <= 60)  settings.short = s;
  if (l >= 1 && l <= 120) settings.long  = l;
  save(KEYS.settings, settings);
  const proj = projects.find(p => p.id === state.activeProjectId);
  if (proj) { proj.focus = settings.focus; proj.short = settings.short; proj.long = settings.long; save(KEYS.projects, projects); }
  if (!state.running) { state.totalSeconds = settings[state.mode] * 60; state.remaining = state.totalSeconds; updateDisplay(); }
  addLog('system', 'CFG', `focus=${f}m short=${s}m long=${l}m`);
  els.btnApply.style.background = 'rgba(122,162,247,0.35)';
  setTimeout(() => { els.btnApply.style.background = ''; }, 600);
}

// ══════════════════════════════════════════════
// Reports
// ══════════════════════════════════════════════
let reportView = 'day';
let reportDate = todayStr();

function buildDailyReport(dateStr) {
  const day = sessions.filter(s => s.date === dateStr && s.type === 'focus');
  if (!day.length) return `-- no sessions on ${dateStr} --`;

  const groups = {};
  day.forEach(s => {
    const key = `${s.projectId}||${s.task}||${(s.tags||[]).join(',')}`;
    if (!groups[key]) groups[key] = { projectName: s.projectName, categoryId: s.categoryId, task: s.task, tags: s.tags || [], totalMin: 0 };
    groups[key].totalMin += s.durationMin;
  });

  // Distractions last
  const sorted = Object.values(groups).sort((a, b) => {
    const aD = isDistract(getCat(a.categoryId)), bD = isDistract(getCat(b.categoryId));
    if (aD && !bD) return 1; if (!aD && bD) return -1;
    return b.totalMin - a.totalMin;
  });

  const cat = getCat(sorted[0]?.categoryId);
  let out = '- #dailyfocus\n';
  sorted.forEach(g => {
    const taskPart = g.task ? `[[${g.task}]]` : `[[${g.projectName}]]`;
    const tagsPart = g.tags.length ? ' ' + g.tags.join(' ') : '';
    const gCat     = getCat(g.categoryId);
    const distTag  = isDistract(gCat) ? ' #distraction' : '';
    out += `- [[${g.projectName}]] ${taskPart}${tagsPart}${distTag}\n`;
    out += `  time:: ${fmtDuration(g.totalMin)}\n`;
  });
  return out.trimEnd();
}

function buildWeeklyReport(mondayStr) {
  const monday = new Date(mondayStr + 'T00:00:00');
  const days = Array.from({length:7}, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const ws = sessions.filter(s => days.includes(s.date) && s.type === 'focus');
  if (!ws.length) return `-- no sessions for week of ${mondayStr} --`;

  const dayLabels = days.map(d => new Date(d + 'T12:00:00').toLocaleDateString('en', { weekday: 'short' }));
  const COL = 18, DW = 6;
  const sep = '─'.repeat(COL + 7 * DW + 8);

  let out = `weekly report — ${mondayStr}\n\n`;

  // By category
  out += 'by category\n' + sep + '\n';
  categories.forEach(cat => {
    const projIds = projects.filter(p => p.categoryId === cat.id).map(p => p.id);
    const total = ws.filter(s => projIds.includes(s.projectId)).reduce((a, s) => a + s.durationMin, 0);
    if (!total) return;
    out += cat.name.slice(0, COL-1).padEnd(COL) + ' ';
    days.forEach(d => {
      const m = ws.filter(s => s.date === d && projIds.includes(s.projectId)).reduce((a, s) => a + s.durationMin, 0);
      out += (m ? fmtDurationShort(m) : '-').padStart(DW);
    });
    out += `  ${fmtDurationShort(total)}\n`;
  });

  // By project
  const byProject = {};
  ws.forEach(s => {
    if (!byProject[s.projectId]) byProject[s.projectId] = { name: s.projectName, categoryId: s.categoryId, days: {}, total: 0 };
    byProject[s.projectId].total += s.durationMin;
    byProject[s.projectId].days[s.date] = (byProject[s.projectId].days[s.date] || 0) + s.durationMin;
  });

  out += '\nby project\n' + sep + '\n';
  out += ' '.repeat(COL) + ' '; dayLabels.forEach(l => out += l.padStart(DW)); out += '  total\n' + sep + '\n';
  Object.values(byProject)
    .sort((a, b) => { const aD = isDistract(getCat(a.categoryId)), bD = isDistract(getCat(b.categoryId)); return aD && !bD ? 1 : !aD && bD ? -1 : b.total - a.total; })
    .forEach(p => {
      out += p.name.slice(0, COL-1).padEnd(COL) + ' ';
      days.forEach(d => out += (p.days[d] ? fmtDurationShort(p.days[d]) : '-').padStart(DW));
      out += `  ${fmtDurationShort(p.total)}\n`;
    });
  out += sep + '\n' + 'TOTAL'.padEnd(COL) + ' ';
  days.forEach(d => { const m = ws.filter(s => s.date === d).reduce((a, s) => a + s.durationMin, 0); out += (m ? fmtDurationShort(m) : '-').padStart(DW); });
  out += `  ${fmtDurationShort(ws.reduce((a, s) => a + s.durationMin, 0))}`;
  return out;
}

function renderReport() {
  els.reportOutput.textContent = reportView === 'day' ? buildDailyReport(reportDate) : buildWeeklyReport(weekStr(reportDate));
}
function switchReportView(view) {
  reportView = view;
  els.reportViewDay.classList.toggle('active', view === 'day');
  els.reportViewWeek.classList.toggle('active', view === 'week');
  renderReport();
}

// ══════════════════════════════════════════════
// Sound
// ══════════════════════════════════════════════
let audioCtx = null;
function getAudioCtx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
function playChime() {
  if (!settings.soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination); osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.18);
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.5);
      osc.start(ctx.currentTime + i * 0.18); osc.stop(ctx.currentTime + i * 0.18 + 0.55);
    });
  } catch (_) {}
}

// ══════════════════════════════════════════════
// Particles
// ══════════════════════════════════════════════
function initParticles() {
  const canvas = $('particles-canvas'), ctx = canvas.getContext('2d');
  const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  resize(); window.addEventListener('resize', resize);
  const particles = Array.from({length: 50}, () => ({
    x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight,
    r: Math.random() * 1.2 + 0.3,
    vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
    alpha: Math.random() * 0.3 + 0.05, hue: Math.random() > 0.5 ? 228 : 267,
  }));
  (function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue},80%,70%,${p.alpha})`; ctx.fill();
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
    });
    requestAnimationFrame(draw);
  })();
}

// ══════════════════════════════════════════════
// Utilities
// ══════════════════════════════════════════════
const genId   = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const escHtml = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ══════════════════════════════════════════════
// Main tab switching
// ══════════════════════════════════════════════
function showTab(tab) {
  const isReport = tab === 'report';
  els.reportPanel.classList.toggle('hidden', !isReport);
  document.querySelector('.main-timer-area').classList.toggle('hidden', isReport);
  els.btnTabTimer.classList.toggle('active', !isReport);
  els.btnTabReport.classList.toggle('active', isReport);
  if (isReport) renderReport();
}

// ══════════════════════════════════════════════
// Keyboard shortcuts
// ══════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  switch (e.key) {
    case ' ': e.preventDefault(); state.running ? stopTimer() : startTimer(); break;
    case 'r': case 'R': resetTimer(); break;
    case 's': case 'S': skipSession(); break;
    case 'd': case 'D': openQuickLog(); break;
    case 'Escape': closeQuickLog(); closeProjectModal(); closeCatModal(); break;
    case '1': switchMode('focus'); break;
    case '2': switchMode('short'); break;
    case '3': switchMode('long');  break;
  }
});

setInterval(() => { const h = new Date().getHours(); if (h !== state.currentHour) { state.currentHour = h; updateStatsUI(); } }, 60000);

// ══════════════════════════════════════════════
// Event wiring
// ══════════════════════════════════════════════
function wireEvents() {
  els.btnStart.addEventListener('click', () => {
    if (state.running) stopTimer(); else startTimer();
    if (audioCtx?.state === 'suspended') audioCtx.resume();
  });
  els.btnReset.addEventListener('click', resetTimer);
  els.btnSkip.addEventListener('click', skipSession);
  els.btnApply.addEventListener('click', applySettings);
  els.btnClearLog.addEventListener('click', () => { els.logTerminal.innerHTML = ''; addLog('system', 'SYS', 'Log cleared.'); });
  els.btnCompletionOk.addEventListener('click', hideCompletion);
  els.completionOverlay.addEventListener('click', e => { if (e.target === els.completionOverlay) hideCompletion(); });
  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchMode(btn.dataset.mode)));

  els.soundToggle.addEventListener('change', () => { settings.soundEnabled = els.soundToggle.checked; save(KEYS.settings, settings); });
  els.autostartToggle.addEventListener('change', () => { settings.autoStart = els.autostartToggle.checked; save(KEYS.settings, settings); });
  [els.settingFocus, els.settingShort, els.settingLong].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') applySettings(); }));

  els.projectSelect.addEventListener('change', () => {
    state.activeProjectId = els.projectSelect.value;
    const proj = projects.find(p => p.id === state.activeProjectId);
    applyProjectDurations(proj);
    if (!state.running) { state.totalSeconds = settings[state.mode] * 60; state.remaining = state.totalSeconds; updateDisplay(); }
    persistTimerState(); updateStatsUI();
  });
  els.labelInput.addEventListener('input', () => {
    state.activeLabel = els.labelInput.value;
    els.tagDisplay.textContent = state.activeLabel.trim() ? `// ${state.activeLabel.trim()}` : '// idle';
    persistTimerState();
  });

  // Project modal
  els.btnNewProject.addEventListener('click', openNewProjectModal);
  els.btnNewProject.addEventListener('contextmenu', e => { e.preventDefault(); openEditProjectModal(state.activeProjectId); });
  els.btnNpSave.addEventListener('click', saveProject);
  els.btnNpCancel.addEventListener('click', closeProjectModal);
  els.btnNpDelete.addEventListener('click', () => deleteProject(editingProjectId));
  els.newProjectModal.addEventListener('click', e => { if (e.target === els.newProjectModal) closeProjectModal(); });
  els.npName.addEventListener('keydown', e => { if (e.key === 'Enter') saveProject(); });

  // Category modal
  els.btnManageCats.addEventListener('click', openCatModal);
  els.btnCatAdd.addEventListener('click', addCategory);
  els.btnCatClose.addEventListener('click', closeCatModal);
  els.catModal.addEventListener('click', e => { if (e.target === els.catModal) closeCatModal(); });
  els.catName.addEventListener('keydown', e => { if (e.key === 'Enter') addCategory(); });

  // Quick-log
  els.btnDistract.addEventListener('click', () => { if (audioCtx?.state === 'suspended') audioCtx.resume(); openQuickLog(); });
  els.btnQuickLog.addEventListener('click', commitQuickLog);
  els.btnQuickLogClose.addEventListener('click', closeQuickLog);
  els.quickLogInput.addEventListener('keydown', e => { if (e.key === 'Enter') commitQuickLog(); });

  // Theme
  els.btnTheme.addEventListener('click', toggleTheme);

  // Reports
  els.btnTabTimer.addEventListener('click', () => showTab('timer'));
  els.btnTabReport.addEventListener('click', () => showTab('report'));
  els.reportDatePick.addEventListener('change', () => { reportDate = els.reportDatePick.value || todayStr(); renderReport(); });
  els.reportViewDay.addEventListener('click', () => switchReportView('day'));
  els.reportViewWeek.addEventListener('click', () => switchReportView('week'));
  els.btnCopyReport.addEventListener('click', () => {
    navigator.clipboard.writeText(els.reportOutput.textContent).then(() => {
      els.btnCopyReport.textContent = 'copied!';
      setTimeout(() => { els.btnCopyReport.textContent = 'copy'; }, 1800);
    }).catch(() => {});
  });
}

// ══════════════════════════════════════════════
// Init
// ══════════════════════════════════════════════
function init() {
  applyTheme(load('df_theme', 'night'));
  buildTickMarks();
  initParticles();

  const activeProj = projects.find(p => p.id === state.activeProjectId);
  if (activeProj) applyProjectDurations(activeProj);

  els.settingFocus.value      = settings.focus;
  els.settingShort.value      = settings.short;
  els.settingLong.value       = settings.long;
  els.soundToggle.checked     = settings.soundEnabled;
  els.autostartToggle.checked = settings.autoStart;

  rebuildProjectSelect();

  if (state.activeLabel) {
    els.labelInput.value = state.activeLabel;
    els.tagDisplay.textContent = `// ${state.activeLabel}`;
  }

  els.reportDatePick.value = todayStr();
  switchMode(state.mode, false);
  updateSessionDots();
  updateStatsUI();
  wireEvents();

  const initEntry = els.logTerminal.querySelector('.log-time');
  if (initEntry) initEntry.textContent = new Date().toTimeString().slice(0, 8);

  if (state.activeStart) {
    const elapsed = Math.floor((Date.now() - state.activeStart) / 1000 / 60);
    addLog('system', 'SYS', `Session resumed (${elapsed}min elapsed).`);
  } else {
    addLog('system', 'SYS', '[Space] start · [D] distraction · [R] reset · [S] skip · right-click + to edit project');
  }
}

document.addEventListener('DOMContentLoaded', init);
