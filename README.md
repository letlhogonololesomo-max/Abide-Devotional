# Abide

A personal devotional companion. Daily Scripture meditation with structured methods (Lectio Divina, SOAP, Reading Plan, Free), journaling, fixed-hour prayer prompts, and habit reinforcement built on Atomic Habits principles.

This is a Progressive Web App (PWA) that runs from GitHub Pages, syncs to Supabase, and uses OneSignal for prayer-time notifications.

---

## What you're getting

- **Frontend** in `public/` — static HTML/CSS/JS, ready for GitHub Pages
- **Database schema** in `supabase/migrations/001_initial_schema.sql`
- **Edge Function** in `supabase/functions/get-passage/` — proxies the Bible API so your key stays server-side
- **Setup checklist** below — work through it in order

---

## Setup — work through in order

### Step 1 — Get your API.Bible key (5 min)

1. Go to **https://scripture.api.bible** and click **Sign Up**.
2. Verify your email.
3. Dashboard → **Applications** → **Create New Application**:
   - Name: Abide
   - Description: Personal devotional app for daily Scripture meditation and journaling
   - Use Case: Personal / Non-commercial
4. Copy the **API key** that appears — you'll need it in Step 4.
5. On your dashboard, find your **Bible selections** (free Starter plan = 3 copyrighted translations). Pick:
   - **NIV** (New International Version)
   - **The Message**
   - **ESV** if available, otherwise pick another (NLT or CSB)

> **Note about ESV:** If your free 3-pick doesn't include ESV, you can also get a free ESV-only key from **https://api.esv.org**. The Edge Function supports both — you'd just add `ESV_API_KEY` as a second secret.

