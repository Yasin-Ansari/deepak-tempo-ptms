const express = require('express');
const path = require('path');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic production-safe HTTP hardening without requiring another dependency.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Authentication Middleware ---
function getUserFromReq(req) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length < 32) return null;
  return db.getSession(token);
}

function requireAuth(req, res, next) {
  const user = getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
  }
  req.user = user;
  next();
}

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const user = getUserFromReq(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    }
    req.user = user;

    const normalizedAllowed = allowedRoles.map(r => r.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const userRoleNorm = user.role.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (normalizedAllowed.includes(userRoleNorm) || userRoleNorm === 'admin') {
      return next();
    }
    return res.status(403).json({ error: `Forbidden: Role "${user.role}" cannot access this resource.` });
  };
}

// =============================================================================
// 1. PUBLIC API (NO AUTH REQUIRED)
// =============================================================================

app.get('/api/public/info', (req, res) => {
  res.json({
    business: db.BUSINESS,
    company: db.COMPANY_NAME,
    system: db.SYSTEM_NAME
  });
});

function handleTrackingLookup(req, res) {
  const trackingNumber = req.params.waybill || req.params.trackingNumber;
  const parcel = db.getParcelByTracking(trackingNumber);
  if (!parcel) {
    return res.status(404).json({ error: 'Consignment not found with tracking number ' + trackingNumber });
  }
  const events = db.getTrackingEvents(parcel.id);
  res.json({
    trackingNumber: parcel.trackingNumber,
    carrierName: parcel.carrierName || db.COMPANY_NAME,
    status: parcel.status,
    parcel: {
      trackingNumber: parcel.trackingNumber,
      bookingDate: parcel.bookingDate,
      serviceType: parcel.serviceType,
      status: parcel.status,
      origin: `${parcel.sender.city}, ${parcel.sender.state}`,
      destination: `${parcel.receiver.city}, ${parcel.receiver.state}`,
      package: {
        category: parcel.package.category,
        billableWeight: parcel.package.billableWeight
      }
    },
    events,
    business: db.BUSINESS,
    company: db.COMPANY_NAME,
    system: db.SYSTEM_NAME
  });
}

app.get('/api/public/track/:waybill', handleTrackingLookup);
app.get('/api/public/tracking/:trackingNumber', handleTrackingLookup);
app.get('/api/tracking/:trackingNumber', handleTrackingLookup);
app.get('/api/public/fleet', (req, res) => res.json(db.getVehicles()));
app.get('/api/public/business', (req, res) => res.json(db.BUSINESS));

// Render / Production deployment healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Deepak Tempo Service (PTMS)',
    system: db.SYSTEM_NAME,
    carrier: db.COMPANY_NAME,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});
app.get('/healthz', (req, res) => res.status(200).send('OK'));

// =============================================================================
// 2. AUTHENTICATION API
// =============================================================================
// Lightweight login throttling for a single-node deployment.
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 100;
function loginThrottle(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return next();
  }
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + LOGIN_WINDOW_MS; }
  entry.count += 1;
  loginAttempts.set(ip, entry);
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }
  next();
}


