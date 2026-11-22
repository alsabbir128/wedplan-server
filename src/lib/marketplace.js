export const serviceCategories = new Set([
  'Photography & Videography',
  'Wedding Venues',
  'Decoration & Florist',
  'Catering Services',
  'Makeup & Styling',
  'Wedding Fashion',
])

const text = (value, max, required = false) => {
  if (typeof value !== 'string') return required ? null : undefined
  const normalized = value.trim()
  if ((!normalized && required) || normalized.length > max) return null
  return normalized
}

export function normalizeServiceInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'A service object is required' }
  }

  const data = {}
  const fields = [
    ['serviceName', 100, true],
    ['category', 80, true],
    ['location', 160, true],
    ['description', 2400, true],
  ]

  for (const [field, max, required] of fields) {
    if (partial && input[field] === undefined) continue
    const value = text(input[field], max, required)
    if (value === null) return { error: `${field} is required and must be under ${max} characters` }
    if (field === 'category' && !serviceCategories.has(value)) return { error: 'Choose a supported service category' }
    data[field] = value
  }

  if (!partial || input.price !== undefined) {
    const price = typeof input.price === 'number' ? input.price : Number(input.price)
    if (!Number.isFinite(price) || price < 0 || price > 10000000) {
      return { error: 'Price must be a non-negative amount under 10,000,000' }
    }
    data.price = Math.round(price * 100) / 100
  }

  if (!partial || input.images !== undefined) {
    const images = input.images ?? []
    if (!Array.isArray(images) || images.length > 8) return { error: 'Add up to 8 service images' }
    const safeImages = []
    for (const image of images) {
      if (typeof image !== 'string' || image.length > 2048) return { error: 'Each image must be a valid hosted image URL' }
      try {
        const parsed = new URL(image)
        if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Invalid URL')
        safeImages.push(parsed.toString())
      } catch {
        return { error: 'Each image must be a valid hosted image URL' }
      }
    }
    data.images = safeImages
  }

  return { data }
}

export function normalizeVendorApplication(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'A vendor profile is required' }
  }

  const businessName = text(input.businessName, 100, true)
  const category = text(input.category, 80, true)
  const location = text(input.location, 160, true)
  const description = text(input.description, 2400, true)
  const phone = text(input.phone ?? '', 40)
  const website = text(input.website ?? '', 500)
  if (!businessName || !category || !location || !description) {
    return { error: 'Business name, category, location, and description are required' }
  }
  if (!serviceCategories.has(category)) return { error: 'Choose a supported service category' }
  if (phone === null || website === null) return { error: 'Phone or website is too long' }
  if (website) {
    try {
      const parsed = new URL(website)
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Invalid URL')
    } catch {
      return { error: 'Website must be a valid http or https URL' }
    }
  }

  return { data: { businessName, category, location, description, phone: phone || '', website: website || '' } }
}

export function isSafeIdempotencyKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(value)
}

export function shouldSkipProcessedWebhook(receipt) {
  return Boolean(receipt?.processedAt)
}

export function isSameOwnerId(firstId, secondId) {
  return firstId !== undefined && firstId !== null && secondId !== undefined && secondId !== null
    && String(firstId) === String(secondId)
}

export function resolveStripeSubscriptionId(invoice) {
  const value = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription
  if (typeof value === 'string') return value
  return typeof value?.id === 'string' ? value.id : null
}

export function canTransitionBookingStatus(currentStatus, nextStatus, actorRole) {
  if (currentStatus !== 'pending') return false
  return (actorRole === 'vendor' && ['accepted', 'rejected'].includes(nextStatus))
    || (actorRole === 'customer' && nextStatus === 'cancelled')
}