> **Bible IDs:** The Edge Function uses specific Bible IDs to match each translation. If a translation isn't returning text, check the IDs in `supabase/functions/get-passage/index.ts` against [API.Bible's Bible list](https://docs.api.bible/) and update if needed.

---

### Step 2 — Set up Supabase database (5 min)

1. Open your Supabase project (or create a new one at **https://supabase.com**).
2. **SQL Editor** → **New query** → paste the entire contents of `supabase/migrations/001_initial_schema.sql` → **Run**.
3. You should see "Success. No rows returned." This created 3 tables (`state`, `entries`, `passages_cache`) with RLS policies.
4. Verify: **Table Editor** → you should see all three tables listed.
5. Note your project's **URL** and **anon key**: **Settings → API**. You'll need both in Step 5.

---

### Step 3 — Deploy the Edge Function (10 min)

You can do this two ways. Pick whichever you're comfortable with.

#### Option A: Supabase CLI (recommended for repeat deployments)

```bash
# One-time install
npm install -g supabase

# In the project folder
cd abide
supabase login
supabase link --project-ref YOUR-PROJECT-REF   # find this in Settings → General

# Deploy the function
supabase functions deploy get-passage --no-verify-jwt

# Set the API.Bible secret
supabase secrets set API_BIBLE_KEY=your_key_here

# Optional: also set ESV key if you have one
supabase secrets set ESV_API_KEY=your_esv_key_here
```

The `--no-verify-jwt` flag is intentional — the function is called with the anon key, not a user JWT, since we're using anonymous device IDs.

#### Option B: Dashboard (no CLI)

1. **Edge Functions** → **Create a new function** → name it `get-passage`.
2. Paste the contents of `supabase/functions/get-passage/index.ts` into the editor.
3. **Deploy**.
4. **Project Settings → Edge Functions → Secrets** → add:
   - `API_BIBLE_KEY` = your API.Bible key
   - `ESV_API_KEY` = your ESV key (optional)

#### Verify it works

In a terminal:

```bash
curl -X POST 'https://YOUR-PROJECT.supabase.co/functions/v1/get-passage' \
  -H 'Authorization: Bearer YOUR-ANON-KEY' \
  -H 'Content-Type: application/json' \
  -d '{"reference":"John 3:16","translation":"NIV"}'
```

You should see JSON with the verse text. If you get a 502 with an API.Bible error, check that the translation is in your selected 3.

---

### Step 4 — Configure the frontend (2 min)

Open **`public/config.js`** and replace the placeholders:

```javascript
window.ABIDE_CONFIG = {
  SUPABASE_URL:      'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'eyJh...your-anon-key...',
  ONESIGNAL_APP_ID:  null,   // leave null for now — Step 7
  DEFAULT_TRANSLATION: 'NIV',
  TRANSLATIONS: ['NIV', 'ESV', 'MSG'],
};
```

**Don't put your API.Bible key here. It belongs in Supabase secrets only.** The anon key is safe in client code by design — RLS policies enforce per-device access.

---

### Step 5 — Push to GitHub & enable Pages (5 min)

1. Create a new repo on GitHub called **abide** (private or public, your call).
2. Push only the `public/` folder contents to the repo root (or the whole project — GitHub Pages serves from a folder you choose):

```bash
cd abide/public
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/abide.git
git push -u origin main
```

3. On GitHub: **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main**, Folder: **/ (root)** → Save.
4. Wait ~1 minute. Your URL will be: **`https://YOUR-USERNAME.github.io/abide/`**

> **Tip — keeping the whole project in the repo:** If you want to keep `supabase/`, `docs/`, etc. tracked together with the frontend, push the whole `abide/` folder and set GitHub Pages to serve from `/public`. That keeps everything in one place.

---

### Step 6 — Install on your phone (2 min)

1. Open **`https://YOUR-USERNAME.github.io/abide/`** in Safari (iPhone) or Chrome (Android).
2. **iPhone**: tap **Share** → **Add to Home Screen** → Add. The app now lives on your home screen and runs full-screen.
3. **Android**: Chrome will prompt you with "Add Abide to Home Screen" automatically, or use the menu → **Install app**.
4. Open Abide from the home screen icon. Try a SOAP session to confirm everything works.

You should see "synced" in small text on the Today screen — that means the Supabase connection is live. If it says "offline" or "local only", double-check Step 4.

---

### Step 7 — Add OneSignal for prayer notifications (15 min, do this last)

> Get the app working without notifications first. This step adds them on top.

#### 7a. Create OneSignal account & app

1. Sign up at **https://onesignal.com** (free tier).
2. **New App/Website** → **Web Push**.
3. Site Name: Abide. Site URL: **`https://YOUR-USERNAME.github.io/abide/`** (note: needs trailing slash).
4. Default icon: skip or upload `icons/icon-192.png`.
5. Save. OneSignal will give you:
   - **App ID** (looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
   - **REST API Key** (long string)
6. Copy the App ID into `public/config.js`:
   ```javascript
   ONESIGNAL_APP_ID: 'your-onesignal-app-id-here',
   ```
7. Push the change to GitHub. Wait for Pages to redeploy.

#### 7b. Set up service worker files

OneSignal requires two files at your site root:

- `OneSignalSDKWorker.js`
- `OneSignalSDK.sw.js`

Both contain a single line:
```javascript
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
```

Create these files in `public/` and push to GitHub.

#### 7c. Enable on your phone

1. Reopen Abide on your phone (after the redeploy).
2. Go to **Prayer** tab → tap **Enable notifications**. Accept the system prompt.
3. To test: in OneSignal dashboard → **Messages → New Push** → target "All subscribers" → Send. You should receive it within seconds.

#### 7d. Schedule the prayer notifications

This is the only piece that requires a small backend job. See **`docs/SCHEDULER.md`** for the Supabase scheduled Edge Function that reads each user's prayer times and sends the right OneSignal notifications at the right local time.

---

## Daily use

- **Today**: tap "Begin Devotion", pick a method, work through the steps.
- **Journal**: every entry is searchable by date and method. Long-press an entry (future feature) to view full content.
- **Prayer**: toggle anchors on/off, change times. Changes sync to your scheduler.
- **Walk**: see your streak, grace days, milestones. Change translation here.

---

## How sync works

- Every action writes to **localStorage first** (instant, works offline) then pushes to Supabase in the background.
- On app load, the app pulls fresh state from Supabase and merges (cloud wins on conflict for state, entries are append-only).
- If sync fails, you keep working — it'll catch up when you're online.
- **Device ID** is generated on first launch and stored in localStorage. Wiping browser data = losing your data unless you back up the device ID. Future feature: a "transfer code" to sync to a new device.

---

## Troubleshooting

**"Local only" on Today screen**
Check `config.js` — `SUPABASE_URL` and `SUPABASE_ANON_KEY` must not contain `YOUR-PROJECT`.

**Passages don't load (just the loading spinner)**
1. Check the browser console for errors.
2. Verify the Edge Function with the curl test in Step 3.
3. Check that your selected translation is in your API.Bible plan.

**Notifications don't fire**
- iOS: must be installed via Add to Home Screen first. Tab-only Safari can't receive web push.
- Check OneSignal dashboard → Subscriptions: your device should appear after enabling.
- Test sending manually from the OneSignal dashboard.

**Streak reset unfairly**
Grace days only cover *one missed day*. Two consecutive misses still resets — by design.

---

## File map

```
abide/
├── public/                          ← deploys to GitHub Pages
│   ├── index.html
│   ├── styles.css
│   ├── app.js                       ← all UI + sync logic
│   ├── config.js                    ← YOU FILL THIS IN
│   ├── manifest.json                ← PWA manifest
│   ├── service-worker.js            ← offline cache
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql   ← paste into Supabase SQL editor
│   └── functions/
│       └── get-passage/
│           └── index.ts             ← deploy as Edge Function
├── docs/
│   └── SCHEDULER.md                 ← OneSignal scheduler setup
└── README.md                        ← this file
```

---

## What's deliberately *not* in V1

- Voice notes — by your call
- Multi-translation comparison view (one translation at a time)
- Sharing entries
- Search within journal
- Reading plan progress (current stub: rotates through 21 suggested passages)
- Cross-device sync via transfer code (you can hand-edit the device ID in localStorage if you really need to)
- Sabbath rest mode (auto-pause streak weekly)

These are all small additions — flag what you want next once V1 is in your hands.
