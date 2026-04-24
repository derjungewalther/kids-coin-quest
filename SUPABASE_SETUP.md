# Supabase setup — Kids Coin Quest

One-time steps to turn on cloud login and per-user persistence.

## 1. Create a Supabase project

1. Go to https://app.supabase.com and sign up / log in (free tier is fine).
2. Click **New project**.
3. Name: `kids-coin-quest` (or anything).
4. Database password: generate one and save it in your password manager — you
   do *not* need it in the app, but you'll need it if you ever want to
   connect with a SQL client.
5. Region: **Frankfurt (eu-central-1)** if you target German users (DSGVO),
   otherwise the closest region to your users.
6. Click **Create new project** and wait ~2 minutes for it to provision.

## 2. Run the schema

1. In the Supabase dashboard, open **SQL Editor** → **New query**.
2. Open `supabase-schema.sql` from this repo, copy the whole thing, paste it
   into the SQL editor.
3. Click **Run**. You should see `Success. No rows returned`.

## 3. Wire the app to the project

In the Supabase dashboard, open **Project Settings → API**. You need two values:

- **Project URL** (looks like `https://abcd1234.supabase.co`)
- **anon public key** (a long JWT starting with `eyJ...`)

Open `config.js` in this repo and paste both:

```js
window.SUPABASE_URL = 'https://abcd1234.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

Commit and push — Netlify auto-deploys.

> The anon key is **public by design**. It only grants access to what the
> Row-Level Security policies allow, which is "your own family" (for regular
> users) and "all families, read-only" (for admins).

## 4. Configure the magic-link redirect

In the Supabase dashboard, open **Authentication → URL Configuration**:

- **Site URL**: `https://kidscoinadventure.netlify.app`
- **Redirect URLs** (one per line):
  ```
  https://kidscoinadventure.netlify.app/
  https://kidscoinadventure.netlify.app/index.html
  http://localhost:8765/
  http://localhost:8765/index.html
  ```

The localhost entries let you test the magic-link flow while running
`npm run serve`.

## 5. Sign up as yourself

1. Open the deployed app.
2. Click **👤 Sign in** top-right.
3. Enter your email → **Send magic link**.
4. Check your inbox, click the link. You'll be returned to the app signed in.
5. Back in the app go to **Council → Account** — you should see your email
   and "Cloud synced".

## 6. Promote yourself to admin

Back in Supabase **SQL Editor**, run:

```sql
update public.profiles
set is_admin = true
where email = 'you@example.com';  -- your actual email
```

Reload the app. In **Council** you'll now see the **🛡 Global Admin**
section with a list of every family using the app.

## Rolling back

If anything goes wrong and you want to revert to offline-only mode, just set
both values back to `null` in `config.js` and redeploy. The app falls back
to localStorage transparently — your data is safe.
