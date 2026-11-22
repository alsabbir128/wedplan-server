import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const statuses = new Set(['accepted', 'rejected'])

router.post('/', requireAuth('customer'), async (request, response, next) => {
  try {
    const { serviceId, eventDate, eventLocation, message = '' } = request.body ?? {}
    if (!ObjectId.isValid(serviceId)) return response.status(400).json({ error: 'A valid service is required' })
    if (typeof eventLocation !== 'string' || !eventLocation.trim() || eventLocation.length > 240) {
      return response.status(400).json({ error: 'Event location is required and must be under 240 characters' })
    }
    const date = new Date(eventDate)
    if (!eventDate || Number.isNaN(date.getTime()) || date <= new Date()) {
      return response.status(400).json({ error: 'Choose a valid future event date' })
    }
    if (typeof message !== 'string' || message.length > 2000) {
      return response.status(400).json({ error: 'Message must be under 2,000 characters' })
    }

    const database = await connectDatabase()
    const service = await database.collection('services').findOne({
      _id: new ObjectId(serviceId), status: 'approved', isActive: true,
    })
    if (!service) return response.status(404).json({ error: 'This service is no longer available' })
    const vendorId = service.vendorId?.toString()
    if (!vendorId || vendorId === request.user.id) {
      return response.status(403).json({ error: 'You cannot book your own service' })
    }

    const day = date.toISOString().slice(0, 10)
    const bookings = database.collection('bookings')
    const existing = await bookings.findOne({
      serviceId: service._id,
      customerId: request.user.id,
      eventDate: day,
      status: { $in: ['pending', 'accepted'] },
    })
    if (existing) return response.status(409).json({ error: 'You already have an active request for this service and date' })

    const booking = {
      serviceId: service._id,
      vendorId,
      customerId: request.user.id,
      eventDate: day,
      eventLocation: eventLocation.trim(),
      message: message.trim(),
      status: 'pending',
      createdAt: new Date(),
    }
    const result = await bookings.insertOne(booking)
    response.status(201).json({ item: { ...booking, _id: result.insertedId } })
  } catch (error) {
    next(error)
  }
})

router.get('/mine', requireAuth('customer'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const items = await database.collection('bookings').find({ customerId: request.user.id }).sort({ createdAt: -1 }).toArray()
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

router.get('/vendor', requireAuth('vendor'), async (request, response, next) => {
  try {
    const database = await connectDatabase()
    const items = await database.collection('bookings').find({ vendorId: request.user.id }).sort({ createdAt: -1 }).toArray()
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/cancel', requireAuth('customer'), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid booking ID' })
    const database = await connectDatabase()
    const result = await database.collection('bookings').findOneAndUpdate(
      { _id: new ObjectId(request.params.id), customerId: request.user.id, status: 'pending' },
      { $set: { status: 'cancelled', updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) return response.status(404).json({ error: 'Pending booking request not found for this customer' })
    response.json({ item: result })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/status', requireAuth('vendor'), async (request, response, next) => {
  try {
    if (!ObjectId.isValid(request.params.id)) return response.status(400).json({ error: 'Invalid booking ID' })
    const { status } = request.body ?? {}
    if (!statuses.has(status)) return response.status(400).json({ error: 'Status must be accepted or rejected' })
    const database = await connectDatabase()
    const result = await database.collection('bookings').findOneAndUpdate(
      { _id: new ObjectId(request.params.id), vendorId: request.user.id, status: 'pending' },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) return response.status(404).json({ error: 'Pending booking request not found for this vendor' })
    response.json({ item: result })
  } catch (error) {
    next(error)
  }
})

export default router
