# Stripe Integration Setup — Kids Coin Quest

End-to-end guide to wire up real Stripe checkout. After this is done,
the "Upgrade to Pro" button in the app actually charges users and the
`subscriptions` table reflects reality automatically via webhook.

**Time:** ~30 min walkthrough. **Stack:** Stripe + Supabase Edge Functions.

---

## 1 · Stripe Dashboard

Sign in at <https://dashboard.stripe.com>.

### 1.1 Toggle Test mode

Top right corner — work in **Test mode** until everything is verified
end-to-end. Switch to live only when you're ready to take real money.

### 1.2 Create the product + prices

1. **Products → Add product**
   - **Name:** `Kids Coin Quest Pro`
   - **Description:** _(optional)_ All 8 adventures, unlimited heroes, premium narration.
   - **Pricing model:** Standard pricing
   - **Price 1:** EUR `3.00` Recurring monthly → Add price
   - **Price 2:** EUR `19.99` Recurring yearly → Add price
   - **Save product**
2. Click each price; copy the price IDs (`price_xxxxxxxx`). You'll need these next.

### 1.3 Enable the Customer Portal

The portal is what users see when they click "Manage subscription" — Stripe-hosted, you don't write any UI for it.

1. **Settings → Billing → Customer portal**
2. Enable these features:
   - ✅ Customers can update payment methods
   - ✅ Customers can update billing addresses
   - ✅ Customers can cancel subscriptions (immediate or at period end — your call)
   - ✅ Customers can switch plans (so monthly ↔ yearly self-serve)
   - ✅ Invoice history
3. Set a return URL: `https://kidscoinquest.app`
4. **Save**

### 1.4 Set up the webhook

This is how Stripe tells our backend that a payment happened or a sub was canceled.

1. **Developers → Webhooks → Add endpoint**
2. **Endpoint URL:**
   ```
   https://dyfomoaxreoaceaakusg.supabase.co/functions/v1/stripe-webhook
   ```
3. **Events to send:**
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. **Add endpoint**
5. Click the endpoint, then **Reveal signing secret** → copy it (`whsec_xxxxxxxx`).

### 1.5 Get the secret API key

**Developers → API keys → Secret key** → copy (`sk_test_xxxxxxxx`).
Keep it secret. Don't commit it. Don't paste it into a client-side file.

---

## 2 · Supabase Edge Functions

You need the **Supabase CLI** installed locally:

```bash
brew install supabase/tap/supabase
# or:
npm install -g supabase
```

Then from the repo root:

```bash
cd /Users/sebastianwalther/Desktop/kids-piggy-bank
supabase login                                     # one-time
supabase link --project-ref dyfomoaxreoaceaakusg   # one-time
```

### 2.1 Set the secrets

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_xxxxxxxx \
  STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx \
  STRIPE_PRICE_ID_MONTHLY=price_xxxxxxxx \
  STRIPE_PRICE_ID_YEARLY=price_xxxxxxxx \
  APP_URL=https://kidscoinquest.app
```

The `SUPABASE_*` variables (URL, ANON_KEY, SERVICE_ROLE_KEY) are auto-injected
into Edge Functions by the platform — no need to set them manually.

### 2.2 Deploy the three functions

```bash
supabase functions deploy create-checkout-session
supabase functions deploy create-portal-session
supabase functions deploy stripe-webhook --no-verify-jwt
```

The `--no-verify-jwt` on the webhook is important: Stripe doesn't send a
Supabase JWT, it sends its own signature header which our function
verifies inside its body.

### 2.3 Verify

```bash
supabase functions list
```

Should show all three. Status `ACTIVE`.

You can also tail the logs:

```bash
supabase functions logs stripe-webhook --follow
```

---

## 3 · Test the full flow

1. Open the app → sign in as a free user
2. Settings → Konto → **⭐ Upgrade to Pro**
3. Pick **Monthly €3** in the pricing modal → **Upgrade to Pro** button
4. You'll be redirected to Stripe Checkout
5. Use the Stripe test card:
   - Card: `4242 4242 4242 4242`
   - Expiry: any future date (`12 / 34`)
   - CVC: any 3 digits (`123`)
   - Postal: any (`12345`)
6. Pay → Stripe redirects to `kidscoinquest.app/?upgrade=success`
7. Toast: "🎉 Welcome to Pro!"
8. Settings → Konto: badge should now say **⭐ Pro · €3/mo** with a **Manage subscription** button

In another tab, open the Supabase Table Editor → `public.subscriptions`. The user's row now has:
- `plan: 'pro'`
- `status: 'active'`
- `billing_period: 'monthly'`
- `stripe_customer_id: cus_xxx`
- `stripe_subscription_id: sub_xxx`

Check the admin dashboard (Settings → 🛡 Globaler Admin → 💳 Pläne) — the MRR/ARR cards reflect the new subscription.

### Test cancellation

1. In the app: **Manage subscription** → opens Stripe Portal
2. Click "Cancel plan"
3. Stripe fires `customer.subscription.deleted` webhook
4. Subscriptions row flips to `plan: 'free', status: 'canceled'`
5. Pro features lock again on next page reload

### Test failed payment

1. Stripe Dashboard → Customers → find the test customer
2. Find the subscription → "Update subscription" → set to a card that fails (`4000 0000 0000 0341`)
3. Wait for the next renewal (or trigger it manually)
4. `invoice.payment_failed` webhook → row updates to `status: 'past_due'`

---

## 4 · Going live

When you're ready for real money:

1. Stripe Dashboard → toggle **Live mode** (top right)
2. Re-do the Customer Portal config in live mode (it's a separate config from test)
3. Re-create the webhook endpoint in live mode → copy the new signing secret
4. Re-create the product and prices in live mode → copy the new price IDs
5. Update the secrets:
   ```bash
   supabase secrets set \
     STRIPE_SECRET_KEY=sk_live_xxxxxxxx \
     STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx \
     STRIPE_PRICE_ID_MONTHLY=price_xxxxxxxx \
     STRIPE_PRICE_ID_YEARLY=price_xxxxxxxx
   ```
6. Re-deploy the webhook function: `supabase functions deploy stripe-webhook --no-verify-jwt`

The Edge Function code doesn't change between test and live — only the
secrets. That's why we keep the price IDs in env vars, not hardcoded.

---

## 5 · Troubleshooting

**"Stripe checkout is not deployed yet" toast**
→ The Edge Function isn't deployed. Run `supabase functions deploy create-checkout-session`.

**Webhook signature verification fails (in function logs)**
→ Check `STRIPE_WEBHOOK_SECRET` matches the one in Stripe Dashboard.
→ Make sure the webhook endpoint URL in Stripe Dashboard matches the deployed function URL.

**Webhook fires but subscription row doesn't update**
→ Check function logs: `supabase functions logs stripe-webhook --follow`.
→ Common cause: `STRIPE_PRICE_ID_*` env vars missing → period defaults to 'monthly'.
→ Or: `metadata.supabase_user_id` is missing on the subscription. We set it during checkout, but if a customer was created outside our flow (e.g., manually in the dashboard), we resolve via `stripe_customer_id` lookup as a fallback.

**User on Pro but features still locked**
→ Hard-refresh (Cmd+Shift+R). The client caches `supaSubscription` until next session refresh.
→ Or call `refetchSubscription()` from DevTools console.

**Customer Portal: "no stripe customer" error**
→ The user has never paid — they're not in Stripe at all yet. The "Manage subscription" button shouldn't be visible for them; if it is, that's a UI bug.
