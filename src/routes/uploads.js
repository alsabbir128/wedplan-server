import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (request, file, callback) => {
    callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
  },
})

router.post('/images', requireAuth('vendor'), upload.single('image'), async (request, response) => {
  const apiKey = process.env.IMGBB_API_KEY
  if (!apiKey) return response.status(503).json({ error: 'Image uploads are not configured' })
  if (!request.file) return response.status(400).json({ error: 'Choose a JPEG, PNG, or WebP image under 5 MB' })

  try {
    const body = new URLSearchParams({ image: request.file.buffer.toString('base64') })
    const result = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(15000),
    })
    const payload = await result.json()
    if (!result.ok || !payload?.success || typeof payload?.data?.url !== 'string') {
      return response.status(502).json({ error: 'Image hosting could not accept this upload' })
    }
    response.status(201).json({ url: payload.data.url })
  } catch {
    response.status(502).json({ error: 'Image hosting is temporarily unavailable' })
  }
})

export default router
