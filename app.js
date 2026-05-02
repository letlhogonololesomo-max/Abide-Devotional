/* =====================================================================
   Abide — App
   ===================================================================== */
(function () {
'use strict';

// ---------- Config & boot ----------
const CFG = window.ABIDE_CONFIG || {};
const STORAGE_KEY = 'abide_v1';
const DEVICE_KEY  = 'abide_device_id';

let supabase = null;
const supabaseReady = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
  !CFG.SUPABASE_URL.includes('YOUR-PROJECT'));

if (supabaseReady && window.supabase) {
  supabase = window.supabase.createClient(
    CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY,
    { global: { headers: { 'x-device-id': getDeviceId() } } }
  );
}

// ---------- State ----------
const defaultState = {
  streak: 0,
  lastSession: null,
  graceDays: 2,
  graceMonth: new Date().getMonth(),
  entries: [],
  prayers: {
    morning: { enabled: true,  time: '06:30', name: 'Morning' },
    midday:  { enabled: false, time: '12:00', name: 'Midday' },
    evening: { enabled: false, time: '18:00', name: 'Evening' },
    night:   { enabled: false, time: '22:00', name: 'Night' }
  },
  carryLine: null,
  milestonesReached: [],
  preferredTranslation: CFG.DEFAULT_TRANSLATION || 'NIV'
};

let state = loadLocal();
let session = null;

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign({}, defaultState, JSON.parse(raw));
  } catch (e) {}
  return Object.assign({}, defaultState);
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || makeUuid();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function makeUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ---------- Supabase sync ----------
async function syncFromCloud() {
  if (!supabase) return;
  setSyncStatus('syncing…');
  try {
    const deviceId = getDeviceId();

    // Pull state row
    const { data: stateRow } = await supabase
      .from('state').select('*').eq('device_id', deviceId).maybeSingle();

    // Pull entries
    const { data: entries } = await supabase
      .from('entries').select('*').eq('device_id', deviceId)
      .order('created_at', { ascending: true });

    if (stateRow) {
      // Cloud wins on conflict (we treat cloud as source of truth on load)
      state.streak             = stateRow.streak ?? state.streak;
      state.lastSession        = stateRow.last_session ?? state.lastSession;
      state.graceDays          = stateRow.grace_days ?? state.graceDays;
      state.graceMonth         = stateRow.grace_month ?? state.graceMonth;
      state.prayers            = stateRow.prayers ?? state.prayers;
      state.carryLine          = stateRow.carry_line ?? state.carryLine;
      state.milestonesReached  = stateRow.milestones_reached ?? state.milestonesReached;
      state.preferredTranslation = stateRow.preferred_translation ?? state.preferredTranslation;
    }

    if (entries) {
      state.entries = entries.map(rowToEntry);
    }

    saveLocal();
    setSyncStatus('synced');
  } catch (err) {
    console.warn('Sync from cloud failed', err);
    setSyncStatus('offline');
  }
}

async function pushStateToCloud() {
  if (!supabase) return;
  try {
    const deviceId = getDeviceId();
    await supabase.from('state').upsert({
      device_id: deviceId,
      streak: state.streak,
      last_session: state.lastSession,
      grace_days: state.graceDays,
      grace_month: state.graceMonth,
      prayers: state.prayers,
      carry_line: state.carryLine,
      milestones_reached: state.milestonesReached,
      preferred_translation: state.preferredTranslation
    });
    setSyncStatus('synced');
  } catch (err) {
    console.warn('Push state failed', err);
    setSyncStatus('offline');
  }
}

async function pushEntryToCloud(entry) {
  if (!supabase) return;
  try {
    const deviceId = getDeviceId();
    await supabase.from('entries').insert({
      id: entry.id,
      device_id: deviceId,
      method: entry.method,
      passage_ref: entry.passageRef || '',
      translation: entry.translation || 'NIV',
      passage_text: entry.passageText || null,
      fields: entry.fields || {},
      carry: entry.carry || null,
      preview: entry.preview || null,
      created_at: entry.date
    });
    setSyncStatus('synced');
  } catch (err) {
    console.warn('Push entry failed', err);
    setSyncStatus('offline');
  }
}

