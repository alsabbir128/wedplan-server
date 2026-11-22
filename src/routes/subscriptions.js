import { Router } from 'express'
import Stripe from 'stripe'
import { connectDatabase } from '../config/database.js'
import { isSafeIdempotencyKey } from '../lib/marketplace.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
let stripeClient

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY must be configured')
  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY)
  return stripeClient
}

router.get('/me', requireAuth('vendor'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const item = await database.collection('subscriptions').findOne(
      { vendorId: request.user.id },
      { sort: { updatedAt: -1 }, projection: { vendorId: 0, stripeCustomerId: 0 } },
    )
    response.json({ item })
  } catch (error) {
    next(error)
  }
})

router.post('/portal', requireAuth('vendor'), async (request, response, next) => {
  try {
    const clientUrl = process.env.CLIENT_APP_URL ?? process.env.CLIENT_ORIGIN?.split(',')[0]
    if (!clientUrl) return response.status(503).json({ error: 'Vendor billing is not configured' })
    const database = await connectDatabase()
    const subscription = await database.collection('subscriptions').findOne(
      { vendorId: request.user.id, stripeCustomerId: { $type: 'string' } },
      { sort: { updatedAt: -1 }, projection: { stripeCustomerId: 1 } },
    )
    if (!subscription?.stripeCustomerId) return response.status(404).json({ error: 'No billing account is available yet' })
    const portal = await getStripe().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${new URL(clientUrl).origin}/vendor`,
    })
    response.json({ url: portal.url })
  } catch (error) {
    next(error)
  }
})

router.post('/checkout', requireAuth('vendor'), async (request, response, next) => {
  try {
    const priceId = process.env.STRIPE_VENDOR_PRICE_ID
    const clientUrl = process.env.CLIENT_APP_URL ?? process.env.CLIENT_ORIGIN?.split(',')[0]
    if (!priceId || !clientUrl) return response.status(503).json({ error: 'Vendor billing is not configured' })
    const idempotencyKey = request.get('idempotency-key')
    if (!isSafeIdempotencyKey(idempotencyKey)) {
      return response.status(400).json({ error: 'A valid Idempotency-Key header is required' })
    }

    const database = await connectDatabase()
    const active = await database.collection('subscriptions').findOne({ vendorId: request.user.id, isPremium: true })
    if (active) return response.status(409).json({ error: 'Your premium vendor plan is already active' })

    const origin = new URL(clientUrl).origin
    const checkout = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: request.user.email,
      client_reference_id: request.user.id,
      success_url: `${origin}/vendor?billing=success`,
      cancel_url: `${origin}/vendor?billing=cancelled`,
      metadata: { vendorId: request.user.id },
      subscription_data: { metadata: { vendorId: request.user.id } },
    }, {
      idempotencyKey: `wedplan:${request.user.id}:${idempotencyKey}`,
    })
    response.status(201).json({ url: checkout.url })
  } catch (error) {
    next(error)
  }
})

export default router