// Customer Self-Registration
function handleCustomerRegistration(req, res) {
  try {
    const result = db.registerCustomer(req.body);
    res.status(201).json({
      success: true,
      user: result.user,
      customer: result.customer,
      token: result.token,
      portal: 'customer',
      business: db.BUSINESS,
      company: db.COMPANY_NAME,
      system: db.SYSTEM_NAME
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
}

app.post('/api/auth/customer/register', handleCustomerRegistration);
app.post('/api/auth/register-customer', handleCustomerRegistration);

// Customer Login
app.post('/api/auth/customer/login', loginThrottle, (req, res) => {
  const { username, password, email, phone, identifier } = req.body || {};
  const loginId = identifier || username || email || phone;
  const result = db.authenticate(loginId, password);
  if (!result) {
    return res.status(401).json({ error: 'Invalid customer credentials. Please check your email/mobile and password.' });
  }
  if (result.role !== 'Customer') {
    return res.status(403).json({ error: 'This login portal is reserved for Customers only. Staff members should use the Staff Portal.' });
  }
  res.json({
    success: true,
    user: result.user,
    token: result.token,
    portal: 'customer',
    business: db.BUSINESS,
    company: db.COMPANY_NAME,
    system: db.SYSTEM_NAME
  });
});

// Staff / Internal Login
app.post('/api/auth/staff/login', loginThrottle, (req, res) => {
  const { username, password, email, phone, identifier } = req.body || {};
  const loginId = identifier || username || email || phone;
  const result = db.authenticate(loginId, password);
  if (!result) {
    return res.status(401).json({ error: 'Invalid staff credentials. Please check your username and password.' });
  }
  if (result.role === 'Customer') {
    return res.status(403).json({ error: 'Customer accounts cannot access the internal Staff Portal. Please log in via the Customer Portal.' });
  }
  let portal = 'staff';
  if (result.role === 'Admin') portal = 'admin';
  else if (result.role === 'Driver') portal = 'driver';

  res.json({
    success: true,
    user: result.user,
    token: result.token,
    portal,
    business: db.BUSINESS,
    company: db.COMPANY_NAME,
    system: db.SYSTEM_NAME
  });
});

// Unified Login Endpoint (Backward Compatible)
app.post('/api/auth/login', loginThrottle, (req, res) => {
  const { username, password, email, phone, identifier } = req.body || {};
  const loginId = identifier || username || email || phone;
  const result = db.authenticate(loginId, password);
  if (!result) {
    return res.status(401).json({ error: 'Invalid credentials. Please check your username/email and password.' });
  }
  const { user, token } = result;
  let portal = 'staff';
  if (user.role === 'Admin') portal = 'admin';
  else if (user.role === 'Customer') portal = 'customer';
  else if (user.role === 'Driver') portal = 'driver';

  res.json({
    success: true,
    user,
    token,
    portal,
    business: db.BUSINESS,
    company: db.COMPANY_NAME,
    system: db.SYSTEM_NAME
  });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '').trim();
    db.deleteSession(token);
  }
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Change password for the currently authenticated account.
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const result = db.changePassword(req.user.id, currentPassword, newPassword);
    res.json({ success: true, user: result.user, token: result.token });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Administrator-only password reset for a staff/customer account.
app.post('/api/auth/admin-reset-password', requireRole(['Admin']), (req, res) => {
  try {
    const { userId, newPassword } = req.body || {};
    const result = db.adminResetPassword(req.user.id, userId, newPassword);
    res.json({ success: true, message: `Password reset for ${result.username}.` });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Administrators can review pending reset requests and complete a verified reset.
app.get('/api/admin/password-reset-requests', requireRole(['Admin']), (req, res) => {
  const requests = db.getPasswordResetRequests().map(request => {
    const user = request.userId ? db.getUsers().find(u => u.id === request.userId) : null;
    return {
      id: request.id,
      identifier: request.identifier,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      account: user ? { id: user.id, username: user.username, name: user.name, role: user.role } : null
    };
  });
  res.json({ requests });
});

app.post('/api/admin/password-reset-requests/:requestId/complete', requireRole(['Admin']), (req, res) => {
  try {
    const result = db.consumePasswordResetRequest(req.params.requestId, req.body?.newPassword, req.user.id);
    res.json({ success: true, message: `Password reset for ${result.username}.` });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Password-reset request. No account existence is disclosed and no password is changed here.
app.post('/api/auth/password-reset-request', loginThrottle, (req, res) => {
  try {
    const { identifier } = req.body || {};
    db.createPasswordResetRequest(identifier);
    res.json({
      success: true,
      message: 'If the account exists, a password-reset request has been recorded. An authorized administrator can verify the request and issue a secure reset.'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Self-Service OTP Forgot Password - Send OTP via SMS / Email
function handleSendForgotOTP(req, res) {
  try {
    const { identifier, channel } = req.body || {};
    const result = db.generatePasswordResetOTP(identifier, channel);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
}
app.post('/api/auth/forgot-password/send-otp', loginThrottle, handleSendForgotOTP);
app.post('/api/auth/forgot-password', loginThrottle, handleSendForgotOTP);
app.post('/api/auth/send-otp', loginThrottle, handleSendForgotOTP);

// Self-Service OTP Password Reset - Verify OTP & Set New Password
function handleVerifyResetOTP(req, res) {
  try {
    const { otpToken, otp, newPassword } = req.body || {};
    const result = db.verifyPasswordResetOTP(otpToken, otp, newPassword);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
}
app.post('/api/auth/forgot-password/verify-otp', loginThrottle, handleVerifyResetOTP);
app.post('/api/auth/reset-password', loginThrottle, handleVerifyResetOTP);
app.post('/api/auth/reset-password-otp', loginThrottle, handleVerifyResetOTP);

app.get('/api/auth/me', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  res.json({ user, business: db.BUSINESS, company: db.COMPANY_NAME, system: db.SYSTEM_NAME });
});

// =============================================================================
// 3. CUSTOMER-SCOPED API (ROLE: CUSTOMER)
// =============================================================================

app.get('/api/customer/dashboard', requireRole(['Customer']), (req, res) => {
  const parcels = db.getParcels({}, req.user);
  const totalBookings = parcels.length;
  const inTransit = parcels.filter(p => ['Booked', 'Received at Origin Hub', 'In Transit', 'Arrived at Destination Hub', 'Out for Delivery'].includes(p.status)).length;
  const delivered = parcels.filter(p => p.status === 'Delivered').length;
  const pendingPickups = parcels.filter(p => p.status === 'Booked').length;
  const totalSpent = parcels.reduce((sum, p) => sum + (p.pricing?.totalAmount || 0), 0);

  res.json({
    metrics: {
      totalBookings,
      inTransit,
      delivered,
      pendingPickups,
      totalSpent
    },
    recentParcels: parcels.slice(0, 5),
    customer: req.user,
    business: db.BUSINESS
  });
});

app.get('/api/customer/parcels', requireRole(['Customer']), (req, res) => {
  res.json(db.getParcels(req.query, req.user));
});

app.post('/api/customer/book', requireRole(['Customer']), (req, res) => {
  try {
    const payload = { ...req.body };
    payload.createdByUserId = req.user.id;
    payload.customerId = req.user.customerId || req.user.id;
    payload.senderCustomerId = req.user.customerId || req.user.id;
    payload.senderName = payload.senderName || req.user.name;
    payload.senderPhone = payload.senderPhone || req.user.phone;
    payload.senderAddress = payload.senderAddress || req.user.address || 'Surat';
    payload.senderCity = payload.senderCity || req.user.city || 'Surat';
    payload.senderState = payload.senderState || req.user.state || 'Gujarat';
    payload.senderPincode = payload.senderPincode || req.user.pincode || '394305';

    const newParcel = db.createParcel(payload);
    res.status(201).json(newParcel);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.get('/api/customer/parcels/:waybill/lr', requireRole(['Customer']), (req, res) => {
  const parcel = db.getParcelByTracking(req.params.waybill);
  if (!parcel) {
    return res.status(404).json({ error: 'Consignment not found.' });
  }
  const custId = req.user.customerId || req.user.id;
  const isOwner = (parcel.customerId === custId) ||
                  (parcel.createdByUserId === req.user.id) ||
                  (parcel.sender && parcel.sender.phone && parcel.sender.phone.replace(/\s+/g, '') === req.user.phone.replace(/\s+/g, ''));

  if (!isOwner) {
    return res.status(403).json({ error: 'Forbidden: You can only view Lorry Receipts for your own consignments.' });
  }

  res.json({
    parcel,
    events: db.getTrackingEvents(parcel.id),
    business: db.BUSINESS,
    carrierName: db.COMPANY_NAME
  });
});

// =============================================================================
// 4. INTERNAL / STAFF / ADMIN API (RBAC ENFORCED)
// =============================================================================

// Combined State API (Internal / Customer)
app.get('/api/data', (req, res) => {
  const user = getUserFromReq(req);
  const parcels = db.getParcels({}, user);
  const isCustomer = user && user.role === 'Customer';

  // Enrich each parcel with milestones from tracking events & add createdAt alias
  const enrichedParcels = parcels.map(p => {
    const events = db.getTrackingEvents(p.id);
    return {
      ...p,
      createdAt: p.bookingDate || p.createdAt,
      milestones: events.map(e => ({
        status: e.status,
        location: e.location,
        timestamp: e.timestamp,
        notes: e.description,
        operator: e.actor
      }))
    };
  });

  res.json({
    business: db.BUSINESS,
    companyName: db.COMPANY_NAME,
    systemName: db.SYSTEM_NAME,
    parcels: enrichedParcels,
    customers: isCustomer ? [] : db.getCustomers(),
    vehicles: isCustomer ? [] : db.getVehicles(),
    drivers: isCustomer ? [] : db.getDrivers(),
    runSheets: isCustomer ? [] : db.getRunSheets(),
    hubs: isCustomer ? [] : db.getHubs()
  });
});

// Customers Management API (Staff Only)
app.get('/api/customers', requireRole(['Admin', 'Booking Staff', 'Accounts Staff', 'Dispatcher']), (req, res) => {
  res.json(db.getCustomers(req.query.q));
});

app.post('/api/customers', requireRole(['Admin', 'Booking Staff']), (req, res) => {
  try {
    const newCust = db.createCustomer(req.body);
    res.status(201).json(newCust);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Parcels Management API
app.get('/api/parcels', requireAuth, (req, res) => {
  res.json(db.getParcels(req.query, req.user));
});

app.post('/api/parcels', requireRole(['Admin', 'Booking Staff', 'Customer']), (req, res) => {
  try {
    const payload = { ...req.body };
    if (req.user && req.user.role === 'Customer') {
      payload.createdByUserId = req.user.id;
      payload.customerId = req.user.customerId || req.user.id;
      payload.senderCustomerId = req.user.customerId || req.user.id;
      payload.senderName = payload.senderName || req.user.name;
      payload.senderPhone = payload.senderPhone || req.user.phone;
      payload.senderAddress = payload.senderAddress || req.user.address || 'Surat';
      payload.senderCity = payload.senderCity || req.user.city || 'Surat';
      payload.senderState = payload.senderState || req.user.state || 'Gujarat';
      payload.senderPincode = payload.senderPincode || req.user.pincode || '394305';
    }
    const newParcel = db.createParcel(payload);
    res.status(201).json(newParcel);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/parcels/:id/status', requireRole(['Admin', 'Hub/Operations Staff', 'Dispatcher']), (req, res) => {
  try {
    const { status, location, notes } = req.body;
    const actor = req.user ? req.user.name : 'Operations Staff';
    // Resolve tracking number to internal ID if needed
    let parcelId = req.params.id;
    const byTracking = db.getParcelByTracking(parcelId);
    if (byTracking) parcelId = byTracking.id;
    const updated = db.updateParcelStatus(parcelId, status, location, notes, actor);
    if (!updated) return res.status(404).json({ error: 'Parcel not found' });
    res.json(updated);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/parcels/:id/pod', requireRole(['Admin', 'Driver', 'Dispatcher']), (req, res) => {
  try {
    // Resolve tracking number to internal ID if needed
    let parcelId = req.params.id;
    const byTracking = db.getParcelByTracking(parcelId);
    if (byTracking) parcelId = byTracking.id;
    const updated = db.recordPOD(parcelId, req.body);
    if (!updated) return res.status(404).json({ error: 'Parcel not found' });
    res.json(updated);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/parcels/:id/failed', requireRole(['Admin', 'Driver', 'Dispatcher']), (req, res) => {
  try {
    const { reason, notes } = req.body;
    const driverName = req.user ? req.user.name : 'Driver';
    let parcelId = req.params.id;
    const byTracking = db.getParcelByTracking(parcelId);
    if (byTracking) parcelId = byTracking.id;
    const updated = db.recordFailedDelivery(parcelId, reason, notes, driverName);
    if (!updated) return res.status(404).json({ error: 'Parcel not found' });
    res.json(updated);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.post('/api/parcels/:id/collect-cod', requireRole(['Admin', 'Accounts Staff', 'Dispatcher']), (req, res) => {
  try {
    const actor = req.user ? `${req.user.name} (${req.user.role})` : 'Accounts Desk';
    let parcelId = req.params.id;
    const byTracking = db.getParcelByTracking(parcelId);
    if (byTracking) parcelId = byTracking.id;
    const updated = db.collectPayment(parcelId, actor);
    if (!updated) return res.status(404).json({ error: 'Parcel not found' });
    res.json(updated);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Driver Dedicated Endpoints
app.get('/api/driver/run-sheets', requireRole(['Driver', 'Dispatcher', 'Admin']), (req, res) => {
  let runSheets = db.getRunSheets();
  if (req.user.role === 'Driver') {
    const driverId = req.user.driverId || req.user.id;
    runSheets = runSheets.filter(r => r.driverId === driverId);
  }
  res.json(runSheets);
});

app.post('/api/driver/pod', requireRole(['Driver', 'Dispatcher', 'Admin']), (req, res) => {
  try {
    const { parcelId, waybill, ...podData } = req.body;
    let targetParcelId = parcelId;
    if (!targetParcelId && waybill) {
      const p = db.getParcelByTracking(waybill);
      if (p) targetParcelId = p.id;
    }
    if (!targetParcelId) return res.status(400).json({ error: 'Parcel ID or Waybill is required.' });
    const updated = db.recordPOD(targetParcelId, podData);
    if (!updated) return res.status(404).json({ error: 'Parcel not found.' });
    res.json(updated);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Fleet Management API
app.get('/api/fleet/vehicles', (req, res) => {
  res.json(db.getVehicles());
});

app.post('/api/fleet/vehicles', requireRole(['Admin', 'Dispatcher']), (req, res) => {
  try {
    const newVehicle = db.createVehicle(req.body);
    res.status(201).json(newVehicle);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.get('/api/fleet/drivers', requireRole(['Admin', 'Dispatcher', 'Hub/Operations Staff']), (req, res) => {
  res.json(db.getDrivers());
});

app.post('/api/fleet/drivers', requireRole(['Admin', 'Dispatcher']), (req, res) => {
  try {
    res.status(201).json(db.createDriver(req.body));
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.get('/api/fleet/run-sheets', requireRole(['Admin', 'Dispatcher', 'Driver']), (req, res) => {
  res.json(db.getRunSheets());
});

app.post('/api/fleet/run-sheets', requireRole(['Admin', 'Dispatcher']), (req, res) => {
  try {
    res.status(201).json(db.createRunSheet(req.body));
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Analytics API
app.get('/api/analytics', requireRole(['Admin', 'Accounts Staff', 'Dispatcher', 'Booking Staff', 'Hub/Operations Staff']), (req, res) => {
  res.json(db.getAnalytics());
});

app.listen(PORT, () => {
  console.log(`✅ Deepak Tempo Service (PTMS) Server live at http://localhost:${PORT}`);
  console.log(`   Carrier: ${db.COMPANY_NAME}`);
  console.log(`   System:  ${db.SYSTEM_NAME}`);
  console.log(`   Owner:   ${db.BUSINESS.owner} (${db.BUSINESS.mobile1} | ${db.BUSINESS.mobile2})`);
  console.log(`   GSTIN:   ${db.BUSINESS.gstin}`);
});