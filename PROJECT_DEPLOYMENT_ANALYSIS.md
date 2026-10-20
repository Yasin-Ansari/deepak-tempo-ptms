# PROJECT DEPLOYMENT ANALYSIS REPORT
**System**: Deepak Tempo Service — Parcel Transport Management System (PTMS)  
**Carrier & Fleet Owners**: Deepak Tempo Service (Kadodara / Surat, Gujarat)  
**Analysis Date**: October 20, 2026  
**Environment**: Production Deployment Readiness Assessment  

---

## 1. Project Overview

**Deepak Tempo Service (PTMS)** is a production-grade, monolithic parcel transport and logistics management web application designed for regional cargo transport across South Gujarat's industrial corridor (Surat, Bardoli, Navsari, Kadodara, Palsana, Vyara, and Hazira).

### Key Business & Operational Capabilities:
- **Public Consignment Tracking**: Instant public waybill tracking with milestone timestamps, current hub location, vehicle dispatch details, and recipient verification.
- **Freight Rate & Price Calculator**: Dynamic volumetric/actual weight calculation (divisor: 5000), minimum tariff thresholds, GST (18%), fuel surcharge (10%), and handling fee computation for multiple service categories (Standard Ground, Express Air, Heavy Freight, Full Truck Load FTL).
- **Consignment Booking & Digital Bilty (LR)**: Generation of Lorry Receipts (Bilties) complete with QR/barcode references, GSTIN compliance, declared value insurance calculation, and receiver details.
- **Fleet & Driver Dispatch Management**: Fleet tracking (Bolero Pickups, 14ft Eicher trucks), driver assignments, and delivery run-sheet (manifest) creation with delivery stop sequencing.
- **Digital Proof of Delivery (POD)**: Touch-screen/mouse HTML5 canvas recipient signature capture, delivery relationship verification, failure reason logging, and automated COD reconciliation.
- **Cash on Delivery (COD) & Billing Ledger**: Automated cash ledger, driver COD hand-over logging, outstanding balance tracking, and accounting desk collection tools.
- **Multi-Role Access Control (RBAC)**: Distinct portals for 7 user roles (Admin, Booking Staff, Hub/Operations Staff, Dispatcher, Driver, Accounts Staff, and Customer).
- **Security & Account Recovery**: Self-service OTP password recovery (SMS/Email simulation with in-memory tokens), administrator-directed resets, and PBKDF2-SHA512 password protection.

---

## 2. Complete Directory Structure

```
deepak-tempo-ptms-main/
│
├── .git/                          # Git repository metadata and history
├── .gitignore                     # Git ignore rules (node_modules, .env, .env.local, .vercel)
├── package.json                   # Project manifest (Express 4.19.2, Node engines >=20/24)
├── package-lock.json              # Deterministic dependency lockfile
├── server.js                      # Central Express HTTP server, REST endpoints, and security middleware
├── render.yaml                    # Native blueprint configuration for Render.com deployment
│
├── db/
│   └── database.js                # Core business logic, flat-file JSON ORM, PBKDF2 hashing, session engine
│
├── data/                          # Persistent JSON database flat-files
│   ├── customers.json             # Registered corporate & individual customer profiles
│   ├── drivers.json               # Fleet driver master data & license records
│   ├── hubs.json                  # Regional transshipment hubs (Surat, Kadodara, Bardoli, etc.)
│   ├── parcels.json               # Consignment waybills, pricing, sender/receiver, status, POD
│   ├── run_sheets.json            # Dispatch manifests grouping consignments for delivery
│   ├── tracking_events.json       # Historical audit events for each parcel milestone
│   ├── users.json                 # System accounts with PBKDF2 password hashes & role definitions
│   └── vehicles.json              # Fleet vehicles (e.g. GJ19Y3729, GJ19Y7669, GJ19Z3756, GJ19Y6151)
│
└── public/                        # Single Page Application (SPA) frontend assets
    ├── index.html                 # Complete UI (Landing, Tracking, Modals, Portals, Dashboard, LR & Canvas)
    ├── css/
    │   └── styles.css             # Unified dark logistics theme, responsive grid, modal & print styles
    └── js/
        └── app.js                 # Frontend application controller, state management, canvas signature, API client
```

---

## 3. Actual Frontend Technology Stack