function rowToEntry(row) {
  return {
    id: row.id,
    date: row.created_at,
    method: row.method,
    passageRef: row.passage_ref,
    translation: row.translation,
    passageText: row.passage_text,
    fields: row.fields || {},
    carry: row.carry || '',
    preview: row.preview || ''
  };
}

function setSyncStatus(msg) {
  const el = document.getElementById('syncState');
  if (!el) return;
  if (!supabase) { el.textContent = 'local only'; return; }
  el.textContent = msg;
}

// ---------- Bible passage fetching ----------
async function fetchPassage(reference, translation) {
  // Local cache first
  const cacheKey = `passage:${translation}:${reference.toUpperCase()}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  if (!supabase) {
    return { text: '(Backend not configured. See README.)', reference };
  }

  try {
    const { data, error } = await supabase.functions.invoke('get-passage', {
      body: { reference, translation }
    });
    if (error) throw error;
    if (data && data.text) {
      localStorage.setItem(cacheKey, JSON.stringify(data));
      return data;
    }
    throw new Error(data?.error || 'No text');
  } catch (err) {
    console.warn('Passage fetch failed', err);
    return { text: null, reference, error: String(err) };
  }
}

// ---------- Anchor verses (rotates daily) ----------
const anchorVerses = [
  { text: 'Abide in me, and I in you.', ref: 'John 15:4' },
  { text: 'Be still, and know that I am God.', ref: 'Psalm 46:10' },
  { text: 'The Lord is my shepherd; I shall not want.', ref: 'Psalm 23:1' },
  { text: 'Come to me, all you who are weary and burdened, and I will give you rest.', ref: 'Matthew 11:28' },
  { text: 'I have called you by name; you are mine.', ref: 'Isaiah 43:1' },
  { text: 'His mercies are new every morning; great is your faithfulness.', ref: 'Lamentations 3:23' },
  { text: 'In him we live and move and have our being.', ref: 'Acts 17:28' },
  { text: 'Delight yourself in the Lord, and he will give you the desires of your heart.', ref: 'Psalm 37:4' }
];

// ---------- Suggested passages by method (rotated daily) ----------
const suggestedPassages = [
  'John 15:1-11', 'Psalm 23', 'Psalm 1', 'Matthew 5:1-12', 'Romans 8:28-39',
  'Philippians 4:4-9', 'Isaiah 40:28-31', 'Psalm 46', '1 Corinthians 13',
  'Hebrews 11:1-6', 'James 1:2-8', 'Psalm 139:1-12', 'John 1:1-14',
  'Ephesians 3:14-21', 'Psalm 27', 'Matthew 6:25-34', 'Galatians 5:22-26',
  'Psalm 51:1-12', '2 Corinthians 4:16-18', 'Colossians 3:1-4', 'Psalm 91'
];

function todaysPassage() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return suggestedPassages[dayOfYear % suggestedPassages.length];
}

// ---------- Milestones ----------
const milestones = [
  { days: 7,   name: 'Seven — Completion',   desc: 'A full week of returning',     verse: 'On the seventh day God rested.', ref: 'Genesis 2:2',  symbol: '✦' },
  { days: 21,  name: 'Twenty-one — Foundation', desc: 'The shape of a habit',       verse: 'Train up the way you should go.', ref: 'Proverbs 22:6', symbol: '✦✦' },
  { days: 40,  name: 'Forty — Wilderness',   desc: 'Tested and formed',            verse: 'Forty days in the wilderness.',  ref: 'Matthew 4:2', symbol: '✦✦✦' },
  { days: 90,  name: 'Ninety — Season',      desc: 'A season of seeking',          verse: 'There is a time for every season.', ref: 'Ecclesiastes 3:1', symbol: '✧✦✧' },
  { days: 365, name: 'Year — Faithfulness',  desc: 'A year of faithfulness',       verse: 'Well done, good and faithful servant.', ref: 'Matthew 25:21', symbol: '✦✦✦✦✦' }
];

// =====================================================================
// UI / Rendering
// =====================================================================

function init() {
  updateGreeting();
  updateDate();
  rotateAnchorVerse();
  resetGraceIfNewMonth();
  setupTabs();
  renderToday();
  renderJournal();
  renderPrayer();
  renderWalk();

  // Sync from cloud on boot, then re-render with cloud data
  if (supabase) {
    // First push our local state so the row exists (idempotent upsert).
    // Then pull whatever's in cloud and re-render.
    pushStateToCloud()
      .then(syncFromCloud)
      .then(() => {
        renderToday(); renderJournal(); renderPrayer(); renderWalk();
      });
  } else {
    setSyncStatus('local only');
  }

  // Initialize OneSignal if configured
  if (CFG.ONESIGNAL_APP_ID) initOneSignal();
}

function updateGreeting() {
  const h = new Date().getHours();
  const g = document.getElementById('greetText');
  if (h < 5)       g.textContent = 'Late watches of the night';
  else if (h < 12) g.textContent = 'Peace be with you';
  else if (h < 17) g.textContent = 'The Lord watches over you';
  else if (h < 21) g.textContent = 'Evening grace';
  else             g.textContent = 'He gives his beloved rest';
}

function updateDate() {
  document.getElementById('dateText').textContent =
    new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function rotateAnchorVerse() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const v = anchorVerses[dayOfYear % anchorVerses.length];
  document.getElementById('anchorVerse').textContent = v.text;
  document.getElementById('anchorRef').textContent = '— ' + v.ref;
}

function resetGraceIfNewMonth() {
  const m = new Date().getMonth();
  if (state.graceMonth !== m) {
    state.graceDays = 2;
    state.graceMonth = m;
    saveLocal();
  }
}

function renderToday() {
  document.getElementById('streakValue').innerHTML =
    `${state.streak}<small>${state.streak === 1 ? 'day' : 'days'}</small>`;
  document.getElementById('entriesValue').innerHTML =
    `${state.entries.length}<small>${state.entries.length === 1 ? 'entry' : 'entries'}</small>`;

  const idEl = document.getElementById('identityText');
  if (state.entries.length === 0) {
    idEl.textContent = 'You are beginning a journey of listening.';
  } else if (state.streak >= 21) {
    idEl.textContent = `You are someone who hears. ${state.entries.length} times you've stopped to listen.`;
  } else if (state.streak >= 7) {
    idEl.textContent = `You're becoming someone who shows up. ${state.streak} mornings in a row.`;
  } else if (state.entries.length >= 3) {
    idEl.textContent = `You've written down ${state.entries.length} things the Lord has spoken.`;
  } else {
    idEl.textContent = "You're learning to be still. Keep going.";
  }

  const next = getNextPrayer();
  const np = document.getElementById('nextPrayer');
  if (next) {
    document.getElementById('nextPrayerName').textContent = next.name;
    document.getElementById('nextPrayerTime').textContent = next.time;
    np.style.display = 'flex';
  } else {
    np.style.display = 'none';
  }
}

