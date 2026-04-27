// Kids Coin Quest — Stripe webhook receiver
//
// Stripe POSTs subscription lifecycle events here. We verify the
// signature, then upsert the relevant row in public.subscriptions
// using the SERVICE_ROLE_KEY (bypasses RLS).
//
// Deploy with `--no-verify-jwt` because Stripe doesn't send a
// Supabase JWT — we verify the Stripe webhook signature instead.
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Events handled:
//   • customer.subscription.created   — initial paid signup
//   • customer.subscription.updated   — plan change, status change
//   • customer.subscription.deleted   — cancellation
//   • invoice.payment_failed          — flag past_due
//
// Env vars:
//   STRIPE_SECRET_KEY            sk_test_xxx or sk_live_xxx
//   STRIPE_WEBHOOK_SECRET        whsec_xxx (from Stripe Dashboard → Webhooks)
//   STRIPE_PRICE_ID_MONTHLY      price_xxx
//   STRIPE_PRICE_ID_YEARLY       price_xxx
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const supaAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// price_id → billing_period mapping. Configured once via env vars so
// changing a price doesn't require a code deploy.
const PERIOD_BY_PRICE: Record<string, 'monthly' | 'yearly'> = {};
const monthlyId = Deno.env.get('STRIPE_PRICE_ID_MONTHLY');
const yearlyId  = Deno.env.get('STRIPE_PRICE_ID_YEARLY');
if (monthlyId) PERIOD_BY_PRICE[monthlyId] = 'monthly';
if (yearlyId)  PERIOD_BY_PRICE[yearlyId]  = 'yearly';

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('missing stripe-signature', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (e) {
    console.error('webhook signature verification failed:', (e as Error).message);
    return new Response(`signature error: ${(e as Error).message}`, { status: 400 });
  }

  console.log('stripe webhook event:', event.type, event.id);

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        await upsertFromStripeSubscription(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId(sub);
        if (!userId) {
          console.error('subscription.deleted: no user_id resolvable for', sub.id);
          break;
        }
        await supaAdmin.from('subscriptions').upsert({
          user_id: userId,
          plan: 'free',
          status: 'canceled',
          billing_period: null,
          stripe_subscription_id: null,
        }, { onConflict: 'user_id' });
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
        if (!customerId) break;
        const userId = await getUserIdFromCustomerId(customerId);
        if (!userId) break;
        await supaAdmin
          .from('subscriptions')
          .update({ status: 'past_due' })
          .eq('user_id', userId);
        break;
      }
      default:
        console.log('unhandled event type:', event.type);
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('webhook handler error:', e);
    return new Response(`handler error: ${(e as Error).message}`, { status: 500 });
  }
});

async function upsertFromStripeSubscription(sub: Stripe.Subscription) {
  const userId = await resolveUserId(sub);
  if (!userId) {
    console.error('no user_id resolvable for subscription', sub.id);
    return;
  }
  const priceId = sub.items.data[0]?.price?.id;
  const period = (priceId && PERIOD_BY_PRICE[priceId]) || 'monthly';
  const status = mapStripeStatus(sub.status);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  await supaAdmin.from('subscriptions').upsert({
    user_id: userId,
    plan: status === 'canceled' ? 'free' : 'pro',
    status,
    billing_period: status === 'canceled' ? null : period,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
  }, { onConflict: 'user_id' });
}

// Resolve user_id from a Subscription object. Two paths:
//   1. metadata.supabase_user_id (set by us during checkout)
//   2. lookup by stripe_customer_id in our table (fallback)
async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.supabase_user_id;
  if (fromMeta) return fromMeta;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  return await getUserIdFromCustomerId(customerId);
}

async function getUserIdFromCustomerId(customerId: string): Promise<string | null> {
  const { data } = await supaAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

// Stripe statuses → our 4-value enum.
//   active                  → active
//   trialing                → trialing
//   past_due, unpaid, incomplete, incomplete_expired → past_due
//   canceled, paused        → canceled
function mapStripeStatus(s: Stripe.Subscription.Status): 'active' | 'trialing' | 'past_due' | 'canceled' {
  if (s === 'active') return 'active';
  if (s === 'trialing') return 'trialing';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete' || s === 'incomplete_expired') return 'past_due';
  return 'canceled';
}
