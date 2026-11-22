import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'
import { userIdFilter } from '../lib/identity.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/overview', requireAuth('admin'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const [customers, vendors, pendingVendors, activeServices, pendingServices, bookings, activeSubscriptions] = await Promise.all([
      database.collection('users').countDocuments({ role: 'customer' }),
      database.collection('users').countDocuments({ role: 'vendor' }),
      database.collection('vendorApplications').countDocuments({ status: 'pending' }),
      database.collection('services').countDocuments({ status: 'approved', isActive: true }),
      database.collection('services').countDocuments({ status: 'pending', isActive: true }),
      database.collection('bookings').countDocuments({}),
      database.collection('subscriptions').countDocuments({ isPremium: true }),
    ])
    response.json({ customers, vendors, pendingVendors, activeServices, pendingServices, bookings, activeSubscriptions })
  } catch (error) {
    next(error)
  }
})

router.get('/users', requireAuth('admin'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const page = Math.max(Number.parseInt(request.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 25, 1), 100)
    const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 100) : ''
    const filter = search ? {
      $or: [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { email: { $regex: escapeRegex(search), $options: 'i' } },
      ],
    } : {}
    const [items, total] = await Promise.all([
      database.collection('users').find(filter, {
        projection: { name: 1, email: 1, role: 1, isBlocked: 1, createdAt: 1 },
      }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      database.collection('users').countDocuments(filter),
    ])
    response.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

router.patch('/users/:id/status', requireAuth('admin'), async (request, response, next) => {
  try {
    if (request.user.id === request.params.id) return response.status(400).json({ error: 'You cannot change your own account status' })
    if (typeof request.body?.isBlocked !== 'boolean') return response.status(400).json({ error: 'isBlocked must be a boolean' })
    const database = await connectDatabase()
    const result = await database.collection('users').findOneAndUpdate(
      userIdFilter(request.params.id),
      { $set: { isBlocked: request.body.isBlocked, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { name: 1, email: 1, role: 1, isBlocked: 1 } },
    )
    if (!result) return response.status(404).json({ error: 'User not found' })
    response.json({ item: result })
  } catch (error) {
    next(error)
  }
})

router.get('/vendors', requireAuth('admin'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const status = typeof request.query.status === 'string' && ['pending', 'approved', 'rejected'].includes(request.query.status)
      ? request.query.status
      : undefined
    const filter = status ? { status } : {}
    const items = await database.collection('vendorApplications').find(filter).sort({ createdAt: -1 }).limit(100).toArray()
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

router.patch('/vendors/:id/status', requireAuth('admin'), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid application ID' })
    const { status } = request.body ?? {}
    if (!['approved', 'rejected'].includes(status)) return response.status(400).json({ error: 'Status must be approved or rejected' })

    const database = await connectDatabase()
    const applications = database.collection('vendorApplications')
    const application = await applications.findOne({ _id: new ObjectId(request.params.id), status: 'pending' })
    if (!application) return response.status(404).json({ error: 'Pending vendor application not found' })
    const user = await database.collection('users').findOne(userIdFilter(application.userId))
    if (!user) return response.status(404).json({ error: 'Applicant account not found' })

    const reviewedAt = new Date()
    if (status === 'approved') {
      await database.collection('users').updateOne(userIdFilter(application.userId), {
        $set: { role: 'vendor', updatedAt: reviewedAt },
      })
      await database.collection('vendorProfiles').updateOne(
        { userId: application.userId },
        {
          $set: {
            businessName: application.businessName,
            category: application.category,
            location: application.location,
            description: application.description,
            phone: application.phone ?? '',
            website: application.website ?? '',
            contactEmail: application.contactEmail ?? user.email,
            userId: application.userId,
            updatedAt: reviewedAt,
          },
          $setOnInsert: { createdAt: reviewedAt },
        },
        { upsert: true },
      )
    }
    await applications.updateOne({ _id: application._id, status: 'pending' }, {
      $set: { status, reviewedAt, reviewedBy: request.user.id, updatedAt: reviewedAt },
    })
    response.json({ item: { ...application, status, reviewedAt } })
  } catch (error) {
    next(error)
  }
})

router.get('/services', requireAuth('admin'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const status = typeof request.query.status === 'string' && ['pending', 'approved', 'rejected'].includes(request.query.status)
      ? request.query.status
      : undefined
    const filter = status ? { status } : {}
    const items = await database.collection('services').find(filter).sort({ createdAt: -1 }).limit(100).toArray()
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

router.patch('/services/:id/status', requireAuth('admin'), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid service ID' })
    const { status } = request.body ?? {}
    if (!['approved', 'rejected'].includes(status)) return response.status(400).json({ error: 'Status must be approved or rejected' })
    const database = await connectDatabase()
    const result = await database.collection('services').findOneAndUpdate(
      { _id: new ObjectId(request.params.id) },
      { $set: { status, isActive: status === 'approved', reviewedAt: new Date(), reviewedBy: request.user.id, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) return response.status(404).json({ error: 'Service not found' })
    response.json({ item: result })
  } catch (error) {
    next(error)
  }
})

router.get('/transactions', requireAuth('admin'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const items = await database.collection('subscriptions').find({})
      .sort({ updatedAt: -1 }).limit(100).toArray()
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default router
