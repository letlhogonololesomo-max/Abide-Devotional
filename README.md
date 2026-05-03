# Abide

A personal companion for the inner life. Two practices in one app:

- **Devotion** — structured Scripture meditation (Lectio Divina, SOAP, Reading Plan, Free) with journaling
- **Memorise** — verse memorisation with first-letter recall, type-back verification, and spaced-repetition scheduling

Built on the principles of *Atomic Habits* — small daily wins, identity reinforcement, gentle gamification, grace days. Both practices share a single streak: any practice keeps the walk alive.

This is a Progressive Web App that runs from GitHub Pages and syncs to Supabase. No Bible API needed — you paste passages yourself, which means you can read and memorise from any translation you have access to.

---

## Project structure

```
abide/
├── public/                          ← deploys to GitHub Pages
│   ├── index.html
│   ├── styles.css
│   ├── app.js                       ← all UI + logic
│   ├── config.js                    ← YOU FILL THIS IN
│   ├── manifest.json
│   ├── service-worker.js
│   ├── icon-192.png                 ← (or in icons/, see deployment notes)
│   └── icon-512.png
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql   ← run if first-time setup
│       └── 002_memorisation.sql     ← run to add memorise tables
├── docs/
│   └── SCHEDULER.md                 ← OneSignal scheduler (later)
└── README.md
```

---

## What's new since V1

If you're upgrading from the previous version of Abide:

1. **Home is a chooser.** Tapping the app lands on a screen with two large cards: Devotion and Memorise. The old "Today" experience now lives behind the Devotion card.
2. **Memorise module added.** Full verse list with mastery dots, daily review queue with first-letter and type-back modes, spaced repetition.
3. **Tight integration.** Devotion can pull a memorised verse as today's passage. Carry lines can become memorisation candidates. Journal entries can link to verses.
4. **Unified streak.** Either practice satisfies the daily streak. The Walk screen shows what you did today.
5. **No Bible API needed.** The app is now fully manual — you paste passages from YouVersion, Bible Gateway, or wherever. The Edge Function for `get-passage` is no longer used.

---

## Setup — work through in order

### Step 1 — Run database migrations

Open your Supabase project → **SQL Editor**.

If you've never run migration 001 before, run it first:

1. New query → paste the entire contents of `supabase/migrations/001_initial_schema.sql` → **Run**

Then run migration 002:

2. New query → paste the entire contents of `supabase/migrations/002_memorisation.sql` → **Run**

You should see "Success. No rows returned." for each. Verify in **Table Editor** that you now see: `state`, `entries`, `passages_cache`, `memorise_verses`, `memorise_reviews`.

> **If you've already been using Abide V1**, your existing `entries` and `state` data is preserved. Migration 002 only adds the new memorise tables and one optional column.

### Step 2 — Configure the frontend

Open `public/config.js` and fill in:

```javascript
window.ABIDE_CONFIG = {
  SUPABASE_URL:      'https://YOUR-PROJECT.supabase.co',  // Settings → API
  SUPABASE_ANON_KEY: 'eyJh...',                            // Settings → API
  ONESIGNAL_APP_ID:  null,                                 // Step 4 (optional)
  DEFAULT_TRANSLATION: 'NIV'
};
```

### Step 3 — Deploy to GitHub Pages

If you already have the repo set up, just push the new files to it. If not:

1. Create or open your repo on GitHub
2. Push the contents of `public/` to the repo
3. Settings → Pages → Source: Deploy from branch, main, root → Save
4. Wait ~60 seconds, your URL is `https://YOUR-USERNAME.github.io/REPO-NAME/`

> **Icons:** the icons need to be at the path the manifest expects. The current manifest expects `icon-192.png` and `icon-512.png` at the root. If you put them in a subfolder, update `manifest.json` and `index.html` accordingly.

### Step 4 — Add OneSignal for prayer notifications (optional)

This step is documented separately in `docs/SCHEDULER.md`. The app works perfectly without notifications; you just won't get pinged at prayer times.

---

## How to use the app

### Opening the app

You'll land on **Home**, which shows:
- Today's anchor verse (rotates daily)
- Two cards: Devotion and Memorise
- Identity line ("You are someone who hears…")
- Next prayer (if you have any enabled)

### Devotion practice

1. Tap **Devotion** → **Begin Devotion**
2. Choose a method: Lectio Divina, SOAP, Reading Plan, Free, *or* "Reflect on a memorised verse" if you have any
3. Walk through Stillness → Scripture → method-specific reflection → Carry
4. The Scripture step has a passage reference field and a textarea — paste the passage from your Bible app
5. Complete → entry saves to Journal, streak advances, milestones fire

