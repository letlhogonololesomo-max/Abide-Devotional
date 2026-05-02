# Prayer Notification Scheduler

This is the piece that fires your prayer notifications at the right time. It lives as a **scheduled Supabase Edge Function** that runs every minute, checks who has a prayer due in the next minute, and tells OneSignal to send them.

> Set this up *after* the rest of the app is working and you've enabled notifications via the OneSignal flow in the README.

## How it works

```
   ┌──────────────────────┐
   │  Supabase Cron       │  every minute
   │  (pg_cron)           │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────────────────────────┐
   │  Edge Function: prayer-tick              │
   │  1. Read all rows in `state`             │
   │  2. For each enabled prayer, check if    │
   │     local time matches now               │
   │  3. POST to OneSignal API                │
   └──────────┬───────────────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │  OneSignal           │  push delivered
   └──────────────────────┘
```

## Setup

### 1. Add OneSignal REST key as a Supabase secret

```bash
supabase secrets set ONESIGNAL_APP_ID=your-app-id
supabase secrets set ONESIGNAL_REST_KEY=your-rest-api-key
```

### 2. Add a `timezone` column to the `state` table

Run this in the SQL editor:

```sql
alter table public.state add column if not exists timezone text default 'UTC';
```

Then in the frontend (`app.js` → `pushStateToCloud`), include the timezone:

```javascript
timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
```

This lets the scheduler fire at *your* local 6:30, not UTC 6:30.

### 3. Create the scheduler function

`supabase/functions/prayer-tick/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!;
const ONESIGNAL_REST_KEY = Deno.env.get('ONESIGNAL_REST_KEY')!;

const PRAYER_MESSAGES = {
  morning: { title: 'Morning prayer', body: 'A moment to begin the day with him.' },
  midday:  { title: 'Midday pause',   body: 'Lift your eyes. He is with you.' },
  evening: { title: 'Evening prayer', body: 'What did the Lord show you today?' },
  night:   { title: 'Night prayer',   body: 'Rest. He gives his beloved sleep.' }
};

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: rows } = await supabase
    .from('state')
    .select('device_id, prayers, timezone, onesignal_player_id')
    .not('onesignal_player_id', 'is', null);

  if (!rows) return new Response('no rows');

  const now = new Date();
  const results = [];

  for (const row of rows) {
    const tz = row.timezone || 'UTC';
    // Get user's local time as HH:MM
    const localTime = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz
    }).format(now);

    for (const [key, prayer] of Object.entries(row.prayers || {})) {
      const p = prayer as { enabled: boolean; time: string };
      if (!p.enabled) continue;
      if (p.time !== localTime) continue;

      // Fire it
      const msg = PRAYER_MESSAGES[key as keyof typeof PRAYER_MESSAGES] || {
        title: 'Prayer time', body: 'A moment with him.'
      };

      const r = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${ONESIGNAL_REST_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          include_player_ids: [row.onesignal_player_id],
          headings: { en: msg.title },
          contents: { en: msg.body }
        })
      });

      results.push({ device: row.device_id, prayer: key, ok: r.ok });
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

Deploy:

```bash
supabase functions deploy prayer-tick --no-verify-jwt
```

### 4. Schedule it with pg_cron

In the Supabase SQL editor, enable pg_cron and schedule:

```sql
-- One-time: enable extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schedule every minute
select cron.schedule(
  'prayer-tick-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url:='https://YOUR-PROJECT.supabase.co/functions/v1/prayer-tick',
    headers:='{"Authorization":"Bearer YOUR-SERVICE-ROLE-KEY"}'::jsonb
  );
  $$
);
```

> Replace `YOUR-PROJECT` and `YOUR-SERVICE-ROLE-KEY` (Settings → API → service_role).
> Service role here is fine because pg_cron runs server-side.

### 5. Test

1. Set your morning prayer to 2 minutes from now.
2. Wait. The notification should fire on your phone at the exact minute.
3. Check OneSignal dashboard → Delivery for confirmation.

## Caveats

- **Apple delivery isn't 100%.** APNS occasionally drops messages. Mission-critical wakeups need a real native alarm; this is best-effort.
- **Once per minute granularity.** If you set 06:30, it fires when the cron tick sees 06:30 local — usually within ~30 seconds of the minute mark.
- **Cost at scale.** This is fine for single-user. If Abide ever became multi-user, you'd want to batch by minute rather than iterate every row.

## Future improvements

- Inject the morning's "Carry" line into the morning notification body so prayer threads through your day.
- Add a "Pray now" deep link that opens straight into a 60-second prayer screen.
- Adaptive timing: if someone routinely opens the morning prayer at 6:45 instead of 6:30, suggest moving the time.
