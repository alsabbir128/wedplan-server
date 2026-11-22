import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'

const router = Router()

router.get('/', async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const status = ['pending', 'approved', 'rejected', 'deleted'].includes(request.query.status) ? request.query.status : null
    const filter = status ? { status } : { status: { $ne: 'deleted' } }
    const items = await database.collection('services').find(filter).sort({ createdAt: -1 }).limit(200).toArray()
    response.json({ items })
  } catch (error) { next(error) }
})

router.patch('/:id/review', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid service ID.' })
    const { status, isActive } = request.body ?? {}
    if (!['approved', 'rejected'].includes(status) || (isActive !== undefined && typeof isActive !== 'boolean')) {
      return response.status(400).json({ error: 'Choose approved or rejected and a valid availability state.' })
    }
    const database = await connectDatabase()
    const serviceFilter = { _id: new ObjectId(request.params.id), status: { $ne: 'deleted' } }
    const service = await database.collection('services').findOne(serviceFilter)
    if (!service) return response.status(404).json({ error: 'Service not found.' })
    const shouldActivate = status === 'approved' && isActive === true
    if (shouldActivate) {
      const vendorId = String(service.vendorId ?? '')
      const vendorObjectId = ObjectId.isValid(vendorId) ? new ObjectId(vendorId) : null
      const vendor = await database.collection('users').findOne({ $or: [
        { id: vendorId },
        ...(vendorObjectId ? [{ _id: vendorObjectId }] : []),
      ] }, { projection: { subscriptionPlan: 1, subscriptionExpiresAt: 1 } })
      const premium = vendor?.subscriptionPlan === 'premium' && new Date(vendor.subscriptionExpiresAt) > new Date()
      if (!premium) {
        const activeCount = await database.collection('services').countDocuments({
          vendorId,
          status: 'approved',
          isActive: true,
          _id: { $ne: service._id },
        })
        if (activeCount >= 3) return response.status(409).json({ error: 'This vendor has reached the 3-service Free plan limit. Approve it while inactive or ask the vendor to upgrade.' })
      }
    }
    const set = { status, isActive: shouldActivate, reviewedAt: new Date(), updatedAt: new Date(), reviewedBy: request.user.id }
    const result = await database.collection('services').findOneAndUpdate(
      serviceFilter,
      { $set: set },
      { returnDocument: 'after' },
    )
    response.json({ item: result })
  } catch (error) { next(error) }
})

router.delete('/:id', async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid service ID.' })
    const result = await (await connectDatabase()).collection('services').updateOne(
      { _id: new ObjectId(request.params.id) },
      { $set: { status: 'deleted', isActive: false, deletedAt: new Date(), updatedAt: new Date() } },
    )
    if (!result.matchedCount) return response.status(404).json({ error: 'Service not found.' })
    response.status(204).end()
  } catch (error) { next(error) }
})

export default router
