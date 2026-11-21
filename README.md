# WedPlan API

Express API for the WedPlan wedding planning platform. This separate server project provides MongoDB-backed public service discovery and role-protected booking endpoints.

## Features

- Express 5 API with Helmet security headers, strict CORS allowlist, request-size limits, and rate limiting
- MongoDB Atlas connection via `MONGODB_URI` using the native driver
- Public listing/detail endpoints return approved, active services only, with keyword, category, location, pagination, and price sorting
- Better Auth-compatible remote JWKS JWT verification, with user role and blocked-account state loaded from MongoDB
- Booking creation scoped to the authenticated customer, plus vendor-owned request review and atomic pending-only status changes
- Consistent 400/401/403/404/409 errors and health endpoint

## Technology

Node.js 20+, Express 5, MongoDB Node.js Driver, jose, Helmet, CORS, express-rate-limit.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and set values from your MongoDB Atlas and Better Auth configuration. Never commit `.env` or production credentials.
3. Run `npm install`.
4. Run `npm run dev` to start the API on port 4000.
5. Visit `http://localhost:4000/api/health` to verify the server and MongoDB connection.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | API listen port (default `4000`) |
| `MONGODB_URI` | MongoDB Atlas connection string; secret |
| `MONGODB_DB` | Business database name (optional if URI selects it) |
| `CLIENT_ORIGIN` | Comma-separated exact client origins allowed by CORS |
| `BETTER_AUTH_JWKS_URL` | Better Auth JSON Web Key Set endpoint used to verify bearer tokens |
| `BETTER_AUTH_ISSUER` | Expected token issuer |
| `BETTER_AUTH_AUDIENCE` | Expected token audience |

Better Auth must be configured to issue RS256 JWTs with matching issuer and audience and expose the configured JWKS URL. API access is denied when JWT verification or the authoritative MongoDB user-role lookup fails.

## API routes

- `GET /api/health`
- `GET /api/services?search=&category=&location=&sort=price-asc&page=1&limit=24`
- `GET /api/services/:id`
- `POST /api/bookings` (customer bearer token)
- `GET /api/bookings/mine` (customer bearer token)
- `GET /api/bookings/vendor` (vendor bearer token)
- `PATCH /api/bookings/:id/status` (vendor bearer token; status `accepted` or `rejected`)

Protected routes require a valid Better Auth JWT in `Authorization: Bearer <token>`. Roles and blocked status are read from the database; request-supplied roles are never trusted.

## Data model

The API uses the platform `users`, `services`, and `bookings` collections and is designed to share the `users` collection with Better Auth. Business records reference service, vendor, and customer IDs. The service and booking route handlers expect the listed fields from the assignment.

## Deployment

Deploy this directory as a separate Node.js service. Set the environment variables in the deployment platform, configure the client origin(s), and ensure the Better Auth issuer/audience/JWKS settings match the client authentication setup. Never expose MongoDB or signing credentials to the browser.

## Repository links

- Client: https://github.com/alsabbir128/wedplan-client
- Server: https://github.com/alsabbir128/wedplan-server
- Live website: not deployed yet
