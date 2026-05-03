/* =====================================================================
   Abide — App
   Home chooser + Devotion + Memorise (with spaced repetition + type-back)
   ===================================================================== */
(function () {
'use strict';

// =====================================================================
// Config & Supabase
// =====================================================================
const CFG = window.ABIDE_CONFIG || {};
const STORAGE_KEY = 'abide_v2';
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

// =====================================================================
// State
// =====================================================================
const defaultState = {
  streak: 0,
  lastSession: null,
  graceDays: 2,
  graceMonth: new Date().getMonth(),
  entries: [],
  verses: [],          // memorisation
  prayers: {
    morning: { enabled: true,  time: '06:30', name: 'Morning' },
    midday:  { enabled: false, time: '12:00', name: 'Midday' },
    evening: { enabled: false, time: '18:00', name: 'Evening' },
    night:   { enabled: false, time: '22:00', name: 'Night' }
  },
  carryLine: null,
  milestonesReached: [],
  preferredTranslation: CFG.DEFAULT_TRANSLATION || 'NIV',
  todayPracticeFlags: { date: null, devotion: false, memorise: false }
};

let state = loadLocal();
let session = null;       // devotion session
let review = null;        // memorisation review session
let verseFilter = 'all';
let addTab = 'single';

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

// =====================================================================
// Cloud sync
// =====================================================================
async function syncFromCloud() {
  if (!supabase) return;
  setSyncStatus('syncing…');
  try {
    const deviceId = getDeviceId();

    const { data: stateRow } = await supabase
      .from('state').select('*').eq('device_id', deviceId).maybeSingle();

    const { data: entries } = await supabase
      .from('entries').select('*').eq('device_id', deviceId)
      .order('created_at', { ascending: true });

    const { data: verses } = await supabase
      .from('memorise_verses').select('*').eq('device_id', deviceId)
      .order('created_at', { ascending: true });

    if (stateRow) {
      state.streak             = stateRow.streak ?? state.streak;
      state.lastSession        = stateRow.last_session ?? state.lastSession;
      state.graceDays          = stateRow.grace_days ?? state.graceDays;
      state.graceMonth         = stateRow.grace_month ?? state.graceMonth;
      state.prayers            = stateRow.prayers ?? state.prayers;
      state.carryLine          = stateRow.carry_line ?? state.carryLine;
      state.milestonesReached  = stateRow.milestones_reached ?? state.milestonesReached;
      state.preferredTranslation = stateRow.preferred_translation ?? state.preferredTranslation;
    }

    if (entries) state.entries = entries.map(rowToEntry);
    if (verses)  state.verses  = verses.map(rowToVerse);

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
    await supabase.from('state').upsert({
      device_id: getDeviceId(),
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
    await supabase.from('entries').insert({
      id: entry.id,
      device_id: getDeviceId(),
      method: entry.method,
      passage_ref: entry.passageRef || '',
      translation: entry.translation || 'NIV',
      passage_text: entry.passageText || null,
      fields: entry.fields || {},
      carry: entry.carry || null,
      preview: entry.preview || null,
      created_at: entry.date,
      linked_verse_id: entry.linkedVerseId || null
    });
  } catch (err) { console.warn('Push entry failed', err); }
}

async function pushVerseToCloud(verse) {
  if (!supabase) return;
  try {
    await supabase.from('memorise_verses').upsert({
      id: verse.id,
      device_id: getDeviceId(),
      reference: verse.reference,
      translation: verse.translation || null,
      passage_text: verse.passageText,
      tags: verse.tags || [],
      level: verse.level,
      ease: verse.ease,
      interval_days: verse.intervalDays,
      next_review: verse.nextReview,
      last_review: verse.lastReview,
      review_count: verse.reviewCount,
      created_at: verse.createdAt
    });
  } catch (err) { console.warn('Push verse failed', err); }
}

async function deleteVerseFromCloud(verseId) {
  if (!supabase) return;
  try {
    await supabase.from('memorise_verses').delete().eq('id', verseId);
  } catch (err) { console.warn('Delete verse failed', err); }
}

async function pushReviewToCloud(rev) {
  if (!supabase) return;
  try {
    await supabase.from('memorise_reviews').insert({
      verse_id: rev.verseId,
      device_id: getDeviceId(),
      result: rev.result,
      mode: rev.mode
    });
  } catch (err) { console.warn('Push review failed', err); }
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
    preview: row.preview || '',
    linkedVerseId: row.linked_verse_id || null
  };
}

function rowToVerse(row) {
  return {
    id: row.id,
    reference: row.reference,
    translation: row.translation || '',
    passageText: row.passage_text,
    tags: row.tags || [],
    level: row.level,
    ease: row.ease,
    intervalDays: row.interval_days,
    nextReview: row.next_review,
    lastReview: row.last_review,
    reviewCount: row.review_count,
    createdAt: row.created_at
  };
}

function setSyncStatus(msg) {
  const el = document.getElementById('syncState');
  if (!el) return;
  if (!supabase) { el.textContent = 'local only'; return; }
  el.textContent = msg;
}

// =====================================================================
// Anchor verses (rotates daily)
// =====================================================================
const anchorVerses = [
  { text: 'Abide in me, and I in you.', ref: 'John 15:4' },
  { text: 'Be still, and know that I am God.', ref: 'Psalm 46:10' },
  { text: 'The Lord is my shepherd; I shall not want.', ref: 'Psalm 23:1' },
  { text: 'Come to me, all you who are weary and burdened, and I will give you rest.', ref: 'Matthew 11:28' },
  { text: 'I have called you by name; you are mine.', ref: 'Isaiah 43:1' },
  { text: 'His mercies are new every morning; great is your faithfulness.', ref: 'Lamentations 3:23' },
  { text: 'In him we live and move and have our being.', ref: 'Acts 17:28' },
  { text: 'Delight yourself in the Lord, and he will give you the desires of your heart.', ref: 'Psalm 37:4' },
  { text: 'I have hidden your word in my heart, that I might not sin against you.', ref: 'Psalm 119:11' },
  { text: 'Your word is a lamp for my feet, a light on my path.', ref: 'Psalm 119:105' }
];

function dayOfYear() {
  return Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
}

// =====================================================================
// Milestones
// =====================================================================
const milestones = [
  { days: 7,   name: 'Seven — Completion',    desc: 'A full week of returning',  verse: 'On the seventh day God rested.', ref: 'Genesis 2:2',  symbol: '✦' },
  { days: 21,  name: 'Twenty-one — Foundation', desc: 'The shape of a habit',     verse: 'Train up the way you should go.', ref: 'Proverbs 22:6', symbol: '✦✦' },
  { days: 40,  name: 'Forty — Wilderness',    desc: 'Tested and formed',         verse: 'Forty days in the wilderness.',  ref: 'Matthew 4:2',  symbol: '✦✦✦' },
  { days: 90,  name: 'Ninety — Season',       desc: 'A season of seeking',       verse: 'There is a time for every season.', ref: 'Ecclesiastes 3:1', symbol: '✧✦✧' },
  { days: 365, name: 'Year — Faithfulness',   desc: 'A year of faithfulness',    verse: 'Well done, good and faithful servant.', ref: 'Matthew 25:21', symbol: '✦✦✦✦✦' }
];

// =====================================================================
// Spaced repetition (simplified SM-2)
// =====================================================================
// On a successful review:
//   if reviewCount === 0  → interval = 1 day
//   if reviewCount === 1  → interval = 3 days
//   else                  → interval = round(prev * ease)
//   ease += 0.10  (capped at 3.5)
// On 'almost':
//   interval stays similar (interval = max(1, prev))
//   ease -= 0.05
// On 'forgot':
//   interval = 1 day
//   ease -= 0.20
//   reviewCount = 0  (reset learning)
// Levels are derived from intervalDays after the update.

function applyReviewToVerse(verse, result) {
  let { ease, intervalDays, reviewCount } = verse;
  ease = ease || 2.5;
  reviewCount = reviewCount || 0;

  if (result === 'had_it') {
    if (reviewCount === 0)      intervalDays = 1;
    else if (reviewCount === 1) intervalDays = 3;
    else                        intervalDays = Math.max(1, Math.round(intervalDays * ease));
    ease = Math.min(3.5, ease + 0.10);
    reviewCount += 1;
  } else if (result === 'almost') {
    intervalDays = Math.max(1, Math.round(intervalDays * 0.8));
    ease = Math.max(1.3, ease - 0.05);
    reviewCount += 1;
  } else { // forgot
    intervalDays = 1;
    ease = Math.max(1.3, ease - 0.20);
    reviewCount = 0;
  }

  // Cap interval at 180 days for sanity
  intervalDays = Math.min(180, intervalDays);

  const next = new Date();
  next.setDate(next.getDate() + intervalDays);

  verse.ease = Math.round(ease * 100) / 100;
  verse.intervalDays = intervalDays;
  verse.reviewCount = reviewCount;
  verse.lastReview = new Date().toISOString();
  verse.nextReview = next.toISOString();
  verse.level = deriveLevel(verse);
  return verse;
}

function deriveLevel(verse) {
  const days = verse.intervalDays || 0;
  const count = verse.reviewCount || 0;
  if (count === 0)   return 'new';
  if (days < 7)      return 'learning';
  if (days < 30)     return 'familiar';
  if (days < 90)     return 'confident';
  return 'mastered';
}

function dueVerses() {
  const now = Date.now();
  return state.verses.filter(v => new Date(v.nextReview).getTime() <= now);
}

function newVerses() {
  return state.verses.filter(v => v.reviewCount === 0);
}

// =====================================================================
// Init
// =====================================================================
function init() {
  updateGreeting();
  updateDate();
  rotateAnchorVerse();
  resetGraceIfNewMonth();
  resetTodayFlagsIfNewDay();
  setupTabs();
  setupFilterBar();

  renderHome();
  renderDevotion();
  renderMemorise();
  renderJournal();
  renderPrayer();
  renderWalk();

  if (supabase) {
    pushStateToCloud()
      .then(syncFromCloud)
      .then(() => {
        renderHome(); renderDevotion(); renderMemorise();
        renderJournal(); renderPrayer(); renderWalk();
      });
  } else {
    setSyncStatus('local only');
  }

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
  const v = anchorVerses[dayOfYear() % anchorVerses.length];
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

function resetTodayFlagsIfNewDay() {
  const today = new Date().toDateString();
  if (state.todayPracticeFlags?.date !== today) {
    state.todayPracticeFlags = { date: today, devotion: false, memorise: false };
    saveLocal();
  }
}

// =====================================================================
// Home renderer
// =====================================================================
function renderHome() {
  // Devotion meta
  const devEl = document.getElementById('devotionMeta');
  if (state.streak > 0) devEl.textContent = `Day ${state.streak} · ${state.entries.length} ${state.entries.length === 1 ? 'entry' : 'entries'}`;
  else devEl.textContent = 'Begin today\'s reflection';

  // Memorise meta
  const memEl = document.getElementById('memoriseMeta');
  const due = dueVerses().length;
  const total = state.verses.length;
  if (total === 0) memEl.textContent = 'Hide his word in your heart';
  else if (due > 0) memEl.textContent = `${due} due · ${total} total`;
  else memEl.textContent = `${total} ${total === 1 ? 'verse' : 'verses'} · all current`;

  // Identity reflection
  const idEl = document.getElementById('identityText');
  idEl.textContent = computeIdentityLine();

  // Next prayer
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

function computeIdentityLine() {
  const e = state.entries.length;
  const v = state.verses.length;
  const masteredCount = state.verses.filter(x => x.level === 'mastered').length;

  if (e === 0 && v === 0) return 'You are beginning a journey of listening.';
  if (state.streak >= 21) {
    if (v >= 5) return `You are someone who hears and remembers. ${e} reflections, ${v} verses hidden.`;
    return `You are someone who hears. ${e} times you've stopped to listen.`;
  }
  if (state.streak >= 7) return `You're becoming someone who shows up. ${state.streak} days in a row.`;
  if (masteredCount >= 3) return `${masteredCount} verses mastered. The word is becoming part of you.`;
  if (e >= 3) return `You've written down ${e} things the Lord has spoken.`;
  if (v >= 3) return `${v} verses planted. Keep returning to them.`;
  return "You're learning to be still. Keep going.";
}

// =====================================================================
// Devotion renderer
// =====================================================================
function renderDevotion() {
  document.getElementById('streakValue').innerHTML =
    `${state.streak}<small>${state.streak === 1 ? 'day' : 'days'}</small>`;
  document.getElementById('entriesValue').innerHTML =
    `${state.entries.length}<small>${state.entries.length === 1 ? 'entry' : 'entries'}</small>`;

  // Recent entries (last 3)
  const recent = state.entries.slice(-3).reverse();
  const title = document.getElementById('recentDevotionsTitle');
  const list = document.getElementById('recentDevotions');
  if (recent.length) {
    title.style.display = 'block';
    list.innerHTML = recent.map(e => `
      <div class="journal-entry">
        <div class="meta">
          <span class="date">${formatDate(e.date)}</span>
          <span class="method-tag">${e.method}</span>
        </div>
        <div class="ref">${escapeHtml(e.passageRef || 'Free reflection')}</div>
        <div class="preview">${escapeHtml(e.preview || '')}</div>
      </div>
    `).join('');
  } else {
    title.style.display = 'none';
    list.innerHTML = '';
  }
}

// =====================================================================
// Memorise renderer
// =====================================================================
function renderMemorise() {
  const due = dueVerses();
  const total = state.verses.length;

  // Summary
  const summary = document.getElementById('memoriseSummary');
  if (total === 0) {
    summary.innerHTML = `
      <div class="empty-state">
        <div class="icon">∞</div>
        <div class="text">No verses yet. Tap "Add verse" below to begin hiding his word in your heart.</div>
      </div>
    `;
  } else {
    const newCount = newVerses().length;
    const masteredCount = state.verses.filter(v => v.level === 'mastered').length;
    summary.innerHTML = `
      <div class="memorise-stats">
        <div><span class="stat-num">${due.length}</span><span class="stat-lbl">due today</span></div>
        <div><span class="stat-num">${newCount}</span><span class="stat-lbl">new</span></div>
        <div><span class="stat-num">${masteredCount}</span><span class="stat-lbl">mastered</span></div>
      </div>
    `;
  }

  // Review button state
  const btn = document.getElementById('reviewBtn');
  if (due.length > 0) {
    btn.textContent = `Review ${due.length} ${due.length === 1 ? 'verse' : 'verses'}`;
    btn.disabled = false;
  } else if (total === 0) {
    btn.textContent = 'Begin Review';
    btn.disabled = true;
  } else {
    btn.textContent = 'Nothing due — review anyway';
    btn.disabled = false;
  }

  // List
  const list = document.getElementById('verseList');
  let filtered = state.verses.slice();
  if (verseFilter === 'due')       filtered = filtered.filter(v => new Date(v.nextReview) <= new Date());
  else if (verseFilter === 'learning')  filtered = filtered.filter(v => v.level === 'new' || v.level === 'learning');
  else if (verseFilter === 'mastered')  filtered = filtered.filter(v => v.level === 'mastered');

  if (!state.verses.length) {
    list.innerHTML = '';
    return;
  }
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="text">No verses match this filter.</div></div>`;
    return;
  }

  list.innerHTML = filtered.map(v => {
    const dueText = describeDue(v);
    const dots = renderDots(v.level);
    return `
      <div class="verse-row" onclick="App.viewVerse('${v.id}')">
        <div class="verse-row-head">
          <div class="verse-ref-line">${escapeHtml(v.reference)}${v.translation ? ' <span class="trans">· ' + escapeHtml(v.translation) + '</span>' : ''}</div>
          <div class="verse-dots">${dots}</div>
        </div>
        <div class="verse-preview">${escapeHtml(truncate(v.passageText, 90))}</div>
        <div class="verse-due">${dueText}</div>
      </div>
    `;
  }).join('');
}

function describeDue(v) {
  const now = new Date();
  const due = new Date(v.nextReview);
  const diffMs = due - now;
  const diffDays = Math.round(diffMs / 86400000);
  if (v.reviewCount === 0) return 'New';
  if (diffMs <= 0) return 'Due now';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays < 7)  return `Due in ${diffDays} days`;
  if (diffDays < 30) return `Due in ${Math.round(diffDays / 7)} weeks`;
  return `Due in ${Math.round(diffDays / 30)} months`;
}

function renderDots(level) {
  const order = ['new','learning','familiar','confident','mastered'];
  const idx = order.indexOf(level);
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += `<span class="dot${i <= idx ? ' filled' : ''}"></span>`;
  }
  return html;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n).trim() + '…' : s;
}

function setupFilterBar() {
  document.querySelectorAll('#verseFilterBar .filter-pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#verseFilterBar .filter-pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      verseFilter = p.dataset.filter;
      renderMemorise();
    });
  });
}

// =====================================================================
// Add verse modal
// =====================================================================
function openAddVerseModal() {
  document.getElementById('addVerseRef').value = '';
  document.getElementById('addVerseTrans').value = state.preferredTranslation || '';
  document.getElementById('addVerseText').value = '';
  document.getElementById('addVerseTags').value = '';
  document.getElementById('addVerseBulkText').value = '';
  switchAddTab('single');
  document.getElementById('addVerseModal').classList.add('active');
}

function closeAddVerseModal() {
  document.getElementById('addVerseModal').classList.remove('active');
}

function switchAddTab(tab) {
  addTab = tab;
  document.querySelectorAll('.add-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  document.getElementById('addVerseSingle').style.display = tab === 'single' ? 'block' : 'none';
  document.getElementById('addVerseBulk').style.display   = tab === 'bulk'   ? 'block' : 'none';
}

async function saveNewVerse() {
  const ref = document.getElementById('addVerseRef').value.trim();
  const trans = document.getElementById('addVerseTrans').value.trim();
  const text = document.getElementById('addVerseText').value.trim();
  const tagsRaw = document.getElementById('addVerseTags').value.trim();

  if (!ref) { toast('Reference is required'); return; }
  if (!text) { toast('Passage text is required'); return; }

  const tags = tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const verse = makeVerse(ref, trans, text, tags);
  state.verses.push(verse);
  saveLocal();
  await pushVerseToCloud(verse);
  closeAddVerseModal();
  renderMemorise();
  renderHome();
  toast('Verse added');
}

async function saveBulkVerses() {
  const text = document.getElementById('addVerseBulkText').value;
  const parsed = parseBulkVerses(text);
  if (!parsed.length) { toast('Could not find any verses to parse'); return; }

  for (const p of parsed) {
    const verse = makeVerse(p.reference, p.translation, p.passageText, []);
    state.verses.push(verse);
    await pushVerseToCloud(verse);
  }
  saveLocal();
  closeAddVerseModal();
  renderMemorise();
  renderHome();
  toast(`Added ${parsed.length} ${parsed.length === 1 ? 'verse' : 'verses'}`);
}

function makeVerse(reference, translation, passageText, tags) {
  return {
    id: makeUuid(),
    reference,
    translation: translation || '',
    passageText,
    tags: tags || [],
    level: 'new',
    ease: 2.5,
    intervalDays: 1,
    reviewCount: 0,
    nextReview: new Date().toISOString(),  // immediately due
    lastReview: null,
    createdAt: new Date().toISOString()
  };
}

function parseBulkVerses(text) {
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const refLine = lines[0];
    const transMatch = refLine.match(/\(([^)]+)\)\s*$/);
    let reference, translation = '';
    if (transMatch) {
      translation = transMatch[1].trim();
      reference = refLine.replace(/\s*\([^)]+\)\s*$/, '').trim();
    } else {
      reference = refLine;
    }
    const passageText = lines.slice(1).join(' ');
    out.push({ reference, translation, passageText });
  }
  return out;
}

// =====================================================================
// Verse detail
// =====================================================================
function viewVerse(id) {
  const v = state.verses.find(x => x.id === id);
  if (!v) return;
  const body = document.getElementById('verseDetailBody');
  body.innerHTML = `
    <h2 class="section-title">${escapeHtml(v.reference)}</h2>
    <p class="section-sub">${v.translation ? escapeHtml(v.translation) + ' · ' : ''}${describeDue(v)}</p>

    <div class="passage" style="margin-top:14px;">
      ${escapeHtml(v.passageText)}
    </div>

    <div class="verse-stats">
      <div><span class="lbl">Level</span><span class="val">${v.level}</span></div>
      <div><span class="lbl">Reviews</span><span class="val">${v.reviewCount}</span></div>
      <div><span class="lbl">Ease</span><span class="val">${v.ease.toFixed(2)}</span></div>
      <div><span class="lbl">Interval</span><span class="val">${v.intervalDays}d</span></div>
    </div>

    ${v.tags.length ? `<div class="tags">${v.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}

    <h3 class="subhead">Actions</h3>
    <button class="btn btn-secondary" onclick="App.reviewSingle('${v.id}')">Review now</button>
    <button class="btn btn-secondary" onclick="App.useVerseInDevotion('${v.id}')">Use as today's devotion</button>
    <button class="btn btn-secondary" onclick="App.editVerse('${v.id}')">Edit</button>
    <button class="btn btn-secondary danger" onclick="App.deleteVerse('${v.id}')">Delete</button>
  `;
  switchTo('verse-detail');
}

async function deleteVerse(id) {
  if (!confirm('Delete this verse? This cannot be undone.')) return;
  state.verses = state.verses.filter(v => v.id !== id);
  saveLocal();
  await deleteVerseFromCloud(id);
  renderMemorise(); renderHome();
  enterMemorise();
  toast('Verse deleted');
}

function editVerse(id) {
  const v = state.verses.find(x => x.id === id);
  if (!v) return;
  // Reuse add modal in edit mode
  openAddVerseModal();
  document.getElementById('addVerseRef').value = v.reference;
  document.getElementById('addVerseTrans').value = v.translation || '';
  document.getElementById('addVerseText').value = v.passageText;
  document.getElementById('addVerseTags').value = (v.tags || []).join(', ');
  // Hijack save button
  const saveBtn = document.querySelector('#addVerseSingle .btn-primary');
  saveBtn.textContent = 'Update verse';
  saveBtn.onclick = async () => {
    const ref = document.getElementById('addVerseRef').value.trim();
    const trans = document.getElementById('addVerseTrans').value.trim();
    const text = document.getElementById('addVerseText').value.trim();
    const tagsRaw = document.getElementById('addVerseTags').value.trim();
    if (!ref || !text) { toast('Reference and text required'); return; }
    v.reference = ref;
    v.translation = trans;
    v.passageText = text;
    v.tags = tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    saveLocal();
    await pushVerseToCloud(v);
    closeAddVerseModal();
    saveBtn.textContent = 'Save verse';
    saveBtn.onclick = saveNewVerse;
    viewVerse(v.id);
    renderMemorise();
    toast('Verse updated');
  };
}

// =====================================================================
// Memorise review session
// =====================================================================
function startMemoriseReview() {
  let queue = dueVerses();
  // If nothing due, show oldest 3 anyway (extra practice)
  if (!queue.length && state.verses.length) {
    queue = state.verses.slice().sort((a, b) =>
      new Date(a.lastReview || 0) - new Date(b.lastReview || 0)
    ).slice(0, 3);
  }
  if (!queue.length) {
    toast('No verses to review');
    return;
  }

  review = {
    queue: shuffle(queue.slice()),
    index: 0,
    revealed: false,
    mode: 'first_letter',
    typed: '',
    results: []   // { verseId, result, mode }
  };
  switchTo('review');
  renderReview();
}

function reviewSingle(id) {
  const v = state.verses.find(x => x.id === id);
  if (!v) return;
  review = {
    queue: [v],
    index: 0,
    revealed: false,
    mode: 'first_letter',
    typed: '',
    results: []
  };
  switchTo('review');
  renderReview();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function renderReview() {
  const v = review.queue[review.index];
  if (!v) return finishReview();

  // Decide mode for this verse: type-back if confident or mastered
  const useTypeBack = (v.level === 'confident' || v.level === 'mastered');
  review.mode = useTypeBack ? 'type_back' : 'first_letter';

  document.getElementById('reviewProgress').textContent =
    `${review.index + 1} of ${review.queue.length}`;
  document.getElementById('reviewModeLabel').textContent =
    review.mode === 'type_back' ? 'TYPE IT BACK' : 'FIRST LETTER';

  const body = document.getElementById('reviewBody');
  const footer = document.getElementById('reviewFooter');

  if (review.mode === 'type_back') {
    if (!review.revealed) {
      body.innerHTML = `
        <div class="review-ref">${escapeHtml(v.reference)}</div>
        <p class="step-prompt">Type the passage from memory. We'll show you a hint if you tap reveal.</p>
        <textarea class="field" id="typeBackInput" placeholder="Begin typing…" style="min-height:160px;"></textarea>
      `;
      footer.innerHTML = `
        <button class="btn btn-secondary" onclick="App.revealReview()">Reveal</button>
        <button class="btn btn-primary" onclick="App.checkTypeBack()">Check</button>
      `;
    } else {
      const typedScore = scoreTypeBack(review.typed, v.passageText);
      body.innerHTML = `
        <div class="review-ref">${escapeHtml(v.reference)}</div>
        <p class="step-prompt">Your answer ${typedScore.percent}% match.</p>
        <div class="passage" style="margin-bottom:16px;">${escapeHtml(v.passageText)}</div>
        <div class="typeback-comparison">
          <div class="typeback-label">You typed:</div>
          <div class="typeback-typed">${escapeHtml(review.typed) || '<i>(nothing typed)</i>'}</div>
        </div>
        <p class="step-prompt">How did that go?</p>
      `;
      footer.innerHTML = `
        <button class="btn btn-secondary" onclick="App.gradeReview('forgot')">Forgot</button>
        <button class="btn btn-secondary" onclick="App.gradeReview('almost')">Almost</button>
        <button class="btn btn-primary" onclick="App.gradeReview('had_it')">I had it</button>
      `;
    }
  } else {
    // First-letter mode
    if (!review.revealed) {
      body.innerHTML = `
        <div class="review-ref">${escapeHtml(v.reference)}</div>
        <p class="step-prompt">Recite the passage out loud, then reveal to check.</p>
        <div class="first-letters">${firstLetters(v.passageText)}</div>
      `;
      footer.innerHTML = `
        <button class="btn btn-primary" onclick="App.revealReview()">Reveal</button>
      `;
    } else {
      body.innerHTML = `
        <div class="review-ref">${escapeHtml(v.reference)}</div>
        <div class="passage" style="margin-bottom:16px;">${escapeHtml(v.passageText)}</div>
        <p class="step-prompt">How did that go?</p>
      `;
      footer.innerHTML = `
        <button class="btn btn-secondary" onclick="App.gradeReview('forgot')">Forgot</button>
        <button class="btn btn-secondary" onclick="App.gradeReview('almost')">Almost</button>
        <button class="btn btn-primary" onclick="App.gradeReview('had_it')">I had it</button>
      `;
    }
  }
}

function firstLetters(text) {
  // Show first letter of each word, preserving punctuation as visual anchor
  return text.split(/(\s+)/).map(token => {
    if (/^\s+$/.test(token)) return token;
    // Keep leading punctuation, take first letter, keep trailing punctuation
    const m = token.match(/^([^\w]*)(\w)\w*([^\w]*)$/);
    if (!m) return token;
    return `${m[1]}${m[2].toLowerCase()}${m[3]}`;
  }).join('').replace(/(\w)/g, '<span class="fl-letter">$1</span>');
}

function revealReview() {
  if (review.mode === 'type_back') {
    const input = document.getElementById('typeBackInput');
    if (input) review.typed = input.value;
  }
  review.revealed = true;
  renderReview();
}

function checkTypeBack() {
  const input = document.getElementById('typeBackInput');
  if (input) review.typed = input.value;
  review.revealed = true;
  renderReview();
}

function scoreTypeBack(typed, target) {
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const a = norm(typed).split(' ').filter(Boolean);
  const b = norm(target).split(' ').filter(Boolean);
  if (!b.length) return { percent: 0 };
  let matches = 0;
  const bSet = new Map();
  for (const w of b) bSet.set(w, (bSet.get(w) || 0) + 1);
  for (const w of a) {
    if (bSet.get(w) > 0) { matches++; bSet.set(w, bSet.get(w) - 1); }
  }
  return { percent: Math.round((matches / b.length) * 100) };
}

async function gradeReview(result) {
  const v = review.queue[review.index];
  applyReviewToVerse(v, result);
  saveLocal();
  await pushVerseToCloud(v);
  await pushReviewToCloud({ verseId: v.id, result, mode: review.mode });
  review.results.push({ verseId: v.id, result, mode: review.mode });

  review.index++;
  review.revealed = false;
  review.typed = '';

  if (review.index >= review.queue.length) finishReview();
  else renderReview();
}

async function finishReview() {
  // Mark practice + update streak
  state.todayPracticeFlags.memorise = true;
  await maybeAdvanceStreak();

  const summary = review.results.reduce((acc, r) => { acc[r.result] = (acc[r.result] || 0) + 1; return acc; }, {});
  const had = summary.had_it || 0;
  const almost = summary.almost || 0;
  const forgot = summary.forgot || 0;

  // Show summary in body
  document.getElementById('reviewProgress').textContent = 'Done';
  document.getElementById('reviewModeLabel').textContent = '';
  document.getElementById('reviewBody').innerHTML = `
    <h2 class="step-title">Well done.</h2>
    <p class="step-prompt">${review.queue.length} ${review.queue.length === 1 ? 'verse' : 'verses'} reviewed.</p>
    <div class="review-summary">
      <div class="rs-row"><span>Had it</span><span class="rs-num">${had}</span></div>
      <div class="rs-row"><span>Almost</span><span class="rs-num">${almost}</span></div>
      <div class="rs-row"><span>Forgot</span><span class="rs-num">${forgot}</span></div>
    </div>
  `;
  document.getElementById('reviewFooter').innerHTML = `
    <button class="btn btn-primary" onclick="App.exitReview(true)">Continue</button>
  `;

  review.complete = true;
  renderMemorise(); renderHome(); renderWalk();
  checkMilestone();
}

function exitReview(silent) {
  if (!silent && review && !review.complete) {
    if (!confirm('Leave this review? Your progress so far is saved.')) return;
  }
  review = null;
  switchTo('memorise');
}

// =====================================================================
// Devotion session (with memorise integration)
// =====================================================================
function todaysPassage() {
  const list = [
    'John 15:1-11', 'Psalm 23', 'Psalm 1', 'Matthew 5:1-12', 'Romans 8:28-39',
    'Philippians 4:4-9', 'Isaiah 40:28-31', 'Psalm 46', '1 Corinthians 13',
    'Hebrews 11:1-6', 'James 1:2-8', 'Psalm 139:1-12', 'John 1:1-14',
    'Ephesians 3:14-21', 'Psalm 27', 'Matthew 6:25-34', 'Galatians 5:22-26',
    'Psalm 51:1-12', '2 Corinthians 4:16-18', 'Colossians 3:1-4', 'Psalm 91'
  ];
  return list[dayOfYear() % list.length];
}

function buildSteps(method, passageRef, prefilledText, linkedVerseId) {
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
    render: () => `
      <h2 class="step-title">${prompt.title}</h2>
      <p class="step-prompt">${prompt.body}</p>
      <div class="passage-input">
        <input type="text" id="passage-ref" value="${escapeHtml(session.passageRef)}" placeholder="e.g. John 3:16-21">
      </div>
      <div id="passage-container">
        ${renderManualPassage(session.manualPassageText)}
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
      ${session.linkedVerseId ? '' : `
        <div class="carry-memorise">
          <button class="btn btn-secondary" onclick="App.carryToMemorise()">+ Add this to memorisation</button>
        </div>
      `}
    `
  };

  const skeletons = {
    lectio: [stillness,
      passageStep('READ',     { title: 'Read slowly', body: 'Read the passage once. Notice the rhythm of the words. Let it wash over you.' }),
      passageStep('MEDITATE', { title: 'Read again',  body: 'A word or phrase will likely stand out. Read again and notice what catches you.' }),
      writeStep('LISTENING', 'What stood out?', 'What word, phrase, or image is the Lord highlighting? Write what you sense him saying.', 'field-listening'),
      writeStep('PRAYER', 'Pray it back', 'Speak to God about what you noticed. What does it stir in you? What do you want to ask?', 'field-prayer'),
      carryStep
    ],
    soap: [stillness,
      passageStep('SCRIPTURE', { title: 'Scripture', body: 'Read the passage. Underline the verse that speaks loudest.' }),
      writeStep('OBSERVATION', 'Observation', 'What is happening in this passage? What does it say about God? About people?', 'field-observation'),
      writeStep('APPLICATION', 'Application', 'How does this apply to your life today? What needs to change, or what is being affirmed?', 'field-application'),
      writeStep('PRAYER', 'Prayer', 'Pray this passage back to God in your own words.', 'field-prayer'),
      carryStep
    ],
    plan: [stillness,
      passageStep('READING', { title: "Today's reading", body: 'Read carefully. Take your time.' }),
      writeStep('LISTENING', 'What is he saying?', 'What is the Lord saying to you through this reading? Write freely.', 'field-listening'),
      carryStep
    ],
    free: [stillness,
      passageStep('PASSAGE', { title: 'A word for today', body: 'Sit with this passage. No prompts, no structure — just you and the Word.' }),
      writeStep('REFLECTION', 'Free reflection', 'Whatever the Spirit stirs. There are no wrong answers here.', 'field-listening'),
      carryStep
    ]
  };

  return skeletons[method];
}

function renderManualPassage(text) {
  return `
    <div class="passage-manual">
      <div class="manual-hint">Paste the passage from your Bible app (YouVersion, Bible Gateway, etc.) here.</div>
      <textarea class="field manual-passage" id="manual-passage-text"
        placeholder="Paste the passage text here…">${escapeHtml(text || '')}</textarea>
    </div>
  `;
}

function startSession(method, opts) {
  closeMethodPicker();
  const ref = (opts && opts.passageRef) || todaysPassage();
  const prefilled = (opts && opts.passageText) || '';
  const linkedId = (opts && opts.linkedVerseId) || null;

  session = {
    method,
    steps: buildSteps(method, ref, prefilled, linkedId),
    current: 0,
    data: {},
    passageRef: ref,
    manualPassageText: prefilled,
    linkedVerseId: linkedId
  };
  switchTo('session');
  renderSessionStep();
}

function renderSessionStep() {
  const step = session.steps[session.current];
  document.getElementById('stepLabel').textContent = step.label;
  document.getElementById('sessionBody').innerHTML = step.render();

  if (step.fieldId && session.data[step.fieldId]) {
    const f = document.getElementById(step.fieldId);
    if (f) f.value = session.data[step.fieldId];
  }

  document.getElementById('progressDots').innerHTML =
    session.steps.map((_, i) => {
      let cls = '';
      if (i < session.current) cls = 'done';
      else if (i === session.current) cls = 'active';
      return `<div class="dot ${cls}"></div>`;
    }).join('');

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
  const refInput = document.getElementById('passage-ref');
  if (refInput) session.passageRef = refInput.value.trim();
  const manualPassage = document.getElementById('manual-passage-text');
  if (manualPassage) session.manualPassageText = manualPassage.value;
}

function nextStep() { captureField(); session.current++; renderSessionStep(); }
function prevStep() { captureField(); session.current--; renderSessionStep(); }

function exitSession() {
  if (confirm('Leave this session? Your reflection will not be saved.')) {
    session = null;
    switchTo('devotion');
  }
}

async function finishSession() {
  captureField();
  const listening = session.data['field-listening'] || session.data['field-application'] || session.data['field-observation'] || '';
  const carry = session.data['field-carry'] || '';

  const passageText = session.manualPassageText || null;
  const entry = {
    id: makeUuid(),
    date: new Date().toISOString(),
    method: session.method.toUpperCase(),
    passageRef: session.passageRef,
    translation: state.preferredTranslation || 'NIV',
    passageText,
    fields: { ...session.data },
    carry,
    preview: listening || carry || '(no reflection)',
    linkedVerseId: session.linkedVerseId || null
  };
  state.entries.push(entry);
  state.carryLine = carry;
  state.todayPracticeFlags.devotion = true;

  await maybeAdvanceStreak();

  saveLocal();
  await pushStateToCloud();
  await pushEntryToCloud(entry);

  const reachedNow = state.milestonesReached.includes(state.streak)
    ? null
    : milestones.find(m => m.days === state.streak);
  if (reachedNow) {
    state.milestonesReached.push(reachedNow.days);
    saveLocal(); pushStateToCloud();
  }

  session = null;
  renderHome(); renderDevotion(); renderJournal(); renderWalk(); renderMemorise();

  if (reachedNow) showReward(reachedNow);
  else switchTo('home');
}

async function maybeAdvanceStreak() {
  const today = new Date().toDateString();
  const last = state.lastSession ? new Date(state.lastSession).toDateString() : null;
  if (last === today) {
    state.lastSession = new Date().toISOString();
    saveLocal();
    return;
  }
  if (last === null) {
    state.streak = 1;
  } else {
    const diffDays = Math.round((new Date(today) - new Date(last)) / 86400000);
    if (diffDays === 1) state.streak += 1;
    else if (diffDays > 1) {
      if (diffDays === 2 && state.graceDays > 0) {
        state.graceDays -= 1;
        state.streak += 1;
        toast(`Grace day used. ${state.graceDays} left this month.`);
      } else {
        state.streak = 1;
      }
    }
  }
  state.lastSession = new Date().toISOString();
  saveLocal();
  pushStateToCloud();
}

function checkMilestone() {
  const reached = milestones.find(m => m.days === state.streak && !state.milestonesReached.includes(m.days));
  if (reached) {
    state.milestonesReached.push(reached.days);
    saveLocal(); pushStateToCloud();
    showReward(reached);
  }
}

// =====================================================================
// Method picker (with memorise integration option)
// =====================================================================
function openMethodPicker() {
  // Inject "Reflect on a verse I'm memorising" if there are verses
  const slot = document.getElementById('methodMemoriseSlot');
  if (state.verses.length > 0) {
    slot.innerHTML = `
      <button class="method-option memorise-method" onclick="App.openMemoriseVersePicker()">
        <div class="name">Reflect on a memorised verse</div>
        <div class="desc">Use one of your hidden verses as today's passage.</div>
        <div class="meta">${state.verses.length} ${state.verses.length === 1 ? 'verse' : 'verses'} available</div>
      </button>
    `;
  } else {
    slot.innerHTML = '';
  }
  document.getElementById('methodModal').classList.add('active');
}

function closeMethodPicker() {
  document.getElementById('methodModal').classList.remove('active');
}

function openMemoriseVersePicker() {
  closeMethodPicker();
  // Build a quick picker UI inline as a modal
  const div = document.createElement('div');
  div.className = 'modal-overlay active';
  div.id = 'verseQuickPicker';
  div.onclick = (e) => { if (e.target === div) div.remove(); };
  const inner = document.createElement('div');
  inner.className = 'modal';
  inner.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-title">Choose a verse</div>
    <div class="modal-sub">Then choose a method</div>
    ${state.verses.map(v => `
      <button class="method-option" data-verse-id="${v.id}">
        <div class="name">${escapeHtml(v.reference)}</div>
        <div class="desc">${escapeHtml(truncate(v.passageText, 110))}</div>
      </button>
    `).join('')}
  `;
  div.appendChild(inner);
  document.body.appendChild(div);

  inner.querySelectorAll('button.method-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.verseId;
      const v = state.verses.find(x => x.id === id);
      div.remove();
      if (!v) return;
      // Pick method next
      const div2 = document.createElement('div');
      div2.className = 'modal-overlay active';
      div2.onclick = (e) => { if (e.target === div2) div2.remove(); };
      div2.innerHTML = `
        <div class="modal">
          <div class="modal-handle"></div>
          <div class="modal-title">Method for "${escapeHtml(v.reference)}"</div>
          <div class="modal-sub">Same skeleton, different depths</div>
          <button class="method-option" data-m="lectio"><div class="name">Lectio Divina</div><div class="desc">Four passes through the same passage.</div></button>
          <button class="method-option" data-m="soap"><div class="name">SOAP</div><div class="desc">Scripture, Observation, Application, Prayer.</div></button>
          <button class="method-option" data-m="free"><div class="name">Free</div><div class="desc">Open page, no prompts.</div></button>
        </div>
      `;
      document.body.appendChild(div2);
      div2.querySelectorAll('button.method-option').forEach(b => {
        b.addEventListener('click', () => {
          const method = b.dataset.m;
          div2.remove();
          startSession(method, {
            passageRef: v.reference,
            passageText: v.passageText,
            linkedVerseId: v.id
          });
        });
      });
    });
  });
}

function carryToMemorise() {
  captureField();
  const carry = session.data['field-carry'] || '';
  if (!carry.trim()) { toast('Write a carry line first'); return; }
  const ref = session.passageRef || 'Carry line';
  const verse = makeVerse(ref, state.preferredTranslation || '', carry, ['from-devotion']);
  state.verses.push(verse);
  saveLocal();
  pushVerseToCloud(verse);
  toast('Added to memorisation');
}

async function useVerseInDevotion(id) {
  const v = state.verses.find(x => x.id === id);
  if (!v) return;
  // Open method picker with this verse pre-selected
  goHome();
  setTimeout(() => {
    enterDevotion();
    setTimeout(() => {
      // Build the "method for this verse" modal directly
      const div2 = document.createElement('div');
      div2.className = 'modal-overlay active';
      div2.onclick = (e) => { if (e.target === div2) div2.remove(); };
      div2.innerHTML = `
        <div class="modal">
          <div class="modal-handle"></div>
          <div class="modal-title">Method for "${escapeHtml(v.reference)}"</div>
          <div class="modal-sub">Same skeleton, different depths</div>
          <button class="method-option" data-m="lectio"><div class="name">Lectio Divina</div><div class="desc">Four passes through the same passage.</div></button>
          <button class="method-option" data-m="soap"><div class="name">SOAP</div><div class="desc">Scripture, Observation, Application, Prayer.</div></button>
          <button class="method-option" data-m="free"><div class="name">Free</div><div class="desc">Open page, no prompts.</div></button>
        </div>
      `;
      document.body.appendChild(div2);
      div2.querySelectorAll('button.method-option').forEach(b => {
        b.addEventListener('click', () => {
          const method = b.dataset.m;
          div2.remove();
          startSession(method, {
            passageRef: v.reference,
            passageText: v.passageText,
            linkedVerseId: v.id
          });
        });
      });
    }, 100);
  }, 100);
}

// =====================================================================
// Reward
// =====================================================================
function showReward(m) {
  document.getElementById('rewardSymbol').textContent = m.symbol;
  document.getElementById('rewardTitle').textContent = m.name;
  document.getElementById('rewardVerse').textContent = `"${m.verse}"`;
  document.getElementById('rewardRef').textContent = '— ' + m.ref;
  document.getElementById('rewardPopup').classList.add('active');
}
function closeReward() {
  document.getElementById('rewardPopup').classList.remove('active');
  switchTo('home');
}

// =====================================================================
// Journal
// =====================================================================
function renderJournal() {
  const list = document.getElementById('journalList');
  if (!state.entries.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">✦</div><div class="text">Your journal is empty.<br>Begin a devotion to write your first entry.</div></div>`;
    return;
  }
  list.innerHTML = state.entries.slice().reverse().map(e => {
    const linked = e.linkedVerseId ? state.verses.find(v => v.id === e.linkedVerseId) : null;
    return `
      <div class="journal-entry">
        <div class="meta">
          <span class="date">${formatDate(e.date)}</span>
          <span class="method-tag">${e.method}</span>
        </div>
        <div class="ref">${escapeHtml(e.passageRef || 'Free reflection')}${e.translation ? ' · ' + escapeHtml(e.translation) : ''}</div>
        <div class="preview">${escapeHtml(e.preview || '(no reflection)')}</div>
        ${linked ? `<div class="linked-verse">∞ Linked: ${escapeHtml(linked.reference)}</div>` : ''}
      </div>
    `;
  }).join('');
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

// =====================================================================
// Prayer
// =====================================================================
function renderPrayer() {
  const list = document.getElementById('prayerList');
  list.innerHTML = Object.entries(state.prayers).map(([key, p]) => `
    <div class="prayer-card">
      <div class="row">
        <div style="flex:1;"><div class="name">${p.name}</div></div>
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
      saveLocal(); pushStateToCloud(); renderHome();
    });
  });

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
  renderHome();
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

// =====================================================================
// Walk
// =====================================================================
function renderWalk() {
  document.getElementById('walkStreak').innerHTML = `${state.streak}<small>days</small>`;
  document.getElementById('walkGrace').innerHTML  = `${state.graceDays}<small>left</small>`;
  document.getElementById('walkEntries').innerHTML = `${state.entries.length}<small>total</small>`;
  document.getElementById('walkVerses').innerHTML = `${state.verses.length}<small>memorised</small>`;

  document.getElementById('walkIdentity').textContent = computeIdentityLine();

  // Today's practice
  const tp = document.getElementById('todayPractice');
  const f = state.todayPracticeFlags || {};
  tp.innerHTML = `
    <div class="practice-tile ${f.devotion ? 'on' : ''}">
      <div class="tile-icon">✦</div>
      <div class="tile-name">Devotion</div>
      <div class="tile-state">${f.devotion ? 'Done' : 'Not yet'}</div>
    </div>
    <div class="practice-tile ${f.memorise ? 'on' : ''}">
      <div class="tile-icon">∞</div>
      <div class="tile-name">Memorise</div>
      <div class="tile-state">${f.memorise ? 'Done' : 'Not yet'}</div>
    </div>
  `;

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

// =====================================================================
// Tabs / navigation
// =====================================================================
function setupTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTo(t.dataset.screen));
  });
}

function switchTo(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const screen = document.getElementById('screen-' + name);
  if (screen) screen.classList.add('active');

  // Tab activation: only if it's a top-level tab
  const tab = document.querySelector(`.tab[data-screen="${name}"]`);
  if (tab) tab.classList.add('active');
  else {
    // sub-screen — keep "Home" active for home/devotion/memorise/session/review/verse-detail
    const homeTab = document.querySelector('.tab[data-screen="home"]');
    if (['home','devotion','memorise','session','review','verse-detail'].includes(name) && homeTab)
      homeTab.classList.add('active');
  }

  // Hide topbar/tabbar for full-screen sessions
  const fullscreen = (name === 'session' || name === 'review');
  document.getElementById('topbar').style.display = fullscreen ? 'none' : 'flex';
  document.getElementById('tabbar').style.display = fullscreen ? 'none' : 'grid';
}

function goHome() { switchTo('home'); }
function enterDevotion() { renderDevotion(); switchTo('devotion'); }
function enterMemorise() { renderMemorise(); switchTo('memorise'); }

// =====================================================================
// Toast
// =====================================================================
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// =====================================================================
// OneSignal (optional)
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
    try {
      await OneSignal.User.addTag('device_id', getDeviceId());
      const playerId = await OneSignal.User.PushSubscription.id;
      if (playerId && supabase) {
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
    toast('OneSignal not loaded yet'); return;
  }
  window.OneSignalDeferred.push(async function(OneSignal) {
    try {
      await OneSignal.Notifications.requestPermission();
      renderPrayer();
      toast('Notifications enabled');
    } catch (e) { toast('Could not enable notifications'); }
  });
}

// =====================================================================
// Public API
// =====================================================================
window.App = {
  // Navigation
  goHome, enterDevotion, enterMemorise, switchTo,

  // Devotion
  openMethodPicker, closeMethodPicker, openMemoriseVersePicker,
  startSession, exitSession, nextStep, prevStep, finishSession,
  carryToMemorise,

  // Memorise
  openAddVerseModal, closeAddVerseModal, switchAddTab,
  saveNewVerse, saveBulkVerses,
  startMemoriseReview, reviewSingle, exitReview,
  revealReview, checkTypeBack, gradeReview,
  viewVerse, deleteVerse, editVerse, useVerseInDevotion,

  // Misc
  closeReward, requestNotificationPermission
};

document.addEventListener('DOMContentLoaded', init);

})();