### Memorisation practice

**Adding verses:**
1. Tap **Memorise** → **+ Add verse**
2. Paste reference, translation (optional), passage text, tags (optional)
3. Or use **Paste many** mode to import a list at once
4. Each verse starts as "New" and is due for review immediately

**Reviewing verses:**
1. Tap **Memorise** → **Begin Review**
2. For each verse you'll see either:
   - **First letter mode** (default for new/learning/familiar verses): see only first letters of each word, recite, tap Reveal
   - **Type-it-back mode** (for confident/mastered verses): type from memory, app scores match
3. After each, grade yourself: **Forgot / Almost / I had it**
4. The schedule updates automatically — confident verses gap out to weeks/months, weak verses come back tomorrow

**Mastery levels** (small dots on each verse card):
- **New** → just added
- **Learning** → reviewed 1+ times, gap < 7 days
- **Familiar** → gap 7-30 days
- **Confident** → gap 30-90 days, type-back unlocks
- **Mastered** → gap 90+ days, only resurfaces every few months

### Integration touch points

These are the places Devotion and Memorise meet:

- **In the method picker**, if you have memorisation verses, an extra option appears: "Reflect on a memorised verse." Tap it, choose a verse, then choose a method. The session uses the verse text as today's passage and links the journal entry to the verse.
- **At the Carry step of devotion**, a "+ Add this to memorisation" button appears. Tap it to turn your one-line carry into a memorisation verse on the spot.
- **From a verse's detail screen**, "Use as today's devotion" jumps you into the method picker pre-loaded with that verse.
- **Journal entries linked to verses** show a small "∞ Linked: …" tag at the bottom.

### The unified streak

Either practice satisfies the daily streak. Your **Walk** screen shows:
- **Streak / Grace days** at the top
- **Reflections / Verses Hidden** counts
- **Today's practice:** two tiles showing whether you've done Devotion and/or Memorise today
- **Milestones** at 7/21/40/90/365 days
- Identity line that pulls from both modes' data

Grace days: 2 per month, automatically used if you miss exactly one day. Two consecutive misses still resets — by design.

---

## Troubleshooting

**"Local only" on Home screen**
`config.js` not configured. SUPABASE_URL or SUPABASE_ANON_KEY still has the placeholder.

**Verses don't appear after I add them**
Check the browser console. If sync to Supabase is failing, the verse is still saved locally and will sync next time you're online. The "synced/offline/local only" indicator on Home tells you the current state.

**Streak reset unfairly**
You missed two consecutive days, or the timezone interpretation crossed a date boundary. Grace days only cover *one missed day*.

**I want to import many verses at once**
Use the "Paste many" tab in Add Verse. Format:
```
Reference 1 (Translation)
Passage text 1...

Reference 2 (Translation)
Passage text 2...
```
Blank line separates verses. Translation in parentheses is optional.

**I want to start over with memorisation**
On the Walk screen → Device section, you can see your device ID. To reset everything, you'd clear localStorage in the browser AND delete the row from `state` in Supabase. Or just delete each verse from the Memorise screen.

---

## Design notes (for future you)

A few things to keep in mind if you come back to this code in three months:

**The streak logic is in `maybeAdvanceStreak()`.** Both `finishSession` (devotion) and `finishReview` (memorise) call it. It's idempotent — calling it twice in one day just bumps `lastSession` without re-incrementing the streak.

**Spaced repetition lives in `applyReviewToVerse()`.** Simplified SM-2. Tunable: ease bumps (+0.10/-0.05/-0.20), interval cap (180 days). If reviews feel too aggressive, lower the ease bump on success.

**`deriveLevel()` is the only place mastery levels are computed.** Don't store level separately — always derive from `intervalDays + reviewCount`. This way, fudging the schedule or adjusting the math doesn't leave verses stranded at the wrong level.

**Manual mode is the only mode now.** If API.Bible eventually authorizes your account, you could re-introduce automatic passage fetching by restoring `fetchPassage()` to call the Edge Function. The hooks are still there in concept — just removed for clarity.

---

## What's deliberately *not* in this version

- Voice notes
- Audio playback of verses
- Search within journal
- Cross-device sync via "transfer code" (would need to be added — currently device ID = browser localStorage)
- Sharing entries
- Family/group prayer lists
- Reading plan progress tracking (still uses the rotating-day suggested passage)

These are all small additions that can come later once V2 has time to settle.
