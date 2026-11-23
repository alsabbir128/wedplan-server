# WedPlan API

Express API for the WedPlan wedding planning platform. This separate server project provides MongoDB-backed public service discovery and role-protected booking endpoints.

## Features

- Express 5 API with Helmet security headers, strict CORS allowlist, request-size limits, and rate limiting
- MongoDB Atlas connection via `MONGODB_URI` using the native driver
- Public listing/detail endpoints return approved, active services only, with keyword, category, location, pagination, and price sorting
- Better Auth-compatible remote JWKS JWT verification, with user role and blocked-account state loaded from MongoDB
- Customer booking requests and pending-only cancellation; vendor-owned service CRUD and request review
- Admin user status, vendor application, service moderation, and subscription transaction views
- Stripe-hosted vendor subscription Checkout with configurable Price ID, signature-verified raw-body webhooks, event receipts, and premium activation only after `invoice.paid`
- Vendor image uploads proxied through the API to ImgBB; the API never returns its credential
- Consistent 400/401/403/404/409 errors and health endpoint

## Technology

Node.js 20+, Express 5, MongoDB Node.js Driver, Stripe Node SDK, Multer, jose, Helmet, CORS, express-rate-limit.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and set values from your MongoDB Atlas and Better Auth configuration. Never commit `.env` or production credentials.
3. Run `npm install`.
4. Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the monthly `STRIPE_VENDOR_PRICE_ID` on the API deployment. Add the webhook URL `/api/webhooks/stripe` in Stripe and subscribe to `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
5. Configure `IMGBB_API_KEY` on the API deployment if vendors should upload service images.
6. Run `npm run dev` to start the API on port 4000.
7. Visit `http://localhost:4000/api/health` to verify the server and MongoDB connection.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | API listen port (default `4000`) |
| `MONGODB_URI` | MongoDB Atlas connection string; secret |
| `MONGODB_DB` | Business database name (optional if URI selects it) |
| `CLIENT_ORIGIN` | Comma-separated exact client origins allowed by CORS |
| `BETTER_AUTH_JWKS_URL` | Better Auth JSON Web Key Set endpoint used to verify bearer tokens |
| `BETTER_AUTH_ISSUER` | Expected token issuer |
| `BETTER_AUTH_AUDIENCE` | Expected token audience, for example `wedplan-api` |
| `CLIENT_APP_URL` | Canonical client origin used for Checkout return URLs |
| `STRIPE_SECRET_KEY` | Stripe secret key; server-only |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret; server-only |
| `STRIPE_VENDOR_PRICE_ID` | Stripe Dashboard Price ID for the vendor monthly subscription; configure this value in Stripe and do not accept it from clients |
| `IMGBB_API_KEY` | ImgBB credential used only by the image-upload proxy |

Better Auth must be configured to issue RS256 JWTs with matching issuer and audience and expose the configured JWKS URL. API access is denied when JWT verification or the authoritative MongoDB user-role lookup fails. The Express deployment is separate from the Vercel client: configure these API environment variables and Stripe webhook endpoint there; client-side environment variables do not automatically provision the API.

## API routes

- `GET /api/health`
- `GET /api/services?search=&category=&location=&sort=price-asc&page=1&limit=24`
- `GET /api/services/:id`
- `POST /api/bookings` (customer bearer token)
- `GET /api/bookings/mine` (customer bearer token)
- `GET /api/bookings/vendor` (vendor bearer token)
- `DELETE /api/bookings/:id` (customer bearer token; pending requests only)
- `PATCH /api/bookings/:id/status` (vendor bearer token; status `accepted` or `rejected`)
- `GET /api/vendors/me`, `POST /api/vendors/apply`, `PATCH /api/vendors/me`
- `GET /api/services/mine`, `POST /api/services`, `PATCH /api/services/:id`, `DELETE /api/services/:id` (vendor-owned)
- `GET /api/admin/overview`, `/users`, `/vendors`, `/services`, `/transactions`; admin status updates use `PATCH /api/admin/users/:id/status`, `/vendors/:id/status`, and `/services/:id/status`
- `POST /api/subscriptions/checkout`, `POST /api/subscriptions/portal`, and `GET /api/subscriptions/me` (vendor bearer token)
- `POST /api/webhooks/stripe` (Stripe signature verified from the raw request body)
- `POST /api/uploads/images` (vendor bearer token; JPEG, PNG, WebP up to 5 MB)

Protected routes require a valid Better Auth JWT in `Authorization: Bearer <token>`. Roles and blocked status are read from the database; request-supplied roles are never trusted. Vendor applications start as customer accounts and only an administrator approval changes the account role to vendor. The app intentionally has no public admin-promotion endpoint; provision the initial admin role through a trusted database administration process.

## Data model

The API shares the `users` collection with Better Auth and stores marketplace data in `vendorApplications`, `vendorProfiles`, `services`, `bookings`, `subscriptions`, and `stripeWebhookEvents`. Business records reference user, service, vendor, and customer IDs. Stripe event IDs are unique receipts; event handlers use repeatable state updates so retries do not create duplicate entitlements.

## Deployment

Deploy this repository as its own Vercel project, separate from the Next.js client. The root `index.js` exports the Express app for Vercel Functions; local development continues to start the listener from `src/index.js`. Set the environment variables listed above on the API project, configure `CLIENT_ORIGIN` and `CLIENT_APP_URL` with the production client URL, and ensure the Better Auth issuer/audience/JWKS settings match the client authentication setup. Set `API_SERVER_ORIGIN` on the client project to the API project’s production origin. Never expose MongoDB or signing credentials to the browser.

## Repository links

- Client: https://github.com/alsabbir128/wedplan-client
- Server: https://github.com/alsabbir128/wedplan-server
- Live website: not deployed yet
