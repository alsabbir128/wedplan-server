import { Router } from 'express'
import { connectDatabase } from '../config/database.js'

const router = Router()

router.get('/', async (request, response, next) => {
  try {
    await connectDatabase()
    response.json({ status: 'ok', database: 'connected' })
  } catch (error) {
    next(error)
  }
})

export default router
