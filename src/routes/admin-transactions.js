import { Router } from 'express'
import { connectDatabase } from '../config/database.js'

const router = Router()

router.get('/', async (request, response, next) => {
  try {
    const items = await (await connectDatabase()).collection('transactions').find({}).sort({ createdAt: -1 }).limit(250).toArray()
    response.json({ items })
  } catch (error) { next(error) }
})

export default router
