/**
 * DEEPAK TEMPO SERVICE — PARCEL TRANSPORT MANAGEMENT SYSTEM (PTMS)
 * Unified High-Performance Frontend Controller
 * Complete State, RBAC, Real-time APIs, & Visual Controls
 */

const app = {
  token: null,
  currentUser: null,
  currentView: 'dashboard',
  currentFilter: 'All',
  loginMode: 'staff',
  data: {
    parcels: [],
    vehicles: [],
    drivers: [],
    customers: [],
    runSheets: [],
    business: null
  },
  selectedTrackingParcel: null,

  /* ========================================================================
     INITIALIZATION & PAGE ROUTING
     ======================================================================== */
  init() {
    this.restoreSession();
    this.calcPublicPrice();
  },

  restoreSession() {
    this.token = localStorage.getItem('ptms_token') || null;
    const saved = localStorage.getItem('ptms_user');
    if (saved) {
      try { this.currentUser = JSON.parse(saved); } catch (e) { this.currentUser = null; }
    }
    if (this.token && this.currentUser) {
      this.enterApp();
    }
  },

  /* ========================================================================
     PAGE NAVIGATION (Landing / Login / App)
     ======================================================================== */
  showLanding() {
    document.getElementById('publicLandingPage').classList.add('active');
    document.getElementById('loginPortalPage').classList.remove('active');
    document.getElementById('appContainer').classList.remove('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  showLoginPortal() {
    document.getElementById('publicLandingPage').classList.remove('active');
    document.getElementById('loginPortalPage').classList.add('active');
    document.getElementById('appContainer').classList.remove('active');
    document.getElementById('loginErrorMsg').style.display = 'none';
  },

  async enterApp() {
    document.getElementById('publicLandingPage').classList.remove('active');
    document.getElementById('loginPortalPage').classList.remove('active');
    document.getElementById('appContainer').classList.add('active');

    this.updateUserBadge();
    this.applyRBAC();
    this.initCanvas();
    this.initGlobalSearch();
    await this.loadData();
    this.renderAll();
  },

  /* ========================================================================
     AUTHENTICATION
     ======================================================================== */
  switchLoginTab(mode) {
    this.loginMode = mode;
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    const tabs = document.querySelectorAll('.login-tab');
    if (mode === 'staff') tabs[0]?.classList.add('active');
    else tabs[1]?.classList.add('active');
  },

  async handlePortalLogin(e) {
    e.preventDefault();
    const user = document.getElementById('loginPortalUser').value.trim();
    const pass = document.getElementById('loginPortalPass').value.trim();
    const errorEl = document.getElementById('loginErrorMsg');

    if (!user || !pass) {
      errorEl.textContent = 'Please enter both username and password.';
      errorEl.style.display = 'block';
      return;
    }

    const endpoint = this.loginMode === 'customer' ? '/api/auth/customer/login' : '/api/auth/staff/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: user, password: pass })
      });
      const json = await res.json();

      if (!res.ok) {
        errorEl.textContent = json.error || 'Login failed. Please check your credentials.';
        errorEl.style.display = 'block';
        return;
      }

      errorEl.style.display = 'none';
      this.token = json.token;
      this.currentUser = json.user;
      localStorage.setItem('ptms_token', json.token);
      localStorage.setItem('ptms_user', JSON.stringify(json.user));
      this.showToast('Welcome, ' + json.user.name + '! (' + json.user.role + ')', 'success');
      this.enterApp();
    } catch (err) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.style.display = 'block';
    }
  },

  async demoLogin(username, password) {
    document.getElementById('loginPortalUser').value = username;
    document.getElementById('loginPortalPass').value = password;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: username, password })
      });
      const json = await res.json();

      if (!res.ok) {
        this.showToast(json.error || 'Login failed.', 'error');
        return;
      }

      this.token = json.token;
      this.currentUser = json.user;
      localStorage.setItem('ptms_token', json.token);
      localStorage.setItem('ptms_user', JSON.stringify(json.user));
      this.showToast('Logged in as ' + json.user.name + ' (' + json.user.role + ')', 'success');
      this.enterApp();
    } catch (err) {
      this.showToast('Network error during login.', 'error');
    }
  },

  /* ========================================================================
     LOGOUT
     ======================================================================== */
  logout() {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.classList.add('active');
  },

  async confirmLogout() {
    this.closeModal('logoutModal');

    if (this.token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + this.token }
        });
      } catch (e) {}
    }

    this.token = null;
    this.currentUser = null;
    localStorage.removeItem('ptms_token');
    localStorage.removeItem('ptms_user');
    this.data = { parcels: [], vehicles: [], drivers: [], customers: [], runSheets: [], business: null };

    this.showToast('You have been signed out successfully.', 'info');
    this.showLanding();
  },

  /* ========================================================================
     CUSTOMER REGISTRATION
     ======================================================================== */
  showRegister() {
    const modal = document.getElementById('registerModal');
    if (modal) {
      // Reset form
      document.getElementById('registerErrorMsg').style.display = 'none';
      document.getElementById('registerSuccessMsg').style.display = 'none';
      const form = modal.querySelector('form');
      if (form) form.reset();
      document.getElementById('regState').value = 'Gujarat';
      modal.classList.add('active');
    }
  },

  async handleCustomerRegister(e) {
    e.preventDefault();
    const errorEl = document.getElementById('registerErrorMsg');
    const successEl = document.getElementById('registerSuccessMsg');
    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    const name = document.getElementById('regName').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;
    const address = document.getElementById('regAddress').value.trim();
    const city = document.getElementById('regCity').value.trim();
    const state = document.getElementById('regState').value.trim();
    const pincode = document.getElementById('regPincode').value.trim();
    const taxId = document.getElementById('regTaxId').value.trim();

    if (password !== confirmPassword) {
      errorEl.textContent = 'Passwords do not match. Please re-enter.';
      errorEl.style.display = 'block';
      return;
    }

    try {
      const res = await fetch('/api/auth/customer/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, password, address, city, state, pincode, taxId })
      });
      const json = await res.json();

      if (!res.ok) {
        errorEl.textContent = json.error || 'Registration failed. Please try again.';
        errorEl.style.display = 'block';
        return;
      }

      // Registration successful — auto-login
      this.token = json.token;
      this.currentUser = json.user;
      localStorage.setItem('ptms_token', json.token);
      localStorage.setItem('ptms_user', JSON.stringify(json.user));
      this.closeModal('registerModal');
      this.showToast('Account created successfully! Welcome, ' + json.user.name + '!', 'success');
      this.enterApp();
    } catch (err) {
      errorEl.textContent = 'Network error. Please check your connection and try again.';
      errorEl.style.display = 'block';
    }
  },

  /* ========================================================================
     FORGOT PASSWORD (OTP-based Self-Service Reset)
     ======================================================================== */
  _forgotOtpToken: null,

  showForgotPassword() {
    const modal = document.getElementById('forgotPasswordModal');
    if (modal) {
      // Reset state
      document.getElementById('forgotErrorMsg').style.display = 'none';
      document.getElementById('forgotSuccessMsg').style.display = 'none';
      document.getElementById('forgotStep1').style.display = '';
      document.getElementById('forgotStep2').style.display = 'none';
      document.getElementById('forgotDemoOtpHint').style.display = 'none';
      document.getElementById('forgotIdentifier').value = '';
      document.getElementById('forgotOTP').value = '';
      document.getElementById('forgotNewPassword').value = '';
      document.getElementById('forgotConfirmPassword').value = '';
      this._forgotOtpToken = null;
      modal.classList.add('active');
    }
  },

  async handleForgotSendOTP() {
    const errorEl = document.getElementById('forgotErrorMsg');
    const successEl = document.getElementById('forgotSuccessMsg');
    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    const identifier = document.getElementById('forgotIdentifier').value.trim();
    const channel = document.getElementById('forgotChannel').value;

    if (!identifier) {
      errorEl.textContent = 'Please enter your mobile number or email address.';
      errorEl.style.display = 'block';
      return;
    }

    try {
      const res = await fetch('/api/auth/forgot-password/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, channel })
      });
      const json = await res.json();

      if (!res.ok) {
        errorEl.textContent = json.error || 'Failed to send OTP. Please try again.';
        errorEl.style.display = 'block';
        return;
      }

      // Store OTP token and move to step 2
      this._forgotOtpToken = json.otpToken;
      document.getElementById('forgotDestDisplay').textContent = json.destination || identifier;
      document.getElementById('forgotStep1').style.display = 'none';
      document.getElementById('forgotStep2').style.display = '';

      // Show demo OTP hint if available (demo/dev mode)
      if (json.demoOtp) {
        document.getElementById('forgotDemoOtpValue').textContent = json.demoOtp;
        document.getElementById('forgotDemoOtpHint').style.display = 'block';
      }

      successEl.textContent = json.message || 'OTP sent successfully!';
      successEl.style.display = 'block';
    } catch (err) {
      errorEl.textContent = 'Network error. Please check your connection and try again.';
      errorEl.style.display = 'block';
    }
  },

  async handleForgotVerifyOTP() {
    const errorEl = document.getElementById('forgotErrorMsg');
    const successEl = document.getElementById('forgotSuccessMsg');
    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    const otp = document.getElementById('forgotOTP').value.trim();
    const newPassword = document.getElementById('forgotNewPassword').value;
    const confirmPassword = document.getElementById('forgotConfirmPassword').value;

    if (!otp || otp.length !== 6) {
      errorEl.textContent = 'Please enter the 6-digit OTP code.';
      errorEl.style.display = 'block';
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      errorEl.textContent = 'New password must be at least 6 characters long.';
      errorEl.style.display = 'block';
      return;
    }

    if (newPassword !== confirmPassword) {
      errorEl.textContent = 'Passwords do not match. Please re-enter.';
      errorEl.style.display = 'block';
      return;
    }

    try {
      const res = await fetch('/api/auth/forgot-password/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otpToken: this._forgotOtpToken, otp, newPassword })
      });
      const json = await res.json();

      if (!res.ok) {
        errorEl.textContent = json.error || 'Failed to reset password. Please try again.';
        errorEl.style.display = 'block';
        return;
      }

      // Password reset successful — auto-login
      this.closeModal('forgotPasswordModal');
      if (json.token && json.user) {
        this.token = json.token;
        this.currentUser = json.user;
        localStorage.setItem('ptms_token', json.token);
        localStorage.setItem('ptms_user', JSON.stringify(json.user));
        this.showToast('Password reset successful! You are now logged in.', 'success');
        this.enterApp();
      } else {
        this.showToast('Password reset successful! Please log in with your new password.', 'success');
      }
    } catch (err) {
      errorEl.textContent = 'Network error. Please check your connection and try again.';
      errorEl.style.display = 'block';
    }
  },

  forgotGoBackToStep1() {
    document.getElementById('forgotErrorMsg').style.display = 'none';
    document.getElementById('forgotSuccessMsg').style.display = 'none';
    document.getElementById('forgotStep1').style.display = '';
    document.getElementById('forgotStep2').style.display = 'none';
    document.getElementById('forgotDemoOtpHint').style.display = 'none';
  },

  /* ========================================================================
     RBAC (Role-Based Access Control)
     ======================================================================== */
  applyRBAC() {
    const role = this.currentUser?.role || 'Admin';
    const roleNorm = role.toLowerCase().replace(/[^a-z0-9]/g, '');

    document.querySelectorAll('#sidebarNav li[data-requires-role]').forEach(li => {
      const allowedRoles = li.getAttribute('data-requires-role').split(',').map(r => r.toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (roleNorm === 'admin' || allowedRoles.includes(roleNorm)) {
        li.style.display = '';
      } else {
        li.style.display = 'none';
      }
    });
  },

  updateUserBadge() {
    const nameEl = document.getElementById('userDisplayName');
    const roleEl = document.getElementById('userRoleTag');
    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarRole = document.getElementById('sidebarUserRole');

    const name = this.currentUser?.name || 'Guest';
    const role = this.currentUser?.role || 'Viewer';

    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;
    if (sidebarName) sidebarName.textContent = name;
    if (sidebarRole) sidebarRole.textContent = role;
  },

  /* ========================================================================
     DATA LOADING
     ======================================================================== */
  async loadData() {
    try {
      const headers = this.token ? { 'Authorization': 'Bearer ' + this.token } : {};
      const res = await fetch('/api/data', { headers });
      if (res.ok) {
        const json = await res.json();
        this.data.parcels = json.parcels || [];
        this.data.vehicles = json.vehicles || [];
        this.data.drivers = json.drivers || [];
        this.data.customers = json.customers || [];
        this.data.runSheets = json.runSheets || [];
        this.data.business = json.business || null;
      }
    } catch (e) {
      console.warn('Could not fetch /api/data:', e);
    }
  },

  renderAll() {
    this.renderDashboard();
    this.renderShipmentsTable();
    this.renderFleet();
    this.renderPodView();
    this.renderBilling();
    this.renderCustomers();
    this.renderHistory();
    this.calcFare();
  },

  switchView(viewId) {
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const panel = document.getElementById('view-' + viewId);
    const link = document.querySelector('.nav-link[data-view="' + viewId + '"]');
    if (panel) panel.classList.add('active');
    if (link) link.classList.add('active');
    this.currentView = viewId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const sidebar = document.getElementById('appSidebar');
    if (sidebar) sidebar.classList.remove('open');

    if (viewId === 'dashboard') this.renderDashboard();
    if (viewId === 'shipments') this.renderShipmentsTable();
    if (viewId === 'fleet') this.renderFleet();
    if (viewId === 'pod') this.renderPodView();
    if (viewId === 'billing') this.renderBilling();
    if (viewId === 'customers') this.renderCustomers();
    if (viewId === 'history') this.renderHistory();
  },

  toggleSidebar() {
    const sidebar = document.getElementById('appSidebar');
    if (sidebar) sidebar.classList.toggle('open');
  },

  /* ========================================================================
     PUBLIC TRACKING (Landing Page)
     ======================================================================== */
  async publicTrack() {
    const num = document.getElementById('publicTrackInput')?.value.trim();
    const resultBox = document.getElementById('publicTrackResult');
    if (!num || !resultBox) return;

    try {
      const res = await fetch('/api/public/track/' + encodeURIComponent(num));
      const json = await res.json();

      if (!res.ok) {
        resultBox.innerHTML = `<div style="background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; padding: 14px; border-radius: 8px; font-size: 14px;">${this.escapeHtml(json.error || 'Parcel not found.')}</div>`;
        resultBox.style.display = 'block';
        return;
      }

      const p = json.parcel || json;
      const events = json.events || [];
      let eventsHtml = events.map(e => `<div style="display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);"><span style="font-size: 11px; color: #64748b; min-width: 110px;" class="font-mono">${this.formatDate(e.timestamp)}</span><span style="color: #cbd5e1; font-size: 13px;"><strong>${this.escapeHtml(e.status)}</strong> — ${this.escapeHtml(e.location || '')}</span></div>`).join('');

      resultBox.innerHTML = `
        <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <div class="font-mono" style="font-size: 18px; font-weight: 800; color: #fff;">${this.escapeHtml(p.trackingNumber)}</div>
            <span class="status-pill ${this.getStatusSlug(p.status)}">${this.escapeHtml(p.status)}</span>
          </div>
          <div style="font-size: 13px; color: #94a3b8; margin-bottom: 14px;">
            ${this.escapeHtml(p.origin || '')} → ${this.escapeHtml(p.destination || '')}
            &bull; ${this.escapeHtml(p.package?.category || '')}
            &bull; ${p.package?.billableWeight || 0} kg
          </div>
          ${eventsHtml ? `<div style="margin-top: 10px;"><div style="font-size: 12px; font-weight: 700; color: var(--brand-amber); text-transform: uppercase; margin-bottom: 8px;">Tracking History</div>${eventsHtml}</div>` : ''}
        </div>
      `;
      resultBox.style.display = 'block';
    } catch (e) {
      resultBox.innerHTML = `<div style="background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; padding: 14px; border-radius: 8px;">Network error. Please try again.</div>`;
      resultBox.style.display = 'block';
    }
  },

  /* ========================================================================
     PUBLIC PRICE CALCULATOR
     ======================================================================== */
  calcPublicPrice() {
    const weight = parseFloat(document.getElementById('calcWeight')?.value) || 0;
    const l = parseFloat(document.getElementById('calcLength')?.value) || 0;
    const w = parseFloat(document.getElementById('calcWidth')?.value) || 0;
    const h = parseFloat(document.getElementById('calcHeight')?.value) || 0;
    const service = document.getElementById('calcService')?.value || 'Direct Express Tempo';

    const volWeight = (l * w * h) / 5000;
    const billable = Math.max(weight, volWeight);

    const volEl = document.getElementById('calcPubVolWeight');
    if (volEl) volEl.textContent = volWeight.toFixed(1) + ' kg';
    const billEl = document.getElementById('calcPubBillWeight');
    if (billEl) billEl.textContent = billable.toFixed(1) + ' kg';

    let baseRate = 180, perKg = 15;
    if (service.includes('Standard')) { baseRate = 120; perKg = 10; }
    else if (service.includes('FTL')) { baseRate = 7500; perKg = 0; }

    let total = Math.round(baseRate + (billable * perKg));
    const gst = Math.round(total * 0.18);
    total += gst;

    const totalEl = document.getElementById('calcPubTotal');
    if (totalEl) totalEl.textContent = '₹' + total.toLocaleString('en-IN');
  },

  /* ========================================================================
     1. DASHBOARD & KPIS
     ======================================================================== */
  renderDashboard() {
    const parcels = this.data.parcels || [];
    const total = parcels.length;
    const inTransit = parcels.filter(p => ['In Transit', 'Received at Origin Hub', 'Arrived at Destination Hub'].includes(p.status)).length;
    const outForDelivery = parcels.filter(p => p.status === 'Out for Delivery').length;
    const delivered = parcels.filter(p => p.status === 'Delivered').length;
    const booked = parcels.filter(p => p.status === 'Booked').length;
    const failed = parcels.filter(p => ['Delivery Attempt Failed', 'Returned'].includes(p.status)).length;

    this.setEl('kpiInTransit', inTransit + outForDelivery);
    this.setEl('kpiTotalShipments', total);
    this.setEl('kpiDelivered', delivered);
    this.setEl('kpiOutForDelivery', outForDelivery + ' OFD');
    this.setEl('sidebarShipmentCount', total);

    const pct = total > 0 ? Math.round((delivered / total) * 100) : 0;
    this.setEl('kpiSuccessRate', pct + '% On-Time');

    const transitBar = document.getElementById('kpiTransitBar');
    if (transitBar) transitBar.style.width = (total > 0 ? Math.round(((inTransit + outForDelivery) / total) * 100) : 0) + '%';
    const deliveredBar = document.getElementById('kpiDeliveredBar');
    if (deliveredBar) deliveredBar.style.width = (total > 0 ? Math.round((delivered / total) * 100) : 0) + '%';

    this.setEl('pipeAll', total);
    this.setEl('pipeBooked', booked);
    this.setEl('pipeInTransit', inTransit);
    this.setEl('pipeOFD', outForDelivery);
    this.setEl('pipeDelivered', delivered);
    this.setEl('pipeFailed', failed);

    let codToCollect = 0, codCollected = 0;
    parcels.forEach(p => {
      const amt = p.pricing ? p.pricing.totalAmount : 0;
      if (p.payment && p.payment.mode === 'COD') {
        if (p.payment.status === 'Collected' || p.status === 'Delivered') codCollected += amt;
        else codToCollect += amt;
      }
    });
    this.setEl('kpiCodToCollect', '₹' + codToCollect.toLocaleString('en-IN'));
    this.setEl('kpiCodCollected', '₹' + codCollected.toLocaleString('en-IN') + ' collected');

    const tbody = document.getElementById('dashboardTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const recent = [...parcels].reverse().slice(0, 6);
    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 32px;">No consignments yet. Click <strong>New Consignment</strong> to create one.</td></tr>';
      return;
    }
    recent.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-mono"><strong>${this.escapeHtml(p.trackingNumber)}</strong></td>
        <td>${this.formatDate(p.createdAt)}</td>
        <td><strong>${this.escapeHtml(p.sender?.name || '')}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${this.escapeHtml(p.sender?.city || 'Surat')}</span></td>
        <td><strong>${this.escapeHtml(p.receiver?.name || '')}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${this.escapeHtml(p.receiver?.city || '')}</span></td>
        <td><span style="font-size: 12px;">${this.escapeHtml(p.serviceType || 'Standard')}</span></td>
        <td class="font-mono">${p.package?.billableWeight || p.package?.actualWeight || 0} kg</td>
        <td><span class="font-mono">₹${p.pricing?.totalAmount || 0}</span><br><span style="font-size: 11px; color: var(--text-muted);">${p.payment?.mode || 'Paid'}</span></td>
        <td>${this.getStatusPill(p.status)}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-outline btn-sm" onclick="app.openBiltyModal('${p.trackingNumber}')" title="Print"><span class="material-symbols-outlined" style="font-size: 16px;">receipt</span></button>
            <button class="btn btn-outline btn-sm" onclick="app.quickTrack('${p.trackingNumber}')" title="Track"><span class="material-symbols-outlined" style="font-size: 16px;">near_me</span></button>
            <button class="btn btn-outline btn-sm" onclick="app.openStatusModal('${p.trackingNumber}')" title="Update"><span class="material-symbols-outlined" style="font-size: 16px;">edit</span></button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
  },

  filterByStatus(status, chipEl) {
    this.currentFilter = status;
    document.querySelectorAll('.pipeline-filter-chip').forEach(c => c.classList.remove('active'));
    if (chipEl) chipEl.classList.add('active');
    const select = document.getElementById('shipmentFilterSelect');
    if (select) select.value = status;
    this.switchView('shipments');
  },

  /* ========================================================================
     2. BOOKING CONSIGNMENT
     ======================================================================== */
  calcFare() {
    const act = parseFloat(document.getElementById('bookActualWeight')?.value) || 0;
    const l = parseFloat(document.getElementById('bookLength')?.value) || 0;
    const w = parseFloat(document.getElementById('bookWidth')?.value) || 0;
    const h = parseFloat(document.getElementById('bookHeight')?.value) || 0;
    const count = parseInt(document.getElementById('bookCount')?.value) || 1;
    const volWeight = (l * w * h * count) / 5000;
    const billable = Math.max(act, volWeight);
    this.setEl('calcVolWeight', volWeight.toFixed(1) + ' kg');
    this.setEl('calcBillableWeight', billable.toFixed(1) + ' kg');
    const total = Math.round(180 + (billable * 15));
    this.setEl('calcTotalFare', '₹' + total.toLocaleString('en-IN'));
    return { billable, total };
  },

  toggleCodField() {
    const mode = document.getElementById('bookPaymentMode')?.value;
    const container = document.getElementById('codAmountContainer');
    if (container) container.style.display = (mode === 'COD') ? 'block' : 'none';
  },

  fillSampleBooking(type) {
    if (type === 'textile') {
      this.setVal('bookSenderName', 'Shree Ganesh Textiles Pvt Ltd');
      this.setVal('bookSenderPhone', '9825144820');
      this.setVal('bookSenderGstin', '24AAACG1924L1Z2');
      this.setVal('bookSenderAddress', 'Plot 14, Phase 2, GIDC Pandesara Industrial Estate');
      this.setVal('bookSenderCity', 'Surat');
      this.setVal('bookSenderPincode', '394221');
      this.setVal('bookReceiverName', 'Royal Garments Fashion Hub');
      this.setVal('bookReceiverPhone', '9824055112');
      this.setVal('bookReceiverCity', 'Bardoli');
      this.setVal('bookReceiverAddress', 'Shop 18, Sardar Patel Textile Market, Station Road');
      this.setVal('bookReceiverState', 'Gujarat');
      this.setVal('bookReceiverPincode', '394601');
      this.setVal('bookDescription', 'Cotton Textiles / Grey Loom Bales');
      this.setVal('bookCount', 4);
      this.setVal('bookActualWeight', 48.0);
    } else {
      this.setVal('bookSenderName', 'Surat Precision Engineering Works');
      this.setVal('bookSenderPhone', '9825011993');
      this.setVal('bookSenderGstin', '24COZPS7273E2Z5');
      this.setVal('bookSenderAddress', 'Sector 3, GIDC Sachin Industrial Area');
      this.setVal('bookSenderCity', 'Surat');
      this.setVal('bookSenderPincode', '394230');
      this.setVal('bookReceiverName', 'Navsari Agro-Automotive Spares');
      this.setVal('bookReceiverPhone', '9724188339');
      this.setVal('bookReceiverCity', 'Navsari');
      this.setVal('bookReceiverAddress', 'Opposite State Transport Bus Station, Highway Road');
      this.setVal('bookReceiverState', 'Gujarat');
      this.setVal('bookReceiverPincode', '396445');
      this.setVal('bookDescription', 'Heavy Machinery Couplings & Bearings');
      this.setVal('bookCount', 2);
      this.setVal('bookActualWeight', 35.5);
    }
    this.calcFare();
    this.showToast('Sample consignment populated.', 'info');
  },

  async handleBookingSubmit(e) {
    e.preventDefault();
    const { billable, total } = this.calcFare();
    const payload = {
      senderName: this.getVal('bookSenderName'),
      senderPhone: this.getVal('bookSenderPhone'),
      senderGstin: this.getVal('bookSenderGstin'),
      senderAddress: this.getVal('bookSenderAddress'),
      senderCity: this.getVal('bookSenderCity'),
      senderState: 'Gujarat',
      senderPincode: this.getVal('bookSenderPincode'),
      receiverName: this.getVal('bookReceiverName'),
      receiverPhone: this.getVal('bookReceiverPhone'),
      receiverAddress: this.getVal('bookReceiverAddress'),
      receiverCity: this.getVal('bookReceiverCity'),
      receiverState: this.getVal('bookReceiverState') || 'Gujarat',
      receiverPincode: this.getVal('bookReceiverPincode'),
      description: this.getVal('bookDescription'),
      category: 'General Cargo',
      count: parseInt(this.getVal('bookCount')) || 1,
      weight: parseFloat(this.getVal('bookActualWeight')) || 0,
      length: parseFloat(this.getVal('bookLength')) || 60,
      width: parseFloat(this.getVal('bookWidth')) || 40,
      height: parseFloat(this.getVal('bookHeight')) || 40,
      serviceType: document.getElementById('bookServiceType')?.value || 'Direct Express Tempo',
      paymentMode: document.getElementById('bookPaymentMode')?.value || 'Paid',
      codAmount: (document.getElementById('bookPaymentMode')?.value === 'COD') ? (parseFloat(document.getElementById('bookCodAmount')?.value) || total) : 0,
    };

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
      const res = await fetch('/api/parcels', { method: 'POST', headers, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) { this.showToast(json.error || 'Booking failed.', 'error'); return; }
      this.showToast('Waybill ' + json.trackingNumber + ' generated!', 'success');
      await this.loadData();
      this.renderAll();
      this.openBiltyModal(json.trackingNumber);
    } catch (err) {
      this.showToast('Network error.', 'error');
    }
  },

  /* ========================================================================
     3. LIVE TRACKING
     ======================================================================== */
  quickTrack(trackingNumber) {
    this.switchView('tracking');
    const input = document.getElementById('trackInputNumber');
    if (input) input.value = trackingNumber;
    this.handleTrackingSearch();
  },

  handleTrackingSearch() {
    const num = document.getElementById('trackInputNumber')?.value.trim();
    if (!num) { this.showToast('Enter a waybill number.', 'info'); return; }
    const parcel = (this.data.parcels || []).find(p => p.trackingNumber.toLowerCase() === num.toLowerCase());
    if (!parcel) { this.showToast('Consignment "' + num + '" not found.', 'error'); return; }

    this.selectedTrackingParcel = parcel;
    const box = document.getElementById('trackingDetailsBox');
    if (box) box.style.display = 'block';
    this.setEl('trackNumberHeading', parcel.trackingNumber);
    this.setEl('trackRouteHeading', (parcel.sender?.city || 'Surat') + ' → ' + (parcel.receiver?.city || 'Destination'));
    const pill = document.getElementById('trackStatusPill');
    if (pill) { pill.className = 'status-pill ' + this.getStatusSlug(parcel.status); pill.textContent = parcel.status; }
    this.setEl('trackServiceTier', parcel.serviceType || 'Express');
    this.setEl('trackBillableWeight', (parcel.package?.billableWeight || parcel.package?.actualWeight || 0) + ' kg');
    this.setEl('trackPaymentSummary', (parcel.payment?.mode || 'Paid') + ' (₹' + (parcel.pricing?.totalAmount || 0) + ')');
    this.setEl('trackPartiesSummary', (parcel.sender?.name || '') + ' → ' + (parcel.receiver?.name || ''));

    const container = document.getElementById('trackingTimelineContainer');
    if (container) {
      container.innerHTML = '';
      const milestones = parcel.milestones || [{ status: 'Booked', location: 'Kadodara Hub', timestamp: parcel.createdAt, notes: 'Consignment docket initialized.' }];
      milestones.forEach((m, idx) => {
        const item = document.createElement('div');
        item.style.position = 'relative';
        item.innerHTML = `
          <div style="position: absolute; left: -26px; top: 0; width: 12px; height: 12px; border-radius: 50%; background: ${idx === milestones.length - 1 ? 'var(--brand-amber)' : '#10b981'}; box-shadow: 0 0 0 3px #fff;"></div>
          <div style="font-weight: 700; font-size: 14px; color: var(--text-main);">${this.escapeHtml(m.status)}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${this.escapeHtml(m.location || 'Hub')} &bull; ${this.formatDate(m.timestamp)}</div>
          ${m.notes ? '<div style="font-size: 12px; color: var(--text-body); margin-top: 2px;">' + this.escapeHtml(m.notes) + '</div>' : ''}`;
        container.appendChild(item);
      });
    }
  },

  /* ========================================================================
     4. CONSIGNMENTS TABLE
     ======================================================================== */
  renderShipmentsTable() {
    const tbody = document.getElementById('shipmentsMasterTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const query = (document.getElementById('shipmentSearchInput')?.value || '').toLowerCase().trim();
    const filter = document.getElementById('shipmentFilterSelect')?.value || this.currentFilter || 'All';
    let list = this.data.parcels || [];
    if (filter !== 'All') {
      list = list.filter(p => {
        if (filter === 'Failed') return ['Delivery Attempt Failed', 'Returned'].includes(p.status);
        return p.status === filter;
      });
    }
    if (query) {
      list = list.filter(p => p.trackingNumber.toLowerCase().includes(query) || (p.sender?.name && p.sender.name.toLowerCase().includes(query)) || (p.receiver?.name && p.receiver.name.toLowerCase().includes(query)) || (p.receiver?.phone && p.receiver.phone.includes(query)));
    }
    if (list.length === 0) { tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 32px;">No consignments matching filter.</td></tr>'; return; }
    list.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="font-mono"><strong>${this.escapeHtml(p.trackingNumber)}</strong></td><td>${this.formatDate(p.createdAt)}</td><td><strong>${this.escapeHtml(p.sender?.name || '')}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${this.escapeHtml(p.sender?.city || '')}</span></td><td><strong>${this.escapeHtml(p.receiver?.name || '')}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${this.escapeHtml(p.receiver?.city || '')}</span></td><td class="font-mono">${p.package?.billableWeight || 0} kg</td><td class="font-mono">₹${p.pricing?.totalAmount || 0}</td><td>${p.payment?.mode || 'Paid'}</td><td>${this.getStatusPill(p.status)}</td><td><div style="display: flex; gap: 6px;"><button class="btn btn-outline btn-sm" onclick="app.openBiltyModal('${p.trackingNumber}')"><span class="material-symbols-outlined" style="font-size: 16px;">receipt</span></button><button class="btn btn-outline btn-sm" onclick="app.quickTrack('${p.trackingNumber}')"><span class="material-symbols-outlined" style="font-size: 16px;">near_me</span></button><button class="btn btn-outline btn-sm" onclick="app.openStatusModal('${p.trackingNumber}')"><span class="material-symbols-outlined" style="font-size: 16px;">edit</span></button></div></td>`;
      tbody.appendChild(tr);
    });
  },

  /* ========================================================================
     5. FLEET
     ======================================================================== */
  renderFleet() {
    const vehicles = this.data.vehicles || [];
    const drivers = this.data.drivers || [];
    this.setEl('fleetVehicleCount', vehicles.length + ' Vehicles');
    this.setEl('fleetDriverCount', drivers.length + ' Drivers');

    const cardsGrid = document.getElementById('fleetCardsGrid');
    if (cardsGrid) {
      cardsGrid.innerHTML = '';
      vehicles.forEach((v, idx) => {
        const util = [85, 72, 94, 68][idx % 4];
        const card = document.createElement('div');
        card.className = 'vehicle-telemetry-card';
        card.innerHTML = `<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;"><div class="plate-badge-container"><span class="ind-badge">IND</span><span>${this.escapeHtml(v.regNumber)}</span></div><span class="status-pill in-transit">${this.escapeHtml(v.status || 'Active')}</span></div><div style="font-weight: 700; font-size: 14px; color: var(--text-main);">${this.escapeHtml(v.type || 'Carrier')}</div><div class="vehicle-capacity-track"><div class="vehicle-capacity-fill" style="width: ${util}%;"></div></div><div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 4px;" class="font-mono"><span>Utilization: ${util}%</span><span>2.5 MT</span></div>`;
        cardsGrid.appendChild(card);
      });
    }

    const vTbody = document.getElementById('fleetVehiclesTableBody');
    if (vTbody) {
      vTbody.innerHTML = '';
      if (vehicles.length === 0) { vTbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 18px;">No vehicles registered.</td></tr>'; }
      vehicles.forEach(v => { const tr = document.createElement('tr'); tr.innerHTML = `<td class="font-mono"><strong>${this.escapeHtml(v.regNumber)}</strong></td><td>${this.escapeHtml(v.type)}</td><td><span class="status-pill in-transit">${this.escapeHtml(v.status || 'Active')}</span></td>`; vTbody.appendChild(tr); });
    }

    const dTbody = document.getElementById('fleetDriversTableBody');
    if (dTbody) {
      dTbody.innerHTML = '';
      if (drivers.length === 0) { dTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 18px;">No drivers added.</td></tr>'; }
      else { drivers.forEach(d => { const tr = document.createElement('tr'); tr.innerHTML = `<td><strong>${this.escapeHtml(d.name)}</strong></td><td class="font-mono">${this.escapeHtml(d.phone)}</td><td class="font-mono">${this.escapeHtml(d.licenseNumber || '-')}</td><td><span class="status-pill delivered">Ready</span></td>`; dTbody.appendChild(tr); }); }
    }
  },

  /* ========================================================================
     6. PROOF OF DELIVERY
     ======================================================================== */
  renderPodView() {
    const select = document.getElementById('podParcelSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Choose Consignment --</option>';
    (this.data.parcels || []).forEach(p => {
      if (p.status !== 'Delivered') {
        const opt = document.createElement('option');
        opt.value = p.trackingNumber;
        opt.textContent = p.trackingNumber + ' (' + (p.receiver?.name || '') + ' - ' + p.status + ')';
        select.appendChild(opt);
      }
    });
  },

  handlePodParcelSelect(trackingNumber) {
    const parcel = (this.data.parcels || []).find(p => p.trackingNumber === trackingNumber);
    const emptyBox = document.getElementById('podDetailsEmpty');
    const activeBox = document.getElementById('podDetailsActive');
    const codPrompt = document.getElementById('podCodPrompt');
    if (!parcel) { if (emptyBox) emptyBox.style.display = 'block'; if (activeBox) activeBox.style.display = 'none'; if (codPrompt) codPrompt.style.display = 'none'; return; }
    if (emptyBox) emptyBox.style.display = 'none';
    if (activeBox) activeBox.style.display = 'flex';
    this.setEl('podDetailWaybill', parcel.trackingNumber);
    this.setEl('podDetailConsignee', parcel.receiver?.name || '');
    this.setEl('podDetailAddress', (parcel.receiver?.address || '') + ', ' + (parcel.receiver?.city || ''));
    this.setEl('podDetailArticles', (parcel.package?.count || 1) + ' Articles');
    this.setEl('podDetailWeight', (parcel.package?.billableWeight || 0) + ' kg');
    this.setEl('podDetailPayment', (parcel.payment?.mode || 'Paid') + ' (₹' + (parcel.pricing?.totalAmount || 0) + ')');
    document.getElementById('podReceiverName').value = parcel.receiver?.name || '';
    if (parcel.payment && parcel.payment.mode === 'COD' && parcel.payment.status !== 'Collected') {
      if (codPrompt) { codPrompt.style.display = 'block'; this.setEl('podCodAmountText', '₹' + (parcel.pricing?.totalAmount || 0)); }
    } else { if (codPrompt) codPrompt.style.display = 'none'; }
  },

  initCanvas() {
    const canvas = document.getElementById('podCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth || 500;
    canvas.height = canvas.offsetHeight || 160;
    let drawing = false;
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    const getPos = (e) => { const rect = canvas.getBoundingClientRect(); return { x: (e.clientX || e.touches?.[0]?.clientX || 0) - rect.left, y: (e.clientY || e.touches?.[0]?.clientY || 0) - rect.top }; };
    const startDraw = (e) => { drawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); };
    const draw = (e) => { if (!drawing) return; e.preventDefault(); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const stopDraw = () => { drawing = false; };
    canvas.addEventListener('mousedown', startDraw); canvas.addEventListener('mousemove', draw); window.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false }); canvas.addEventListener('touchmove', draw, { passive: false }); window.addEventListener('touchend', stopDraw);
  },

  clearPodCanvas() {
    const canvas = document.getElementById('podCanvas');
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  },

  async handlePodSubmit(e) {
    e.preventDefault();
    const waybill = document.getElementById('podParcelSelect')?.value;
    if (!waybill) { this.showToast('Select a consignment.', 'error'); return; }
    const canvas = document.getElementById('podCanvas');
    const payload = { receiverName: this.getVal('podReceiverName'), relationship: document.getElementById('podRelationship')?.value || 'Self', remarks: this.getVal('podRemarks') || 'Delivered in verified condition.', signatureData: canvas ? canvas.toDataURL() : 'digital-signature' };
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
      const res = await fetch('/api/parcels/' + waybill + '/pod', { method: 'POST', headers, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) { this.showToast(json.error || 'POD failed.', 'error'); return; }
      this.showToast(waybill + ' marked as Delivered!', 'success');
      this.clearPodCanvas();
      await this.loadData(); this.renderAll(); this.switchView('dashboard');
    } catch (err) { this.showToast('Network error.', 'error'); }
  },

  /* ========================================================================
     7. BILLING
     ======================================================================== */
  renderBilling() {
    const parcels = this.data.parcels || [];
    let totalRev = 0, pendingCod = 0, collectedCod = 0;
    parcels.forEach(p => {
      const fare = p.pricing?.totalAmount || 0;
      totalRev += fare;
      if (p.payment?.mode === 'COD') {
        if (p.payment.status === 'Collected' || p.status === 'Delivered') collectedCod += fare;
        else pendingCod += fare;
      }
    });
    this.setEl('billingTotalRev', '₹' + totalRev.toLocaleString('en-IN'));
    this.setEl('billingPendingCod', '₹' + pendingCod.toLocaleString('en-IN'));
    this.setEl('billingCollectedCod', '₹' + collectedCod.toLocaleString('en-IN'));
    const tbody = document.getElementById('billingTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (parcels.length === 0) { tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">No invoices.</td></tr>'; return; }
    parcels.forEach(p => {
      const isSettled = p.payment?.status === 'Collected' || p.payment?.mode === 'Paid' || p.status === 'Delivered';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="font-mono"><strong>${this.escapeHtml(p.trackingNumber)}</strong></td><td><strong>${this.escapeHtml(p.sender?.name || '')}</strong></td><td>${this.formatDate(p.createdAt)}</td><td class="font-mono">${p.package?.billableWeight || 0} kg</td><td class="font-mono">₹${p.pricing?.totalAmount || 0}</td><td>${p.payment?.mode || 'Paid'}</td><td>${isSettled ? '<span class="status-pill delivered">Settled</span>' : '<span class="status-pill booked">Pending</span>'}</td><td><button class="btn btn-outline btn-sm" onclick="app.openBiltyModal('${p.trackingNumber}')">View</button></td>`;
      tbody.appendChild(tr);
    });
  },

  /* ========================================================================
     8. CUSTOMERS
     ======================================================================== */
  renderCustomers() {
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const map = {};
    (this.data.parcels || []).forEach(p => {
      if (p.sender?.name) {
        if (!map[p.sender.name]) map[p.sender.name] = { name: p.sender.name, phone: p.sender.phone || '-', gstin: p.sender.gstin || '-', city: p.sender.city || 'Surat', address: p.sender.address || '-', count: 0 };
        map[p.sender.name].count++;
      }
    });
    const list = Object.values(map);
    if (list.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No customers yet.</td></tr>'; return; }
    list.forEach(c => { const tr = document.createElement('tr'); tr.innerHTML = `<td><strong>${this.escapeHtml(c.name)}</strong></td><td class="font-mono">${this.escapeHtml(c.phone)}</td><td class="font-mono">${this.escapeHtml(c.gstin)}</td><td>${this.escapeHtml(c.city)}</td><td>${this.escapeHtml(c.address)}</td><td class="font-mono"><strong>${c.count}</strong></td>`; tbody.appendChild(tr); });
  },

  /* ========================================================================
     9. HISTORY
     ======================================================================== */
  renderHistory() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const list = [];
    (this.data.parcels || []).forEach(p => {
      if (p.milestones) { p.milestones.forEach(m => { list.push({ ...m, trackingNumber: p.trackingNumber }); }); }
      else { list.push({ trackingNumber: p.trackingNumber, status: p.status, location: 'Kadodara Hub', timestamp: p.createdAt, operator: 'System', notes: 'Booking created.' }); }
    });
    list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (list.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No audit entries.</td></tr>'; return; }
    list.slice(0, 20).forEach(item => { const tr = document.createElement('tr'); tr.innerHTML = `<td class="font-mono" style="font-size: 12px;">${this.formatDate(item.timestamp)}</td><td class="font-mono"><strong>${this.escapeHtml(item.trackingNumber)}</strong></td><td>${this.getStatusPill(item.status)}</td><td>${this.escapeHtml(item.location || 'Hub')}</td><td>${this.escapeHtml(item.operator || 'System')}</td><td>${this.escapeHtml(item.notes || '-')}</td>`; tbody.appendChild(tr); });
  },

  /* ========================================================================
     MODALS
     ======================================================================== */
  closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); },

  openStatusModal(trackingNumber) {
    if (!trackingNumber && this.selectedTrackingParcel) trackingNumber = this.selectedTrackingParcel.trackingNumber;
    if (!trackingNumber) { this.showToast('Select a consignment.', 'info'); return; }
    document.getElementById('statusModalParcelId').value = trackingNumber;
    document.getElementById('statusModal').classList.add('active');
  },

  async handleStatusUpdateSubmit(e) {
    e.preventDefault();
    const id = this.getVal('statusModalParcelId');
    const status = document.getElementById('statusModalNewStatus').value;
    const location = this.getVal('statusModalLocation');
    const notes = this.getVal('statusModalNotes');
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
      const res = await fetch('/api/parcels/' + id + '/status', { method: 'POST', headers, body: JSON.stringify({ status, location, notes }) });
      const json = await res.json();
      if (!res.ok) { this.showToast(json.error || 'Update failed.', 'error'); return; }
      this.showToast(id + ' → ' + status, 'success');
      this.closeModal('statusModal');
      await this.loadData(); this.renderAll();
      if (this.currentView === 'tracking') this.handleTrackingSearch();
    } catch (err) { this.showToast('Network error.', 'error'); }
  },

  openAddVehicleModal() { document.getElementById('addVehicleModal')?.classList.add('active'); },
  openAddDriverModal() { document.getElementById('addDriverModal')?.classList.add('active'); },

  async handleAddVehicleSubmit(e) {
    e.preventDefault();
    const regNumber = this.getVal('newVehReg').toUpperCase();
    const type = document.getElementById('newVehType').value;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
      const res = await fetch('/api/fleet/vehicles', { method: 'POST', headers, body: JSON.stringify({ regNumber, type }) });
      const json = await res.json();
      if (!res.ok) { this.showToast(json.error || 'Failed.', 'error'); return; }
      this.showToast('Vehicle ' + regNumber + ' added!', 'success');
      this.closeModal('addVehicleModal');
      document.getElementById('newVehReg').value = '';
      await this.loadData(); this.renderFleet();
    } catch (err) { this.showToast('Network error.', 'error'); }
  },

  async handleAddDriverSubmit(e) {
    e.preventDefault();
    const name = this.getVal('newDrvName');
    const phone = this.getVal('newDrvPhone');
    const licenseNumber = this.getVal('newDrvLicense');
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
      const res = await fetch('/api/fleet/drivers', { method: 'POST', headers, body: JSON.stringify({ name, phone, licenseNumber }) });
      const json = await res.json();
      if (!res.ok) { this.showToast(json.error || 'Failed.', 'error'); return; }
      this.showToast('Driver ' + name + ' added!', 'success');
      this.closeModal('addDriverModal');
      ['newDrvName', 'newDrvPhone', 'newDrvLicense'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      await this.loadData(); this.renderFleet();
    } catch (err) { this.showToast('Network error.', 'error'); }
  },

  openBiltyModal(trackingNumber) {
    const parcel = (this.data.parcels || []).find(p => p.trackingNumber === trackingNumber);
    if (!parcel) return;
    const container = document.getElementById('biltyPrintContainer');
    if (!container) return;
    container.innerHTML = `
      <div style="border: 2px solid #0f172a; padding: 20px; font-family: var(--font-sans);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 14px;">
          <div>
            <h2 style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 0;">DEEPAK TEMPO SERVICE</h2>
            <div style="font-size: 11px; font-weight: 700; color: #f97316; letter-spacing: 0.05em;">FLEET OWNERS &amp; TRANSPORT CONTRACTORS</div>
            <div style="font-size: 11px; color: #475569; margin-top: 3px;">Abhinandan Nagar, Chalthan, Kadodara, Dist. Surat - 394305</div>
            <div style="font-size: 11px; font-weight: 700;">GSTIN: 24COZPS7273E2Z5 | Mob: 98246 21221 / 70961 47585</div>
          </div>
          <div style="text-align: right;">
            <div style="background: #0f172a; color: #fff; padding: 4px 10px; font-weight: 800; font-size: 12px; border-radius: 4px;">CONSIGNMENT DOCKET</div>
            <div class="font-mono" style="font-size: 18px; font-weight: 800; margin-top: 6px;">${parcel.trackingNumber}</div>
            <div style="font-size: 11px; color: #475569;">Date: ${this.formatDate(parcel.createdAt)}</div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 14px; margin-bottom: 14px; font-size: 12px;">
          <div style="background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
            <strong style="display: block; margin-bottom: 4px; text-transform: uppercase;">Consignor (Sender)</strong>
            <div><strong>${this.escapeHtml(parcel.sender?.name || '')}</strong></div>
            <div>Phone: ${this.escapeHtml(parcel.sender?.phone || '-')}</div>
            <div>Address: ${this.escapeHtml(parcel.sender?.address || '')}, ${this.escapeHtml(parcel.sender?.city || '')}</div>
          </div>
          <div style="background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
            <strong style="display: block; margin-bottom: 4px; text-transform: uppercase;">Consignee (Receiver)</strong>
            <div><strong>${this.escapeHtml(parcel.receiver?.name || '')}</strong></div>
            <div>Phone: ${this.escapeHtml(parcel.receiver?.phone || '-')}</div>
            <div>Address: ${this.escapeHtml(parcel.receiver?.address || '')}, ${this.escapeHtml(parcel.receiver?.city || '')}</div>
          </div>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;">
          <thead><tr style="background: #f1f5f9; border: 1px solid #cbd5e1;"><th style="padding: 6px 8px; text-align: left;">Articles</th><th style="padding: 6px 8px; text-align: left;">Description</th><th style="padding: 6px 8px; text-align: right;">Weight</th><th style="padding: 6px 8px; text-align: right;">Billable</th><th style="padding: 6px 8px; text-align: right;">Payment</th><th style="padding: 6px 8px; text-align: right;">Freight</th></tr></thead>
          <tbody><tr><td style="padding: 8px;" class="font-mono">${parcel.package?.count || 1}</td><td style="padding: 8px;">${this.escapeHtml(parcel.package?.description || 'Freight')}</td><td style="padding: 8px; text-align: right;" class="font-mono">${parcel.package?.actualWeight || 0} kg</td><td style="padding: 8px; text-align: right;" class="font-mono">${parcel.package?.billableWeight || 0} kg</td><td style="padding: 8px; text-align: right; font-weight: 700;">${parcel.payment?.mode || 'Paid'}</td><td style="padding: 8px; text-align: right; font-weight: 800; font-size: 14px;" class="font-mono">₹${parcel.pricing?.totalAmount || 0}</td></tr></tbody>
        </table>
        <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 16px; border-top: 1px dashed #94a3b8; font-size: 11px;">
          <div>Carried under terms & conditions of Deepak Tempo Service.</div>
          <div style="text-align: center;"><div style="width: 140px; border-bottom: 1px solid #0f172a; margin-bottom: 4px;"></div><strong>Authorised Signature</strong></div>
        </div>
      </div>`;
    document.getElementById('biltyModal')?.classList.add('active');
  },

  /* ========================================================================
     HELPERS
     ======================================================================== */
  initGlobalSearch() {
    const input = document.getElementById('globalTrackingSearch');
    const dropdown = document.getElementById('globalSearchResults');
    if (!input || !dropdown) return;
    input.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q || q.length < 2) { dropdown.style.display = 'none'; return; }
      const matched = (this.data.parcels || []).filter(p => p.trackingNumber.toLowerCase().includes(q) || (p.sender?.name && p.sender.name.toLowerCase().includes(q)) || (p.receiver?.name && p.receiver.name.toLowerCase().includes(q))).slice(0, 5);
      if (matched.length === 0) { dropdown.innerHTML = '<div style="padding: 14px; text-align: center; font-size: 12px; color: var(--text-muted);">No results</div>'; }
      else { dropdown.innerHTML = matched.map(p => `<div onclick="app.quickTrack('${p.trackingNumber}'); document.getElementById('globalSearchResults').style.display='none';" style="padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); cursor: pointer;" onmouseover="this.style.background='var(--bg-low)'" onmouseout="this.style.background='transparent'"><strong class="font-mono">${this.escapeHtml(p.trackingNumber)}</strong><div style="font-size: 11px; color: var(--text-muted);">${this.escapeHtml(p.sender?.name || '')} → ${this.escapeHtml(p.receiver?.name || '')}</div></div>`).join(''); }
      dropdown.style.display = 'block';
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.global-search-container')) dropdown.style.display = 'none'; });
  },

  async refreshAll() {
    await this.loadData(); this.renderAll();
    this.showToast('Data refreshed.', 'success');
  },

  getStatusSlug(status) {
    if (!status) return 'booked';
    const s = status.toLowerCase();
    if (s.includes('transit') || s.includes('origin hub') || s.includes('destination hub')) return 'in-transit';
    if (s.includes('out for delivery')) return 'out-for-delivery';
    if (s.includes('delivered')) return 'delivered';
    if (s.includes('fail') || s.includes('returned')) return 'failed';
    return 'booked';
  },

  getStatusPill(status) {
    const slug = this.getStatusSlug(status);
    let dot = '';
    if (slug === 'in-transit') dot = '<span class="live-pulse-dot" style="width: 5px; height: 5px; background: #4338ca;"></span> ';
    return '<span class="status-pill ' + slug + '">' + dot + this.escapeHtml(status || 'Booked') + '</span>';
  },

  formatDate(iso) {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return String(iso); }
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = '<span>' + this.escapeHtml(message) + '</span>';
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(10px)'; toast.style.transition = 'all 0.3s ease'; setTimeout(() => toast.remove(), 300); }, 3500);
  },

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; },
  setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; },
  getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
