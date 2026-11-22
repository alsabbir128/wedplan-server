import { createRemoteJWKSet, jwtVerify } from 'jose'
import { connectDatabase } from '../config/database.js'
import { userIdFilter } from '../lib/identity.js'

let remoteKeys

function getRemoteKeys() {
  const jwksUrl = process.env.BETTER_AUTH_JWKS_URL
  if (!jwksUrl) throw new Error('BETTER_AUTH_JWKS_URL must be configured')
  if (!remoteKeys) remoteKeys = createRemoteJWKSet(new URL(jwksUrl))
  return remoteKeys
}

export function isAllowedRole(role, allowedRoles) {
  return allowedRoles.length === 0 || allowedRoles.includes(role)
}

export function requireAuth(...allowedRoles) {
  return async (request, response, next) => {
    try {
      const authorization = request.get('authorization')
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
      if (!token) return response.status(401).json({ error: 'Authentication required' })

      let payload
      try {
        const verified = await jwtVerify(token, getRemoteKeys(), {
          issuer: process.env.BETTER_AUTH_ISSUER,
          audience: process.env.BETTER_AUTH_AUDIENCE,
          algorithms: ['RS256'],
        })
        payload = verified.payload
      } catch {
        return response.status(401).json({ error: 'Invalid or expired authentication token' })
      }
      if (typeof payload.sub !== 'string' || !payload.sub) {
        return response.status(401).json({ error: 'Invalid authentication token' })
      }

      const database = await connectDatabase()
      const user = await database.collection('users').findOne(userIdFilter(payload.sub))
      if (!user) return response.status(401).json({ error: 'Account not found' })
      if (user.isBlocked === true) return response.status(403).json({ error: 'This account is blocked' })
      const role = typeof user.role === 'string' ? user.role : 'customer'
      if (!isAllowedRole(role, allowedRoles)) {
        return response.status(403).json({ error: 'You do not have permission to perform this action' })
      }

      request.user = { id: user._id?.toString() ?? String(user.id), role, name: user.name, email: user.email }
      return next()
    } catch (error) {
      if (error.code === 'ERR_JWT_EXPIRED' || error.code === 'ERR_JWS_INVALID' || error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' || error.code === 'ERR_JWKS_NO_MATCHING_KEY') {
        return response.status(401).json({ error: 'Invalid or expired authentication token' })
      }
      return next(error)
    }
  }
}
