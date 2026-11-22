import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'

const router = Router()

router.get('/', async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 100) : ''
    const role = ['customer', 'vendor', 'admin'].includes(request.query.role) ? request.query.role : null
    const filter = {}
    if (role) filter.role = role
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter.$or = [{ name: { $regex: safe, $options: 'i' } }, { email: { $regex: safe, $options: 'i' } }]
    }
    const items = await database.collection('users').find(filter, {
      projection: { name: 1, email: 1, role: 1, isBlocked: 1, businessName: 1, createdAt: 1, subscriptionPlan: 1 },
    }).sort({ createdAt: -1 }).limit(200).toArray()
    response.json({ items })
  } catch (error) { next(error) }
})

router.patch('/:id/block', async (request, response, next) => {
  try {
    const { isBlocked } = request.body ?? {}
    if (typeof isBlocked !== 'boolean') return response.status(400).json({ error: 'isBlocked must be true or false.' })
    if (request.params.id === request.user.id && isBlocked) return response.status(400).json({ error: 'You cannot block your own administrator account.' })
    const id = ObjectId.isValid(request.params.id) ? new ObjectId(request.params.id) : request.params.id
    const result = await (await connectDatabase()).collection('users').updateOne(
      { $or: [{ _id: id }, { id: request.params.id }] },
      { $set: { isBlocked, updatedAt: new Date() } },
    )
    if (!result.matchedCount) return response.status(404).json({ error: 'User not found.' })
    response.json({ success: true, isBlocked })
  } catch (error) { next(error) }
})

export default router
