# Google Sign-In setup

The "Continue with Google" button needs a one-time setup on two dashboards:
Google Cloud (where Google hosts your OAuth client) and Supabase (where you
tell it about the Google client). ~10 minutes total.

## Part 1 — Google Cloud Console

### 1.1 Create / pick a project

1. Open https://console.cloud.google.com
2. Top bar → project picker → **New Project**
3. Name: `kids-coin-quest`. Create.
4. Make sure that project is selected.

### 1.2 Configure the OAuth consent screen

1. Left nav → **APIs & Services → OAuth consent screen**
2. User type: **External**. Create.
3. App information:
   - **App name:** Kids Coin Quest
   - **User support email:** your email
   - **App logo:** optional; you can skip for now
4. App domain (all optional, can be left blank for testing):
   - Application home page: `https://kidscoinquest.app`
5. **Authorized domains:** add `kidscoinquest.app`
6. **Developer contact info:** your email. Save & continue.
7. **Scopes:** don't add anything extra. Save & continue.
8. **Test users:** add your own Google email (and any other family-member emails
   you want to let in while the app is in "testing" mode). Save & continue.
9. Back to dashboard. The app stays in **Testing** mode, which is fine —
   unverified apps in testing mode allow up to 100 users to sign in. You only
   need to verify with Google if you go fully public.

### 1.3 Create the OAuth 2.0 Client ID

1. Left nav → **APIs & Services → Credentials**
2. **+ Create credentials → OAuth client ID**
3. **Application type:** Web application
4. **Name:** `Kids Coin Quest — Web`
5. **Authorized JavaScript origins:** (none needed for Supabase flow — leave empty)
6. **Authorized redirect URIs** — add exactly this URL:

   ```
   https://dyfomoaxreoaceaakusg.supabase.co/auth/v1/callback
   ```

   (This is always `https://<your-project-ref>.supabase.co/auth/v1/callback`.
   Supabase handles the redirect, then bounces to your app.)

7. **Create.** A dialog shows two values — **keep these open:**
   - **Client ID** (ends in `.apps.googleusercontent.com`)
   - **Client secret** (short alphanumeric string)

## Part 2 — Supabase

1. Open https://app.supabase.com/project/dyfomoaxreoaceaakusg/auth/providers
2. Find **Google** in the list → click to expand → toggle **Enabled = ON**
3. Paste the **Client ID** and **Client secret** from step 1.3
4. **Skip nonce checks:** leave OFF (default)
5. **Save**

## Part 3 — Test

1. Open the app in an incognito window: https://kidscoinquest.app
2. Landing page → **Get started** → sign-in modal
3. Click **Continue with Google**
4. Google consent screen appears. Pick your account → Continue
5. Returns to the app, signed in. Council → Account shows your Google email.

## Common issues

- **"Error 400: redirect_uri_mismatch"** — the redirect URI in Google Cloud
  must be EXACTLY `https://<project-ref>.supabase.co/auth/v1/callback`. No
  trailing slash, no path changes.
- **"Access blocked: authorization error"** — your email isn't in the Test
  users list (while the app is in Testing mode). Add it in the consent
  screen config.
- **Returns to app but not signed in** — check that the Supabase **Site URL**
  and **Redirect URLs** (Authentication → URL Configuration) include
  `https://kidscoinquest.app`.

## Going live (later)

When you're ready to let anyone sign up:
1. Google consent screen → **Publish app**
2. For a kids-focused app, Google will likely require verification
   (takes a few weeks; requires a privacy-policy URL, homepage, and a
   demonstration video of the OAuth flow).
3. Until verified, the 100-user testing limit stays.
