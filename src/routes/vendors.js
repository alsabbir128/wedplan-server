import { Router } from 'express'
import { connectDatabase } from '../config/database.js'
import { normalizeVendorApplication } from '../lib/marketplace.js'
import { userIdFilter } from '../lib/identity.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/me', requireAuth(), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const [profile, application] = await Promise.all([
      database.collection('vendorProfiles').findOne({ userId: request.user.id }),
      database.collection('vendorApplications').findOne({ userId: request.user.id }, { sort: { createdAt: -1 } }),
    ])
    response.json({ profile, application })
  } catch (error) {
    next(error)
  }
})

router.post('/apply', requireAuth('customer'), async (request, response, next) => {
  try {
    const { data, error } = normalizeVendorApplication(request.body)
    if (error) return response.status(400).json({ error })

    const database = await connectDatabase()
    const existing = await database.collection('vendorApplications').findOne({ userId: request.user.id })
    if (existing?.status === 'pending' || existing?.status === 'approved') {
      return response.status(409).json({ error: 'A vendor application already exists for this account' })
    }

    const application = {
      ...data,
      userId: request.user.id,
      contactEmail: request.user.email,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const result = await database.collection('vendorApplications').insertOne(application)
    response.status(201).json({ item: { ...application, _id: result.insertedId } })
  } catch (error) {
    next(error)
  }
})

router.patch('/me', requireAuth('vendor'), async (request, response, next) => {
  try {
    const { data, error } = normalizeVendorApplication(request.body)
    if (error) return response.status(400).json({ error })

    const database = await connectDatabase()
    const profile = {
      ...data,
      userId: request.user.id,
      contactEmail: request.user.email,
      updatedAt: new Date(),
    }
    await database.collection('vendorProfiles').updateOne(
      { userId: request.user.id },
      { $set: profile, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    )
    response.json({ profile })
  } catch (error) {
    next(error)
  }
})

export default router
