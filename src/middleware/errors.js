export function notFound(request, response) {
  response.status(404).json({ error: `Route ${request.method} ${request.path} was not found` })
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error)
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Request body must contain valid JSON' })
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'The image must be no larger than 5 MB' })
  }
  if (typeof error.code === 'string' && error.code.startsWith('LIMIT_')) {
    return response.status(400).json({ error: 'Choose one image file to upload' })
  }
  if (error.code === 11000) {
    return response.status(409).json({ error: 'A record with these details already exists' })
  }
  request.log?.error({ error }, 'API request failed')
  response.status(error.statusCode ?? 500).json({
    error: error.statusCode && error.statusCode < 500 ? error.message : 'An unexpected server error occurred',
  })
}
