import { Router } from 'express'
import Stripe from 'stripe'
import { connectDatabase } from '../config/database.js'
import { resolveStripeSubscriptionId, shouldSkipProcessedWebhook } from '../lib/marketplace.js'

const router = Router()
let stripeClient

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY must be configured')
  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY)
  return stripeClient
}

async function synchronizeVendorPremium(database, vendorId) {
  const activePaidSubscription = await database.collection('subscriptions').findOne(
    { vendorId, isPremium: true },
    { projection: { _id: 1 } },
  )
  await database.collection('vendorProfiles').updateOne(
    { userId: vendorId },
    { $set: { isPremium: Boolean(activePaidSubscription), updatedAt: new Date() } },
  )
}

router.post('/', async (request, response) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = request.get('stripe-signature')
  if (!secret || !signature || !Buffer.isBuffer(request.body)) {
    return response.status(400).json({ error: 'Webhook signature verification failed' })
  }

  let event
  try {
    event = getStripe().webhooks.constructEvent(request.body, signature, secret)
  } catch {
    return response.status(400).json({ error: 'Webhook signature verification failed' })
  }

  try {
    const database = await connectDatabase()
    const receipts = database.collection('stripeWebhookEvents')
    await receipts.updateOne(
      { _id: event.id },
      { $setOnInsert: { type: event.type, receivedAt: new Date(), processedAt: null } },
      { upsert: true },
    )
    const receipt = await receipts.findOne({ _id: event.id })
    if (shouldSkipProcessedWebhook(receipt)) return response.json({ received: true, duplicate: true })

    await processEvent(event, database)
    await receipts.updateOne({ _id: event.id }, { $set: { processedAt: new Date() } })
    response.json({ received: true })
  } catch (error) {
    request.log?.error({ error, eventId: event.id, eventType: event.type }, 'Stripe webhook processing failed')
    response.status(500).json({ error: 'Webhook processing failed' })
  }
})

async function processEvent(event, database) {
  const subscriptions = database.collection('subscriptions')
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    if (session.mode !== 'subscription' || !session.subscription || !session.metadata?.vendorId) return
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
    await subscriptions.updateOne(
      { stripeSubscriptionId: subscriptionId },
      {
        $set: {
          vendorId: session.metadata.vendorId,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
          stripeSubscriptionId: subscriptionId,
          checkoutSessionId: session.id,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date(), status: 'pending', isPremium: false },
      },
      { upsert: true },
    )
    return
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object
    const subscriptionId = resolveStripeSubscriptionId(invoice)
    if (!subscriptionId) return
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId)
    const vendorId = subscription.metadata?.vendorId
    if (!vendorId) throw new Error('Paid subscription is missing its vendor reference')
    const now = new Date()
    if (!['active', 'trialing'].includes(subscription.status)) {
      await subscriptions.updateOne(
        { stripeSubscriptionId: subscription.id },
        { $set: { status: subscription.status, isPremium: false, updatedAt: now } },
      )
      await synchronizeVendorPremium(database, vendorId)
      return
    }
    await subscriptions.updateOne(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          vendorId,
          stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
          stripeSubscriptionId: subscription.id,
          status: subscription.status,
          isPremium: true,
          currentPeriodEnd: subscription.items.data[0]?.current_period_end
            ? new Date(subscription.items.data[0].current_period_end * 1000)
            : null,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    )
    await synchronizeVendorPremium(database, vendorId)
    return
  }

  const subscriptionEventTypes = new Set([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ])
  if (subscriptionEventTypes.has(event.type)) {
    const subscription = await getStripe().subscriptions.retrieve(event.data.object.id)
    const vendorId = subscription.metadata?.vendorId
    if (!vendorId) return
    const now = new Date()
    const isPremium = subscription.status === 'active'
      ? (await subscriptions.findOne({ stripeSubscriptionId: subscription.id }))?.isPremium === true
      : false
    await subscriptions.updateOne(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          vendorId,
          stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
          stripeSubscriptionId: subscription.id,
          status: subscription.status,
          isPremium,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    )
    await synchronizeVendorPremium(database, vendorId)
    return
  }

  if (event.type === 'invoice.payment_failed') {
    const subscriptionId = resolveStripeSubscriptionId(event.data.object)
    if (!subscriptionId) return
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId)
    const vendorId = subscription.metadata?.vendorId
    if (!vendorId) return
    const now = new Date()
    const existing = await subscriptions.findOne({ stripeSubscriptionId: subscriptionId })
    const isPremium = subscription.status === 'active' && existing?.isPremium === true
    await subscriptions.updateOne({ stripeSubscriptionId: subscriptionId }, {
      $set: {
        vendorId,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
        status: subscription.status,
        isPremium,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now, stripeSubscriptionId: subscriptionId },
    }, { upsert: true })
    await synchronizeVendorPremium(database, vendorId)
  }
}

export default router
