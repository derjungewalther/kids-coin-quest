// Kids Coin Quest — Stripe Customer Portal session creator
//
// Called by the frontend when a Pro user clicks "Manage subscription".
// Auth: requires Supabase JWT.
// Returns: { url: 'https://billing.stripe.com/...' }
//
// The Customer Portal lets the user switch monthly↔yearly, update
// payment method, view invoices, and cancel — without us writing any
// of that UI ourselves. After they make a change, Stripe fires a
// webhook that lands in stripe-webhook/ and updates our subscriptions
// row.
//
// Env vars: STRIPE_SECRET_KEY, APP_URL, plus auto-injected Supabase env.

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

    const supaUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !user) throw new Error('not authenticated');

    const supaAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: subRow } = await supaAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!subRow?.stripe_customer_id) {
      throw new Error('no stripe customer — has the user paid yet?');
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://kidscoinquest.app';
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subRow.stripe_customer_id,
      return_url: appUrl,
    });

    return new Response(JSON.stringify({ url: portalSession.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('create-portal-session error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
