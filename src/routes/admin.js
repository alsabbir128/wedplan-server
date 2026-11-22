import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import usersRouter from './admin-users.js'
import servicesRouter from './admin-services.js'
import transactionsRouter from './admin-transactions.js'

const router = Router()
router.use(requireAuth('admin'))
router.use('/users', usersRouter)
router.use('/services', servicesRouter)
router.use('/transactions', transactionsRouter)

export default router