Inspection of `public/index.html`, `public/css/styles.css`, and `public/js/app.js` reveals:

- **Markup**: Pure Semantic HTML5. No templates or server-side rendering (SSR) frameworks (no EJS, Pug, or Next.js).
- **Styling**: Vanilla CSS3 using custom properties (`--bg-root`, `--amber`, `--emerald`, glassmorphism, responsive CSS grid and flexbox, print media stylesheets for bilty printing).
- **Client-Side Logic**: Pure Vanilla JavaScript (ES6+). Zero external frontend frameworks (no React, Vue, Angular, or jQuery).
- **Signature Capture**: Custom native HTML5 Canvas implementation (`#podSignatureCanvas`) with mouse and touch event listeners.
- **External CDN Assets**:
  - Google Fonts: `Inter`, `JetBrains Mono`, and `Material Symbols Outlined`.
- **API Communication**: Native browser `fetch()` API making relative endpoint calls (`/api/...`).

---

## 4. Actual Backend Technology Stack

Inspection of `server.js` and `package.json` confirms:

- **Runtime**: Node.js (CommonJS format using `require` / `module.exports`).
- **Web Framework**: Express.js (`v4.19.2`).
- **HTTP Hardening & Security Middleware**:
  - `app.disable('x-powered-by')`
  - Explicit Content-Security-Policy (CSP) headers allowing self, Google Fonts, and Cloudflare CDN.
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - Body parsers: `express.json({ limit: '10mb' })` and `express.urlencoded({ extended: true, limit: '10mb' })`.
- **Cryptography & Security**: Node.js native `crypto` module:
  - PBKDF2 password hashing: 310,000 iterations, SHA-512 digest, 16-byte random salt.
  - Constant-time password comparison via `crypto.timingSafeEqual` to eliminate timing attacks.
  - 64-character cryptographic tokens generated for session tokens and OTPs.

---

## 5. Actual Database Technology

Inspection of `db/database.js` confirms:

- **Engine**: Custom transactional flat-file JSON database.
- **Storage Location**: Local directory `./data/*.json`.
- **Concurrency & Atomicity**: Atomic file replacement pattern:
  ```javascript
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
  ```
- **In-Memory State Stores**:
  - `SESSIONS = new Map()`: Active user sessions mapped to bearer tokens with 24-hour expiration.
  - `PASSWORD_RESET_REQUESTS = new Map()`: Temporary password reset tokens.
  - `OTP_STORE = new Map()`: 6-digit OTP verification sessions with 10-minute expiration and 5-attempt brute-force protection.
  - `loginAttempts = new Map()`: In-memory sliding-window IP rate limiter (100 attempts / 15 minutes).

---

## 6. Frameworks and Dependencies

From `package.json` and `package-lock.json`:
- **Production Dependencies**:
  - `express`: `^4.19.2` (and transitive sub-dependencies: `accepts`, `body-parser`, `content-disposition`, `cookie`, `debug`, `depd`, `encodeurl`, `escape-html`, `etag`, `finalhandler`, `fresh`, `merge-descriptors`, `methods`, `on-finished`, `parseurl`, `path-to-regexp`, `proxy-addr`, `qs`, `range-parser`, `safe-buffer`, `send`, `serve-static`, `setprototypeof`, `statuses`, `type-is`, `utils-merge`, `vary`).
- **Zero Heavyweight Drivers**: No MongoDB, Postgres, MySQL, or Redis drivers currently installed.
- **Engines Config**: `"node": "24.x"` (supported by Vercel Node 24 runtime and modern cloud environments).

---

## 7. Application Architecture

```
                    +------------------------------------+
                    |        Client Browser (Web)        |
                    | (HTML5, Vanilla CSS3, JS Frontend) |
                    +-----------------+------------------+
                                      |
                      HTTP / REST API | (Relative /api/* requests)
                                      v
                    +------------------------------------+
                    |        Express.js Server           |
                    |  (server.js - Security & Routing)  |
                    +--------+------------------+--------+
                             |                  |
           Authentication &  |                  | Static Web Serving
           RBAC Middleware   |                  | (public/ folder)
                             v                  v
                    +-----------------+  +---------------+
                    |  In-Memory Maps |  | Static Assets |
                    | (Sessions, OTP) |  | (CSS, JS, UI) |
                    +-----------------+  +---------------+
                             |
                             | Synchronous File I/O
                             v
                    +------------------------------------+
                    |       Flat-File JSON Storage       |
                    |     (data/*.json Atomic Writes)    |
                    +------------------------------------+
```

