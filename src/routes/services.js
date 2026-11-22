import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const categories = new Set(['Photography & Videography', 'Wedding Venues', 'Decoration & Florist', 'Catering Services', 'Makeup & Styling', 'Wedding Fashion'])

router.get('/', async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const { search = '', category, location, sort = 'recommended', limit = '24', page = '1' } = request.query
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 24, 1), 60)
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1)
    const filter = { status: 'approved', isActive: true }
    if (typeof category === 'string' && categories.has(category)) filter.category = category
    if (typeof location === 'string' && location.trim()) filter.location = { $regex: escapeRegex(location.trim()), $options: 'i' }
    if (typeof search === 'string' && search.trim()) {
      const term = escapeRegex(search.trim())
      filter.$or = [{ serviceName: { $regex: term, $options: 'i' } }, { description: { $regex: term, $options: 'i' } }]
    }

    const blockedVendors = await database.collection('users').find({ role: 'vendor', isBlocked: true }, { projection: { _id: 1, id: 1 } }).toArray()
    const blockedVendorIds = blockedVendors.flatMap((vendor) => [vendor._id?.toString(), vendor.id]).filter(Boolean)
    if (blockedVendorIds.length) filter.vendorId = { $nin: blockedVendorIds }
    const order = sort === 'price-asc' ? { price: 1 } : sort === 'price-desc' ? { price: -1 } : { createdAt: -1 }
    const [rawItems, total] = await Promise.all([
      database.collection('services').find(filter).sort(order).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
      database.collection('services').countDocuments(filter),
    ])
    const vendorIds = [...new Set(rawItems.map((item) => String(item.vendorId ?? '')).filter(Boolean))]
    const objectIds = vendorIds.filter(ObjectId.isValid).map((id) => new ObjectId(id))
    const vendors = vendorIds.length ? await database.collection('users').find({ $or: [
      { id: { $in: vendorIds } },
      ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
    ] }, { projection: { name: 1, businessName: 1 } }).toArray() : []
    const vendorById = new Map(vendors.map((vendor) => [vendor._id?.toString() ?? vendor.id, vendor]))
    const items = rawItems.map((item) => ({ ...item, vendor: vendorById.get(String(item.vendorId)) ?? null }))
    response.json({ items, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } })
  } catch (error) {
    next(error)
  }
})

