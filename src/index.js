import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { errorHandler, notFound } from './middleware/errors.js'
import healthRouter from './routes/health.js'
import servicesRouter from './routes/services.js'
import bookingsRouter from './routes/bookings.js'

const app = express()
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }))
app.use(express.json({ limit: '32kb' }))
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/health', healthRouter)
app.use('/api/services', servicesRouter)
app.use('/api/bookings', bookingsRouter)
app.use(notFound)
app.use(errorHandler)

const port = Number.parseInt(process.env.PORT ?? '4000', 10)
app.listen(port, () => process.stdout.write(`WedPlan API listening on port ${port}\n`))
