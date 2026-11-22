import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canTransitionBookingStatus,
  isSafeIdempotencyKey,
  normalizeServiceInput,
  normalizeVendorApplication,
  resolveStripeSubscriptionId,
  isSameOwnerId,
  shouldSkipProcessedWebhook,
} from '../src/lib/marketplace.js'
import { isAllowedRole } from '../src/middleware/auth.js'

test('service validation requires supported category and safe values', () => {
  assert.equal(normalizeServiceInput({
    serviceName: 'Garden venue', category: 'Wedding Venues', location: 'Hudson Valley',
    description: 'A garden for celebrations', price: 5000, images: ['https://images.example.com/a.jpg'],
  }).data.price, 5000)
  assert.match(normalizeServiceInput({
    serviceName: 'Venue', category: 'Other', location: 'NY', description: 'A venue', price: -1,
  }).error, /category/i)
  assert.match(normalizeServiceInput({
    serviceName: 'Venue', category: 'Wedding Venues', location: 'NY', description: 'A venue', price: -1,
  }).error, /price/i)
})

test('vendor applications reject unsupported categories and malformed websites', () => {
  const valid = normalizeVendorApplication({
    businessName: 'Petal Studio', category: 'Decoration & Florist', location: 'Brooklyn',
    description: 'Seasonal flowers for celebrations', website: 'https://petal.example.com',
  })
  assert.equal(valid.data.businessName, 'Petal Studio')
  assert.match(normalizeVendorApplication({
    businessName: 'Petal Studio', category: 'Other', location: 'Brooklyn', description: 'Flowers',
  }).error, /category/i)
  assert.match(normalizeVendorApplication({
    businessName: 'Petal Studio', category: 'Decoration & Florist', location: 'Brooklyn',
    description: 'Flowers', website: 'javascript:alert(1)',
  }).error, /website/i)
})

test('booking transitions enforce role, current state, and allowed outcome', () => {
  assert.equal(canTransitionBookingStatus('pending', 'cancelled', 'customer'), true)
  assert.equal(canTransitionBookingStatus('pending', 'accepted', 'vendor'), true)
  assert.equal(canTransitionBookingStatus('pending', 'accepted', 'customer'), false)
  assert.equal(canTransitionBookingStatus('accepted', 'cancelled', 'customer'), false)
})

test('subscription helpers validate idempotency and normalize Stripe invoice shapes', () => {
  assert.equal(isSafeIdempotencyKey('checkout-1234567890'), true)
  assert.equal(isSafeIdempotencyKey('short'), false)
  assert.equal(isSafeIdempotencyKey('bad key 123456789'), false)
  assert.equal(resolveStripeSubscriptionId({ subscription: 'sub_old' }), 'sub_old')
  assert.equal(resolveStripeSubscriptionId({ parent: { subscription_details: { subscription: { id: 'sub_new' } } } }), 'sub_new')
  assert.equal(resolveStripeSubscriptionId({}), null)
})

test('role and ownership guards reject unrelated actors', () => {
  assert.equal(isAllowedRole('vendor', ['vendor']), true)
  assert.equal(isAllowedRole('customer', ['vendor']), false)
  assert.equal(isAllowedRole('customer', []), true)
  assert.equal(isSameOwnerId('vendor-1', 'vendor-1'), true)
  assert.equal(isSameOwnerId('vendor-1', 'vendor-2'), false)
  assert.equal(isSameOwnerId(null, 'vendor-1'), false)
})

test('processed Stripe webhook receipts are treated as duplicates', () => {
  assert.equal(shouldSkipProcessedWebhook({ processedAt: new Date() }), true)
  assert.equal(shouldSkipProcessedWebhook({ processedAt: null }), false)
  assert.equal(shouldSkipProcessedWebhook(null), false)
})
