// Kids Coin Quest — Stripe Checkout Session creator
//
// Called by the frontend when a free user clicks "Upgrade to Pro".
// Auth: requires the user's Supabase JWT (Authorization: Bearer <token>).
// Body: { period: 'monthly' | 'yearly' }
// Returns: { url: 'https://checkout.stripe.com/...' }
//
// Flow:
//   1. Verify JWT, extract user.
//   2. Look up user's stripe_customer_id in subscriptions.
//   3. If missing, create a Stripe customer + persist the id.
//   4. Create a Checkout Session for the requested price.
//   5. Return the URL — frontend redirects.
//
// Env vars (set via `supabase secrets set ...`):
//   STRIPE_SECRET_KEY            sk_test_xxx or sk_live_xxx
//   STRIPE_PRICE_ID_MONTHLY      price_xxx (€3/mo)
//   STRIPE_PRICE_ID_YEARLY       price_xxx (€19.99/yr)
//   APP_URL                      https://kidscoinquest.app
//   SUPABASE_URL                 (auto-injected by Supabase)
//   SUPABASE_ANON_KEY            (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-injected)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('missing Authorization header');

    // Authenticate the caller against their own JWT.
    const supaUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !user) throw new Error('not authenticated');

    const { period } = await req.json().catch(() => ({}));
    if (period !== 'monthly' && period !== 'yearly') {
      throw new Error('period must be monthly or yearly');
    }
    const priceId = period === 'yearly'
      ? Deno.env.get('STRIPE_PRICE_ID_YEARLY')
      : Deno.env.get('STRIPE_PRICE_ID_MONTHLY');
    if (!priceId) throw new Error(`STRIPE_PRICE_ID_${period.toUpperCase()} not configured`);

    // Service-role client to read/write subscriptions row (bypasses RLS).
    const supaAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Find or create Stripe customer.
    const { data: subRow } = await supaAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let customerId = subRow?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      // Persist it so the webhook can resolve user_id from customer_id.
      await supaAdmin
        .from('subscriptions')
        .upsert(
          { user_id: user.id, stripe_customer_id: customerId },
          { onConflict: 'user_id' },
        );
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://kidscoinquest.app';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Both metadata blocks: the session itself for reference, and
      // `subscription_data.metadata` so it propagates onto the
      // Subscription object that webhooks fire about.
      metadata: { supabase_user_id: user.id, period },
      subscription_data: {
        metadata: { supabase_user_id: user.id, period },
      },
      success_url: `${appUrl}/?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?upgrade=cancel`,
      // Localise the checkout to the user's browser language; Stripe
      // auto-detects from the Accept-Language header otherwise.
      locale: 'auto',
      // Allow promotion codes — gives Sebastian a marketing lever.
      allow_promotion_codes: true,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('create-checkout-session error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
