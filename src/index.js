import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { errorHandler, notFound } from './middleware/errors.js'
import adminRouter from './routes/admin.js'
import bookingsRouter from './routes/bookings.js'
import healthRouter from './routes/health.js'
import servicesRouter from './routes/services.js'
import stripeWebhooksRouter from './routes/stripe-webhooks.js'
import subscriptionsRouter from './routes/subscriptions.js'
import uploadsRouter from './routes/uploads.js'
import vendorsRouter from './routes/vendors.js'

const app = express()
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
}))
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '100kb' }), stripeWebhooksRouter)
app.use(express.json({ limit: '32kb' }))
app.use('/api/health', healthRouter)
app.use('/api/services', servicesRouter)
app.use('/api/bookings', bookingsRouter)
app.use('/api/vendors', vendorsRouter)
app.use('/api/admin', adminRouter)
app.use('/api/subscriptions', subscriptionsRouter)
app.use('/api/uploads', uploadsRouter)
app.use(notFound)
app.use(errorHandler)

const port = Number.parseInt(process.env.PORT ?? '4000', 10)
app.listen(port, () => process.stdout.write(`WedPlan API listening on port ${port}\n`))