function getNextPrayer() {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const enabled = Object.values(state.prayers).filter(p => p.enabled);
  if (!enabled.length) return null;
  for (const p of enabled) {
    const [h, m] = p.time.split(':').map(Number);
    if (h * 60 + m > nowMin) return p;
  }
  return enabled[0];
}

function renderJournal() {
  const list = document.getElementById('journalList');
  if (!state.entries.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">✦</div><div class="text">Your journal is empty.<br>Begin a devotion to write your first entry.</div></div>`;
    return;
  }
  list.innerHTML = state.entries.slice().reverse().map(e => `
    <div class="journal-entry">
      <div class="meta">
        <span class="date">${formatDate(e.date)}</span>
        <span class="method-tag">${e.method}</span>
      </div>
      <div class="ref">${escapeHtml(e.passageRef || 'Free reflection')} · ${e.translation || 'NIV'}</div>
      <div class="preview">${escapeHtml(e.preview || '(no reflection)')}</div>
    </div>
  `).join('');
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 86400000;
  if (diff < 1) return 'Today, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 2) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function renderPrayer() {
  const list = document.getElementById('prayerList');
  list.innerHTML = Object.entries(state.prayers).map(([key, p]) => `
    <div class="prayer-card">
      <div class="row">
        <div style="flex:1;">
          <div class="name">${p.name}</div>
        </div>
        <input type="time" class="time-input" value="${p.time}" data-prayer-key="${key}">
        <div class="toggle ${p.enabled ? 'on' : ''}" data-toggle-key="${key}"></div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.toggle').forEach(t => {
    t.addEventListener('click', () => togglePrayer(t.dataset.toggleKey));
  });
  list.querySelectorAll('.time-input').forEach(i => {
    i.addEventListener('change', () => {
      state.prayers[i.dataset.prayerKey].time = i.value;
      saveLocal(); pushStateToCloud(); renderToday();
      if (CFG.ONESIGNAL_APP_ID) syncOneSignalSchedules();
    });
  });

  // Notification status
  const ns = document.getElementById('notificationStatus');
  if (!CFG.ONESIGNAL_APP_ID) {
    ns.innerHTML = `<div>Notifications aren't set up yet. When OneSignal is configured (see README), you'll be prompted to enable prayer reminders here.</div>`;
  } else if (window.OneSignalDeferred && window.__abideOSReady) {
    ns.innerHTML = `<div>Prayer reminders are active. Notifications will appear at your scheduled times.</div>`;
  } else {
    ns.innerHTML = `<div>Tap to enable prayer reminders on this device.</div><button onclick="App.requestNotificationPermission()">Enable notifications</button>`;
  }
}

function togglePrayer(key) {
  state.prayers[key].enabled = !state.prayers[key].enabled;
  saveLocal();
  pushStateToCloud();
  renderPrayer();
  renderToday();
  if (CFG.ONESIGNAL_APP_ID) syncOneSignalSchedules();
}

function renderWalk() {
  document.getElementById('walkStreak').innerHTML =
    `${state.streak}<small>days</small>`;
  document.getElementById('walkGrace').innerHTML =
    `${state.graceDays}<small>left</small>`;

  const idEl = document.getElementById('walkIdentity');
  if (state.streak === 0)        idEl.textContent = 'Your walk is just beginning. Show up tomorrow.';
  else if (state.streak < 7)     idEl.textContent = `${state.streak} ${state.streak === 1 ? 'day' : 'days'} of returning. Keep going.`;
  else                            idEl.textContent = `${state.streak} days. You are becoming someone who seeks him.`;

  // Translation picker
  const tp = document.getElementById('translationPicker');
  tp.innerHTML = (CFG.TRANSLATIONS || ['NIV']).map(t =>
    `<button class="${state.preferredTranslation === t ? 'active' : ''}" data-trans="${t}">${t}</button>`
  ).join('');
  tp.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      state.preferredTranslation = b.dataset.trans;
      saveLocal(); pushStateToCloud(); renderWalk();
      toast(`Translation set to ${b.dataset.trans}`);
    });
  });

  document.getElementById('milestoneList').innerHTML = milestones.map(m => {
    const reached = state.streak >= m.days;
    return `
      <div class="milestone">
        <div class="badge ${reached ? 'reached' : 'locked'}">${reached ? m.symbol : m.days}</div>
        <div class="info">
          <div class="name">${m.name}</div>
          <div class="desc">${m.desc}</div>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('deviceInfo').innerHTML = `
    <div class="label">Device ID</div>
    ${escapeHtml(getDeviceId())}
    <div class="label" style="margin-top:8px;">Backend</div>
    ${supabase ? 'Supabase connected' : 'Local only — see README to connect'}
  `;
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTo(t.dataset.screen));
  });
}