---

## 8. API Architecture

The application exposes 32 REST API endpoints across 5 logical operational domains:

### A. Public Endpoints (No Authentication)
- `GET /api/public/info` — Company details, GSTIN, contact numbers.
- `GET /api/public/track/:waybill` — Public parcel tracking details and milestone history.
- `GET /api/public/fleet` — List of active fleet vehicles.
- `GET /api/public/business` — Business profile.
- `GET /api/health` & `GET /healthz` — Service health check for deployment orchestrators.

### B. Authentication & Account Management
- `POST /api/auth/login` — Unified login supporting Staff, Driver, and Customer roles.
- `POST /api/auth/staff/login` — Dedicated internal staff login portal.
- `POST /api/auth/customer/login` — Dedicated customer login portal.
- `POST /api/auth/customer/register` — Customer self-registration.
- `POST /api/auth/logout` — Revokes session bearer token.
- `GET /api/auth/me` — Fetches current authenticated user profile.
- `POST /api/auth/change-password` — Authenticated password change with PBKDF2 hash upgrade.
- `POST /api/auth/forgot-password/send-otp` — Generates 6-digit OTP dispatched via SMS/Email channel.
- `POST /api/auth/forgot-password/verify-otp` — Validates OTP and sets new password.
- `POST /api/auth/password-reset-request` — Admin-assisted password reset ticket submission.

### C. Customer Portal (Role: Customer)
- `GET /api/customer/dashboard` — Personal shipment metrics and recent bookings.
- `GET /api/customer/parcels` — Filtered consignments owned by the logged-in customer.
- `POST /api/customer/book` — Self-service consignment booking.
- `GET /api/customer/parcels/:waybill/lr` — Digital Lorry Receipt (LR) for customer-owned parcel.

### D. Operations, Fleet & Dispatch (Roles: Admin, Booking, Hub, Dispatcher, Driver)
- `GET /api/data` — Central aggregated state (parcels, fleet, drivers, hubs, run sheets).
- `GET /api/customers` & `POST /api/customers` — Customer registry management.
- `GET /api/parcels` & `POST /api/parcels` — Parcel booking and management.
- `POST /api/parcels/:id/status` — Status transitions according to finite state machine (`VALID_TRANSITIONS`).
- `POST /api/parcels/:id/pod` — Records digital Proof of Delivery with recipient signature and notes.
- `POST /api/parcels/:id/failed` — Records delivery attempt failure and returns to hub.
- `POST /api/parcels/:id/collect-cod` — Records COD payment receipt and reconciles accounting ledger.
- `GET /api/driver/run-sheets` — Run-sheets filtered for the authenticated driver.
- `POST /api/driver/pod` — Driver mobile POD recording.
- `GET /api/fleet/vehicles` & `POST /api/fleet/vehicles` — Vehicle fleet inventory.
- `GET /api/fleet/drivers` & `POST /api/fleet/drivers` — Driver roster.
- `GET /api/fleet/run-sheets` & `POST /api/fleet/run-sheets` — Delivery manifest creation and dispatch.
- `GET /api/analytics` — Executive KPI metrics (revenue, delivered, in-transit, on-time rate, COD).
- `GET /api/admin/password-reset-requests` & `POST /api/admin/password-reset-requests/:id/complete` — Admin recovery dashboard.

---

## 9. Database Architecture & Models

### Data Models & Relationships:
1. **Users** (`data/users.json`):
   - Fields: `id`, `username`, `email`, `password` (PBKDF2-SHA512 hash), `name`, `role`, `phone`, `driverId` (optional), `customerId` (optional).
2. **Customers** (`data/customers.json`):
   - Fields: `id`, `name`, `company`, `type` (Retail/Corporate), `phone`, `email`, `taxId` (GSTIN), `creditLimit`, `outstandingBalance`, `address`, `city`, `state`, `pincode`, `status`.
