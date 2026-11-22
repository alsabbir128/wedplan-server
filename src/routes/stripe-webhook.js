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
      if (session.mode === 'subscription' && vendorId && ['paid', 'no_payment_required'].includes(session.payment_status)) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription)
        const expiration = new Date(subscription.current_period_end * 1000)
        const id = ObjectId.isValid(vendorId) ? new ObjectId(vendorId) : vendorId
        await database.collection('users').updateOne(
          { $or: [{ _id: id }, { id: vendorId }] },
          { $set: { subscriptionPlan: 'premium', subscriptionExpiresAt: expiration, stripeSubscriptionId: subscription.id } },
        )
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
