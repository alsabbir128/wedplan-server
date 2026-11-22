import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'
import { normalizeServiceInput, serviceCategories } from '../lib/marketplace.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/', async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const { search = '', category, location, sort = 'recommended', limit = '24', page = '1' } = request.query
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 24, 1), 60)
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1)
    const filter = { status: 'approved', isActive: true }
    if (typeof category === 'string' && serviceCategories.has(category)) filter.category = category
    if (typeof location === 'string' && location.trim()) filter.location = { $regex: escapeRegex(location.trim()), $options: 'i' }
    if (typeof search === 'string' && search.trim()) {
      const term = escapeRegex(search.trim())
      filter.$or = [
        { serviceName: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
        { location: { $regex: term, $options: 'i' } },
      ]
    }

    const order = sort === 'price-asc' ? { price: 1 } : sort === 'price-desc' ? { price: -1 } : { createdAt: -1 }
    const [items, total] = await Promise.all([
      database.collection('services').find(filter).sort(order).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
      database.collection('services').countDocuments(filter),
    ])
    response.json({ items, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } })
  } catch (error) {
    next(error)
  }
})

router.get('/mine', requireAuth('vendor'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const items = await database.collection('services').find({ vendorId: request.user.id })
      .sort({ updatedAt: -1 }).limit(100).toArray()
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

router.post('/', requireAuth('vendor'), async (request, response, next) => {
  try {
    const { data, error } = normalizeServiceInput(request.body)
    if (error) return response.status(400).json({ error })
    const database = await connectDatabase()
    const vendor = await database.collection('vendorProfiles').findOne({ userId: request.user.id })
    if (!vendor) return response.status(403).json({ error: 'Complete vendor onboarding before publishing a service' })

    const service = {
      ...data,
      vendorId: request.user.id,
      vendorName: request.user.name,
      businessName: vendor.businessName,
      status: 'pending',
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const result = await database.collection('services').insertOne(service)
    response.status(201).json({ item: { ...service, _id: result.insertedId } })
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
    response.json({ item: service })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', requireAuth('vendor'), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid service ID' })
    const { data, error } = normalizeServiceInput(request.body, { partial: true })
    if (error) return response.status(400).json({ error })
    if (!Object.keys(data).length) return response.status(400).json({ error: 'Provide at least one service field to update' })

    const database = await connectDatabase()
    const result = await database.collection('services').findOneAndUpdate(
      { _id: new ObjectId(request.params.id), vendorId: request.user.id },
      { $set: { ...data, status: 'pending', isActive: false, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) return response.status(404).json({ error: 'Service not found for this vendor' })
    response.json({ item: result })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', requireAuth('vendor'), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid service ID' })
    const database = await connectDatabase()
    const result = await database.collection('services').findOneAndUpdate(
      { _id: new ObjectId(request.params.id), vendorId: request.user.id, isActive: true },
      { $set: { isActive: false, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) return response.status(404).json({ error: 'Active service not found for this vendor' })
    response.json({ item: result })
  } catch (error) {
    next(error)
  }
})

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default router