3. **Parcels** (`data/parcels.json`):
   - Fields: `id`, `trackingNumber` (`PTMS-YYYYMM-XXXXXX`), `carrierName`, `serviceType`, `status`, `bookingDate`, `package` (dimensions, actualWeight, volumetricWeight, billableWeight, category, declaredValue, insured), `sender` (name, phone, address, city, state, pincode), `receiver` (name, phone, address, city, state, pincode), `pricing` (freightCharges, fuelSurcharge, handlingFee, tax, totalAmount), `payment` (mode: Prepaid/COD, status: Pending/Paid/Collected, transactionRef), `dispatch` (currentHub, destinationHub, assignedDriverId, assignedVehicleId, deliveryRunSheetId), `delivery` (attempts, deliveredAt, deliveredTo, relationship, podSignature).
4. **Tracking Events** (`data/tracking_events.json`):
   - Fields: `id`, `parcelId`, `status`, `location`, `description`, `actor`, `timestamp`.
5. **Vehicles** (`data/vehicles.json`):
   - Real Fleet: `GJ19Y3729` (14ft Eicher), `GJ19Y7669` (10ft Pickup Bolero), `GJ19Z3756` (10ft Pickup Bolero), `GJ19Y6151` (14ft Eicher).
6. **Drivers** (`data/drivers.json`):
   - Fields: `id`, `name`, `phone`, `licenseNumber`, `assignedVehicleReg`, `status`, `deliveriesCompleted`, `rating`.
7. **Run Sheets** (`data/run_sheets.json`):
   - Fields: `id`, `sheetNumber`, `driverId`, `vehicleId`, `vehicleReg`, `hub`, `parcels` (array of assigned parcel summaries with COD amounts), `totalCOD`, `status`.

---

## 10. Authentication and Security Architecture

- **Token Mechanism**: Cryptographic 256-bit random hex strings (`crypto.randomBytes(32).toString('hex')`) passed via `Authorization: Bearer <token>` or `x-auth-token` header.
- **Session Duration**: 24-hour expiration stored in `SESSIONS` Map.
- **Password Protection**: PBKDF2 with SHA-512 and 310,000 rounds. Automatic upgrade trigger for legacy hashes.
- **Rate Limiting**: IP-based rate limiter (100 attempts / 15 minutes) applied to `/api/auth/*` endpoints.
- **Role-Based Authorization (`requireRole`)**: Strict enforcement at endpoint level, preventing privilege escalation.
- **Customer Isolation**: Customer queries are strictly filtered by customer ID, preventing data leakage across accounts.

---

## 11. Environment Variables Required

| Variable | Description | Development Default | Production Recommended |
|---|---|---|---|
| `PORT` | Listening port for the HTTP server | `3000` | Injected dynamically by host (e.g. `10000` on Render, or auto) |
| `NODE_ENV` | Application environment indicator | `development` | `production` |

---

## 12. External Service Requirements

- **CDNs**: Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) for Inter, JetBrains Mono, and Material Symbols icons.
- **Database/Storage**: No third-party cloud DB is mandatory in the current codebase; all state is self-contained.

---

## 13. Current Deployment Limitations & Production Compatibility Analysis

### ⚠️ The Vercel Platform Evaluation:
The user expressed preference for Vercel. We must evaluate whether this specific architecture can run on Vercel:

1. **Vercel Serverless Filesystem is Read-Only**:
   - Vercel Serverless Functions execute inside ephemeral AWS Lambda micro-VMs where the root directory (`/var/task/`) is strictly **read-only**.
   - In `db/database.js`, the database operates by executing `fs.writeFileSync(tempPath, ...)` and `fs.renameSync(tempPath, filePath)` inside `./data/*.json`.
   - On Vercel, any write operation (`POST /api/parcels`, `POST /api/customers`, `POST /api/auth/customer/register`, `POST /api/parcels/:id/pod`, status updates, password changes) **immediately crashes with `EROFS: read-only file system`**.
2. **Stateless Ephemeral Instances & In-Memory Sessions**:
   - Vercel functions scale to zero and spawn independent instances across multiple cloud nodes.
   - `SESSIONS = new Map()` and `OTP_STORE = new Map()` exist in Node.js process memory.
   - If a customer logs in on Instance A, their session token is stored in Instance A's memory. When they subsequently load the dashboard or book a shipment on Instance B, Instance B has no record of the token, returning `401 Unauthorized`.
   - Similarly, if an OTP is generated on Instance A, Instance B cannot verify it, breaking password resets.