function switchTo(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  const tab = document.querySelector(`.tab[data-screen="${name}"]`);
  if (tab) tab.classList.add('active');
  document.getElementById('topbar').style.display = (name === 'session') ? 'none' : 'flex';
  document.getElementById('tabbar').style.display = (name === 'session') ? 'none' : 'grid';
}

// =====================================================================
// Session engine
// =====================================================================

function buildSteps(method, passageRef) {
  const stillness = {
    label: 'STILLNESS',
    render: () => `
      <div class="stillness">
        <div class="breath-circle">✦</div>
        <div class="stillness-text">"Be still, and know that I am God."</div>
      </div>
    `
  };

  const passageStep = (label, prompt) => ({
    label,
    needsPassage: true,
    render: (passage) => `
      <h2 class="step-title">${prompt.title}</h2>
      <p class="step-prompt">${prompt.body}</p>
      <div class="passage-input">
        <input type="text" id="passage-ref" value="${escapeHtml(passageRef)}" placeholder="e.g. John 3:16-21">
        <button onclick="App.reloadPassage()">Load</button>
      </div>
      <div id="passage-container">
        ${renderPassageBlock(passage)}
      </div>
    `
  });

  const writeStep = (label, title, prompt, fieldId) => ({
    label,
    fieldId,
    render: () => `
      <h2 class="step-title">${title}</h2>
      <p class="step-prompt">${prompt}</p>
      <textarea class="field" id="${fieldId}" placeholder="Write here..."></textarea>
    `
  });

  const carryStep = {
    label: 'CARRY',
    fieldId: 'field-carry',
    render: () => `
      <h2 class="step-title">One line to carry</h2>
      <p class="step-prompt">What single truth will you carry into today? Keep it short — something you can repeat.</p>
      <textarea class="field" id="field-carry" placeholder="Today I carry..." style="min-height: 80px;"></textarea>
    `
  };

  const skeletons = {
    lectio: [
      stillness,
      passageStep('READ',     { title: 'Read slowly', body: 'Read the passage once. Notice the rhythm of the words. Let it wash over you.' }),
      passageStep('MEDITATE', { title: 'Read again',  body: 'A word or phrase will likely stand out. Read again and notice what catches you.' }),
      writeStep('LISTENING', 'What stood out?', 'What word, phrase, or image is the Lord highlighting? Write what you sense him saying.', 'field-listening'),
      writeStep('PRAYER', 'Pray it back', 'Speak to God about what you noticed. What does it stir in you? What do you want to ask?', 'field-prayer'),
      carryStep
    ],
    soap: [
      stillness,
      passageStep('SCRIPTURE', { title: 'Scripture', body: 'Read the passage. Underline the verse that speaks loudest.' }),
      writeStep('OBSERVATION', 'Observation', 'What is happening in this passage? What does it say about God? About people?', 'field-observation'),
      writeStep('APPLICATION', 'Application', 'How does this apply to your life today? What needs to change, or what is being affirmed?', 'field-application'),
      writeStep('PRAYER', 'Prayer', 'Pray this passage back to God in your own words.', 'field-prayer'),
      carryStep
    ],
    plan: [
      stillness,
      passageStep('READING', { title: "Today's reading", body: 'Read carefully. Take your time.' }),
      writeStep('LISTENING', 'What is he saying?', 'What is the Lord saying to you through this reading? Write freely.', 'field-listening'),
      carryStep
    ],
    free: [
      stillness,
      passageStep('PASSAGE', { title: 'A word for today', body: 'Sit with this passage. No prompts, no structure — just you and the Word.' }),
      writeStep('REFLECTION', 'Free reflection', 'Whatever the Spirit stirs. There are no wrong answers here.', 'field-listening'),
      carryStep
    ]
  };

  return skeletons[method];
}

