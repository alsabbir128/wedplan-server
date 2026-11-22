import Stripe from 'stripe'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_not_configured')
const PREMIUM_AMOUNT = 1900
const PREMIUM_CURRENCY = 'usd'

export async function handleStripeWebhook(request, response) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !process.env.STRIPE_SECRET_KEY) return response.status(503).json({ error: 'Stripe webhook is not configured.' })
  let event
  try {
    event = stripe.webhooks.constructEvent(request.body, request.get('stripe-signature'), secret)
  } catch {
    return response.status(400).json({ error: 'Invalid Stripe signature.' })
  }

  try {
    const database = await connectDatabase()
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const vendorId = session.metadata?.vendorId
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      if (
        session.mode === 'subscription' &&
        vendorId &&
        session.client_reference_id === vendorId &&
        session.payment_status === 'paid' &&
        session.amount_total === PREMIUM_AMOUNT &&
        session.currency?.toLowerCase() === PREMIUM_CURRENCY &&
        subscriptionId
      ) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const matchingPrice = subscription.items.data.some((item) =>
          item.quantity === 1 &&
          item.price.unit_amount === PREMIUM_AMOUNT &&
          item.price.currency.toLowerCase() === PREMIUM_CURRENCY &&
          item.price.recurring?.interval === 'month'
        )
        const active = ['active', 'trialing'].includes(subscription.status)
        if (!matchingPrice || !active || subscription.metadata?.vendorId !== vendorId) {
          return response.json({ received: true, ignored: true })
        }

        const expiration = new Date(subscription.current_period_end * 1000)
        const id = ObjectId.isValid(vendorId) ? new ObjectId(vendorId) : vendorId
        const update = await database.collection('users').updateOne(
          { $or: [{ _id: id }, { id: vendorId }] },
          { $set: {
            subscriptionPlan: 'premium',
            subscriptionExpiresAt: expiration,
            stripeSubscriptionId: subscription.id,
            subscriptionCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
          } },
        )
        if (!update.matchedCount) throw new Error('Vendor account for verified Stripe session was not found.')
        await database.collection('transactions').updateOne(
          { stripeSessionId: session.id },
          { $setOnInsert: {
            vendorId,
            plan: 'premium',
            amount: session.amount_total ?? PREMIUM_AMOUNT,
            currency: session.currency ?? PREMIUM_CURRENCY,
            stripeSessionId: session.id,
            stripeSubscriptionId: subscription.id,
            status: 'paid',
            createdAt: new Date(),
          } },
          { upsert: true },
        )
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object
      const vendorId = subscription.metadata?.vendorId
      if (vendorId) {
        const id = ObjectId.isValid(vendorId) ? new ObjectId(vendorId) : vendorId
        const active = ['active', 'trialing'].includes(subscription.status)
        await database.collection('users').updateOne(
          { $or: [{ _id: id }, { id: vendorId }], stripeSubscriptionId: subscription.id },
          { $set: {
            subscriptionPlan: active ? 'premium' : 'free',
            subscriptionExpiresAt: active ? new Date(subscription.current_period_end * 1000) : null,
            subscriptionCancelAtPeriodEnd: active && Boolean(subscription.cancel_at_period_end),
          } },
        )
        if (!active) await database.collection('transactions').updateMany(
          { stripeSubscriptionId: subscription.id, status: 'paid' },
          { $set: { status: 'expired', updatedAt: new Date() } },
        )
      }
    }

    response.json({ received: true })
  } catch {
    response.status(500).json({ error: 'Could not process Stripe event.' })
  }
}