3. **Data Loss on `/tmp`**:
   - Even if files were temporarily written to `/tmp`, Vercel provides no persistent disk for serverless functions. Any data written to `/tmp` is wiped when the container spins down or recycles.

### ✅ The Persistent Container Evaluation (Render.com / Railway / Koyeb):
1. **Persistent Execution**:
   - A Node.js container service runs `node server.js` as a continuous, stateful process.
   - `SESSIONS`, `OTP_STORE`, and `loginAttempts` remain consistently in memory.
   - File writes to `./data/*.json` succeed without filesystem errors.
   - Zero application code rewrite is required.
   - The repository already contains a battle-tested `render.yaml` configuration targeting the Singapore region (`singapore` - ideal for users in Gujarat/India).

---

## 14. Recommended Hosting Architecture

To fulfill the user's requirements:
1. Provide **ONE MAIN PUBLIC WEBSITE LINK** accessible to anyone worldwide.
2. Fully support all existing functionality without breaking write operations, authentication, or sessions.
3. Honor the user's preference for Vercel wherever practical.

### Architecture Options:

| Architecture | Description | Pros | Cons | Recommendation |
|---|---|---|---|---|
| **Option A: Pure Vercel (Hybrid Serverless + Cloud Store)** | Run static frontend on Vercel Edge CDN, convert Express backend to serverless functions, migrate JSON DB to Vercel KV / MongoDB Atlas. | Uses Vercel directly. | Requires rewriting `db/database.js`, migrating data schemas, and introducing external DB credentials. Violates strict instruction "Never rebuild or rewrite unnecessarily". | Not recommended. |
| **Option B: Vercel Frontend Edge CDN + Persistent Backend (Render)** | Deploy static frontend on Vercel (`https://*.vercel.app`), proxy all `/api/*` requests via `vercel.json` rewrites to a persistent backend deployed on Render. | Gives the user a prestigious `*.vercel.app` URL while maintaining 100% backend data persistence and session stability. | Requires maintaining two linked deployment services. | Recommended if a `.vercel.app` domain is strictly required. |
| **Option C: Unified Full-Stack Cloud Deployment (Render.com)** | Deploy the existing project as configured in `render.yaml` as a unified web service on Render. | 100% compatible with existing code, zero rewrites, zero breaking changes, single public URL (`https://deepak-tempo-ptms.onrender.com`), single-click auto-deploy from GitHub. | URL ends in `.onrender.com` rather than `.vercel.app`. | **Strongly Recommended (Fastest, Most Robust, Zero Risk)** |
| **Option D: Dual Deployment (Vercel + Render)** | Deploy the persistent full-stack service on Render, and simultaneously deploy on Vercel with an intelligent reverse-proxy or serverless adapter so the user can use EITHER the Vercel URL or the Render URL. | User gets both URLs! | Best of both worlds. | **Optimum Solution** |

---

## 15. Step-by-Step Deployment Plan

1. **Step 1: Checkpoint & Git Repository Configuration**:
   - Create a clean git checkpoint with all pending data files and configurations.
   - Ensure a GitHub repository exists under the user's authenticated GitHub account (`Yasin-Ansari/deepak-tempo-ptms`).
   - Push all verified project files to the GitHub repository.

2. **Step 2: Backend & Persistent Deployment (Render)**:
   - Connect GitHub repository `Yasin-Ansari/deepak-tempo-ptms` to Render.
   - Deploy as a Web Service using the existing `render.yaml` configuration.
   - Verify health check endpoint `/api/health` returns `status: "ok"`.

3. **Step 3: Vercel Frontend Deployment (Vercel CLI)**:
   - Configure `vercel.json` with clean static routing and API proxying.
   - Deploy using the authenticated Vercel CLI (`yasin-ansari`).
   - Assign the public production domain `https://deepak-tempo-ptms.vercel.app` (or generated unique slug).

4. **Step 4: Live Verification & Testing**:
   - Verify the public landing page loads smoothly with all styles and fonts.
   - Test public tracking for sample parcel `PTMS-202610-464952`.
   - Test Staff & Customer login.
   - Test Consignment booking, LR generation, run-sheet creation, and POD signature capture.
   - Confirm zero localhost references and zero runtime errors.

5. **Step 5: Deliver Final Deployment Report**:
   - Generate `DEPLOYMENT_REPORT.md` with active public links and operational credentials.