function renderPassageBlock(passage) {
  if (!passage) return `<div class="passage-loading">Loading passage…</div>`;
  if (passage.error) return `<div class="passage-error">Could not load passage: ${escapeHtml(passage.error)}</div>`;
  if (!passage.text) return `<div class="passage-error">No passage loaded yet.</div>`;
  return `
    <div class="passage">
      ${escapeHtml(passage.text).replace(/\n/g, '<br>')}
      <div class="passage-ref">— ${escapeHtml(passage.reference || '')}</div>
    </div>
  `;
}

async function startSession(method) {
  closeMethodPicker();
  const ref = todaysPassage();
  session = {
    method,
    steps: buildSteps(method, ref),
    current: 0,
    data: {},
    passageRef: ref,
    passage: null
  };
  switchTo('session');
  renderSessionStep();
  // Pre-fetch the passage so it's ready when they reach the Scripture step
  loadPassageForSession();
}

async function loadPassageForSession() {
  if (!session) return;
  const trans = state.preferredTranslation || 'NIV';
  const result = await fetchPassage(session.passageRef, trans);
  session.passage = result;
  // Re-render only the passage container if currently visible
  const container = document.getElementById('passage-container');
  if (container) container.innerHTML = renderPassageBlock(result);
}

async function reloadPassage() {
  if (!session) return;
  const input = document.getElementById('passage-ref');
  if (input) session.passageRef = input.value.trim();
  const container = document.getElementById('passage-container');
  if (container) container.innerHTML = renderPassageBlock(null);
  await loadPassageForSession();
}

