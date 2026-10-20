const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve database directory. In serverless or containerized environments where
// the root directory is read-only (e.g. AWS Lambda / Vercel), fall back to /tmp/ptms-data
// while automatically preserving seed tables.
const SEED_DIR = path.join(__dirname, '..', 'data');
let DATA_DIR = SEED_DIR;

function isDirWritable(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const testFile = path.join(dir, `.write-test-${Date.now()}`);
    fs.writeFileSync(testFile, 'ok', 'utf8');
    fs.unlinkSync(testFile);
    return true;
  } catch (e) {
    return false;
  }
}

if (!isDirWritable(DATA_DIR)) {
  const tmpBase = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const fallbackDir = path.join(tmpBase, 'ptms-data');
  try {
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    // Copy seed JSON data files to writable directory
    if (fs.existsSync(SEED_DIR)) {
      const files = fs.readdirSync(SEED_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const src = path.join(SEED_DIR, file);
          const dest = path.join(fallbackDir, file);
          if (!fs.existsSync(dest)) {
            fs.copyFileSync(src, dest);
          }
        }
      }
    }
    DATA_DIR = fallbackDir;
    console.log(`[Storage] Read-only filesystem detected. Initialized writable database at: ${DATA_DIR}`);
  } catch (err) {
    console.error('[Storage] Error setting up fallback writable directory:', err);
  }
}

function getFilePath(table) {
  return path.join(DATA_DIR, `${table}.json`);
}

function readTable(table) {
  const filePath = getFilePath(table);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error(`Error reading ${table}:`, err);
    return [];
  }
}

