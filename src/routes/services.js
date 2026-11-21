import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'

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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
}

export default router