function renderSessionStep() {
  const step = session.steps[session.current];
  document.getElementById('stepLabel').textContent = step.label;
  document.getElementById('sessionBody').innerHTML = step.render(session.passage);

  // Restore field if present
  if (step.fieldId && session.data[step.fieldId]) {
    const f = document.getElementById(step.fieldId);
    if (f) f.value = session.data[step.fieldId];
  }

  // Progress dots
  document.getElementById('progressDots').innerHTML =
    session.steps.map((_, i) => {
      let cls = '';
      if (i < session.current) cls = 'done';
      else if (i === session.current) cls = 'active';
      return `<div class="dot ${cls}"></div>`;
    }).join('');

  // Footer
  const footer = document.getElementById('sessionFooter');
  const isLast = session.current === session.steps.length - 1;
  const isFirst = session.current === 0;
  let html = '';
  if (!isFirst) html += `<button class="btn btn-secondary" onclick="App.prevStep()">Back</button>`;
  if (isLast) {
    html += `<button class="btn btn-primary" onclick="App.finishSession()">Complete</button>`;
  } else if (step.label === 'STILLNESS') {
    html += `<button class="btn btn-secondary btn-skip" onclick="App.nextStep()">Skip</button>`;
    html += `<button class="btn btn-primary" onclick="App.nextStep()">Continue</button>`;
  } else {
    html += `<button class="btn btn-primary" onclick="App.nextStep()">Continue</button>`;
  }
  footer.innerHTML = html;
}

function captureField() {
  const step = session.steps[session.current];
  if (step.fieldId) {
    const el = document.getElementById(step.fieldId);
    if (el) session.data[step.fieldId] = el.value;
  }
  // Also capture passage ref from input if present
  const refInput = document.getElementById('passage-ref');
  if (refInput) session.passageRef = refInput.value.trim();
}

function nextStep() { captureField(); session.current++; renderSessionStep(); }
function prevStep() { captureField(); session.current--; renderSessionStep(); }

function exitSession() {
  if (confirm('Leave this session? Your reflection will not be saved.')) {
    session = null;
    switchTo('today');
  }
}