function writeTable(table, data) {
  const filePath = getFilePath(table);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function generateId(prefix = 'ID') {
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${Date.now().toString().slice(-6)}-${random}`;
}

const VALID_TRANSITIONS = {
  'Booked': ['Received at Origin Hub', 'In Transit', 'Cancelled'],
  'Received at Origin Hub': ['In Transit', 'Out for Delivery', 'Cancelled'],
  'In Transit': ['Arrived at Destination Hub', 'Out for Delivery'],
  'Arrived at Destination Hub': ['Out for Delivery'],
  'Out for Delivery': ['Delivered', 'Delivery Attempt Failed'],
  'Delivery Attempt Failed': ['Out for Delivery', 'Returned'],
  'Delivered': [],
  'Returned': [],
  'Cancelled': []
};


// --- Password Security & Session Store ---
const SESSIONS = new Map();
const PASSWORD_RESET_REQUESTS = new Map();
const OTP_STORE = new Map();
const PASSWORD_ITERATIONS = 310000;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_DIGEST = 'sha512';

function hashPassword(password, salt) {
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString('hex');
  return `pbkdf2-sha512:${PASSWORD_ITERATIONS}:${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (typeof password !== 'string' || !storedPassword) return { valid: false, needsUpgrade: false };
  const parts = storedPassword.split(':');
  if (parts.length === 4 && parts[0] === 'pbkdf2-sha512') {
    const iterations = Number(parts[1]);
    const salt = parts[2];
    const originalHash = parts[3];
    if (!Number.isInteger(iterations) || iterations < 1000 || !salt || !originalHash) return { valid: false, needsUpgrade: false };
    const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(originalHash, 'hex');
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { valid, needsUpgrade: valid && iterations < PASSWORD_ITERATIONS };
  }
  // Legacy plaintext or old salt:hash records are accepted once, then upgraded.
  if (parts.length === 2) {
    const [salt, originalHash] = parts;
    const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 1000, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(originalHash, 'hex');
    return { valid: a.length === b.length && crypto.timingSafeEqual(a, b), needsUpgrade: true };
  }
  return { valid: false, needsUpgrade: false };
}

const db = {
  // Real Business Information
  BUSINESS: {
    name: 'Deepak Tempo Service',
    systemName: 'Parcel Transport Management System (PTMS)',
    owner: 'Deepak Singh',
    mobile1: '98246 21221',
    mobile2: '70961 47585',
    gstin: '24COZPS7273E2Z5',
    tagline: 'FLEET OWNERS & TRANSPORT CONTRACTORS',
    address: 'Abhinandan Nagar, Near Telephone Exchange, Chalthan, Kadodara, Tal. Palsana, Dist. Surat - 394305',
    pincode: '394305'
  },

  get COMPANY_NAME() {
    return this.BUSINESS.name;
  },

  get SYSTEM_NAME() {
    return this.BUSINESS.systemName;
  },

  // --- Sessions & Auth ---
  createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      token,
      user,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h
    };
    SESSIONS.set(token, session);
    return session;
  },

  getSession(token) {
    if (!token) return null;
    const session = SESSIONS.get(token);
    if (!session) return null;
    if (new Date(session.expiresAt) < new Date()) {
      SESSIONS.delete(token);
      return null;
    }
    return session.user;
  },

  deleteSession(token) {
    if (token) SESSIONS.delete(token);
  },

  // --- Users & Authentication ---
  getUsers() {
    let users = readTable('users');
    if (users.length === 0) {
      users = [
        { id: 'USR-001', username: 'admin', email: 'admin@deepaktempo.in', password: hashPassword('admin123'), name: 'Deepak Singh (Owner)', role: 'Admin', phone: '98246 21221' },
        { id: 'USR-002', username: 'booking', email: 'booking@deepaktempo.in', password: hashPassword('book123'), name: 'Booking Staff', role: 'Booking Staff', phone: '70961 47585' },
        { id: 'USR-003', username: 'hub', email: 'hub@deepaktempo.in', password: hashPassword('hub123'), name: 'Hub Staff', role: 'Hub/Operations Staff', phone: '98246 21221' },
        { id: 'USR-004', username: 'dispatcher', email: 'dispatch@deepaktempo.in', password: hashPassword('dispatch123'), name: 'Dispatcher', role: 'Dispatcher', phone: '70961 47585' },
        { id: 'USR-005', username: 'driver', email: 'driver@deepaktempo.in', password: hashPassword('driver123'), name: 'Driver', role: 'Driver', driverId: 'DRV-001', phone: '98246 21221' },
        { id: 'USR-006', username: 'accounts', email: 'accounts@deepaktempo.in', password: hashPassword('acc123'), name: 'Accounts Staff', role: 'Accounts Staff', phone: '70961 47585' },
        { id: 'USR-007', username: 'customer', email: 'customer@deepaktempo.in', password: hashPassword('cust123'), name: 'Customer', role: 'Customer', customerId: 'CUST-001', phone: '98246 21221' }
      ];
      writeTable('users', users);
    }
    return users;
  },

  authenticate(identifier, password) {
    if (!identifier || typeof password !== 'string' || !password) return null;
    const users = this.getUsers();
    const cleanId = String(identifier).trim().toLowerCase();
    const cleanPhone = cleanId.replace(/\s+/g, '');

    let user = users.find(u =>
      (u.username && u.username.toLowerCase() === cleanId) ||
      (u.email && u.email.toLowerCase() === cleanId) ||
      (u.phone && u.phone.replace(/\s+/g, '') === cleanPhone)
    );

    if (!user) return null;
    const passwordCheck = verifyPassword(password, user.password);
    if (!passwordCheck.valid) return null;

    if (passwordCheck.needsUpgrade) {
      const usersForUpdate = users.map(u => u.id === user.id ? { ...u, password: hashPassword(password) } : u);
      writeTable('users', usersForUpdate);
      user = usersForUpdate.find(u => u.id === user.id);
    }

    const { password: _password, ...safeUser } = user;
    const session = this.createSession(safeUser);
    return { ...safeUser, user: safeUser, token: session.token };
  },

  changePassword(userId, currentPassword, newPassword) {
    if (!userId || typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      throw new Error('Current password and new password are required.');
    }
    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long.');
    }
    if (currentPassword === newPassword) {
      throw new Error('New password must be different from the current password.');
    }

    const users = this.getUsers();
    const user = users.find(u => u.id === userId);
    if (!user) {
      const err = new Error('Account not found.');
      err.statusCode = 404;
      throw err;
    }

    const passwordCheck = verifyPassword(currentPassword, user.password);
    if (!passwordCheck.valid) {
      const err = new Error('Current password is incorrect.');
      err.statusCode = 401;
      throw err;
    }

    const updatedUser = { ...user, password: hashPassword(newPassword), passwordChangedAt: new Date().toISOString() };
    writeTable('users', users.map(u => u.id === userId ? updatedUser : u));

    // Revoke all existing sessions for this account so an old token cannot be reused.
    for (const [token, session] of SESSIONS.entries()) {
      if (session.user && session.user.id === userId) SESSIONS.delete(token);
    }

    const { password: _password, ...safeUser } = updatedUser;
    const session = this.createSession(safeUser);
    return { user: safeUser, token: session.token };
  },

  adminResetPassword(adminUserId, targetUserId, newPassword) {
    if (!adminUserId || !targetUserId || typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new Error('A valid target account and password of at least 8 characters are required.');
    }
    const users = this.getUsers();
    const admin = users.find(u => u.id === adminUserId);
    if (!admin || admin.role !== 'Admin') {
      const err = new Error('Administrator authorization required.');
      err.statusCode = 403;
      throw err;
    }
    const target = users.find(u => u.id === targetUserId);
    if (!target) {
      const err = new Error('Target account not found.');
      err.statusCode = 404;
      throw err;
    }

    const updatedUser = { ...target, password: hashPassword(newPassword), passwordChangedAt: new Date().toISOString() };
    writeTable('users', users.map(u => u.id === targetUserId ? updatedUser : u));
    for (const [token, session] of SESSIONS.entries()) {
      if (session.user && session.user.id === targetUserId) SESSIONS.delete(token);
    }
    return { id: target.id, username: target.username, role: target.role };
  },

  createPasswordResetRequest(identifier) {
    const normalized = String(identifier || '').trim().toLowerCase();
    if (!normalized) throw new Error('Email address or mobile number is required.');

    const requestId = crypto.randomBytes(12).toString('hex');
    const users = this.getUsers();
    const normalizedPhone = normalized.replace(/\s+/g, '');
    const matched = users.find(u =>
      (u.email && u.email.toLowerCase() === normalized) ||
      (u.username && u.username.toLowerCase() === normalized) ||
      (u.phone && u.phone.replace(/\s+/g, '') === normalizedPhone)
    );

    const request = {
      id: requestId,
      userId: matched ? matched.id : null,
      identifier,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      status: 'Pending'
    };
    PASSWORD_RESET_REQUESTS.set(requestId, request);
    const requests = readTable('password_reset_requests');
    requests.push(request);
    writeTable('password_reset_requests', requests.slice(-500));

    // Deliberately return the same response whether or not an account exists.
    return { requestId };
  },

  getPasswordResetRequests() {
    return readTable('password_reset_requests')
      .filter(r => r.status === 'Pending' && new Date(r.expiresAt) > new Date())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  consumePasswordResetRequest(requestId, newPassword, adminUserId) {
    if (!requestId || typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new Error('A valid reset request and password of at least 8 characters are required.');
    }
    const users = this.getUsers();
    const admin = users.find(u => u.id === adminUserId);
    if (!admin || admin.role !== 'Admin') {
      const err = new Error('Administrator authorization required.');
      err.statusCode = 403;
      throw err;
    }
    const requests = readTable('password_reset_requests');
    const request = requests.find(r => r.id === requestId && r.status === 'Pending');
    if (!request || new Date(request.expiresAt) <= new Date() || !request.userId) {
      const err = new Error('Reset request is invalid, expired, or could not be verified.');
      err.statusCode = 400;
      throw err;
    }
    const target = users.find(u => u.id === request.userId);
    if (!target) {
      const err = new Error('Target account not found.');
      err.statusCode = 404;
      throw err;
    }

    const updatedUser = { ...target, password: hashPassword(newPassword), passwordChangedAt: new Date().toISOString() };
    writeTable('users', users.map(u => u.id === target.id ? updatedUser : u));
    for (const [token, session] of SESSIONS.entries()) {
      if (session.user && session.user.id === target.id) SESSIONS.delete(token);
    }

    const updatedRequests = requests.map(r => r.id === requestId ? { ...r, status: 'Completed', completedAt: new Date().toISOString(), completedBy: admin.id } : r);
    writeTable('password_reset_requests', updatedRequests);
    PASSWORD_RESET_REQUESTS.delete(requestId);
    return { id: target.id, username: target.username, role: target.role };
  },

  // --- Real-time Self-Service OTP Password Reset (SMS / Email) ---
  generatePasswordResetOTP(identifier, channel = 'SMS') {
    const normalized = String(identifier || '').trim().toLowerCase();
    if (!normalized) {
      const err = new Error('Please provide your registered mobile number or email address.');
      err.statusCode = 400;
      throw err;
    }

    const users = this.getUsers();
    const normalizedDigits = normalized.replace(/[^0-9]/g, '');
    const user = users.find(u => {
      const uDigits = (u.phone || '').replace(/[^0-9]/g, '');
      const uEmail = (u.email || '').toLowerCase();
      const uUser = (u.username || '').toLowerCase();
      return (uEmail && uEmail === normalized) ||
             (uUser && uUser === normalized) ||
             (normalizedDigits.length >= 7 && (uDigits.endsWith(normalizedDigits.slice(-10)) || uDigits === normalizedDigits));
    });

    if (!user) {
      const err = new Error('No registered account found with this mobile number or email address.');
      err.statusCode = 404;
      throw err;
    }

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpToken = crypto.randomBytes(24).toString('hex');

    // Format destination and channel
    let destination = user.phone;
    let ch = channel || 'SMS';
    if (ch.toUpperCase() === 'EMAIL' && user.email) {
      const [usr, dom] = user.email.split('@');
      destination = `${usr.slice(0, 2)}***@${dom}`;
      ch = 'Email';
    } else {
      const p = (user.phone || '').replace(/\s+/g, '');
      destination = `+91 ${p.slice(0, 5)}****${p.slice(-1)}`;
      ch = 'SMS';
    }

    OTP_STORE.set(otpToken, {
      userId: user.id,
      username: user.username,
      otp,
      channel: ch,
      destination,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      attempts: 0
    });

    console.log(`[PTMS ${ch} GATEWAY DISPATCH] To: ${user.phone || user.email} | OTP: ${otp} | Account: ${user.name} (${user.role})`);

    return {
      success: true,
      message: `Security verification OTP sent successfully via ${ch} to ${destination}`,
      destination,
      channel: ch,
      otpToken,
      demoOtp: otp, // For rapid testing & demo convenience
      expiresIn: 600
    };
  },

  verifyPasswordResetOTP(otpToken, otp, newPassword) {
    if (!otpToken || typeof otpToken !== 'string') {
      const err = new Error('Invalid or missing verification session. Please request a new OTP.');
      err.statusCode = 400;
      throw err;
    }

    const record = OTP_STORE.get(otpToken);
    if (!record) {
      const err = new Error('Verification session has expired or is invalid. Please request a new OTP.');
      err.statusCode = 400;
      throw err;
    }

    if (Date.now() > record.expiresAt) {
      OTP_STORE.delete(otpToken);
      const err = new Error('OTP has expired. Please request a new verification code.');
      err.statusCode = 400;
      throw err;
    }

    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts > 5) {
      OTP_STORE.delete(otpToken);
      const err = new Error('Too many invalid attempts. Please request a new OTP.');
      err.statusCode = 429;
      throw err;
    }

    if (!otp || String(otp).trim() !== record.otp) {
      const remaining = 5 - record.attempts;
      const err = new Error(`Invalid 6-digit OTP code. ${remaining} attempt(s) remaining.`);
      err.statusCode = 400;
      throw err;
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      const err = new Error('New password must be at least 6 characters long.');
      err.statusCode = 400;
      throw err;
    }

    const users = this.getUsers();
    const user = users.find(u => u.id === record.userId);
    if (!user) {
      const err = new Error('Associated account not found.');
      err.statusCode = 404;
      throw err;
    }

    const updatedUser = {
      ...user,
      password: hashPassword(newPassword),
      passwordChangedAt: new Date().toISOString()
    };

    writeTable('users', users.map(u => u.id === user.id ? updatedUser : u));

    // Revoke previous sessions
    for (const [token, session] of SESSIONS.entries()) {
      if (session.user && session.user.id === user.id) SESSIONS.delete(token);
    }

    // Clean up used OTP
    OTP_STORE.delete(otpToken);

    // Create fresh session
    const { password: _p, ...safeUser } = updatedUser;
    const session = this.createSession(safeUser);

    return {
      success: true,
      message: 'Password reset successfully! Session authenticated.',
      user: safeUser,
      token: session.token,
      portal: safeUser.role === 'Customer' ? 'customer' : (safeUser.role === 'Admin' ? 'admin' : 'staff')
    };
  },

  registerCustomer(data) {
    if (!data.name || !data.name.trim()) throw new Error('Full Name is required.');
    if (!data.phone || !data.phone.trim()) throw new Error('Mobile Number is required.');
    if (!data.email || !data.email.trim()) throw new Error('Email is required.');
    if (!data.password || data.password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (!data.address || !data.address.trim()) throw new Error('Address is required.');
    if (!data.city || !data.city.trim()) throw new Error('City is required.');
    if (!data.state || !data.state.trim()) throw new Error('State is required.');
    if (!data.pincode || !data.pincode.trim()) throw new Error('PIN Code is required.');

    const cleanPhone = data.phone.trim();
    const cleanEmail = data.email.trim().toLowerCase();

    const users = this.getUsers();
    const customers = readTable('customers');

    if (users.some(u => (u.email && u.email.toLowerCase() === cleanEmail) || (u.phone && u.phone === cleanPhone))) {
      const err = new Error('An account with this mobile number or email already exists.');
      err.statusCode = 409;
      throw err;
    }

    const customerId = generateId('CUST');
    const newCustomer = {
      id: customerId,
      name: data.name.trim(),
      type: data.type || 'Retail',
      phone: cleanPhone,
      email: cleanEmail,
      taxId: data.taxId ? data.taxId.trim() : 'N/A',
      creditLimit: 0,
      address: data.address.trim(),
      city: data.city.trim(),
      state: data.state.trim(),
      pincode: data.pincode.trim(),
      status: 'Active',
      createdAt: new Date().toISOString()
    };
    customers.push(newCustomer);
    writeTable('customers', customers);

    const userId = generateId('USR');
    const newUser = {
      id: userId,
      username: cleanEmail.split('@')[0] + '-' + cleanPhone.slice(-4),
      email: cleanEmail,
      name: data.name.trim(),
      phone: cleanPhone,
      password: hashPassword(data.password),
      role: 'Customer',
      customerId: customerId,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeTable('users', users);

    const { password: _, ...safeUser } = newUser;
    const session = this.createSession(safeUser);
    return { user: safeUser, customer: newCustomer, token: session.token };
  },

  // --- Customers ---
  getCustomers(query = '') {
    const customers = readTable('customers');
    if (!query) return customers;
    const q = query.toLowerCase();
    return customers.filter(c =>
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.company && c.company.toLowerCase().includes(q))
    );
  },

  getCustomerById(id) {
    const customers = readTable('customers');
    return customers.find(c => c.id === id) || null;
  },

  createCustomer(data) {
    if (!data.name || !data.name.trim()) throw new Error('Customer name is required.');
    const phoneRegex = /^\+?[0-9\s\-()]{7,15}$/;
    if (!data.phone || !phoneRegex.test(data.phone.trim())) {
      throw new Error('Invalid customer phone number format.');
    }

    const cleanPhone = data.phone.trim();
    const cleanEmail = data.email ? data.email.trim().toLowerCase() : '';
    const customers = readTable('customers');

    if (customers.some(c => c.phone.replace(/\s+/g, '') === cleanPhone.replace(/\s+/g, '') || (cleanEmail && c.email && c.email.toLowerCase() === cleanEmail))) {
      const err = new Error('A customer with this phone number or email already exists.');
      err.statusCode = 409;
      throw err;
    }

    const rawLimit = parseFloat(data.creditLimit);
    const creditLimit = isNaN(rawLimit) || rawLimit < 0 ? 0 : Math.min(10000000, rawLimit);

    const newCustomer = {
      id: generateId('CUST'),
      name: data.name.trim(),
      company: data.company ? data.company.trim() : '',
      type: data.type || 'Individual',
      email: cleanEmail,
      phone: cleanPhone,
      taxId: data.taxId ? data.taxId.trim() : '',
      address: data.address ? data.address.trim() : '',
      city: data.city ? data.city.trim() : 'Surat',
      state: data.state ? data.state.trim() : 'Gujarat',
      pincode: data.pincode ? data.pincode.trim() : '394305',
      creditLimit,
      outstandingBalance: 0,
      status: 'Active',
      createdAt: new Date().toISOString()
    };
    customers.unshift(newCustomer);
    writeTable('customers', customers);
    return newCustomer;
  },

  updateCustomer(id, updates) {
    const customers = readTable('customers');
    const index = customers.findIndex(c => c.id === id);
    if (index === -1) return null;
    customers[index] = { ...customers[index], ...updates, updatedAt: new Date().toISOString() };
    writeTable('customers', customers);
    return customers[index];
  },

  // --- Parcels ---
  getParcels(filters = {}, user = null) {
    let parcels = readTable('parcels');

    if (user) {
      if (user.role === 'Driver') {
        parcels = parcels.filter(p => p.dispatch.assignedDriverId === user.driverId);
      } else if (user.role === 'Customer') {
        const custId = user.customerId || user.id;
        parcels = parcels.filter(p =>
          (p.customerId && p.customerId === custId) ||
          (p.createdByUserId && p.createdByUserId === user.id) ||
          (p.sender && p.sender.customerId === custId) ||
          (p.sender && p.sender.phone && user.phone && p.sender.phone.replace(/\s+/g, '') === user.phone.replace(/\s+/g, ''))
        );
      }
    }

    if (filters.status && filters.status !== 'All') {
      parcels = parcels.filter(p => p.status.toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.paymentStatus && filters.paymentStatus !== 'All') {
      parcels = parcels.filter(p => p.payment.status.toLowerCase() === filters.paymentStatus.toLowerCase());
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      parcels = parcels.filter(p =>
        p.trackingNumber.toLowerCase().includes(q) ||
        p.sender.name.toLowerCase().includes(q) ||
        p.receiver.name.toLowerCase().includes(q) ||
        p.receiver.city.toLowerCase().includes(q)
      );
    }
    return parcels;
  },

  getParcelById(id) {
    const parcels = readTable('parcels');
    return parcels.find(p => p.id === id) || null;
  },

  getParcelByTracking(trackingNumber) {
    const parcels = readTable('parcels');
    const cleanNumber = trackingNumber ? trackingNumber.trim().toUpperCase() : '';
    return parcels.find(p => p.trackingNumber.toUpperCase() === cleanNumber) || null;
  },

  validateParcelInput(data) {
    if (!data.senderName || !data.senderName.trim()) throw new Error('Sender name is required.');
    if (!data.senderPhone || !data.senderPhone.trim()) throw new Error('Sender phone is required.');
    if (!data.senderAddress || !data.senderAddress.trim()) throw new Error('Sender address is required.');
    if (!data.senderCity || !data.senderCity.trim()) throw new Error('Sender city is required.');
    if (!data.receiverName || !data.receiverName.trim()) throw new Error('Receiver name is required.');
    if (!data.receiverPhone || !data.receiverPhone.trim()) throw new Error('Receiver phone is required.');
    if (!data.receiverAddress || !data.receiverAddress.trim()) throw new Error('Receiver address is required.');
    if (!data.receiverCity || !data.receiverCity.trim()) throw new Error('Receiver city is required.');

    const phoneRegex = /^\+?[0-9\s\-()]{7,15}$/;
    if (!phoneRegex.test(data.senderPhone.trim())) throw new Error('Invalid sender phone number format.');
    if (!phoneRegex.test(data.receiverPhone.trim())) throw new Error('Invalid receiver phone number format.');

    const weight = parseFloat(data.weight);
    if (isNaN(weight) || weight <= 0 || weight > 25000) throw new Error('Invalid parcel actual weight. Must be between 0.01 kg and 25,000 kg.');

    const l = parseFloat(data.length);
    const w = parseFloat(data.width);
    const h = parseFloat(data.height);
    if (isNaN(l) || l <= 0 || l > 2000) throw new Error('Invalid length. Must be between 0.1 cm and 2,000 cm.');
    if (isNaN(w) || w <= 0 || w > 1000) throw new Error('Invalid width. Must be between 0.1 cm and 1,000 cm.');
    if (isNaN(h) || h <= 0 || h > 1000) throw new Error('Invalid height. Must be between 0.1 cm and 1,000 cm.');
  },

  createParcel(data) {
    this.validateParcelInput(data);

    const parcels = readTable('parcels');

    let trackingNumber = data.customTrackingNumber;
    if (trackingNumber) {
      trackingNumber = trackingNumber.trim().toUpperCase();
      if (parcels.some(p => p.trackingNumber.toUpperCase() === trackingNumber)) {
        const err = new Error(`Duplicate tracking number: ${trackingNumber} already exists.`);
        err.statusCode = 409;
        throw err;
      }
    } else {
      const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
      const randCode = Math.floor(100000 + Math.random() * 900000);
      trackingNumber = `PTMS-${yearMonth}-${randCode}`;
    }

    const length = parseFloat(data.length);
    const width = parseFloat(data.width);
    const height = parseFloat(data.height);
    const actualWeight = parseFloat(data.weight);
    const volumetricWeight = parseFloat(((length * width * height) / 5000).toFixed(2));
    const billableWeight = parseFloat(Math.max(actualWeight, volumetricWeight).toFixed(2));

    const serviceType = data.serviceType || 'Standard Ground';
    let baseRatePerKg = 40;
    let minFreight = 200;

    if (serviceType === 'Express Air' || serviceType === 'Priority Express') {
      baseRatePerKg = 90;
      minFreight = 450;
    } else if (serviceType === 'Same-Day Priority') {
      baseRatePerKg = 150;
      minFreight = 600;
    } else if (serviceType === 'Heavy Freight') {
      baseRatePerKg = 30;
      minFreight = 500;
    } else if (serviceType.includes('Full Truck') || serviceType.includes('FTL')) {
      baseRatePerKg = 0;
      minFreight = 7500;
    }

    let freightCharges = minFreight;
    if (baseRatePerKg > 0) {
      freightCharges = Math.max(minFreight, Math.round(billableWeight * baseRatePerKg));
    }

    const fuelSurcharge = Math.round(freightCharges * 0.10);
    const handlingFee = 50;
    const rawDeclared = parseFloat(data.declaredValue);
    const declaredValue = isNaN(rawDeclared) || rawDeclared < 0 ? 0 : Math.min(10000000, rawDeclared);
    const insuranceFee = data.insured ? Math.round(Math.max(50, declaredValue * 0.01)) : 0;
    const subtotal = freightCharges + fuelSurcharge + handlingFee + insuranceFee;
    const tax = Math.round(subtotal * 0.18);
    const totalAmount = subtotal + tax;

    const paymentMode = data.paymentMode || 'Prepaid';
    let paymentStatus = paymentMode === 'Prepaid' ? 'Paid' : 'Pending';
    if (data.paymentFailed) paymentStatus = 'Failed';

    const newParcel = {
      id: generateId('PRCL'),
      trackingNumber,
      carrierName: this.COMPANY_NAME,
      customerId: data.customerId || data.senderCustomerId || null,
      createdByUserId: data.createdByUserId || null,
      bookingDate: new Date().toISOString(),
      serviceType,
      status: 'Booked',
      package: {
        category: data.category || 'General Cargo',
        description: data.description || '',
        declaredValue,
        insured: !!data.insured,
        dimensions: { length, width, height },
        actualWeight,
        volumetricWeight,
        billableWeight,
        fragile: !!data.fragile
      },
      sender: {
        customerId: data.senderCustomerId || null,
        name: data.senderName.trim(),
        phone: data.senderPhone.trim(),
        email: data.senderEmail ? data.senderEmail.trim() : '',
        address: data.senderAddress.trim(),
        city: data.senderCity.trim(),
        state: data.senderState ? data.senderState.trim() : '',
        pincode: data.senderPincode ? data.senderPincode.trim() : ''
      },
      receiver: {
        name: data.receiverName.trim(),
        phone: data.receiverPhone.trim(),
        alternatePhone: data.receiverAlternatePhone ? data.receiverAlternatePhone.trim() : '',
        email: data.receiverEmail ? data.receiverEmail.trim() : '',
        address: data.receiverAddress.trim(),
        landmark: data.receiverLandmark ? data.receiverLandmark.trim() : '',
        city: data.receiverCity.trim(),
        state: data.receiverState ? data.receiverState.trim() : '',
        pincode: data.receiverPincode ? data.receiverPincode.trim() : '',
        instructions: data.deliveryInstructions ? data.deliveryInstructions.trim() : ''
      },
      pricing: {
        freightCharges,
        fuelSurcharge,
        handlingFee,
        insuranceFee,
        tax,
        totalAmount
      },
      payment: {
        mode: paymentMode,
        status: paymentStatus,
        collectedAt: paymentStatus === 'Paid' ? new Date().toISOString() : null,
        collectedBy: paymentStatus === 'Paid' ? 'Online Gateway' : null,
        transactionRef: data.transactionRef || (paymentStatus === 'Paid' ? `TXN-${Date.now()}` : '')
      },
      dispatch: {
        currentHub: data.originHub || 'Surat Main Hub',
        destinationHub: data.destinationHub || `${data.receiverCity} Regional Hub`,
        assignedDriverId: null,
        assignedVehicleId: null,
        deliveryRunSheetId: null,
        estimatedDelivery: data.estimatedDelivery || new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString()
      },
      delivery: {
        attempts: 0,
        deliveredAt: null,
        deliveredTo: null,
        relationship: null,
        podSignature: null,
        failureReason: null
      }
    };

    parcels.unshift(newParcel);
    writeTable('parcels', parcels);

    db.addTrackingEvent(newParcel.id, {
      status: 'Booked',
      location: newParcel.dispatch.currentHub,
      description: `Shipment booking confirmed with ${this.COMPANY_NAME}. Consignment Waybill generated.`,
      actor: 'Booking Counter'
    });

    return newParcel;
  },

  updateParcelStatus(id, newStatus, location, notes, actor = 'System Hub') {
    const parcels = readTable('parcels');
    const parcel = parcels.find(p => p.id === id);
    if (!parcel) return null;

    const allowedNext = VALID_TRANSITIONS[parcel.status] || [];
    if (!allowedNext.includes(newStatus)) {
      const err = new Error(`Invalid status transition from "${parcel.status}" to "${newStatus}". Allowed transitions: [${allowedNext.join(', ')}]`);
      err.statusCode = 400;
      throw err;
    }

    parcel.status = newStatus;
    if (location) {
      parcel.dispatch.currentHub = location;
    }

    if (newStatus === 'Delivered') {
      parcel.delivery.deliveredAt = new Date().toISOString();
      if (parcel.payment.mode === 'COD') {
        parcel.payment.status = 'Collected';
        parcel.payment.collectedAt = new Date().toISOString();
      }
    } else if (newStatus === 'Returned') {
      parcel.delivery.returnedAt = new Date().toISOString();
    }

    writeTable('parcels', parcels);

    db.addTrackingEvent(parcel.id, {
      status: newStatus,
      location: location || parcel.dispatch.currentHub,
      description: notes || `Shipment status updated to ${newStatus}.`,
      actor
    });

    return parcel;
  },

  recordPOD(id, podData) {
    const parcels = readTable('parcels');
    const parcel = parcels.find(p => p.id === id);
    if (!parcel) return null;

    if (parcel.status === 'Delivered') {
      const err = new Error('Parcel is already delivered.');
      err.statusCode = 400;
      throw err;
    }

    if (parcel.status === 'Cancelled' || parcel.status === 'Returned') {
      const err = new Error(`Cannot record POD for parcel with status "${parcel.status}".`);
      err.statusCode = 400;
      throw err;
    }

    if (!podData.signature || typeof podData.signature !== 'string') {
      const err = new Error('Digital recipient signature is required for Proof of Delivery.');
      err.statusCode = 400;
      throw err;
    }

    parcel.status = 'Delivered';
    parcel.delivery.deliveredAt = new Date().toISOString();
    parcel.delivery.deliveredTo = (podData.deliveredTo || parcel.receiver.name || 'Consignee').trim();
    parcel.delivery.relationship = (podData.relationship || 'Self').trim();
    parcel.delivery.podSignature = podData.signature;
    parcel.delivery.podNotes = podData.notes || '';

    if (parcel.payment.mode === 'COD') {
      parcel.payment.status = 'Collected';
      parcel.payment.collectedAt = new Date().toISOString();
      parcel.payment.collectedBy = podData.driverName || 'Delivery Agent';
    }

    writeTable('parcels', parcels);

    db.addTrackingEvent(parcel.id, {
      status: 'Delivered',
      location: `${parcel.receiver.city}, ${parcel.receiver.state}`,
      description: `Delivered by ${this.COMPANY_NAME} to ${parcel.delivery.deliveredTo} (${parcel.delivery.relationship}). Digital POD verified.`,
      actor: podData.driverName || 'Delivery Driver'
    });

    return parcel;
  },

  collectPayment(id, actor = 'Accounts Desk') {
    const parcels = readTable('parcels');
    const parcel = parcels.find(p => p.id === id);
    if (!parcel) return null;

    parcel.payment.status = 'Collected';
    parcel.payment.collectedAt = new Date().toISOString();
    parcel.payment.collectedBy = actor;

    writeTable('parcels', parcels);

    db.addTrackingEvent(parcel.id, {
      status: parcel.status,
      location: parcel.dispatch.currentHub || 'Surat Main Hub',
      description: `Payment / COD of ₹${parcel.pricing.totalAmount} confirmed & recorded by ${actor}.`,
      actor
    });

    return parcel;
  },

  recordFailedDelivery(id, reason, notes, driverName = 'Driver') {
    const parcels = readTable('parcels');
    const parcel = parcels.find(p => p.id === id);
    if (!parcel) return null;

    parcel.delivery.attempts = (parcel.delivery.attempts || 0) + 1;
    parcel.delivery.failureReason = reason;

    if (parcel.delivery.attempts >= 3 || reason === 'Customer Refused to Accept') {
      parcel.status = 'Returned';
    } else {
      parcel.status = 'Delivery Attempt Failed';
    }

    writeTable('parcels', parcels);

    db.addTrackingEvent(parcel.id, {
      status: parcel.status,
      location: `${parcel.receiver.city}`,
      description: `Delivery attempt #${parcel.delivery.attempts} unsuccessful: ${reason}. ${notes || ''}`,
      actor: driverName
    });

    return parcel;
  },

  // --- Tracking Events ---
  getTrackingEvents(parcelId) {
    const events = readTable('tracking_events');
    return events
      .filter(e => e.parcelId === parcelId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  },

  addTrackingEvent(parcelId, event) {
    const events = readTable('tracking_events');
    const newEvent = {
      id: generateId('EVT'),
      parcelId,
      status: event.status,
      location: event.location || 'Surat Main Hub',
      description: event.description || '',
      actor: event.actor || this.COMPANY_NAME,
      timestamp: new Date().toISOString()
    };
    events.push(newEvent);
    writeTable('tracking_events', events);
    return newEvent;
  },

  // --- Real Vehicle Master Data ---
  getVehicles() {
    let vehicles = readTable('vehicles');
    // If table is empty, initialize strictly with the four real vehicles
    if (vehicles.length === 0) {
      vehicles = [
        { id: 'VEH-001', regNumber: 'GJ19Y3729', type: '14 Feet Eicher', status: 'Available', createdAt: new Date().toISOString() },
        { id: 'VEH-002', regNumber: 'GJ19Y7669', type: '10 Feet Pickup Bolero', status: 'Available', createdAt: new Date().toISOString() },
        { id: 'VEH-003', regNumber: 'GJ19Z3756', type: '10 Feet Pickup Bolero', status: 'Available', createdAt: new Date().toISOString() },
        { id: 'VEH-004', regNumber: 'GJ19Y6151', type: '14 Feet Eicher', status: 'Available', createdAt: new Date().toISOString() }
      ];
      writeTable('vehicles', vehicles);
    }
    return vehicles;
  },

  createVehicle(data) {
    if (!data.regNumber || !data.regNumber.trim()) {
      const err = new Error('Vehicle number is required.');
      err.statusCode = 400;
      throw err;
    }
    if (!data.type || !data.type.trim()) {
      const err = new Error('Vehicle type is required.');
      err.statusCode = 400;
      throw err;
    }

    const cleanReg = data.regNumber.trim().toUpperCase();
    const vehicles = readTable('vehicles');

    if (vehicles.some(v => v.regNumber.toUpperCase() === cleanReg)) {
      const err = new Error('Vehicle number already exists.');
      err.statusCode = 409;
      throw err;
    }

    const newVehicle = {
      id: generateId('VEH'),
      regNumber: cleanReg,
      type: data.type.trim(),
      status: 'Available',
      createdAt: new Date().toISOString()
    };
    vehicles.push(newVehicle);
    writeTable('vehicles', vehicles);
    return newVehicle;
  },

  // --- Drivers ---
  getDrivers() {
    return readTable('drivers');
  },

  createDriver(data) {
    if (!data.name || !data.name.trim()) throw new Error('Driver name is required.');
    const phoneRegex = /^\+?[0-9\s\-()]{7,15}$/;
    if (!data.phone || !phoneRegex.test(data.phone.trim())) {
      throw new Error('Invalid driver phone number format.');
    }

    const cleanPhone = data.phone.trim();
    const drivers = readTable('drivers');

    if (drivers.some(d => d.phone.replace(/\s+/g, '') === cleanPhone.replace(/\s+/g, ''))) {
      const err = new Error('A driver with this phone number already exists.');
      err.statusCode = 409;
      throw err;
    }

    const newDriver = {
      id: generateId('DRV'),
      name: data.name.trim(),
      phone: cleanPhone,
      licenseNumber: data.licenseNumber ? data.licenseNumber.trim().toUpperCase() : 'Not provided',
      emergencyContact: data.emergencyContact ? data.emergencyContact.trim() : 'Not provided',
      assignedVehicleId: null,
      assignedVehicleReg: null,
      status: 'Available',
      deliveriesCompleted: 0,
      rating: 5.0,
      createdAt: new Date().toISOString()
    };
    drivers.push(newDriver);
    writeTable('drivers', drivers);
    return newDriver;
  },

  // --- Run-Sheets ---
  getRunSheets() {
    return readTable('run_sheets');
  },

  createRunSheet(data) {
    const runSheets = readTable('run_sheets');
    const parcels = readTable('parcels');
    const drivers = readTable('drivers');
    const vehicles = readTable('vehicles');

    const driver = drivers.find(d => d.id === data.driverId);
    const vehicle = vehicles.find(v => v.id === data.vehicleId);

    if (!data.parcelIds || data.parcelIds.length === 0) {
      throw new Error('At least one parcel must be selected for run-sheet dispatch.');
    }

    const sheetId = generateId('RNS');
    const sheetNumber = `RNS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

    const assignedParcels = [];
    let totalCOD = 0;

    data.parcelIds.forEach((pid, idx) => {
      const p = parcels.find(item => item.id === pid);
      if (p) {
        p.status = 'Out for Delivery';
        p.dispatch.assignedDriverId = driver ? driver.id : null;
        p.dispatch.assignedVehicleId = vehicle ? vehicle.id : null;
        p.dispatch.deliveryRunSheetId = sheetId;
        if (p.payment.mode === 'COD') {
          totalCOD += p.pricing.totalAmount;
        }
        assignedParcels.push({
          parcelId: p.id,
          trackingNumber: p.trackingNumber,
          receiverName: p.receiver.name,
          address: `${p.receiver.address}, ${p.receiver.city}`,
          phone: p.receiver.phone,
          codAmount: p.payment.mode === 'COD' ? p.pricing.totalAmount : 0,
          status: 'Out for Delivery',
          stopNumber: idx + 1
        });

        db.addTrackingEvent(p.id, {
          status: 'Out for Delivery',
          location: vehicle ? vehicle.regNumber : 'Surat Terminal',
          description: `Dispatched on Manifest ${sheetNumber} by ${this.COMPANY_NAME} with vehicle ${vehicle ? vehicle.regNumber : 'Fleet Vehicle'}.`,
          actor: 'Dispatch Manager'
        });
      }
    });

    writeTable('parcels', parcels);

    const newRunSheet = {
      id: sheetId,
      sheetNumber,
      carrierName: this.COMPANY_NAME,
      date: new Date().toISOString(),
      driverId: driver ? driver.id : null,
      driverName: driver ? driver.name : (this.BUSINESS.owner || 'Unassigned'),
      driverPhone: driver ? driver.phone : this.BUSINESS.mobile1,
      vehicleId: vehicle ? vehicle.id : null,
      vehicleReg: vehicle ? vehicle.regNumber : '',
      hub: data.hub || 'Surat Main Hub',
      parcels: assignedParcels,
      totalParcels: assignedParcels.length,
      totalCOD,
      status: 'Active',
      createdAt: new Date().toISOString()
    };

    runSheets.unshift(newRunSheet);
    writeTable('run_sheets', runSheets);
    return newRunSheet;
  },

  getHubs() {
    return readTable('hubs');
  },

  getAnalytics() {
    const parcels = readTable('parcels');
    const drivers = readTable('drivers');
    const vehicles = this.getVehicles();
    const customers = readTable('customers');

    const totalShipments = parcels.length;
    const delivered = parcels.filter(p => p.status === 'Delivered').length;
    const inTransit = parcels.filter(p => ['In Transit', 'Received at Origin Hub', 'Arrived at Destination Hub'].includes(p.status)).length;
    const outForDelivery = parcels.filter(p => p.status === 'Out for Delivery').length;
    const booked = parcels.filter(p => p.status === 'Booked' || p.status === 'Picked Up').length;
    const failed = parcels.filter(p => ['Delivery Attempt Failed', 'Returned'].includes(p.status)).length;

    const totalRevenue = parcels.reduce((sum, p) => sum + (p.pricing?.totalAmount || 0), 0);
    const codTotalToCollect = parcels
      .filter(p => p.payment?.mode === 'COD' && p.payment?.status !== 'Collected')
      .reduce((sum, p) => sum + (p.pricing?.totalAmount || 0), 0);
    const codCollected = parcels
      .filter(p => p.payment?.mode === 'COD' && p.payment?.status === 'Collected')
      .reduce((sum, p) => sum + (p.pricing?.totalAmount || 0), 0);

    const onTimeRate = totalShipments > 0 ? Math.round((delivered / (totalShipments - booked || 1)) * 100) : 100;

    return {
      companyName: this.COMPANY_NAME,
      systemName: this.SYSTEM_NAME,
      businessDetails: this.BUSINESS,
      kpis: {
        totalShipments,
        delivered,
        inTransit,
        outForDelivery,
        booked,
        failed,
        totalRevenue,
        codTotalToCollect,
        codCollected,
        activeDrivers: drivers.length,
        activeVehicles: vehicles.length,
        totalCustomers: customers.length,
        onTimeRate: totalShipments === 0 ? 0 : Math.min(100, Math.max(0, onTimeRate))
      }
    };
  }
};

module.exports = db;