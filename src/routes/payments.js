import { Router } from 'express'
import Stripe from 'stripe'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_not_configured')
const PREMIUM_AMOUNT = 1900
const PREMIUM_CURRENCY = 'usd'

router.post('/cancel', requireAuth('vendor'), async (request, response, next) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return response.status(503).json({ error: 'Payments are not configured yet.' })
    const database = await connectDatabase()
    const userId = ObjectId.isValid(request.user.id) ? new ObjectId(request.user.id) : request.user.id
    const vendor = await database.collection('users').findOne({ $or: [{ _id: userId }, { id: request.user.id }] })
    if (!vendor?.stripeSubscriptionId) return response.status(404).json({ error: 'No active Premium subscription was found.' })
    const subscription = await stripe.subscriptions.update(vendor.stripeSubscriptionId, { cancel_at_period_end: true }, {
      idempotencyKey: `cancel_${vendor.stripeSubscriptionId}`,
    })
    const expiration = new Date(subscription.current_period_end * 1000)
    await database.collection('users').updateOne(
      { _id: vendor._id },
      { $set: { subscriptionExpiresAt: expiration, subscriptionCancelAtPeriodEnd: true } },
    )
    response.json({ success: true, subscriptionExpiresAt: expiration })
  } catch (error) { next(error) }
})

router.post('/checkout', requireAuth('vendor'), async (request, response, next) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return response.status(503).json({ error: 'Payments are not configured yet.' })
    const database = await connectDatabase()
    const userId = ObjectId.isValid(request.user.id) ? new ObjectId(request.user.id) : request.user.id
    const vendor = await database.collection('users').findOne({ $or: [{ _id: userId }, { id: request.user.id }] })
    if (!vendor) return response.status(404).json({ error: 'Vendor account not found.' })
    if (vendor.subscriptionPlan === 'premium' && new Date(vendor.subscriptionExpiresAt) > new Date()) {
      return response.status(409).json({ error: 'Your Premium subscription is already active.' })
    }

    const origin = (process.env.CLIENT_ORIGIN ?? process.env.CLIENT_URL ?? 'http://localhost:3001').split(',')[0].trim().replace(/\/$/, '')
    const suppliedKey = request.get('idempotency-key')
    const idempotencyKey = typeof suppliedKey === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(suppliedKey)
      ? suppliedKey
      : `premium_${request.user.id}_${Math.floor(Date.now() / 60000)}`
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: vendor.email,
      client_reference_id: request.user.id,
      metadata: { vendorId: request.user.id, plan: 'premium' },
      subscription_data: { metadata: { vendorId: request.user.id, plan: 'premium' } },
      line_items: [{
        price_data: {
          currency: PREMIUM_CURRENCY,
          unit_amount: PREMIUM_AMOUNT,
          recurring: { interval: 'month' },
          product_data: { name: 'WedPlan Premium', description: 'Unlimited active wedding service listings' },
        },
        quantity: 1,
      }],
      success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment/cancel`,
    }, { idempotencyKey })
    response.status(201).json({ url: session.url })
  } catch (error) {
    next(error)
  }
})

export default router