async function finishSession() {
  captureField();
  const listening = session.data['field-listening'] || session.data['field-application'] || session.data['field-observation'] || '';
  const carry = session.data['field-carry'] || '';

  const entry = {
    id: makeUuid(),
    date: new Date().toISOString(),
    method: session.method.toUpperCase(),
    passageRef: session.passageRef,
    translation: state.preferredTranslation || 'NIV',
    passageText: session.passage?.text || null,
    fields: { ...session.data },
    carry,
    preview: listening || carry || '(no reflection)'
  };
  state.entries.push(entry);
  state.carryLine = carry;

  // Streak logic
  const today = new Date().toDateString();
  const last = state.lastSession ? new Date(state.lastSession).toDateString() : null;
  if (last !== today) {
    if (last === null) state.streak = 1;
    else {
      const diffDays = Math.round((new Date(today) - new Date(last)) / 86400000);
      if (diffDays === 1) state.streak += 1;
      else if (diffDays > 1) {
        // Use a grace day if available, else reset
        if (diffDays === 2 && state.graceDays > 0) {
          state.graceDays -= 1;
          state.streak += 1;
          toast(`Grace day used. ${state.graceDays} left this month.`);
        } else {
          state.streak = 1;
        }
      }
    }
  }
  state.lastSession = new Date().toISOString();

  const reached = milestones.find(m => m.days === state.streak && !state.milestonesReached.includes(m.days));
  if (reached) state.milestonesReached.push(reached.days);

  saveLocal();
  // Push state first — entries table has FK to state.device_id, so the
  // state row must exist before we insert an entry on a brand new device.
  await pushStateToCloud();
  await pushEntryToCloud(entry);

  session = null;
  renderToday(); renderJournal(); renderWalk();

  if (reached) showReward(reached);
  else switchTo('today');
}

// ---------- Reward popup ----------
function showReward(m) {
  document.getElementById('rewardSymbol').textContent = m.symbol;
  document.getElementById('rewardTitle').textContent = m.name;
  document.getElementById('rewardVerse').textContent = `"${m.verse}"`;
  document.getElementById('rewardRef').textContent = '— ' + m.ref;
  document.getElementById('rewardPopup').classList.add('active');
}
function closeReward() {
  document.getElementById('rewardPopup').classList.remove('active');
  switchTo('today');
}

// ---------- Modal ----------
function openMethodPicker()  { document.getElementById('methodModal').classList.add('active'); }
function closeMethodPicker() { document.getElementById('methodModal').classList.remove('active'); }

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// =====================================================================
// OneSignal integration (optional — only runs if APP_ID is configured)
// =====================================================================
function initOneSignal() {
  if (!CFG.ONESIGNAL_APP_ID) return;
  const s = document.createElement('script');
  s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
  s.defer = true;
  document.head.appendChild(s);

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function(OneSignal) {
    await OneSignal.init({
      appId: CFG.ONESIGNAL_APP_ID,
      allowLocalhostAsSecureOrigin: true,
      notifyButton: { enable: false }
    });
    window.__abideOSReady = true;
    // Tag user with their device ID for targeted scheduling
    try {
      await OneSignal.User.addTag('device_id', getDeviceId());
      // Capture player/subscription ID for backend scheduling later
      const playerId = await OneSignal.User.PushSubscription.id;
      if (playerId && supabase) {
        // Ensure the state row exists first, then update.
        // We use upsert with onConflict to merge cleanly.
        await pushStateToCloud();
        await supabase.from('state')
          .update({ onesignal_player_id: playerId })
          .eq('device_id', getDeviceId());
      }
    } catch (e) { console.warn('OneSignal tagging failed', e); }
    renderPrayer();
  });
}

async function requestNotificationPermission() {
  if (!window.OneSignalDeferred) {
    toast('OneSignal not loaded yet — wait a moment and try again');
    return;
  }
  window.OneSignalDeferred.push(async function(OneSignal) {
    try {
      await OneSignal.Notifications.requestPermission();
      renderPrayer();
      toast('Notifications enabled');
    } catch (e) {
      toast('Could not enable notifications');
    }
  });
}

async function syncOneSignalSchedules() {
  // Placeholder — actual scheduling is handled server-side by a Supabase
  // scheduled function (see docs/SCHEDULER.md) that reads `prayers` from
  // each user's state row and sends a OneSignal notification at the
  // appropriate local time. The frontend only updates the data.
}

// =====================================================================
// Public API
// =====================================================================
window.App = {
  openMethodPicker, closeMethodPicker,
  startSession, exitSession, nextStep, prevStep, finishSession,
  reloadPassage, closeReward,
  requestNotificationPermission
};

// Boot
document.addEventListener('DOMContentLoaded', init);

})();
