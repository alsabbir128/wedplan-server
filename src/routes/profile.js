import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { connectDatabase } from '../config/database.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.patch('/', requireAuth(), async (request, response, next) => {
  try {
    const { name, businessName, image } = request.body ?? {}
    const updates = {}
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) return response.status(400).json({ error: 'Name must be between 2 and 100 characters.' })
      updates.name = name.trim()
    }
    if (businessName !== undefined) {
      if (request.user.role !== 'vendor') return response.status(403).json({ error: 'Only vendors can update a business name.' })
      if (typeof businessName !== 'string' || businessName.trim().length < 2 || businessName.trim().length > 120) return response.status(400).json({ error: 'Business name must be between 2 and 120 characters.' })
      updates.businessName = businessName.trim()
    }
    if (image !== undefined) {
      if (typeof image !== 'string' || (image && (!/^https:\/\//i.test(image) || image.length > 2048))) return response.status(400).json({ error: 'Profile image must be a valid HTTPS URL.' })
      updates.image = image || null
    }
    if (!Object.keys(updates).length) return response.status(400).json({ error: 'Provide at least one profile field to update.' })
    updates.updatedAt = new Date()
    const id = ObjectId.isValid(request.user.id) ? new ObjectId(request.user.id) : request.user.id
    const user = await (await connectDatabase()).collection('users').findOneAndUpdate(
      { $or: [{ _id: id }, { id: request.user.id }] },
      { $set: updates },
      { returnDocument: 'after', projection: { name: 1, email: 1, image: 1, role: 1, businessName: 1 } },
    )
    if (!user) return response.status(404).json({ error: 'Account not found.' })
    response.json({ user })
  } catch (error) { next(error) }
})

export default router