router.get('/mine', requireAuth('vendor'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const items = await database.collection('services')
      .find({ vendorId: request.user.id, status: { $ne: 'deleted' } })
      .sort({ createdAt: -1 })
      .toArray()
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

router.post('/', requireAuth('vendor'), async (request, response, next) => {
  try {
    const { serviceName, category, description, price, location, images } = request.body ?? {}
    const validationError = validateService({ serviceName, category, description, price, location, images })
    if (validationError) return response.status(400).json({ error: validationError })

    const database = await connectDatabase()
    const now = new Date()
    const service = {
      vendorId: request.user.id,
      serviceName: serviceName.trim(),
      category,
      description: description.trim(),
      price: Number(price),
      location: location.trim(),
      images: images.map((image) => image.trim()),
      status: 'pending',
      isActive: false,
      createdAt: now,
      updatedAt: now,
    }
    const result = await database.collection('services').insertOne(service)
    response.status(201).json({ item: { ...service, _id: result.insertedId } })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', requireAuth('vendor'), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid service ID' })
    const fields = request.body ?? {}
    const allowed = ['serviceName', 'category', 'description', 'price', 'location', 'images']
    if (Object.keys(fields).some((field) => !allowed.includes(field))) {
      return response.status(400).json({ error: 'Only service details can be updated here' })
    }
    const current = await connectDatabase().then((database) => database.collection('services').findOne({
      _id: new ObjectId(request.params.id),
      vendorId: request.user.id,
      status: { $ne: 'deleted' },
    }))
    if (!current) return response.status(404).json({ error: 'Service not found for this vendor' })
    const updated = { ...current, ...fields }
    const validationError = validateService(updated)
    if (validationError) return response.status(400).json({ error: validationError })

    const database = await connectDatabase()
    const set = Object.fromEntries(Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() : Array.isArray(value) ? value.map((item) => item.trim()) : value,
    ]))
    set.updatedAt = new Date()
    if (current.status === 'approved') set.status = 'pending'
    if (current.status === 'approved') set.isActive = false
    const result = await database.collection('services').findOneAndUpdate(
      { _id: new ObjectId(request.params.id), vendorId: request.user.id, status: { $ne: 'deleted' } },
      { $set: set },
      { returnDocument: 'after' },
    )
    response.json({ item: result })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', requireAuth('vendor'), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid service ID' })
    const database = await connectDatabase()
    const result = await database.collection('services').updateOne(
      { _id: new ObjectId(request.params.id), vendorId: request.user.id, status: { $ne: 'deleted' } },
      { $set: { status: 'deleted', isActive: false, deletedAt: new Date(), updatedAt: new Date() } },
    )
    if (!result.matchedCount) return response.status(404).json({ error: 'Service not found for this vendor' })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/availability', requireAuth('vendor'), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid service ID' })
    const { isActive } = request.body ?? {}
    if (typeof isActive !== 'boolean') return response.status(400).json({ error: 'Availability must be true or false' })
    const database = await connectDatabase()
    const serviceFilter = { _id: new ObjectId(request.params.id), vendorId: request.user.id, status: 'approved' }
    const service = await database.collection('services').findOne(serviceFilter)
    if (!service) return response.status(404).json({ error: 'Approved service not found for this vendor' })
    if (isActive) {
      const userId = ObjectId.isValid(request.user.id) ? new ObjectId(request.user.id) : request.user.id
      const user = await database.collection('users').findOne({ $or: [{ _id: userId }, { id: request.user.id }] })
      const premium = user?.subscriptionPlan === 'premium' && new Date(user.subscriptionExpiresAt) > new Date()
      if (!premium) {
        const activeCount = await database.collection('services').countDocuments({
          vendorId: request.user.id,
          status: 'approved',
          isActive: true,
          _id: { $ne: service._id },
        })
        if (activeCount >= 3) return response.status(403).json({ error: 'The free plan allows up to 3 active services' })
      }
    }
    const result = await database.collection('services').findOneAndUpdate(
      serviceFilter,
      { $set: { isActive, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    response.json({ item: result })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid service ID' })
    const database = await connectDatabase()
    const service = await database.collection('services').findOne({
      _id: new ObjectId(request.params.id), status: 'approved', isActive: true,
    })
    if (!service) return response.status(404).json({ error: 'Service not found' })
    const vendorKey = String(service.vendorId ?? '')
    const vendorObjectId = ObjectId.isValid(vendorKey) ? new ObjectId(vendorKey) : null
    const vendor = await database.collection('users').findOne({ $or: [
      { id: vendorKey },
      ...(vendorObjectId ? [{ _id: vendorObjectId }] : []),
    ] }, { projection: { name: 1, businessName: 1, image: 1, isBlocked: 1 } })
    if (!vendor || vendor.isBlocked) return response.status(404).json({ error: 'Service not found' })
    response.json({ item: { ...service, vendor } })
  } catch (error) {
    next(error)
  }
})

function validateService({ serviceName, category, description, price, location, images }) {
  if (typeof serviceName !== 'string' || !serviceName.trim() || serviceName.trim().length > 120) {
    return 'Service name is required and must be under 120 characters'
  }
  if (typeof category !== 'string' || !categories.has(category)) return 'Choose a valid service category'
  if (typeof description !== 'string' || description.trim().length < 20 || description.trim().length > 5000) {
    return 'Description must be between 20 and 5,000 characters'
  }
  if (!Number.isFinite(Number(price)) || Number(price) <= 0 || Number(price) > 10000000) {
    return 'Enter a valid price greater than zero'
  }
  if (typeof location !== 'string' || !location.trim() || location.trim().length > 240) {
    return 'Location is required and must be under 240 characters'
  }
  if (!Array.isArray(images) || images.length < 1 || images.length > 8 || images.some((image) => {
    try {
      return typeof image !== 'string' || new URL(image).protocol !== 'https:'
    } catch {
      return true
    }
  })) return 'Add between 1 and 8 valid HTTPS image URLs'
  return null
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default router
