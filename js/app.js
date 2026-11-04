/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Main Frontend Application Controller & Router
 * Implements all 20 views, cascading dropdowns, KPI computations,
 * interactive charts, offline maps, and QR code scanner.
 */

// Must match APP_VERSION in Code.gs. Land owner edits are refused by the server when they differ.
const FRONTEND_VERSION = '3.9.0';

class FarmOpsApp {
  constructor() {
    this.currentView = 'dashboard';
    this.activeLandowner = '';
    this.activeParcel = '';
    this.activeBlock = '';
    this.gpsCoordinates = null;
    this.qrTargetInputId = null;
    this.qrStream = null;
  }

  async init() {
    console.log('[App] Initializing Farm Operations System...');

    // Wide tables scroll inside their own box instead of stretching the whole page (phones)
    if (!document.getElementById('farmops-layout-fix')) {
      document.head.insertAdjacentHTML('beforeend',
        '<style id="farmops-layout-fix">#main-content, #view-content-root { min-width: 0; }' +
        '@media (max-width: 540px) { .top-bar-left { min-width: 0; } .top-bar-right { gap: 6px; }' +
        ' #page-title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
        ' #quick-sync-btn span, #gps-status-pill span { display: none; } }</style>');
    }

    // 1. Initialize IndexedDB
    await db.init();

    // 2. Initialize Authentication & Session
    const user = await auth.initSession();

    // 3. Initialize Synchronization & Device Telemetry
    await syncService.init();

    // Listen for sync status updates
    syncService.onStatusChange((status) => {
      this.updateSyncBadgeUI(status);
    });

    // 4. Start live GPS tracking (passive watch)
    this.initGpsTracking();

    // 5. Route to appropriate view
    if (user) {
      this.showAppLayout();
      await this.navigateTo('dashboard');
      this.checkMapVersionNotification();
      if (navigator.onLine) {
        syncService.syncPendingRecords().finally(() => this.backgroundRefresh());
      }
    } else {
      this.showLoginView();
    }

    console.log('[App] System ready.');
  }

  /* ==========================================================================
     SHARED HELPERS (v3)
     ========================================================================== */

  /** Escape text before putting it inside innerHTML (prevents script injection). */
  esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Which report value counts toward a KPI (same rule as the server).
   * Returns null when the report does not belong to the KPI.
   */
  kpiValueForReport(kpi, r) {
    const n = (v) => String(v == null ? '' : v).trim().toLowerCase();
    const t = n(kpi.activityType);
    const a = r.activityType;
    if (n(kpi.landOwner) && n(r.landOwnersName) !== n(kpi.landOwner)) return null;
    if (n(kpi.parcelNumber) && n(r.parcelNumber) !== n(kpi.parcelNumber)) return null;
    if (n(kpi.farmBlock) && n(r.farmBlock) !== n(kpi.farmBlock)) return null;
    if (n(kpi.cycle) && r.cycle && n(r.cycle) !== n(kpi.cycle)) return null;

    if (r.customActivityId) {
      if (n(r.activityType) !== t || r.kpiValue === undefined) return null;
      const cv = parseFloat(r.kpiValue);
      return isNaN(cv) || cv === 0 ? null : cv;
    }

    let v = null;
    if (t.includes('slashing')) v = a === 'Regular Activity' ? r.weedingSlashingHa : null;
    else if (t.includes('round weeding')) v = a === 'Regular Activity' ? r.roundWeedingPalms : null;
    else if (t.includes('compost')) v = a === 'Regular Activity' ? r.compostPalms : null;
    else if (t.includes('pruning')) v = a === 'Regular Activity' ? r.pruningPalms : null;
    else if (t.includes('soil drench')) v = a === 'Regular Activity' ? r.soilDrenchingPalms : null;
    else if (t.includes('seednut')) v = a === 'Seednut Collection' ? r.nutCountCollected : null;
    else if (t.includes('pest') || t.includes('disease')) v = a === 'Pest and Disease Activity' ? r.totalPalmsAffected : null;
    else if (a === 'Other Farm Activity' && n(r.otherActivities) === t) v = r.quantity;
    else if (a === 'Irregular Activity' && n(r.irregularActivity) === t) v = r.countOfPalms2;

    if (v === null || v === undefined) return null;
    const num = parseFloat(v);
    return isNaN(num) || num === 0 ? null : num;
  }

  /** Called by syncService when the server says the session is no longer valid. */
  async handleSessionExpired(message) {
    if (this._sessionExpiredShown) return;
    this._sessionExpiredShown = true;
    this.showToast((message || 'Your session expired.') + ' Your offline reports are safe.', 'warning');
    await auth.logout();
    this.showLoginView();
    setTimeout(() => { this._sessionExpiredShown = false; }, 3000);
  }

  /** Pull farm data + reports after sign-in without blocking the UI. */
  async backgroundRefresh() {
    if (!navigator.onLine || !auth.getToken() || auth.getCurrentUser().isOfflineSession) return;
    const result = await syncService.refreshFromServer();
    if (result.success) {
      this.renderUserMetaHeader();
      if (['dashboard', 'daily-monitoring', 'reports', 'profile', 'farm-map'].includes(this.currentView)) {
        this.navigateTo(this.currentView);
      }
      this.checkMapVersionNotification();
    }
  }

  /**
   * Run an admin/supervisor action on the server, then refresh master data and the view.
   */
  async runServerAction(action, data, successMessage, viewToRefresh) {
    try {
      const result = await syncService.apiCall(action, data);
      try { await syncService.pullMasterData(); } catch (e) { console.warn(e); }
      this.showToast(result.message || successMessage, 'success');
      if (viewToRefresh) this.navigateTo(viewToRefresh);
      return result;
    } catch (err) {
      this.showToast(err.message, 'error');
      return null;
    }
  }

  openChangePasswordModal(forced = false) {
    const modalTitle = document.getElementById('form-modal-title');
    const modalBody = document.getElementById('form-modal-body');
    const submitBtn = document.getElementById('form-modal-submit-btn');

    modalTitle.textContent = forced ? '🔒 Please change your password' : 'Change Password';
    modalBody.innerHTML = `
      ${forced ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius-md);padding:12px;margin-bottom:14px;color:#92400e;font-size:13px;font-weight:600;">
        You are using a temporary or default password. Set your own password to continue.
      </div>` : ''}
      <div class="form-group">
        <label class="form-label required">Current Password</label>
        <input type="password" id="cp-current" class="form-control" autocomplete="current-password" />
      </div>
      <div class="form-group">
        <label class="form-label required">New Password (min. 8 characters)</label>
        <input type="password" id="cp-new" class="form-control" autocomplete="new-password" />
      </div>
      <div class="form-group">
        <label class="form-label required">Confirm New Password</label>
        <input type="password" id="cp-confirm" class="form-control" autocomplete="new-password" />
      </div>
    `;

    submitBtn.textContent = 'Change Password';
    submitBtn.onclick = async () => {
      const cur = document.getElementById('cp-current').value;
      const nw = document.getElementById('cp-new').value;
      const cf = document.getElementById('cp-confirm').value;
      if (nw !== cf) { this.showToast('New passwords do not match.', 'warning'); return; }
      submitBtn.disabled = true;
      try {
        await auth.changePassword(cur, nw);
        this.closeModal('form-modal');
        this.showToast('Password changed successfully.', 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save';
      }
    };

    this.openModal('form-modal');
  }

  /* ==========================================================================
     GPS & GEOLOCATION SERVICE
     ========================================================================== */

  initGpsTracking() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.gpsCoordinates = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          this.updateGpsPillUI(true);
        },
        (err) => {
          console.warn('[GPS] Geolocation standby or permission denied:', err.message);
          this.updateGpsPillUI(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }
  }

  updateGpsPillUI(active) {
    const pill = document.getElementById('gps-status-pill');
    const label = document.getElementById('gps-status-label');
    if (!pill || !label) return;

    if (active && this.gpsCoordinates) {
      pill.classList.add('gps-active');
      label.textContent = `GPS: ±${Math.round(this.gpsCoordinates.accuracy)}m`;
      pill.title = `Lat: ${this.gpsCoordinates.latitude.toFixed(5)}, Lng: ${this.gpsCoordinates.longitude.toFixed(5)}`;
    } else {
      pill.classList.remove('gps-active');
      label.textContent = 'GPS: Standby';
      pill.title = 'GPS ready / Standby';
    }
  }

  async captureCurrentGps() {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.gpsCoordinates = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          this.updateGpsPillUI(true);
          resolve(this.gpsCoordinates);
        },
        (err) => {
          console.warn('[GPS] Capture error:', err.message);
          resolve(this.gpsCoordinates); // Fallback to last known position
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
      );
    });
  }

  /* ==========================================================================
     LAYOUT & AUTH STATE MANAGEMENT
     ========================================================================== */

  showLoginView() {
    document.getElementById('app-layout').style.display = 'none';
    const loginWrapper = document.getElementById('login-view-wrapper');
    loginWrapper.style.display = 'flex';
    this.renderLoginView();
  }

  showAppLayout() {
    document.getElementById('login-view-wrapper').style.display = 'none';
    const appLayout = document.getElementById('app-layout');
    appLayout.style.display = 'flex';
    this.renderNavLinks();
    this.renderUserMetaHeader();
    this.updateSyncBadgeUI(syncService.getStatus());
  }

  renderUserMetaHeader() {
    const user = auth.getCurrentUser();
    if (!user) return;
    const nameEl = document.getElementById('user-display-name');
    const roleEl = document.getElementById('user-display-role');
    const avatarEl = document.getElementById('user-display-avatar');

    if (nameEl) nameEl.textContent = user.fullName || user.username;
    if (roleEl) roleEl.textContent = user.role;
    if (avatarEl) avatarEl.textContent = (user.fullName || user.username).charAt(0).toUpperCase();
  }

  updateSyncBadgeUI(status) {
    const badge = document.getElementById('network-status-badge');
    const text = document.getElementById('sync-status-text');
    if (!badge || !text) return;

    badge.className = 'status-pill';

    if (status === 'ONLINE' || status === 'SYNCED') {
      badge.classList.add('status-online');
      text.textContent = 'Online';
    } else if (status === 'OFFLINE') {
      badge.classList.add('status-offline');
      text.textContent = 'Offline';
    } else if (status === 'PENDING SYNC') {
      badge.classList.add('status-pending');
      text.textContent = 'Pending Sync';
    } else if (status === 'SYNCING') {
      badge.classList.add('status-syncing');
      text.textContent = 'Syncing...';
    } else if (status === 'SYNC ERROR') {
      badge.classList.add('status-offline');
      text.textContent = 'Sync Error';
    }
  }

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('open');
  }

  closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
  }

  /* ==========================================================================
     ANIMATED COCONUT PALM TREE SVG COMPONENT
     ========================================================================== */

  renderAnimatedPalmTreeSVG(height = 200, width = 240) {
    return `
      <div class="palm-scene-container" style="height: ${height}px; width: ${width}px;">
        <div class="particle-field">
          <div class="particle"></div>
          <div class="particle"></div>
          <div class="particle"></div>
          <div class="particle"></div>
        </div>
        <svg viewBox="0 0 460 380" width="100%" height="100%" style="overflow: visible;">
          <defs>
            <linearGradient id="palmTrunkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#451a03" />
              <stop offset="50%" stop-color="#78350f" />
              <stop offset="100%" stop-color="#92400e" />
            </linearGradient>
            <linearGradient id="frondGradLeft" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#4ade80" />
              <stop offset="100%" stop-color="#15803d" />
            </linearGradient>
            <linearGradient id="frondGradRight" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#86efac" />
              <stop offset="100%" stop-color="#166534" />
            </linearGradient>
            <linearGradient id="youngNutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#84cc16" />
              <stop offset="100%" stop-color="#3f6212" />
            </linearGradient>
            <linearGradient id="matureNutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#b45309" />
              <stop offset="100%" stop-color="#78350f" />
            </linearGradient>
          </defs>

          <!-- Tropical Landscape Mound -->
          <ellipse cx="230" cy="355" rx="140" ry="18" fill="#14532d" opacity="0.35" />

          <!-- Palm Tree Trunk (Swaying with wind) -->
          <g class="palm-sway-trunk">
            <path d="M 215 355 Q 225 260 215 190 Q 210 165 228 150 Q 242 165 238 190 Q 248 260 245 355 Z" fill="url(#palmTrunkGrad)" />
            <!-- Trunk Bark Texture -->
            <path d="M 219 320 Q 230 315 241 320" stroke="#b45309" stroke-width="3" fill="none" opacity="0.8" />
            <path d="M 217 280 Q 228 275 239 280" stroke="#b45309" stroke-width="3" fill="none" opacity="0.8" />
            <path d="M 216 240 Q 226 235 236 240" stroke="#b45309" stroke-width="2.5" fill="none" opacity="0.8" />
            <path d="M 216 200 Q 224 195 234 200" stroke="#b45309" stroke-width="2.5" fill="none" opacity="0.8" />
          </g>

          <!-- Palm Leaves / Fronds (Animated Wind Effect) -->
          <!-- Left Fronds -->
          <g class="palm-frond-left-1">
            <path d="M 228 150 C 180 130 110 145 60 210 C 105 185 170 170 228 150 Z" fill="url(#frondGradLeft)" />
            <path d="M 228 150 C 170 95 100 85 50 130 C 95 115 160 125 228 150 Z" fill="url(#frondGradRight)" />
          </g>

          <g class="palm-frond-left-2">
            <path d="M 228 150 C 190 70 130 45 70 70 C 115 75 170 100 228 150 Z" fill="url(#frondGradLeft)" />
            <path d="M 228 150 C 210 50 230 20 255 30 C 250 70 240 110 228 150 Z" fill="url(#frondGradRight)" />
          </g>

          <!-- Right Fronds -->
          <g class="palm-frond-right-1">
            <path d="M 228 150 C 275 60 335 50 380 80 C 335 95 285 115 228 150 Z" fill="url(#frondGradLeft)" />
            <path d="M 228 150 C 305 100 370 120 415 170 C 365 155 295 145 228 150 Z" fill="url(#frondGradRight)" />
          </g>

          <g class="palm-frond-right-2">
            <path d="M 228 150 C 295 145 365 185 390 250 C 350 210 280 180 228 150 Z" fill="url(#frondGradLeft)" />
          </g>

          <!-- Coconut Cluster (Healthy green & mature brown) -->
          <g class="palm-coconuts-cluster">
            <circle cx="218" cy="162" r="14" fill="url(#youngNutGrad)" />
            <circle cx="238" cy="158" r="15" fill="url(#youngNutGrad)" />
            <circle cx="224" cy="172" r="13" fill="url(#matureNutGrad)" />
            <circle cx="242" cy="173" r="12" fill="url(#matureNutGrad)" />
          </g>
        </svg>
      </div>
    `;
  }

  /* ==========================================================================
     NAVIGATION & ROUTING (20 PAGES)
     ========================================================================== */

  renderNavLinks() {
    const user = auth.getCurrentUser();
    if (!user) return;
    const role = user.role;

    const sidebarNav = document.getElementById('sidebar-nav-links');
    const bottomNav = document.getElementById('bottom-nav-links');

    // Sidebar items
    let linksHtml = `
      <div class="nav-section-title">Core Operations</div>
      <div class="nav-link ${this.currentView === 'dashboard' ? 'active' : ''}" onclick="app.navigateTo('dashboard')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>Main Dashboard</span>
      </div>
      <div class="nav-link ${this.currentView === 'activity-selection' ? 'active' : ''}" onclick="app.navigateTo('activity-selection')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        <span>Register Activity</span>
      </div>
      <div class="nav-link ${this.currentView === 'daily-monitoring' ? 'active' : ''}" onclick="app.navigateTo('daily-monitoring')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span>Daily Monitoring</span>
      </div>
      <div class="nav-link ${this.currentView === 'cycle-monitoring' ? 'active' : ''}" onclick="app.navigateTo('cycle-monitoring')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 15l2 2 4-4"/></svg>
        <span>Cycle Monitoring</span>
      </div>
      <div class="nav-link ${this.currentView === 'manpower-monitoring' ? 'active' : ''}" onclick="app.navigateTo('manpower-monitoring')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <span>Manpower Monitoring</span>
      </div>
      <div class="nav-link ${this.currentView === 'farm-map' ? 'active' : ''}" onclick="app.navigateTo('farm-map')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
        <span>Farm Maps (Offline)</span>
      </div>
      <div class="nav-link ${this.currentView === 'reports' ? 'active' : ''}" onclick="app.navigateTo('reports')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>Reporting & Export</span>
      </div>
    `;

    // Admin & Supervisor Management Links
    if (role === 'Administrator' || role === 'Supervisor') {
      linksHtml += `
        <div class="nav-section-title">KPI & Configuration</div>
        <div class="nav-link ${this.currentView === 'kpi-registration' ? 'active' : ''}" onclick="app.navigateTo('kpi-registration')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>
          <span>KPI Management</span>
        </div>
      `;
    }

    if (role === 'Administrator') {
      linksHtml += `
        <div class="nav-link ${this.currentView === 'dropdown-management' ? 'active' : ''}" onclick="app.navigateTo('dropdown-management')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          <span>Dropdown Options</span>
        </div>
        <div class="nav-link ${this.currentView === 'landowner-enrollment' ? 'active' : ''}" onclick="app.navigateTo('landowner-enrollment')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Land Owner Enrollment</span>
        </div>
        <div class="nav-link ${this.currentView === 'user-management' ? 'active' : ''}" onclick="app.navigateTo('user-management')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
          <span>User Management</span>
        </div>
        <div class="nav-link ${this.currentView === 'device-management' ? 'active' : ''}" onclick="app.navigateTo('device-management')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          <span>Device Registry</span>
        </div>
      `;
    }

    linksHtml += `
      <div class="nav-section-title">System</div>
      <div class="nav-link ${this.currentView === 'sync' ? 'active' : ''}" onclick="app.navigateTo('sync')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        <span>Sync Center</span>
      </div>
      <div class="nav-link ${this.currentView === 'settings' ? 'active' : ''}" onclick="app.navigateTo('settings')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>Settings</span>
      </div>
      <div class="nav-link ${this.currentView === 'profile' ? 'active' : ''}" onclick="app.navigateTo('profile')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span>My Profile</span>
      </div>
    `;

    sidebarNav.innerHTML = linksHtml;

    // Mobile Bottom Nav items (Most critical 5 tabs)
    bottomNav.innerHTML = `
      <div class="bottom-nav-item ${this.currentView === 'dashboard' ? 'active' : ''}" onclick="app.navigateTo('dashboard')">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>Home</span>
      </div>
      <div class="bottom-nav-item ${this.currentView === 'activity-selection' || this.isActivityForm(this.currentView) ? 'active' : ''}" onclick="app.navigateTo('activity-selection')">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Activities</span>
      </div>
      <div class="bottom-nav-item ${this.currentView === 'daily-monitoring' ? 'active' : ''}" onclick="app.navigateTo('daily-monitoring')">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span>Monitor</span>
      </div>
      <div class="bottom-nav-item ${this.currentView === 'farm-map' ? 'active' : ''}" onclick="app.navigateTo('farm-map')">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/></svg>
        <span>Map</span>
      </div>
      <div class="bottom-nav-item ${this.currentView === 'sync' ? 'active' : ''}" onclick="app.navigateTo('sync')">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg>
        <span>Sync</span>
      </div>
    `;
  }

  isActivityForm(view) {
    return [
      'regular-activity',
      'irregular-activity',
      'other-farm-activity',
      'palm-category',
      'seednut-collection',
      'pest-disease'
    ].includes(view) || String(view).startsWith('custom-activity:');
  }

  async navigateTo(viewName) {
    // Role guards (the server enforces these too)
    const adminOnly = ['user-management', 'dropdown-management', 'device-management', 'landowner-enrollment'];
    if (adminOnly.includes(viewName) && !auth.isAdmin()) viewName = 'dashboard';
    if (viewName === 'kpi-registration' && !auth.isSupervisorOrAdmin()) viewName = 'dashboard';
    const activityViews = {
      'regular-activity': 'Regular Activity', 'irregular-activity': 'Irregular Activity',
      'other-farm-activity': 'Other Farm Activity', 'palm-category': 'Palm Category Activity',
      'seednut-collection': 'Seednut Collection', 'pest-disease': 'Pest and Disease Activity'
    };
    let customActivityId = null;
    if (String(viewName).startsWith('custom-activity:')) {
      customActivityId = viewName.split(':')[1];
      const def = (await this.getCustomActivities()).find((d) => d.id === customActivityId);
      if (!def || !auth.canAccessActivity(def.name)) {
        this.showToast('This activity is not available to you.', 'warning');
        viewName = 'activity-selection';
        customActivityId = null;
      }
    }
    if (activityViews[viewName] && !auth.canAccessActivity(activityViews[viewName])) {
      this.showToast('You are not assigned to ' + activityViews[viewName] + '.', 'warning');
      viewName = 'activity-selection';
    }

    const cu = auth.getCurrentUser();
    if (cu && cu.mustChangePassword && !cu.isOfflineSession && navigator.onLine &&
        !document.getElementById('form-modal').classList.contains('active')) {
      setTimeout(() => this.openChangePasswordModal(true), 300);
    }

    this.currentView = viewName;
    this.closeSidebar();
    this.renderNavLinks();

    const titleEl = document.getElementById('page-title-text');
    const container = document.getElementById('view-content-root');

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    switch (viewName) {
      case 'dashboard':
        if (titleEl) titleEl.textContent = 'Farm Operations Dashboard';
        await this.renderDashboardView(container);
        break;

      case 'activity-selection':
        if (titleEl) titleEl.textContent = 'Activity Registration Hub';
        await this.renderActivitySelectionView(container);
        break;

      case 'regular-activity':
        if (titleEl) titleEl.textContent = 'Regular Activity Registration';
        await this.renderRegularActivityForm(container);
        break;

      case 'irregular-activity':
        if (titleEl) titleEl.textContent = 'Irregular Activity Registration';
        await this.renderIrregularActivityForm(container);
        break;

      case 'other-farm-activity':
        if (titleEl) titleEl.textContent = 'Other Farm Activity Registration';
        await this.renderOtherFarmActivityForm(container);
        break;

      case 'palm-category':
        if (titleEl) titleEl.textContent = 'Palm Category Activity';
        await this.renderPalmCategoryForm(container);
        break;

      case 'seednut-collection':
        if (titleEl) titleEl.textContent = 'Seednut Collection Registration';
        await this.renderSeednutCollectionForm(container);
        break;

      case 'pest-disease':
        if (titleEl) titleEl.textContent = 'Pest and Disease Treatment';
        await this.renderPestDiseaseForm(container);
        break;

      case (customActivityId ? viewName : '__none__'):
        if (titleEl) titleEl.textContent = 'Activity Registration';
        await this.renderCustomActivityForm(container, customActivityId);
        break;

      case 'cycle-monitoring':
        if (titleEl) titleEl.textContent = 'Cycle Monitoring';
        await this.renderCycleMonitoringView(container);
        break;

      case 'daily-monitoring':
        if (titleEl) titleEl.textContent = 'Daily Activity & Accomplishment Monitoring';
        await this.renderDailyMonitoringView(container);
        break;

      case 'kpi-registration':
        if (titleEl) titleEl.textContent = 'KPI Targets & Productivity Management';
        await this.renderKPIRegistrationView(container);
        break;

      case 'manpower-monitoring':
        if (titleEl) titleEl.textContent = 'Manpower Utilization & Forecasting';
        await this.renderManpowerMonitoringView(container);
        break;

      case 'farm-map':
        if (titleEl) titleEl.textContent = 'Offline Farm Maps & Boundary Explorer';
        await this.renderFarmMapView(container);
        break;

      case 'dropdown-management':
        if (titleEl) titleEl.textContent = 'Activity Dropdown Management';
        await this.renderDropdownManagementView(container);
        break;

      case 'landowner-enrollment':
        if (titleEl) titleEl.textContent = 'Land Owner Enrollment';
        await this.renderLandownerEnrollmentView(container);
        break;

      case 'user-management':
        if (titleEl) titleEl.textContent = 'User Accounts & Access Control';
        await this.renderUserManagementView(container);
        break;

      case 'reports':
        if (titleEl) titleEl.textContent = 'Consolidated Reports & Data Export';
        await this.renderReportsView(container);
        break;

      case 'sync':
        if (titleEl) titleEl.textContent = 'Synchronization Center & Audit Logs';
        await this.renderSyncCenterView(container);
        break;

      case 'device-management':
        if (titleEl) titleEl.textContent = 'Device Identity & Hardware Registry';
        await this.renderDeviceManagementView(container);
        break;

      case 'settings':
        if (titleEl) titleEl.textContent = 'System & API Settings';
        await this.renderSettingsView(container);
        break;

      case 'profile':
        if (titleEl) titleEl.textContent = 'User Profile & Permissions';
        await this.renderProfileView(container);
        break;

      default:
        if (titleEl) titleEl.textContent = 'Dashboard';
        await this.renderDashboardView(container);
    }
  }

  /* ==========================================================================
     PAGE 1: LOGIN VIEW
     ========================================================================== */

  renderLoginView() {
    const wrapper = document.getElementById('login-view-wrapper');
    wrapper.innerHTML = `
      <div class="card" style="width: 100%; max-width: 440px; padding: 32px 28px; box-shadow: var(--shadow-lg); border-radius: var(--radius-xl); text-align: center;">
        ${this.renderAnimatedPalmTreeSVG(170, 220)}

        <h2 style="font-size: 21px; font-weight: 800; color: var(--palm-dark); margin-top: 8px;">Farm Operations System</h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 22px;">
          Activity Monitoring &amp; KPI Management &bull; Coconut Plantation
        </p>

        <form id="login-form" onsubmit="event.preventDefault(); app.handleLoginSubmit();" style="text-align: left;">
          <div class="form-group">
            <label class="form-label required">Username</label>
            <input type="text" id="login-username" class="form-control" placeholder="Enter username" required autocomplete="username" autocapitalize="none" />
          </div>

          <div class="form-group">
            <label class="form-label required">Password</label>
            <div style="position: relative;">
              <input type="password" id="login-password" class="form-control" placeholder="Enter password" required autocomplete="current-password" />
              <button type="button" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--text-muted);" onclick="app.togglePasswordVisibility('login-password')">👁️</button>
            </div>
          </div>

          <button type="submit" id="login-submit-btn" class="btn btn-primary btn-lg" style="width: 100%; margin-top: 8px;">
            <span>Sign In to Plantation System</span>
          </button>
        </form>

        <details id="login-server-box" style="margin-top: 20px; text-align: left; font-size: 12.5px; color: var(--text-muted);">
          <summary style="cursor: pointer; font-weight: 600;">⚙️ Server connection</summary>
          <div style="margin-top: 10px;">
            <input type="url" id="login-api-url" class="form-control" placeholder="https://script.google.com/macros/s/.../exec" />
            <button type="button" class="btn btn-outline" style="width: 100%; margin-top: 8px;" onclick="app.testApiConnection()">🔌 Test &amp; Save Server URL</button>
            <div id="login-api-status" style="margin-top: 6px; font-weight: 600;"></div>
          </div>
        </details>

        <div style="margin-top: 14px; font-size: 11px; color: var(--text-light);">
          First sign-in on a device needs internet. After that you can sign in offline.
        </div>
      </div>
    `;

    syncService.getApiUrl().then((url) => {
      const input = document.getElementById('login-api-url');
      if (input) input.value = url || '';
      if (!url) document.getElementById('login-server-box').open = true;
    });
  }

  fillDemoLogin(username, password) {
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
  }

  togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  async handleLoginSubmit() {
    const userField = document.getElementById('login-username');
    const passField = document.getElementById('login-password');
    const submitBtn = document.getElementById('login-submit-btn');

    const username = userField.value.trim();
    const password = passField.value;
    if (!username || !password) {
      this.showToast('Please enter both username and password.', 'warning');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Authenticating...</span>`;

    try {
      const result = await auth.login(username, password);
      passField.value = '';
      this.showToast(result.message || 'Login successful!', 'success');
      this.showAppLayout();
      await this.navigateTo('dashboard');

      if (result.mode === 'online') {
        if (result.user.mustChangePassword) this.openChangePasswordModal(true);
        syncService.updateSyncStatus();
        syncService.syncPendingRecords().finally(() => this.backgroundRefresh());
      } else {
        this.checkMapVersionNotification();
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Sign In to Plantation System</span>`;
    }
  }

  async handleLogout() {
    if (confirm('Are you sure you want to sign out? Your offline reports remain safe on this device.')) {
      await auth.logout();
      this.showToast('You have been logged out.', 'info');
      this.showLoginView();
    }
  }

  /* ==========================================================================
     PAGE 2: MAIN DASHBOARD
     ========================================================================== */

  async renderDashboardView(container) {
    await auth.refreshScope();
    const rawReports = await db.getAll('reports');
    const reports = auth.filterAuthorizedRecords(rawReports)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const kpis = auth.filterAuthorizedKpis(await db.getAll('kpis'));

    // Aggregate metrics
    const totalReports = reports.length;
    let totalManpower = 0;
    let totalPalmsServiced = 0;
    let totalHectaresAccomplished = 0;
    let totalMaterialsUsed = 0; // Sacks + Kilos + Liters

    reports.forEach((r) => {
      totalManpower += parseFloat(r.manpower || r.manpowerCount || r.countOfManpower2 || 0);
      totalPalmsServiced += parseFloat(r.roundWeedingPalms || 0) +
                            parseFloat(r.compostPalms || 0) +
                            parseFloat(r.pruningPalms || 0) +
                            parseFloat(r.soilDrenchingPalms || 0) +
                            parseFloat(r.countOfPalms || 0) +
                            parseFloat(r.totalPalmsAffected || 0);
      totalHectaresAccomplished += parseFloat(r.weedingSlashingHa || 0);
      totalMaterialsUsed += parseFloat(r.quantitySacks || 0) +
                            parseFloat(r.quantityLiters || 0) +
                            parseFloat(r.quantity || 0);
    });

    // KPI accomplishments
    let totalTargetQty = 0;
    let totalActualQty = 0;
    let completedCount = 0;
    let aheadCount = 0;
    let behindCount = 0;
    let ongoingCount = 0;

    kpis.forEach((k) => {
      const target = parseFloat(k.targetQuantity) || 0;
      totalTargetQty += target;

      let actual = 0;
      reports.forEach((r) => {
        const v = this.kpiValueForReport(k, r);
        if (v !== null) actual += v;
      });

      totalActualQty += actual;
      const pct = target > 0 ? (actual / target) * 100 : 0;

      if (actual >= target && target > 0) completedCount++;
      else if (pct >= 80) aheadCount++;
      else if (pct >= 40) ongoingCount++;
      else behindCount++;
    });

    const overallKpiPct = totalTargetQty > 0 ? Math.min(100, Math.round((totalActualQty / totalTargetQty) * 100)) : 0;

    container.innerHTML = `
      <!-- Tropical Farm Header Banner with Animated Palm Tree -->
      <div class="card" style="background: linear-gradient(135deg, #064e3b 0%, #14532d 60%, #166534 100%); color: #ffffff; padding: 20px 24px; position: relative; overflow: hidden; margin-bottom: 22px;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
          <div>
            <span class="badge" style="background: rgba(255,255,255,0.2); color: #ffffff; margin-bottom: 8px;">
              🌴 Coconut Plantation Operations
            </span>
            <h2 style="font-size: 22px; font-weight: 800; margin-bottom: 4px;">
              Welcome, ${auth.getEmployeeName()}
            </h2>
            <p style="font-size: 13.5px; opacity: 0.9; max-width: 500px; line-height: 1.5;">
              Monitoring field operations, manpower deployment, and KPI productivity across registered coconut parcels.
            </p>
          </div>
          <div style="flex-shrink: 0;">
            ${this.renderAnimatedPalmTreeSVG(140, 180)}
          </div>
        </div>
      </div>

      <!-- Real-Time Metrics Summary Grid -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon green">📋</div>
          <div class="stat-info">
            <div class="stat-label">Registered Activities</div>
            <div class="stat-value">${totalReports}</div>
            <div class="stat-sub">${completedCount} Completed Activities</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon amber">👥</div>
          <div class="stat-info">
            <div class="stat-label">Manpower Deployed</div>
            <div class="stat-value">${totalManpower}</div>
            <div class="stat-sub">Active field labor count</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon emerald">🥥</div>
          <div class="stat-info">
            <div class="stat-label">Palms Serviced</div>
            <div class="stat-value">${totalPalmsServiced.toLocaleString()}</div>
            <div class="stat-sub">${totalHectaresAccomplished.toFixed(1)} Hectares Cleared</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon blue">🎯</div>
          <div class="stat-info">
            <div class="stat-label">KPI Accomplishment</div>
            <div class="stat-value">${overallKpiPct}%</div>
            <div class="stat-sub">${aheadCount} Ahead &bull; ${behindCount} Behind</div>
          </div>
        </div>
      </div>

      <!-- Quick Action Activity Hub Shortcut -->
      <div class="card" style="padding: 16px 20px; background: var(--palm-subtle); border-color: var(--palm-border); margin-bottom: 22px;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div>
            <div style="font-weight: 700; color: var(--palm-dark); font-size: 15px;">⚡ Record Today's Activity</div>
            <div style="font-size: 12.5px; color: var(--text-muted);">Select from 6 standardized coconut farm activity forms.</div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="app.navigateTo('activity-selection')">
              + New Activity Report
            </button>
            <button class="btn btn-outline" onclick="app.navigateTo('daily-monitoring')">
              View Daily Monitoring
            </button>
          </div>
        </div>
      </div>

      <!-- Interactive SVG / Canvas Accomplishment Charts -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 20px; margin-bottom: 22px;">
        <!-- Chart 1: Accomplishment Progress vs KPI Target -->
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">📈 Accomplishment vs KPI Target</div>
              <div class="card-subtitle">Comparison of actual vs target units across operations</div>
            </div>
          </div>
          <div id="chart-kpi-accomplishment" style="height: 260px; display: flex; align-items: center; justify-content: center;">
            ${this.renderBarChartSVG([
              { label: 'Weeding / Slash (Ha)', actual: totalHectaresAccomplished || 1.8, target: 2.0, unit: 'Ha' },
              { label: 'Round Weeding (Palms)', actual: 95, target: 100, unit: 'Palms' },
              { label: 'Compost Appl (Palms)', actual: 75, target: 80, unit: 'Palms' },
              { label: 'Pruning Palms', actual: 55, target: 60, unit: 'Palms' },
              { label: 'Seednut Harvest', actual: 480, target: 500, unit: 'Nuts' }
            ])}
          </div>
        </div>

        <!-- Chart 2: Manpower Utilization by Activity -->
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">👥 Manpower Utilization by Activity</div>
              <div class="card-subtitle">Distribution of field personnel by operation</div>
            </div>
          </div>
          <div id="chart-manpower-utilization" style="height: 260px; display: flex; align-items: center; justify-content: center;">
            ${this.renderDonutChartSVG([
              { label: 'Regular Weeding', value: 4, color: '#15803d' },
              { label: 'Soil Drench & Compost', value: 3, color: '#22c55e' },
              { label: 'Seednut Harvesting', value: 2, color: '#f59e0b' },
              { label: 'Pruning & Sanitation', value: 2, color: '#78350f' },
              { label: 'Pest Treatment', value: 2, color: '#ef4444' }
            ])}
          </div>
        </div>
      </div>

      <!-- Recent Submissions Table -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📝 Recent Activity Reports</div>
            <div class="card-subtitle">Latest operations in your Farm &amp; Blocks</div>
          </div>
          <button class="btn btn-outline" style="font-size: 13px;" onclick="app.navigateTo('daily-monitoring')">
            View All Reports
          </button>
        </div>

        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Activity Type</th>
                <th>Landowner &amp; Parcel</th>
                <th>Farm &amp; Block</th>
                <th>Manpower</th>
                <th>Accomplishment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${reports.length === 0 ? `
                <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No activities recorded yet. Click "+ New Activity Report" above to begin.</td></tr>
              ` : reports.slice(0, 5).map((r) => `
                <tr>
                  <td><strong>${r.date || 'Today'}</strong></td>
                  <td>${this.esc(r.activityType)}</td>
                  <td>${this.esc(r.landOwnersName || '—')}${r.landOwnerNo ? ` <span style="font-size:11px;color:var(--text-muted);">${this.esc(r.landOwnerNo)}</span>` : ''} &bull; ${this.esc(r.parcelNumber || '—')}</td>
                  <td>${this.esc(r.farmBlock || '—')}</td>
                  <td>${this.esc(r.manpower || r.manpowerCount || 1)} pax</td>
                  <td>
                    ${r.weedingSlashingHa ? `${r.weedingSlashingHa} Ha cleared` : ''}
                    ${r.roundWeedingPalms ? `${r.roundWeedingPalms} palms weeded` : ''}
                    ${r.nutCountCollected ? `${r.nutCountCollected} seednuts` : ''}
                    ${r.totalPalmsAffected ? `${r.totalPalmsAffected} palms treated` : ''}
                    ${r.quantity ? `${r.quantity} ${r.unit || 'units'}` : ''}
                  </td>
                  <td>
                    <span class="badge ${r.syncStatus === 'SENT' ? 'badge-completed' : (r.syncStatus === 'REJECTED' ? 'badge-behind' : 'badge-ongoing')}">
                      ${r.syncStatus === 'SENT' ? '✓ Synced' : (r.syncStatus === 'REJECTED' ? '❌ Rejected' : '⏳ Pending')}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Cycle progress for this month (only the user's Farm & Blocks)
    await this.renderCycleDashboardCard(container);
    try { await this.renderSequenceDashboardCard(container); } catch (err) { console.warn('[Dashboard] sequence summary', err); }
  }

  /* ==========================================================================
     INTERACTIVE SVG CHART GENERATORS (Responsive & 100% Offline)
     ========================================================================== */

  renderBarChartSVG(items) {
    const chartHeight = 220;
    const barWidth = 32;
    const gap = 44;
    const totalWidth = items.length * (barWidth * 2 + gap) + 60;

    let svgBars = '';
    items.forEach((item, index) => {
      const x = 50 + index * (barWidth * 2 + gap);
      const targetHeight = Math.min(150, (item.target / (item.target || 1)) * 140);
      const actualPct = item.target > 0 ? (item.actual / item.target) : 0;
      const actualHeight = Math.min(150, actualPct * 140);

      const targetY = 180 - targetHeight;
      const actualY = 180 - actualHeight;

      svgBars += `
        <!-- Target Bar (Background striped/gray) -->
        <rect x="${x}" y="${targetY}" width="${barWidth}" height="${targetHeight}" rx="4" fill="#e2e8f0" />
        <!-- Actual Bar (Green) -->
        <rect x="${x + barWidth + 4}" y="${actualY}" width="${barWidth}" height="${actualHeight}" rx="4" fill="${actualPct >= 1 ? '#15803d' : '#22c55e'}" />

        <!-- Labels -->
        <text x="${x + barWidth}" y="200" font-size="10" font-weight="600" text-anchor="middle" fill="#64748b">${item.label.substring(0, 14)}</text>
        <text x="${x + barWidth + 4 + barWidth/2}" y="${actualY - 4}" font-size="10" font-weight="700" text-anchor="middle" fill="#15803d">${item.actual}</text>
      `;
    });

    return `
      <svg viewBox="0 0 ${totalWidth} ${chartHeight}" width="100%" height="100%">
        <!-- Baseline -->
        <line x1="30" y1="180" x2="${totalWidth - 20}" y2="180" stroke="#cbd5e1" stroke-width="1.5" />
        ${svgBars}
        <!-- Legend -->
        <rect x="50" y="10" width="12" height="12" rx="2" fill="#e2e8f0" />
        <text x="68" y="20" font-size="11" fill="#64748b">Target KPI</text>
        <rect x="140" y="10" width="12" height="12" rx="2" fill="#22c55e" />
        <text x="158" y="20" font-size="11" fill="#15803d" font-weight="600">Actual Accomplishment</text>
      </svg>
    `;
  }

  renderDonutChartSVG(slices) {
    const total = slices.reduce((acc, s) => acc + s.value, 0) || 1;
    const cx = 130;
    const cy = 120;
    const radius = 80;
    const innerRadius = 50;

    let startAngle = 0;
    let paths = '';

    slices.forEach((s) => {
      const angle = (s.value / total) * 360;
      const endAngle = startAngle + angle;

      const x1 = cx + radius * Math.cos((Math.PI * (startAngle - 90)) / 180);
      const y1 = cy + radius * Math.sin((Math.PI * (startAngle - 90)) / 180);
      const x2 = cx + radius * Math.cos((Math.PI * (endAngle - 90)) / 180);
      const y2 = cy + radius * Math.sin((Math.PI * (endAngle - 90)) / 180);

      const ix1 = cx + innerRadius * Math.cos((Math.PI * (endAngle - 90)) / 180);
      const iy1 = cy + innerRadius * Math.sin((Math.PI * (endAngle - 90)) / 180);
      const ix2 = cx + innerRadius * Math.cos((Math.PI * (startAngle - 90)) / 180);
      const iy2 = cy + innerRadius * Math.sin((Math.PI * (startAngle - 90)) / 180);

      const largeArc = angle > 180 ? 1 : 0;

      const pathData = `
        M ${x1} ${y1}
        A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}
        L ${ix1} ${iy1}
        A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2}
        Z
      `;

      paths += `<path d="${pathData}" fill="${s.color}" />`;
      startAngle = endAngle;
    });

    let legendHtml = '';
    slices.forEach((s, idx) => {
      legendHtml += `
        <g transform="translate(250, ${50 + idx * 28})">
          <circle cx="6" cy="6" r="6" fill="${s.color}" />
          <text x="18" y="10" font-size="11.5" font-weight="600" fill="#0f172a">${s.label} (${s.value} pax)</text>
        </g>
      `;
    });

    return `
      <svg viewBox="0 0 460 240" width="100%" height="100%">
        ${paths}
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="18" font-weight="800" fill="#064e3b">${total}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#64748b">TOTAL PAX</text>
        ${legendHtml}
      </svg>
    `;
  }

  /* ==========================================================================
     PAGE 3: ACTIVITY SELECTION HUB
     ========================================================================== */

  async renderActivitySelectionView(container) {
    this._renderActivityHub(container);
    await this.renderCustomActivityCards(container);
    const map = {
      'regular-activity': 'Regular Activity', 'irregular-activity': 'Irregular Activity',
      'other-farm-activity': 'Other Farm Activity', 'palm-category': 'Palm Category Activity',
      'seednut-collection': 'Seednut Collection', 'pest-disease': 'Pest and Disease Activity'
    };
    container.querySelectorAll('.activity-hub-card').forEach((card) => {
      const m = (card.getAttribute('onclick') || '').match(/navigateTo\('([^']+)'\)/);
      if (m && map[m[1]] && !auth.canAccessActivity(map[m[1]])) card.style.display = 'none';
    });
    await auth.refreshScope();
    if (!auth.hasAllBlocks() && auth.getAuthorizedBlocks().length === 0) {
      container.insertAdjacentHTML('afterbegin', `<div class="card" style="background:#fffbeb;border-color:#fde68a;color:#92400e;margin-bottom:16px;">
        No Farm &amp; Block is assigned to you yet (or farm data is not downloaded). Ask your administrator, then tap Sync while online.</div>`);
    }
  }

  _renderActivityHub(container) {
    container.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Activity Registration Modules</h2>
        <p style="font-size: 13.5px; color: var(--text-muted);">
          Select an activity module to record daily field accomplishments and manpower.${auth.isAdmin() ? ' Administrators can add new activities with <strong>+ Add New Activity</strong>.' : ''}
        </p>
      </div>

      <div class="activity-hub-grid">
        <!-- Module A: Regular Activity -->
        <div class="activity-hub-card" onclick="app.navigateTo('regular-activity')">
          <div class="activity-card-icon">🌿</div>
          <div class="activity-card-title">A. Regular Activity</div>
          <div class="activity-card-desc">
            Weeding rolling / slashing in hectares, round weeding, compost application, BOF requests, pruning, and soil drenching premix.
          </div>
          <div class="activity-card-footer">
            <span>Register Accomplishment</span>
            <span>&rarr;</span>
          </div>
        </div>

        <!-- Module B: Irregular Activity -->
        <div class="activity-hub-card" onclick="app.navigateTo('irregular-activity')">
          <div class="activity-card-icon">🛡️</div>
          <div class="activity-card-title">B. Irregular Activity</div>
          <div class="activity-card-desc">
            Pest &amp; disease treatment soil drenching, crown sanitation, drainage clearing, and special non-cyclic farm operations.
          </div>
          <div class="activity-card-footer">
            <span>Register Accomplishment</span>
            <span>&rarr;</span>
          </div>
        </div>

        <!-- Module C: Other Farm Activity -->
        <div class="activity-hub-card" onclick="app.navigateTo('other-farm-activity')">
          <div class="activity-card-icon">🚜</div>
          <div class="activity-card-title">C. Other Farm Activity</div>
          <div class="activity-card-desc">
            Cover crop planting, road grading, boundary fencing, seedling bagging, and coconut husk mulching along tree basins.
          </div>
          <div class="activity-card-footer">
            <span>Register Accomplishment</span>
            <span>&rarr;</span>
          </div>
        </div>

        <!-- Module D: Palm Category Activity -->
        <div class="activity-hub-card" onclick="app.navigateTo('palm-category')">
          <div class="activity-card-icon">🌴</div>
          <div class="activity-card-title">D. Palm Category Activity</div>
          <div class="activity-card-desc">
            Detailed stage census: Seedling, Juvenile, Pre-trunk Reproductive, Semi-Mature, Mature, Fruiting, and Problem palms.
          </div>
          <div class="activity-card-footer">
            <span>Register Accomplishment</span>
            <span>&rarr;</span>
          </div>
        </div>

        <!-- Module E: Seednut Collection -->
        <div class="activity-hub-card" onclick="app.navigateTo('seednut-collection')">
          <div class="activity-card-icon">🥥</div>
          <div class="activity-card-title">E. Seednut Collection</div>
          <div class="activity-card-desc">
            Daily seednut harvest counting, rejected nuts, next cycle estimation, QR area codes, and automatic GPS coordinate stamping.
          </div>
          <div class="activity-card-footer">
            <span>Register Accomplishment</span>
            <span>&rarr;</span>
          </div>
        </div>

        <!-- Module F: Pest & Disease Activity -->
        <div class="activity-hub-card" onclick="app.navigateTo('pest-disease')">
          <div class="activity-card-icon">🔬</div>
          <div class="activity-card-title">F. Pest &amp; Disease Treatment</div>
          <div class="activity-card-desc">
            Target pest monitoring (Rhinoceros Beetle, Red Palm Weevil), chemicals / bio-inputs used, ratios, and canopy application.
          </div>
          <div class="activity-card-footer">
            <span>Register Accomplishment</span>
            <span>&rarr;</span>
          </div>
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     CUSTOM ACTIVITIES (Admin adds new activity modules)
     ========================================================================== */

  async getCustomActivities(includeInactive = false) {
    const defs = (await db.getSetting('customActivities', [])) || [];
    return includeInactive ? defs : defs.filter((d) => d.status !== 'Deactivated');
  }

  async renderCustomActivityCards(container) {
    const defs = await this.getCustomActivities(auth.isAdmin());
    const grid = container.querySelector('.activity-hub-grid');
    if (!grid) return;
    const e = (v) => this.esc(v);
    const letters = 'GHIJKLMNOPQRSTUVWXYZ';

    defs.forEach((d, i) => {
      if (!auth.canAccessActivity(d.name)) return;
      const active = d.status !== 'Deactivated';
      const fieldNames = d.fields.filter((f) => !f.hidden).map((f) => f.label).join(', ');
      grid.insertAdjacentHTML('beforeend', `
        <div class="activity-hub-card" style="position:relative;${active ? '' : 'opacity:0.55;'}"
             onclick="${active ? `app.navigateTo('custom-activity:${e(d.id)}')` : ''}">
          ${auth.isAdmin() ? `
            <div style="position:absolute;top:10px;right:10px;display:flex;gap:4px;">
              <button class="btn btn-outline btn-icon" title="Edit activity" onclick="event.stopPropagation(); app.openActivityTypeModal('${e(d.id)}')">✏️</button>
              <button class="btn ${active ? 'btn-danger' : 'btn-outline'} btn-icon" title="${active ? 'Deactivate' : 'Reactivate'}"
                      onclick="event.stopPropagation(); app.setActivityTypeStatus('${e(d.id)}', '${active ? 'Deactivated' : 'Active'}')">${active ? '🚫' : '♻️'}</button>
            </div>` : ''}
          <div class="activity-card-icon">${e(d.icon || '📋')}</div>
          <div class="activity-card-title">${letters[i] || '•'}. ${e(d.name)}${active ? '' : ' (deactivated)'}</div>
          <div class="activity-card-desc">${e(d.description || fieldNames)}</div>
          <div class="activity-card-footer"><span>Register Accomplishment</span><span>&rarr;</span></div>
        </div>`);
    });

    if (auth.isAdmin()) {
      grid.insertAdjacentHTML('beforeend', `
        <div class="activity-hub-card" onclick="app.openActivityTypeModal()" style="border:2px dashed var(--palm-primary, #15803d);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:180px;">
          <div class="activity-card-icon">➕</div>
          <div class="activity-card-title">Add New Activity</div>
          <div class="activity-card-desc">Create a new activity module with your own fields (e.g. Coconut Planting, Fertilizer Hauling).</div>
        </div>`);
    }
  }

  /** Admin: create or edit a custom activity and its fields. */
  async openActivityTypeModal(activityId = null) {
    const defs = await this.getCustomActivities(true);
    const def = activityId ? defs.find((d) => d.id === activityId) : null;
    if (activityId && !def) return;
    const e = (v) => this.esc(v);
    const icons = ['📋', '🌱', '🌴', '🥥', '🚜', '💧', '🧪', '🪓', '🔥', '🧺', '🪴', '🛠️', '🐛', '🌾', '📦', '⛏️'];

    this._activityFields = def
      ? def.fields.filter((f) => !f.hidden).map((f) => ({ ...f, options: (f.options || []).join(', ') }))
      : [{ label: '', type: 'number', unit: '', options: '', required: true }];
    this._activityKpiField = def ? def.kpiField : '';

    document.getElementById('form-modal-title').textContent = def ? `Edit Activity: ${def.name}` : 'Add New Activity';
    document.getElementById('form-modal-body').innerHTML = `
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label required">Activity Name</label>
          <input type="text" id="act-name" class="form-control" maxlength="80" value="${e(def ? def.name : '')}" placeholder="e.g. Coconut Planting" />
        </div>
        <div class="form-group">
          <label class="form-label">Icon</label>
          <select id="act-icon" class="form-control">
            ${icons.map((i) => `<option value="${i}" ${def && def.icon === i ? 'selected' : ''}>${i}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input type="text" id="act-desc" class="form-control" maxlength="300" value="${e(def ? def.description : '')}" placeholder="What is recorded in this activity" />
      </div>
      <div class="form-helper" style="margin-bottom:10px;">
        Every activity already includes: Date, Land Owner, Parcel, Farm &amp; Block, Manpower, Remarks and GPS.
        Add the extra fields to record below.
      </div>
      <div id="act-fields"></div>
      <button type="button" class="btn btn-outline" style="margin-top:8px;" onclick="app.addActivityFieldRow()">+ Add Field</button>
      <div class="form-group" style="margin-top:14px;">
        <label class="form-label">KPI Measure (number field counted toward KPI targets)</label>
        <select id="act-kpi-field" class="form-control"></select>
      </div>
    `;
    this.renderActivityFieldRows();

    const btn = document.getElementById('form-modal-submit-btn');
    btn.textContent = 'Save Activity';
    btn.onclick = () => this.saveActivityType(def);
    this.openModal('form-modal');
  }

  readActivityFieldRows() {
    document.querySelectorAll('.act-field-row').forEach((row) => {
      const f = this._activityFields[Number(row.dataset.index)];
      if (!f) return;
      f.label = row.querySelector('.af-label').value;
      f.type = row.querySelector('.af-type').value;
      f.unit = row.querySelector('.af-unit').value;
      f.options = row.querySelector('.af-options').value;
      f.required = row.querySelector('.af-required').checked;
    });
    const kpiSel = document.getElementById('act-kpi-field');
    if (kpiSel) this._activityKpiField = kpiSel.value;
  }

  renderActivityFieldRows() {
    const e = (v) => this.esc(v);
    const wrap = document.getElementById('act-fields');
    wrap.innerHTML = this._activityFields.map((f, i) => `
      <div class="act-field-row card" data-index="${i}" style="padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">
          <div style="flex:2 1 180px;"><label class="form-label" style="font-size:12px;">Field Label</label>
            <input type="text" class="form-control af-label" value="${e(f.label)}" placeholder="e.g. Seedlings Planted" oninput="app.refreshKpiFieldSelect()" /></div>
          <div style="flex:1 1 110px;"><label class="form-label" style="font-size:12px;">Type</label>
            <select class="form-control af-type" onchange="app.readActivityFieldRows(); app.renderActivityFieldRows();">
              ${[['number', 'Number'], ['text', 'Text'], ['select', 'Dropdown'], ['date', 'Date']]
                .map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
          <div style="flex:1 1 90px;"><label class="form-label" style="font-size:12px;">Unit</label>
            <input type="text" class="form-control af-unit" value="${e(f.unit || '')}" placeholder="pcs / Ha / L" /></div>
          <button type="button" class="btn btn-danger btn-icon" title="Remove field" onclick="app.removeActivityFieldRow(${i})">✕</button>
        </div>
        <div style="display:${f.type === 'select' ? 'block' : 'none'};margin-top:8px;">
          <input type="text" class="form-control af-options" value="${e(f.options || '')}" placeholder="Dropdown options, separated by commas (e.g. Tall, Dwarf, Hybrid)" />
        </div>
        <label style="font-size:12.5px;margin-top:6px;display:inline-flex;gap:6px;align-items:center;">
          <input type="checkbox" class="af-required" ${f.required ? 'checked' : ''} /> Required
        </label>
      </div>`).join('') || '<div class="form-helper">No fields yet.</div>';
    this.refreshKpiFieldSelect();
  }

  refreshKpiFieldSelect() {
    const sel = document.getElementById('act-kpi-field');
    if (!sel) return;
    const current = sel.value || this._activityKpiField;
    const rows = [...document.querySelectorAll('.act-field-row')];
    const nums = rows.map((row) => ({
      idx: row.dataset.index,
      label: row.querySelector('.af-label').value.trim(),
      type: row.querySelector('.af-type').value,
      key: this._activityFields[Number(row.dataset.index)].key || ''
    })).filter((f) => f.type === 'number' && f.label);
    sel.innerHTML = `<option value="">— None —</option>` + nums.map((f) =>
      `<option value="${this.esc(f.key || 'idx:' + f.idx)}">${this.esc(f.label)}</option>`).join('');
    if (current && [...sel.options].some((o) => o.value === current)) sel.value = current;
    else if (nums.length) sel.value = nums[0].key || 'idx:' + nums[0].idx;
  }

  addActivityFieldRow() {
    this.readActivityFieldRows();
    this._activityFields.push({ label: '', type: 'number', unit: '', options: '', required: false });
    this.renderActivityFieldRows();
  }

  removeActivityFieldRow(index) {
    this.readActivityFieldRows();
    this._activityFields.splice(index, 1);
    this.renderActivityFieldRows();
  }

  async saveActivityType(def) {
    this.readActivityFieldRows();
    const name = document.getElementById('act-name').value.trim();
    const fields = this._activityFields.filter((f) => String(f.label).trim());
    if (!name) { this.showToast('Activity name is required.', 'warning'); return; }
    if (!fields.length) { this.showToast('Add at least one field.', 'warning'); return; }

    // KPI field may point at a new (unsaved) field by its row index
    let kpiField = document.getElementById('act-kpi-field').value;
    if (kpiField.startsWith('idx:')) {
      const f = this._activityFields[Number(kpiField.slice(4))];
      kpiField = f ? (f.key || '__label:' + f.label) : '';
    }
    if (kpiField.startsWith('__label:')) {
      // server derives keys from labels; send the slug the server will create
      kpiField = kpiField.slice(8).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40);
    }

    const activity = {
      id: def ? def.id : undefined,
      name,
      icon: document.getElementById('act-icon').value,
      description: document.getElementById('act-desc').value.trim(),
      kpiField,
      fields: fields.map((f) => ({ key: f.key, label: f.label.trim(), type: f.type, unit: f.unit, options: f.options, required: !!f.required }))
    };

    const btn = document.getElementById('form-modal-submit-btn');
    btn.disabled = true;
    const res = await this.runServerAction('SAVE_ACTIVITY_TYPE', { activity }, 'Activity saved.', null);
    btn.disabled = false;
    if (res) { this.closeModal('form-modal'); this.navigateTo('activity-selection'); }
  }

  async setActivityTypeStatus(activityId, status) {
    if (!confirm(`${status === 'Active' ? 'Reactivate' : 'Deactivate'} this activity? ${status === 'Active' ? '' : 'Existing reports are kept.'}`)) return;
    await this.runServerAction('SET_ACTIVITY_TYPE_STATUS', { activityId, status }, 'Activity updated.', 'activity-selection');
  }

  async renderCustomActivityForm(container, activityId) {
    const def = (await this.getCustomActivities()).find((d) => d.id === activityId);
    if (!def) {
      container.innerHTML = `<div class="card">This activity is not available. Tap Sync to refresh farm data.</div>`;
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const e = (v) => this.esc(v);
    const fieldHtml = (f) => {
      const id = `cf-${e(f.key)}`;
      const req = f.required ? 'required' : '';
      const label = `<label class="form-label ${f.required ? 'required' : ''}">${e(f.label)}${f.unit ? ` (${e(f.unit)})` : ''}</label>`;
      if (f.type === 'number') return `<div class="form-group">${label}<input type="number" step="any" min="0" id="${id}" class="form-control" ${req} /></div>`;
      if (f.type === 'date') return `<div class="form-group">${label}<input type="date" id="${id}" class="form-control" ${req} /></div>`;
      if (f.type === 'select') return `<div class="form-group">${label}<select id="${id}" class="form-control" ${req}>
          <option value="">-- Select --</option>${(f.options || []).map((o) => `<option value="${e(o)}">${e(o)}</option>`).join('')}</select></div>`;
      return `<div class="form-group">${label}<input type="text" id="${id}" class="form-control" maxlength="500" ${req} /></div>`;
    };

    container.innerHTML = `
      <div class="card" style="max-width: 900px; margin: 0 auto;">
        <div class="card-header">
          <div>
            <div class="card-title">${e(def.icon)} ${e(def.name)}</div>
            <div class="card-subtitle">${e(def.description || 'Record daily accomplishment')}</div>
          </div>
          <button class="btn btn-outline" onclick="app.navigateTo('activity-selection')">&larr; Back to Hub</button>
        </div>

        <form id="form-custom" onsubmit="event.preventDefault(); app.submitCustomActivity('${e(def.id)}');">
          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Date</label>
              <input type="date" id="cust-date" class="form-control" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Land Owners Name</label>
              <select id="cust-landowner" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Parcel Number</label>
              <select id="cust-parcel" class="form-control" required></select>
            </div>
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label required">Farm &amp; Block</label>
              <select id="cust-block" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Manpower (Count)</label>
              <input type="number" id="cust-manpower" class="form-control" min="1" value="1" required />
            </div>
          </div>

          <div class="form-grid-2">
            ${def.fields.filter((f) => !f.hidden).map(fieldHtml).join('')}
          </div>

          <div class="form-group">
            <label class="form-label">Remarks</label>
            <textarea id="cust-remarks" class="form-control" rows="2"></textarea>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
            <button type="button" class="btn btn-outline" onclick="app.navigateTo('activity-selection')">Cancel</button>
            <button type="submit" class="btn btn-primary btn-lg">✓ Save &amp; Submit Report</button>
          </div>
        </form>
      </div>
    `;
    await this.populateCascadingDropdowns('cust-landowner', 'cust-parcel', 'cust-block');
    this.captureCurrentGps();
  }

  async submitCustomActivity(activityId) {
    const def = (await this.getCustomActivities()).find((d) => d.id === activityId);
    if (!def) return;
    const customFields = {};
    def.fields.filter((f) => !f.hidden).forEach((f) => {
      const el = document.getElementById(`cf-${f.key}`);
      if (!el) return;
      customFields[f.key] = f.type === 'number' ? (el.value === '' ? '' : parseFloat(el.value)) : el.value.trim();
    });

    const reportData = {
      activityType: def.name,
      customActivityId: def.id,
      userId: auth.getUserId(),
      employeeName: auth.getEmployeeName(),
      date: document.getElementById('cust-date').value,
      ...this.selectedLandownerFields('cust-landowner'),
      parcelNumber: document.getElementById('cust-parcel').value,
      farmBlock: document.getElementById('cust-block').value,
      manpower: parseFloat(document.getElementById('cust-manpower').value) || 1,
      customFields,
      kpiValue: def.kpiField ? (parseFloat(customFields[def.kpiField]) || 0) : undefined,
      remarks: document.getElementById('cust-remarks').value.trim(),
      gpsLatitude: this.gpsCoordinates ? this.gpsCoordinates.latitude : '',
      gpsLongitude: this.gpsCoordinates ? this.gpsCoordinates.longitude : ''
    };

    await syncService.submitReportLocally(reportData);
    this.showToast(`${def.name} report saved successfully!`, 'success');
    this.navigateTo('daily-monitoring');
  }

  /** "Seedlings Planted: 40 pcs; Variety: Dwarf" for reports/exports. */
  describeCustomFields(r, defs) {
    if (!r.customFields) return '';
    const def = (defs || []).find((d) => d.id === r.customActivityId || d.name === r.activityType);
    return Object.entries(r.customFields).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => {
      const f = def && def.fields.find((x) => x.key === k);
      return `${f ? f.label : k}: ${v}${f && f.unit ? ' ' + f.unit : ''}`;
    }).join('; ');
  }

  /* ==========================================================================
     MAP FILE READING (GeoJSON / KML / KMZ)
     ========================================================================== */

  async readMapFile(file) {
    const name = file.name.toLowerCase();
    let geo;
    if (name.endsWith('.kmz')) {
      geo = this.kmlToGeoJSON(await this.readKmlFromKmz(await file.arrayBuffer()));
    } else {
      const text = await file.text();
      const trimmed = text.trim();
      if (name.endsWith('.kml') || trimmed.startsWith('<')) {
        geo = this.kmlToGeoJSON(trimmed);
      } else if (name.endsWith('.shp') || name.endsWith('.zip')) {
        throw new Error('Shapefiles are not supported. In QGIS use Export › Save Features As › GeoJSON.');
      } else {
        try { geo = JSON.parse(trimmed); } catch (err) { throw new Error('File is not valid GeoJSON / KML.'); }
      }
    }
    if (geo && geo.type === 'Feature') geo = { type: 'FeatureCollection', features: [geo] };
    if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
      throw new Error('The file must contain a FeatureCollection of shapes.');
    }

    // Reduce size: round coordinates to 6 decimals (~10 cm) and drop empty properties
    const round = (c) => Array.isArray(c[0]) ? c.map(round) : c.slice(0, 2).map((n) => Math.round(n * 1e6) / 1e6);
    geo.features = geo.features.filter((f) => f && f.geometry && f.geometry.coordinates).map((f) => {
      const props = {};
      Object.entries(f.properties || {}).forEach(([k, v]) => {
        if (v !== null && v !== '' && typeof v !== 'object') props[k] = typeof v === 'string' ? v.slice(0, 200) : v;
      });
      return { type: 'Feature', properties: props, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } };
    });
    if (!geo.features.length) throw new Error('No shapes were found in the file.');
    return { type: 'FeatureCollection', features: geo.features };
  }

  kmlToGeoJSON(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The KML file could not be read.');
    const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
    const parseCoords = (s) => String(s).trim().split(/\s+/)
      .map((t) => t.split(',').map(Number))
      .filter((c) => c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1]))
      .map((c) => [c[0], c[1]]);
    const features = [];

    all(doc, 'Placemark').forEach((pm) => {
      const props = {};
      const nameEl = pm.getElementsByTagNameNS('*', 'name')[0];
      if (nameEl) props.name = nameEl.textContent.trim();
      all(pm, 'Data').forEach((d) => {
        const v = d.getElementsByTagNameNS('*', 'value')[0];
        if (d.getAttribute('name')) props[d.getAttribute('name')] = v ? v.textContent.trim() : '';
      });
      all(pm, 'SimpleData').forEach((d) => { if (d.getAttribute('name')) props[d.getAttribute('name')] = d.textContent.trim(); });
      if (!props.block && props.name) props.block = props.name;

      const polys = all(pm, 'Polygon').map((pg) => {
        const rings = [];
        const outer = pg.getElementsByTagNameNS('*', 'outerBoundaryIs')[0];
        const oc = outer && outer.getElementsByTagNameNS('*', 'coordinates')[0];
        if (oc) rings.push(parseCoords(oc.textContent));
        all(pg, 'innerBoundaryIs').forEach((ib) => {
          const c = ib.getElementsByTagNameNS('*', 'coordinates')[0];
          if (c) rings.push(parseCoords(c.textContent));
        });
        return rings.filter((r) => r.length >= 3);
      }).filter((r) => r.length);

      // Closed lines drawn in Google Earth are treated as areas
      all(pm, 'LineString').forEach((ls) => {
        const c = ls.getElementsByTagNameNS('*', 'coordinates')[0];
        const pts = c ? parseCoords(c.textContent) : [];
        if (pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) polys.push([pts]);
        else if (pts.length >= 2) features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts } });
      });

      if (polys.length === 1) features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: polys[0] } });
      else if (polys.length > 1) features.push({ type: 'Feature', properties: props, geometry: { type: 'MultiPolygon', coordinates: polys } });

      all(pm, 'Point').forEach((pt) => {
        const c = pt.getElementsByTagNameNS('*', 'coordinates')[0];
        const pts = c ? parseCoords(c.textContent) : [];
        if (pts.length) features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: pts[0] } });
      });
    });

    return { type: 'FeatureCollection', features };
  }

  /** KMZ = zip file with a .kml inside. */
  async readKmlFromKmz(buffer) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This KMZ file is damaged (not a zip file).');

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
      const nameLen = dv.getUint16(p + 28, true);
      entries.push({
        method: dv.getUint16(p + 10, true),
        size: dv.getUint32(p + 20, true),
        offset: dv.getUint32(p + 42, true),
        name: new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen))
      });
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }

    const kml = entries.find((x) => /(^|\/)doc\.kml$/i.test(x.name)) || entries.find((x) => /\.kml$/i.test(x.name));
    if (!kml) throw new Error('No .kml file was found inside the KMZ.');
    const start = kml.offset + 30 + dv.getUint16(kml.offset + 26, true) + dv.getUint16(kml.offset + 28, true);
    const data = u8.subarray(start, start + kml.size);
    if (kml.method === 0) return new TextDecoder().decode(data);
    if (kml.method !== 8) throw new Error('Unsupported KMZ compression.');
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot open KMZ files. Update the browser, or export the map as KML / GeoJSON.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }

  /* ==========================================================================
     CASCADING DROPDOWNS HELPER
     Land Owner -> Parcel Number -> Farm & Block  (only the user's assigned Farm & Blocks)
     ========================================================================== */

  async populateCascadingDropdowns(landSelectId, parcelSelectId, blockSelectId, preset = {}) {
    await auth.refreshScope();
    const blocks = auth.getAuthorizedBlocks();

    const landEl = document.getElementById(landSelectId);
    const parcelEl = document.getElementById(parcelSelectId);
    const blockEl = document.getElementById(blockSelectId);
    if (!landEl || !parcelEl || !blockEl) return;

    const e = (v) => this.esc(v);
    const uniq = (arr) => [...new Set(arr)].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

    // One entry per land owner (ID / CLAIF Number), so two land owners with the same name stay separate
    const ownerKey = (b) => String(b.landOwnerId || b.landOwnerName);
    const owners = [...new Map(blocks.map((b) => [ownerKey(b), b])).values()]
      .sort((a, b) => String(a.landOwnerName).localeCompare(String(b.landOwnerName)) ||
        String(a.landOwnerNo || '').localeCompare(String(b.landOwnerNo || ''), undefined, { numeric: true }));
    const lands = owners.map(ownerKey);
    if (!lands.length) {
      landEl.innerHTML = `<option value="">-- No Farm & Block assigned to you --</option>`;
      parcelEl.innerHTML = `<option value="">--</option>`;
      blockEl.innerHTML = `<option value="">--</option>`;
      return;
    }

    landEl.innerHTML = `<option value="">-- Select Land Owner --</option>` +
      owners.map((b) => `<option value="${e(ownerKey(b))}" data-name="${e(b.landOwnerName)}" data-claif="${e(b.landOwnerNo || '')}">` +
        `${e(b.landOwnerName)}${b.landOwnerNo ? ` – ${e(b.landOwnerNo)}` : ''}</option>`).join('');

    const updateBlocks = () => {
      const filtered = blocks.filter((b) => ownerKey(b) === landEl.value && b.parcelNumber === parcelEl.value);
      blockEl.innerHTML = `<option value="">-- Select Farm & Block --</option>` +
        uniq(filtered.map((b) => b.farmBlockName)).map((n) => `<option value="${e(n)}">${e(n)}</option>`).join('');
      if (filtered.length === 1) blockEl.value = filtered[0].farmBlockName;
    };

    const updateParcels = () => {
      const parcels = uniq(blocks.filter((b) => ownerKey(b) === landEl.value).map((b) => b.parcelNumber));
      parcelEl.innerHTML = `<option value="">-- Select Parcel --</option>` +
        parcels.map((p) => `<option value="${e(p)}">${e(p)}</option>`).join('');
      if (parcels.length === 1) parcelEl.value = parcels[0];
      updateBlocks();
    };

    landEl.onchange = updateParcels;
    parcelEl.onchange = updateBlocks;

    const presetOwner = preset.landOwnerId || (preset.landOwner && (owners.find((b) => b.landOwnerName === preset.landOwner) || {}).landOwnerId);
    if (presetOwner && lands.includes(String(presetOwner))) landEl.value = String(presetOwner);
    else if (lands.length === 1) landEl.value = lands[0];
    updateParcels();
    if (preset.parcelNumber) { parcelEl.value = preset.parcelNumber; updateBlocks(); }
    if (preset.farmBlock) blockEl.value = preset.farmBlock;
  }

  /** Land owner fields for a report, from a land owner select filled by populateCascadingDropdowns. */
  selectedLandownerFields(selectId) {
    const el = document.getElementById(selectId);
    const opt = el && el.selectedOptions ? el.selectedOptions[0] : null;
    if (!opt || !opt.value) return { landOwnersName: '', landOwnerNo: '' };
    return { landOwnersName: opt.dataset.name || opt.textContent.trim(), landOwnerNo: opt.dataset.claif || '' };
  }

  /* ==========================================================================
     KPI MANAGEMENT (Admin: all blocks, Supervisor: own blocks)
     ========================================================================== */

  async renderKPIRegistrationView(container) {
    await auth.refreshScope();
    const kpis = auth.filterAuthorizedKpis(await db.getAll('kpis'));
    const e = (v) => this.esc(v);

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">KPI Registration &amp; Targets</h2>
          <p style="font-size: 13.5px; color: var(--text-muted);">
            Establish operational targets, expected daily rates, and required manpower per Farm &amp; Block.
          </p>
        </div>
        <button class="btn btn-primary" onclick="app.openKPIModal()">+ Add New KPI Target</button>
      </div>

      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>KPI ID</th>
                <th>Activity Type</th>
                <th>Farm &amp; Block</th>
                <th>Cycle</th>
                <th>Target Quantity</th>
                <th>Required Manpower</th>
                <th>Target Days</th>
                <th>Expected Daily Rate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${kpis.length === 0 ? `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px;">No KPI targets for your Farm &amp; Blocks yet.</td></tr>` : kpis.map((k) => `
                <tr>
                  <td><code>${e(k.kpiId)}</code></td>
                  <td><strong>${e(k.activityType)}</strong></td>
                  <td><strong>${e(k.farmBlock)}</strong><br/><span style="font-size: 11px; color: var(--text-muted);">${e(k.landOwner)} › ${e(k.parcelNumber)}</span></td>
                  <td>${e(k.cycle || '—')}</td>
                  <td>${e(k.targetQuantity)} ${e(k.targetUnit)}</td>
                  <td>${e(k.requiredManpower)} pax</td>
                  <td>${e(k.targetWorkingDays)} days</td>
                  <td>${Math.round((parseFloat(k.dailyExpectedAccomplishment) || 0) * 100) / 100} ${e(k.targetUnit)}/day</td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn-outline btn-icon" title="Edit KPI" onclick="app.openKPIModal('${e(k.kpiId)}')">✏️</button>
                    <button class="btn btn-danger btn-icon" title="Deactivate" onclick="app.deleteKPI('${e(k.kpiId)}')">🗑️</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  openAddKPIModal() { return this.openKPIModal(); }
  openEditKPIModal(kpiId) { return this.openKPIModal(kpiId); }

  async openKPIModal(kpiId = null) {
    const kpi = kpiId ? await db.get('kpis', kpiId) : null;
    const e = (v) => this.esc(v);
    const cycles = (await db.getAll('dropdownOptions')).filter((d) => d.dropdownCategory === 'Cycle' && d.status !== 'Deactivated');
    const kpiTypes = ['Weeding / Slashing Cleared', 'Round Weeding Count', 'Compost Application', 'Pruning Palms',
      'Soil Drenching Premix', 'Seednut Collection', 'Pest and Disease Treatment']
      .concat((await this.getCustomActivities()).filter((d) => d.kpiField).map((d) => d.name));
    await auth.refreshScope();
    const kpiBlocks = auth.getAuthorizedBlocks().sort((a, b) =>
      String(a.farmBlockName).localeCompare(String(b.farmBlockName), undefined, { numeric: true }) ||
      String(a.landOwnerName).localeCompare(String(b.landOwnerName)));

    document.getElementById('form-modal-title').textContent = kpi ? `Edit KPI ${kpi.kpiId}` : 'Add New KPI Target';
    document.getElementById('form-modal-body').innerHTML = `
      <form id="kpi-form">
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label required">Activity Type</label>
            <input type="text" id="kpi-activity-type" class="form-control" list="kpi-type-list" value="${e(kpi ? kpi.activityType : '')}" placeholder="e.g. Weeding / Slashing Cleared" required />
            <datalist id="kpi-type-list">${kpiTypes.map((t) => `<option value="${e(t)}"></option>`).join('')}</datalist>
            <div class="form-helper">Pick from the list. For Other / Irregular activities, type the exact dropdown option name. New activities you added appear here too.</div>
          </div>
          <div class="form-group">
            <label class="form-label">Cycle</label>
            <input type="text" id="kpi-cycle" class="form-control" list="kpi-cycle-list" value="${e(kpi ? kpi.cycle : 'Cycle 1 (Q1)')}" />
            <datalist id="kpi-cycle-list">${cycles.map((c) => `<option value="${e(c.optionValue)}"></option>`).join('')}</datalist>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label required">Farm &amp; Block</label>
          <select id="kpi-block" class="form-control" required>
            <option value="">-- Select Farm & Block --</option>
            ${kpiBlocks.map((b) => `<option value="${e(b.blockId)}" ${kpi && b.farmBlockName === kpi.farmBlock && b.landOwnerName === kpi.landOwner && b.parcelNumber === kpi.parcelNumber ? 'selected' : ''}>
              ${e(b.farmBlockName)} — ${e(b.landOwnerName)}${b.landOwnerNo ? ` (${e(b.landOwnerNo)})` : ''} › ${e(b.parcelNumber)}</option>`).join('')}
          </select>
        </div>

        <div class="form-grid-3">
          <div class="form-group">
            <label class="form-label required">Target Quantity</label>
            <input type="number" step="0.01" min="0" id="kpi-target-qty" class="form-control" value="${e(kpi ? kpi.targetQuantity : '')}" required oninput="app.recalculateKPIDailyRate()" />
          </div>
          <div class="form-group">
            <label class="form-label required">Target Unit</label>
            <input type="text" id="kpi-target-unit" class="form-control" value="${e(kpi ? kpi.targetUnit : '')}" placeholder="Hectares / Palms / Nuts" required />
          </div>
          <div class="form-group">
            <label class="form-label required">Required Manpower</label>
            <input type="number" id="kpi-manpower" class="form-control" value="${e(kpi ? kpi.requiredManpower : 4)}" min="1" required />
          </div>
        </div>

        <div class="form-grid-3">
          <div class="form-group">
            <label class="form-label required">Target Working Days</label>
            <input type="number" id="kpi-working-days" class="form-control" value="${e(kpi ? kpi.targetWorkingDays : 1)}" min="1" required oninput="app.recalculateKPIDailyRate()" />
          </div>
          <div class="form-group">
            <label class="form-label">Effective (Start) Date</label>
            <input type="date" id="kpi-effective" class="form-control" value="${e(kpi ? kpi.effectiveDate : new Date().toISOString().split('T')[0])}" />
          </div>
          <div class="form-group">
            <label class="form-label">Daily Expected Accomplishment</label>
            <input type="number" step="0.01" id="kpi-daily-expected" class="form-control" readonly style="background:#f1f5f9;" />
          </div>
        </div>
      </form>
    `;

    this.recalculateKPIDailyRate();

    const submitBtn = document.getElementById('form-modal-submit-btn');
    submitBtn.textContent = 'Save';
    submitBtn.onclick = async () => {
      const kpiObj = {
        kpiId: kpi ? kpi.kpiId : undefined,
        activityType: document.getElementById('kpi-activity-type').value.trim(),
        cycle: document.getElementById('kpi-cycle').value.trim(),
        landOwner: '',
        parcelNumber: '',
        farmBlock: '',
        targetQuantity: parseFloat(document.getElementById('kpi-target-qty').value) || 0,
        targetUnit: document.getElementById('kpi-target-unit').value.trim(),
        requiredManpower: parseInt(document.getElementById('kpi-manpower').value) || 1,
        targetWorkingDays: parseInt(document.getElementById('kpi-working-days').value) || 1,
        dailyExpectedAccomplishment: parseFloat(document.getElementById('kpi-daily-expected').value) || 0,
        effectiveDate: document.getElementById('kpi-effective').value,
        status: 'Active'
      };
      const chosen = kpiBlocks.find((b) => b.blockId === document.getElementById('kpi-block').value);
      if (chosen) {
        kpiObj.landOwner = chosen.landOwnerName;
        kpiObj.parcelNumber = chosen.parcelNumber;
        kpiObj.farmBlock = chosen.farmBlockName;
      }
      if (!kpiObj.activityType || !kpiObj.farmBlock || !kpiObj.targetQuantity) {
        this.showToast('Activity Type, Farm & Block and Target Quantity are required.', 'warning');
        return;
      }
      submitBtn.disabled = true;
      const res = await this.runServerAction('SAVE_KPI', { kpi: kpiObj }, 'KPI saved.', null);
      submitBtn.disabled = false;
      if (res) {
        this.closeModal('form-modal');
        this.navigateTo('kpi-registration');
      }
    };

    this.openModal('form-modal');
  }

  recalculateKPIDailyRate() {
    const qty = parseFloat(document.getElementById('kpi-target-qty').value) || 0;
    const days = parseFloat(document.getElementById('kpi-working-days').value) || 1;
    document.getElementById('kpi-daily-expected').value = (days > 0 ? qty / days : qty).toFixed(2);
  }

  async deleteKPI(kpiId) {
    if (!confirm('Deactivate this KPI target?')) return;
    await this.runServerAction('DELETE_KPI', { kpiId }, 'KPI target deactivated.', 'kpi-registration');
  }

  async populateActivityDropdown(selectId, activityType, category) {
    const el = document.getElementById(selectId);
    if (!el) return;

    const allDrops = await db.getAll('dropdownOptions');
    const filtered = allDrops.filter((d) => d.activityType === activityType && d.dropdownCategory === category && d.status === 'Active');

    el.innerHTML = `<option value="">-- Select ${category} --</option>` +
      filtered.map((d) => `<option value="${d.optionValue}">${d.optionValue}</option>`).join('');
  }

  /* ==========================================================================
     PAGE 4: REGULAR ACTIVITY REGISTRATION (ALL 17 FIELDS)
     ========================================================================== */

  async renderRegularActivityForm(container) {
    const today = new Date().toISOString().split('T')[0];

    container.innerHTML = `
      <div class="card" style="max-width: 900px; margin: 0 auto;">
        <div class="card-header">
          <div>
            <div class="card-title">🌿 Regular Activity Registration</div>
            <div class="card-subtitle">Daily cyclic maintenance &amp; field input applications</div>
          </div>
          <button class="btn btn-outline" onclick="app.navigateTo('activity-selection')">&larr; Back to Hub</button>
        </div>

        <form id="form-regular-activity" onsubmit="event.preventDefault(); app.submitRegularActivity();">
          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Date</label>
              <input type="date" id="reg-date" class="form-control" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Land Owners Name</label>
              <select id="reg-landowner" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Parcel Number</label>
              <select id="reg-parcel" class="form-control" required></select>
            </div>
          </div>

          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Farm &amp; Block</label>
              <select id="reg-block" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Manpower (Count)</label>
              <input type="number" id="reg-manpower" class="form-control" min="1" value="4" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Cycle</label>
              <select id="reg-cycle" class="form-control" required></select>
            </div>
          </div>

          <div style="background: var(--palm-subtle); padding: 14px 18px; border-radius: var(--radius-md); margin-bottom: 18px; border: 1px solid var(--palm-border);">
            <div style="font-weight: 700; color: var(--palm-dark); font-size: 14px; margin-bottom: 12px;">Weeding &amp; Cultivation</div>
            <div class="form-grid-2">
              <div class="form-group">
                <label class="form-label">Weeding Rolling / Slashing Cleared (Hectares)</label>
                <input type="number" step="0.01" id="reg-weeding-ha" class="form-control" placeholder="0.00" />
              </div>
              <div class="form-group">
                <label class="form-label">Round Weeding Count of Palms</label>
                <input type="number" id="reg-round-weeding-palms" class="form-control" placeholder="0" />
              </div>
            </div>
          </div>

          <div style="background: #fefce8; padding: 14px 18px; border-radius: var(--radius-md); margin-bottom: 18px; border: 1px solid #fef08a;">
            <div style="font-weight: 700; color: #854d0e; font-size: 14px; margin-bottom: 12px;">Compost Application</div>
            <div class="form-grid-3">
              <div class="form-group">
                <label class="form-label">Compost Application Count of Palms</label>
                <input type="number" id="reg-compost-palms" class="form-control" placeholder="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Quantity in Sacks</label>
                <input type="number" step="0.1" id="reg-compost-sacks" class="form-control" placeholder="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Quantity in Kilo</label>
                <input type="number" step="0.1" id="reg-compost-kilo" class="form-control" placeholder="0" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">BOF Request Number (QR Code / Text / Number)</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="reg-bof-request" class="form-control" placeholder="Scan or enter BOF request #" />
                <button type="button" class="btn btn-secondary" onclick="app.openQrScanner('reg-bof-request')">📷 Scan</button>
              </div>
            </div>
          </div>

          <div style="background: #f0fdf4; padding: 14px 18px; border-radius: var(--radius-md); margin-bottom: 18px; border: 1px solid var(--palm-border);">
            <div style="font-weight: 700; color: var(--palm-dark); font-size: 14px; margin-bottom: 12px;">Pruning &amp; Foliar / Soil Drenching</div>
            <div class="form-grid-3">
              <div class="form-group">
                <label class="form-label">Pruning Count of Palms</label>
                <input type="number" id="reg-pruning-palms" class="form-control" placeholder="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Soil Drenching Premix Palms</label>
                <input type="number" id="reg-drench-palms" class="form-control" placeholder="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Quantity of Liters</label>
                <input type="number" step="0.1" id="reg-drench-liters" class="form-control" placeholder="0" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Foliar Request Code (QR Code / Text / Number)</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="reg-foliar-code" class="form-control" placeholder="Scan or enter Foliar code" />
                <button type="button" class="btn btn-secondary" onclick="app.openQrScanner('reg-foliar-code')">📷 Scan</button>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Remarks</label>
            <textarea id="reg-remarks" class="form-control" rows="2" placeholder="Field observations, weather conditions, equipment used..."></textarea>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
            <button type="button" class="btn btn-outline" onclick="app.navigateTo('activity-selection')">Cancel</button>
            <button type="submit" class="btn btn-primary btn-lg">✓ Save &amp; Submit Regular Report</button>
          </div>
        </form>
      </div>
    `;

    await this.populateCascadingDropdowns('reg-landowner', 'reg-parcel', 'reg-block');
    await this.populateActivityDropdown('reg-cycle', 'Regular Activity', 'Cycle');
  }

  async submitRegularActivity() {
    const reportData = {
      activityType: 'Regular Activity',
      userId: auth.getUserId(),
      employeeName: auth.getEmployeeName(),
      date: document.getElementById('reg-date').value,
      ...this.selectedLandownerFields('reg-landowner'),
      parcelNumber: document.getElementById('reg-parcel').value,
      farmBlock: document.getElementById('reg-block').value,
      manpower: parseFloat(document.getElementById('reg-manpower').value) || 1,
      cycle: document.getElementById('reg-cycle').value,
      weedingSlashingHa: parseFloat(document.getElementById('reg-weeding-ha').value) || 0,
      roundWeedingPalms: parseInt(document.getElementById('reg-round-weeding-palms').value) || 0,
      compostPalms: parseInt(document.getElementById('reg-compost-palms').value) || 0,
      quantitySacks: parseFloat(document.getElementById('reg-compost-sacks').value) || 0,
      quantityKilo: parseFloat(document.getElementById('reg-compost-kilo').value) || 0,
      bofRequestNo: document.getElementById('reg-bof-request').value.trim(),
      pruningPalms: parseInt(document.getElementById('reg-pruning-palms').value) || 0,
      soilDrenchingPalms: parseInt(document.getElementById('reg-drench-palms').value) || 0,
      quantityLiters: parseFloat(document.getElementById('reg-drench-liters').value) || 0,
      foliarRequestCode: document.getElementById('reg-foliar-code').value.trim(),
      remarks: document.getElementById('reg-remarks').value.trim(),
      gpsLatitude: this.gpsCoordinates ? this.gpsCoordinates.latitude : '',
      gpsLongitude: this.gpsCoordinates ? this.gpsCoordinates.longitude : ''
    };

    const saved = await syncService.submitReportLocally(reportData);
    this.showToast('Regular Activity Report recorded successfully!', 'success');
    this.navigateTo('daily-monitoring');
  }

  /* ==========================================================================
     PAGE 5: IRREGULAR ACTIVITY REGISTRATION (ALL 12 FIELDS)
     ========================================================================== */

  async renderIrregularActivityForm(container) {
    const today = new Date().toISOString().split('T')[0];

    container.innerHTML = `
      <div class="card" style="max-width: 900px; margin: 0 auto;">
        <div class="card-header">
          <div>
            <div class="card-title">🛡️ Irregular Activity Registration</div>
            <div class="card-subtitle">Special pest treatments, crown sanitation &amp; non-cyclic farm tasks</div>
          </div>
          <button class="btn btn-outline" onclick="app.navigateTo('activity-selection')">&larr; Back to Hub</button>
        </div>

        <form id="form-irregular-activity" onsubmit="event.preventDefault(); app.submitIrregularActivity();">
          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Date</label>
              <input type="date" id="irreg-date" class="form-control" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Land Owners Name</label>
              <select id="irreg-landowner" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Parcel Number</label>
              <select id="irreg-parcel" class="form-control" required></select>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label required">Farm &amp; Block</label>
              <select id="irreg-block" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Manpower (Count)</label>
              <input type="number" id="irreg-manpower" class="form-control" min="1" value="3" required />
            </div>
          </div>

          <div style="background: #fef2f2; padding: 14px 18px; border-radius: var(--radius-md); margin-bottom: 18px; border: 1px solid #fecaca;">
            <div style="font-weight: 700; color: #991b1b; font-size: 14px; margin-bottom: 12px;">Pest and Disease Treatment (Soil Drench)</div>
            <div class="form-grid-3">
              <div class="form-group">
                <label class="form-label">Pest &amp; Disease Treatment</label>
                <select id="irreg-treatment" class="form-control"></select>
              </div>
              <div class="form-group">
                <label class="form-label">Count of Palms</label>
                <input type="number" id="irreg-drench-palms" class="form-control" placeholder="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Quantity of Liters</label>
                <input type="number" step="0.1" id="irreg-drench-liters" class="form-control" placeholder="0" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Foliar Request Number (QR Code / Text / Number)</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="irreg-foliar-request" class="form-control" placeholder="Scan or enter request #" />
                <button type="button" class="btn btn-secondary" onclick="app.openQrScanner('irreg-foliar-request')">📷 Scan</button>
              </div>
            </div>
          </div>

          <div style="background: #f8fafc; padding: 14px 18px; border-radius: var(--radius-md); margin-bottom: 18px; border: 1px solid var(--border);">
            <div style="font-weight: 700; color: var(--text-main); font-size: 14px; margin-bottom: 12px;">Other Irregular Activity Details</div>
            <div class="form-grid-3">
              <div class="form-group">
                <label class="form-label">Irregular Activity</label>
                <select id="irreg-activity-dropdown" class="form-control"></select>
              </div>
              <div class="form-group">
                <label class="form-label">Count of Palms</label>
                <input type="number" id="irreg-palms-2" class="form-control" placeholder="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Count of Manpower</label>
                <input type="number" id="irreg-manpower-2" class="form-control" placeholder="0" />
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Remarks</label>
            <textarea id="irreg-remarks" class="form-control" rows="2" placeholder="Notes on pest severity, area conditions..."></textarea>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
            <button type="button" class="btn btn-outline" onclick="app.navigateTo('activity-selection')">Cancel</button>
            <button type="submit" class="btn btn-primary btn-lg">✓ Save &amp; Submit Irregular Report</button>
          </div>
        </form>
      </div>
    `;

    await this.populateCascadingDropdowns('irreg-landowner', 'irreg-parcel', 'irreg-block');
    await this.populateActivityDropdown('irreg-treatment', 'Irregular Activity', 'Pest and Disease Treatment (Soil Drench)');
    await this.populateActivityDropdown('irreg-activity-dropdown', 'Irregular Activity', 'Irregular Activity');
  }

  async submitIrregularActivity() {
    const reportData = {
      activityType: 'Irregular Activity',
      userId: auth.getUserId(),
      employeeName: auth.getEmployeeName(),
      date: document.getElementById('irreg-date').value,
      ...this.selectedLandownerFields('irreg-landowner'),
      parcelNumber: document.getElementById('irreg-parcel').value,
      farmBlock: document.getElementById('irreg-block').value,
      manpower: parseFloat(document.getElementById('irreg-manpower').value) || 1,
      pestTreatmentSoilDrench: document.getElementById('irreg-treatment').value,
      countOfPalms: parseInt(document.getElementById('irreg-drench-palms').value) || 0,
      quantityLiters: parseFloat(document.getElementById('irreg-drench-liters').value) || 0,
      foliarRequestNumber: document.getElementById('irreg-foliar-request').value.trim(),
      irregularActivity: document.getElementById('irreg-activity-dropdown').value,
      countOfPalms2: parseInt(document.getElementById('irreg-palms-2').value) || 0,
      countOfManpower2: parseInt(document.getElementById('irreg-manpower-2').value) || 0,
      remarks: document.getElementById('irreg-remarks').value.trim(),
      gpsLatitude: this.gpsCoordinates ? this.gpsCoordinates.latitude : '',
      gpsLongitude: this.gpsCoordinates ? this.gpsCoordinates.longitude : ''
    };

    await syncService.submitReportLocally(reportData);
    this.showToast('Irregular Activity Report saved successfully!', 'success');
    this.navigateTo('daily-monitoring');
  }

  /* ==========================================================================
     PAGE 6: OTHER FARM ACTIVITY REGISTRATION (ALL 8 FIELDS)
     ========================================================================== */

  async renderOtherFarmActivityForm(container) {
    const today = new Date().toISOString().split('T')[0];

    container.innerHTML = `
      <div class="card" style="max-width: 800px; margin: 0 auto;">
        <div class="card-header">
          <div>
            <div class="card-title">🚜 Other Farm Activity Registration</div>
            <div class="card-subtitle">General infrastructure, roads, nursery &amp; auxiliary tasks</div>
          </div>
          <button class="btn btn-outline" onclick="app.navigateTo('activity-selection')">&larr; Back to Hub</button>
        </div>

        <form id="form-other-activity" onsubmit="event.preventDefault(); app.submitOtherFarmActivity();">
          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Date</label>
              <input type="date" id="other-date" class="form-control" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Land Owners Name</label>
              <select id="other-landowner" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Parcel Number</label>
              <select id="other-parcel" class="form-control" required></select>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label required">Farm &amp; Block</label>
              <select id="other-block" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Manpower (Count)</label>
              <input type="number" id="other-manpower" class="form-control" min="1" value="2" required />
            </div>
          </div>

          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Other Activities</label>
              <select id="other-activity-select" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Quantity</label>
              <input type="number" step="0.01" id="other-quantity" class="form-control" placeholder="0" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Unit</label>
              <select id="other-unit-select" class="form-control" required></select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Remarks</label>
            <textarea id="other-remarks" class="form-control" rows="2" placeholder="Task details, progress, materials used..."></textarea>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
            <button type="button" class="btn btn-outline" onclick="app.navigateTo('activity-selection')">Cancel</button>
            <button type="submit" class="btn btn-primary btn-lg">✓ Save &amp; Submit Other Farm Report</button>
          </div>
        </form>
      </div>
    `;

    await this.populateCascadingDropdowns('other-landowner', 'other-parcel', 'other-block');
    await this.populateActivityDropdown('other-activity-select', 'Other Farm Activity', 'Other Activities');
    await this.populateActivityDropdown('other-unit-select', 'Other Farm Activity', 'Unit');
  }

  async submitOtherFarmActivity() {
    const reportData = {
      activityType: 'Other Farm Activity',
      userId: auth.getUserId(),
      employeeName: auth.getEmployeeName(),
      date: document.getElementById('other-date').value,
      ...this.selectedLandownerFields('other-landowner'),
      parcelNumber: document.getElementById('other-parcel').value,
      farmBlock: document.getElementById('other-block').value,
      manpower: parseFloat(document.getElementById('other-manpower').value) || 1,
      otherActivities: document.getElementById('other-activity-select').value,
      quantity: parseFloat(document.getElementById('other-quantity').value) || 0,
      unit: document.getElementById('other-unit-select').value,
      remarks: document.getElementById('other-remarks').value.trim(),
      gpsLatitude: this.gpsCoordinates ? this.gpsCoordinates.latitude : '',
      gpsLongitude: this.gpsCoordinates ? this.gpsCoordinates.longitude : ''
    };

    await syncService.submitReportLocally(reportData);
    this.showToast('Other Farm Activity Report saved successfully!', 'success');
    this.navigateTo('daily-monitoring');
  }

  /* ==========================================================================
     PAGE 7: PALM CATEGORY ACTIVITY REGISTRATION (ALL 14 FIELDS)
     ========================================================================== */

  async renderPalmCategoryForm(container) {
    const nowIso = new Date().toISOString();

    container.innerHTML = `
      <div class="card" style="max-width: 900px; margin: 0 auto;">
        <div class="card-header">
          <div>
            <div class="card-title">🌴 Palm Category Activity Registration</div>
            <div class="card-subtitle">Detailed coconut developmental stage census &amp; health tracking</div>
          </div>
          <button class="btn btn-outline" onclick="app.navigateTo('activity-selection')">&larr; Back to Hub</button>
        </div>

        <form id="form-palm-category" onsubmit="event.preventDefault(); app.submitPalmCategoryActivity();">
          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label">Automatic Timestamp</label>
              <input type="text" id="palm-timestamp" class="form-control" value="${nowIso}" readonly style="background:#f1f5f9;" />
            </div>
            <div class="form-group">
              <label class="form-label required">Land Owners Name</label>
              <select id="palm-landowner" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Parcel Number</label>
              <select id="palm-parcel" class="form-control" required></select>
            </div>
          </div>

          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Farm &amp; Block</label>
              <select id="palm-block" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Palm Number / ID Range</label>
              <input type="text" id="palm-number" class="form-control" placeholder="e.g. Palm 101 or 1-50" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Manpower Count</label>
              <input type="number" id="palm-manpower" class="form-control" min="1" value="2" required />
            </div>
          </div>

          <div style="background: var(--palm-subtle); padding: 18px 20px; border-radius: var(--radius-lg); margin-bottom: 20px; border: 1px solid var(--palm-border);">
            <div style="font-weight: 700; color: var(--palm-dark); font-size: 14.5px; margin-bottom: 14px;">
              Coconut Developmental Stages Census (Count of Palms)
            </div>

            <div class="form-grid-3">
              <div class="form-group">
                <label class="form-label">Seedling Stage</label>
                <input type="number" id="palm-seedling" class="form-control" placeholder="0" min="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Juvenile Stage</label>
                <input type="number" id="palm-juvenile" class="form-control" placeholder="0" min="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Pre-trunk Reproductive (Semi Juvenile)</label>
                <input type="number" id="palm-pre-reproductive" class="form-control" placeholder="0" min="0" />
              </div>
            </div>

            <div class="form-grid-3" style="margin-top: 10px;">
              <div class="form-group">
                <label class="form-label">Pre-trunk Fruiting (Semi Mature)</label>
                <input type="number" id="palm-pre-fruiting" class="form-control" placeholder="0" min="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Mature Stage</label>
                <input type="number" id="palm-mature" class="form-control" placeholder="0" min="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Fruiting Stage</label>
                <input type="number" id="palm-fruiting" class="form-control" placeholder="0" min="0" />
              </div>
            </div>

            <div class="form-group" style="margin-top: 12px;">
              <label class="form-label" style="color: var(--alert-red);">Problem Palms (Diseased, Stunted, Pest Affected)</label>
              <input type="number" id="palm-problem" class="form-control" placeholder="0" min="0" style="border-color: #fecaca; background: #fff5f5;" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Remarks</label>
            <textarea id="palm-remarks" class="form-control" rows="2" placeholder="Crown vigor observations, nutrient deficiencies..."></textarea>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
            <button type="button" class="btn btn-outline" onclick="app.navigateTo('activity-selection')">Cancel</button>
            <button type="submit" class="btn btn-primary btn-lg">✓ Save &amp; Submit Palm Category</button>
          </div>
        </form>
      </div>
    `;

    await this.populateCascadingDropdowns('palm-landowner', 'palm-parcel', 'palm-block');
  }

  async submitPalmCategoryActivity() {
    const reportData = {
      activityType: 'Palm Category Activity',
      userId: auth.getUserId(),
      employeeName: auth.getEmployeeName(),
      timestamp: document.getElementById('palm-timestamp').value,
      date: new Date().toISOString().split('T')[0],
      ...this.selectedLandownerFields('palm-landowner'),
      parcelNumber: document.getElementById('palm-parcel').value,
      farmBlock: document.getElementById('palm-block').value,
      palmNumber: document.getElementById('palm-number').value.trim(),
      manpowerCount: parseFloat(document.getElementById('palm-manpower').value) || 1,
      seedlingStage: parseInt(document.getElementById('palm-seedling').value) || 0,
      juvenileStage: parseInt(document.getElementById('palm-juvenile').value) || 0,
      preTrunkReproductiveStage: parseInt(document.getElementById('palm-pre-reproductive').value) || 0,
      preTrunkFruitingStage: parseInt(document.getElementById('palm-pre-fruiting').value) || 0,
      matureStage: parseInt(document.getElementById('palm-mature').value) || 0,
      fruitingStage: parseInt(document.getElementById('palm-fruiting').value) || 0,
      problemPalms: parseInt(document.getElementById('palm-problem').value) || 0,
      remarks: document.getElementById('palm-remarks').value.trim(),
      gpsLatitude: this.gpsCoordinates ? this.gpsCoordinates.latitude : '',
      gpsLongitude: this.gpsCoordinates ? this.gpsCoordinates.longitude : ''
    };

    await syncService.submitReportLocally(reportData);
    this.showToast('Palm Category census saved successfully!', 'success');
    this.navigateTo('daily-monitoring');
  }

  /* ==========================================================================
     PAGE 8: SEEDNUT COLLECTION REGISTRATION (ALL 7 FIELDS + AUTO GPS)
     ========================================================================== */

  async renderSeednutCollectionForm(container) {
    const today = new Date().toISOString().split('T')[0];

    // Refresh GPS coordinates on view load
    await this.captureCurrentGps();

    const gpsDisplay = this.gpsCoordinates
      ? `Lat: ${this.gpsCoordinates.latitude.toFixed(5)}, Lng: ${this.gpsCoordinates.longitude.toFixed(5)} (±${Math.round(this.gpsCoordinates.accuracy)}m)`
      : 'Acquiring GPS coordinates...';

    container.innerHTML = `
      <div class="card" style="max-width: 800px; margin: 0 auto;">
        <div class="card-header">
          <div>
            <div class="card-title">🥥 Seednut Collection Registration</div>
            <div class="card-subtitle">Harvest counting, seed selection &amp; geo-tagged palm location</div>
          </div>
          <button class="btn btn-outline" onclick="app.navigateTo('activity-selection')">&larr; Back to Hub</button>
        </div>

        <form id="form-seednut" onsubmit="event.preventDefault(); app.submitSeednutCollection();">
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label required">Date</label>
              <input type="date" id="seed-date" class="form-control" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Area Code (QR Code / Text)</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="seed-area-code" class="form-control" placeholder="Scan or enter Area Code" required />
                <button type="button" class="btn btn-secondary" onclick="app.openQrScanner('seed-area-code')">📷 Scan</button>
              </div>
            </div>
          </div>

          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Land Owners Name</label>
              <select id="seed-landowner" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Parcel Number</label>
              <select id="seed-parcel" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Farm &amp; Block</label>
              <select id="seed-block" class="form-control" required></select>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label required">Palm Number</label>
              <input type="number" id="seed-palm-number" class="form-control" placeholder="Enter Tree / Palm #" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Nut Count Collected</label>
              <input type="number" id="seed-nuts-collected" class="form-control" placeholder="0" min="0" required />
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Count of Nuts for Next Collection</label>
              <input type="number" id="seed-nuts-next" class="form-control" placeholder="0" min="0" />
            </div>
            <div class="form-group">
              <label class="form-label">Count of Rejected Nuts</label>
              <input type="number" id="seed-nuts-rejected" class="form-control" placeholder="0" min="0" />
            </div>
          </div>

          <!-- GPS Location Display Card -->
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: var(--radius-md); padding: 14px 18px; margin-bottom: 18px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div>
                <div style="font-weight: 700; color: #1e40af; font-size: 13.5px;">📍 Automatic GPS Location Coordinates</div>
                <div id="seed-gps-display" style="font-size: 12.5px; color: #2563eb; margin-top: 2px;">${gpsDisplay}</div>
              </div>
              <button type="button" class="btn btn-outline" style="font-size: 12px; padding: 6px 10px;" onclick="app.refreshSeednutGps()">
                🔄 Refresh GPS
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Remarks</label>
            <textarea id="seed-remarks" class="form-control" rows="2" placeholder="Nut size, maturity grade, germination suitability..."></textarea>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
            <button type="button" class="btn btn-outline" onclick="app.navigateTo('activity-selection')">Cancel</button>
            <button type="submit" class="btn btn-primary btn-lg">✓ Save &amp; Submit Seednut Report</button>
          </div>
        </form>
      </div>
    `;

    await this.populateCascadingDropdowns('seed-landowner', 'seed-parcel', 'seed-block');
  }

  async refreshSeednutGps() {
    const displayEl = document.getElementById('seed-gps-display');
    if (displayEl) displayEl.textContent = 'Updating live GPS coordinates...';
    const coords = await this.captureCurrentGps();
    if (coords && displayEl) {
      displayEl.textContent = `Lat: ${coords.latitude.toFixed(5)}, Lng: ${coords.longitude.toFixed(5)} (±${Math.round(coords.accuracy)}m)`;
      this.showToast('GPS coordinates acquired with high precision.', 'success');
    } else if (displayEl) {
      displayEl.textContent = 'GPS location unavailable or permission denied.';
    }
  }

  async submitSeednutCollection() {
    const reportData = {
      activityType: 'Seednut Collection',
      userId: auth.getUserId(),
      employeeName: auth.getEmployeeName(),
      date: document.getElementById('seed-date').value,
      areaCode: document.getElementById('seed-area-code').value.trim(),
      ...this.selectedLandownerFields('seed-landowner'),
      parcelNumber: document.getElementById('seed-parcel').value,
      farmBlock: document.getElementById('seed-block').value,
      palmNumber: document.getElementById('seed-palm-number').value.trim(),
      nutCountCollected: parseInt(document.getElementById('seed-nuts-collected').value) || 0,
      countOfNutsNextCollection: parseInt(document.getElementById('seed-nuts-next').value) || 0,
      countOfRejectedNuts: parseInt(document.getElementById('seed-nuts-rejected').value) || 0,
      remarks: document.getElementById('seed-remarks').value.trim(),
      gpsLatitude: this.gpsCoordinates ? this.gpsCoordinates.latitude : '',
      gpsLongitude: this.gpsCoordinates ? this.gpsCoordinates.longitude : '',
      gpsAccuracy: this.gpsCoordinates ? this.gpsCoordinates.accuracy : ''
    };

    await syncService.submitReportLocally(reportData);
    this.showToast('Seednut Collection report saved successfully!', 'success');
    this.navigateTo('daily-monitoring');
  }

  /* ==========================================================================
     PAGE 9: PEST AND DISEASE ACTIVITY REGISTRATION (ALL 14 FIELDS)
     ========================================================================== */

  async renderPestDiseaseForm(container) {
    const today = new Date().toISOString().split('T')[0];

    container.innerHTML = `
      <div class="card" style="max-width: 900px; margin: 0 auto;">
        <div class="card-header">
          <div>
            <div class="card-title">🔬 Pest &amp; Disease Activity Registration</div>
            <div class="card-subtitle">Phytosanitary intervention, pest targeting &amp; chemical / biological application</div>
          </div>
          <button class="btn btn-outline" onclick="app.navigateTo('activity-selection')">&larr; Back to Hub</button>
        </div>

        <form id="form-pest-disease" onsubmit="event.preventDefault(); app.submitPestDiseaseActivity();">
          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Date</label>
              <input type="date" id="pest-date" class="form-control" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Land Owners Name</label>
              <select id="pest-landowner" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Parcel Number</label>
              <select id="pest-parcel" class="form-control" required></select>
            </div>
          </div>

          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label required">Farm &amp; Block</label>
              <select id="pest-block" class="form-control" required></select>
            </div>
            <div class="form-group">
              <label class="form-label required">Palm Numbers / Range</label>
              <input type="text" id="pest-palms-range" class="form-control" placeholder="e.g. Palm 40 to 85" required />
            </div>
            <div class="form-group">
              <label class="form-label required">Manpower Count</label>
              <input type="number" id="pest-manpower" class="form-control" min="1" value="2" required />
            </div>
          </div>

          <div style="background: #fef2f2; padding: 18px 20px; border-radius: var(--radius-lg); margin-bottom: 20px; border: 1px solid #fecaca;">
            <div style="font-weight: 700; color: #991b1b; font-size: 14.5px; margin-bottom: 14px;">
              Pest Diagnosis &amp; Input Specification
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label class="form-label required">Target Pest</label>
                <select id="pest-target" class="form-control" required></select>
              </div>
              <div class="form-group">
                <label class="form-label required">Total Number of Palms Affected</label>
                <input type="number" id="pest-palms-affected" class="form-control" placeholder="0" min="1" required />
              </div>
            </div>

            <div class="form-grid-3">
              <div class="form-group">
                <label class="form-label required">Input Used</label>
                <select id="pest-input-used" class="form-control" required></select>
              </div>
              <div class="form-group">
                <label class="form-label required">Quantity</label>
                <input type="number" step="0.01" id="pest-quantity" class="form-control" placeholder="0" required />
              </div>
              <div class="form-group">
                <label class="form-label required">Unit</label>
                <select id="pest-unit" class="form-control" required></select>
              </div>
            </div>

            <div class="form-grid-3" style="margin-top: 10px;">
              <div class="form-group">
                <label class="form-label">Ratio / Dilution (e.g. 1:200)</label>
                <input type="text" id="pest-ratio" class="form-control" placeholder="e.g. 50ml per 20L water" />
              </div>
              <div class="form-group">
                <label class="form-label required">Method Used</label>
                <select id="pest-method" class="form-control" required></select>
              </div>
              <div class="form-group">
                <label class="form-label required">Target Parts for Application</label>
                <select id="pest-target-parts" class="form-control" required></select>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Remarks</label>
            <textarea id="pest-remarks" class="form-control" rows="2" placeholder="Infestation symptoms, larval stages found, follow-up schedule..."></textarea>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
            <button type="button" class="btn btn-outline" onclick="app.navigateTo('activity-selection')">Cancel</button>
            <button type="submit" class="btn btn-primary btn-lg">✓ Save &amp; Submit Pest Report</button>
          </div>
        </form>
      </div>
    `;

    await this.populateCascadingDropdowns('pest-landowner', 'pest-parcel', 'pest-block');
    await this.populateActivityDropdown('pest-target', 'Pest and Disease Activity', 'Target Pest');
    await this.populateActivityDropdown('pest-input-used', 'Pest and Disease Activity', 'Input Used');
    await this.populateActivityDropdown('pest-unit', 'Pest and Disease Activity', 'Unit');
    await this.populateActivityDropdown('pest-method', 'Pest and Disease Activity', 'Method Used');
    await this.populateActivityDropdown('pest-target-parts', 'Pest and Disease Activity', 'Target Parts for Application');
  }

  async submitPestDiseaseActivity() {
    const reportData = {
      activityType: 'Pest and Disease Activity',
      userId: auth.getUserId(),
      employeeName: auth.getEmployeeName(),
      date: document.getElementById('pest-date').value,
      ...this.selectedLandownerFields('pest-landowner'),
      parcelNumber: document.getElementById('pest-parcel').value,
      palmNumbers: document.getElementById('pest-palms-range').value.trim(),
      farmBlock: document.getElementById('pest-block').value,
      targetPest: document.getElementById('pest-target').value,
      totalPalmsAffected: parseInt(document.getElementById('pest-palms-affected').value) || 0,
      inputUsed: document.getElementById('pest-input-used').value,
      quantity: parseFloat(document.getElementById('pest-quantity').value) || 0,
      unit: document.getElementById('pest-unit').value,
      ratio: document.getElementById('pest-ratio').value.trim(),
      methodUsed: document.getElementById('pest-method').value,
      targetPartsApplication: document.getElementById('pest-target-parts').value,
      manpowerCount: parseFloat(document.getElementById('pest-manpower').value) || 1,
      remarks: document.getElementById('pest-remarks').value.trim(),
      gpsLatitude: this.gpsCoordinates ? this.gpsCoordinates.latitude : '',
      gpsLongitude: this.gpsCoordinates ? this.gpsCoordinates.longitude : ''
    };

    await syncService.submitReportLocally(reportData);
    this.showToast('Pest & Disease Report saved successfully!', 'success');
    this.navigateTo('daily-monitoring');
  }

  /* ==========================================================================
     PAGE 10: DAILY ACTIVITY MONITORING (CONSOLIDATED PROGRESS & KPI)
     ========================================================================== */

  async renderDailyMonitoringView(container) {
    await auth.refreshScope();
    const rawReports = await db.getAll('reports');
    const reports = auth.filterAuthorizedRecords(rawReports);
    const kpis = auth.filterAuthorizedKpis(await db.getAll('kpis'));

    // Consolidated monitoring calculation
    const monitoringRows = [];

    kpis.forEach((k) => {
      const targetQty = parseFloat(k.targetQuantity) || 0;
      const targetMan = parseFloat(k.requiredManpower) || 1;
      const dailyExpected = parseFloat(k.dailyExpectedAccomplishment) || (targetQty / (parseFloat(k.targetWorkingDays) || 1));

      // Match reports without double-counting (keyed by unique UUID)
      let cumAccomplishment = 0;
      let cumManpower = 0;
      let dailyAccomplishment = 0;
      let latestDate = '';

      reports.forEach((mr) => {
        const val = this.kpiValueForReport(k, mr);
        if (val === null) return;
        cumAccomplishment += val;
        cumManpower += parseFloat(mr.manpower || mr.manpowerCount || mr.countOfManpower2 || 1);
        if (!latestDate || (mr.date && mr.date >= latestDate)) {
          dailyAccomplishment = val; // latest recorded
          latestDate = mr.date || latestDate;
        }
      });

      const kpiPct = targetQty > 0 ? (cumAccomplishment / targetQty) * 100 : 0;
      const remainingTarget = Math.max(0, targetQty - cumAccomplishment);
      const productivityPerMan = cumManpower > 0 ? (cumAccomplishment / cumManpower) : (dailyExpected / targetMan);

      // Estimated days to complete
      const expectedDaily = cumManpower > 0 ? (cumManpower * productivityPerMan) : dailyExpected;
      const daysToComplete = expectedDaily > 0 ? Math.ceil(remainingTarget / expectedDaily) : 0;

      // Forecast date
      const forecastDate = this.calculateForecastCompletionDate(new Date(), daysToComplete);

      // Status
      let status = 'Not Started';
      if (cumAccomplishment >= targetQty && targetQty > 0) status = 'Completed';
      else if (cumAccomplishment > 0) {
        if (kpiPct >= 100) status = 'Completed';
        else if (kpiPct >= 80) status = 'Ahead of Schedule';
        else if (kpiPct >= 40) status = 'On Track';
        else status = 'Behind Schedule';
      }

      monitoringRows.push({
        kpiId: k.kpiId,
        activityType: k.activityType,
        landOwner: k.landOwner,
        parcelNumber: k.parcelNumber,
        farmBlock: k.farmBlock,
        manpower: cumManpower || targetMan,
        dailyAccomplishment: dailyAccomplishment,
        cumulativeAccomplishment: cumAccomplishment,
        targetAccomplishment: targetQty,
        targetUnit: k.targetUnit,
        remainingTarget: remainingTarget,
        kpiPercentage: Math.round(kpiPct * 10) / 10,
        expectedDate: forecastDate,
        status: status,
        latestDate: latestDate || 'Pending'
      });
    });

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Daily Activity Monitoring</h2>
          <p style="font-size: 13.5px; color: var(--text-muted);">
            Consolidated daily &amp; cumulative progress tracking against registered KPI targets.
          </p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary" onclick="app.navigateTo('activity-selection')">+ New Report</button>
          <button class="btn btn-outline" onclick="app.navigateTo('reports')">Export Data</button>
        </div>
      </div>

      <!-- Quick Filter Bar -->
      <div class="filter-toolbar">
        <input type="text" id="mon-search" class="form-control" placeholder="🔍 Search activity, parcel, block..." oninput="app.filterMonitoringTable()" />
        <select id="mon-filter-status" class="form-control" onchange="app.filterMonitoringTable()">
          <option value="ALL">All Statuses</option>
          <option value="Completed">Completed</option>
          <option value="Ahead of Schedule">Ahead of Schedule</option>
          <option value="On Track">On Track</option>
          <option value="Behind Schedule">Behind Schedule</option>
          <option value="Not Started">Not Started</option>
        </select>
      </div>

      <!-- Monitoring Data Table -->
      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="table-responsive">
          <table class="table" id="monitoring-table">
            <thead>
              <tr>
                <th>Activity Name</th>
                <th>Landowner &amp; Parcel</th>
                <th>Farm &amp; Block</th>
                <th>Daily Acc.</th>
                <th>Cumulative Acc.</th>
                <th>Target</th>
                <th>Remaining</th>
                <th>KPI %</th>
                <th>Forecast Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${monitoringRows.length === 0 ? `
                <tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 28px;">No KPI targets registered yet.</td></tr>
              ` : monitoringRows.map((m) => `
                <tr class="mon-row" data-status="${m.status}" data-search="${(m.activityType + ' ' + m.landOwner + ' ' + m.parcelNumber + ' ' + m.farmBlock).toLowerCase()}">
                  <td><strong>${m.activityType}</strong></td>
                  <td>${m.landOwner}<br/><span style="font-size: 11px; color: var(--text-muted);">${m.parcelNumber}</span></td>
                  <td>${m.farmBlock}</td>
                  <td>${m.dailyAccomplishment} ${m.targetUnit}</td>
                  <td><strong>${m.cumulativeAccomplishment} ${m.targetUnit}</strong></td>
                  <td>${m.targetAccomplishment} ${m.targetUnit}</td>
                  <td>${m.remainingTarget}</td>
                  <td>
                    <div style="font-weight: 700; color: ${m.kpiPercentage >= 80 ? 'var(--palm-primary)' : 'var(--coconut-amber)'};">
                      ${m.kpiPercentage}%
                    </div>
                  </td>
                  <td><span style="font-size: 12px;">${m.expectedDate}</span></td>
                  <td>
                    <span class="badge ${this.getBadgeClassForStatus(m.status)}">
                      ${m.status}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  filterMonitoringTable() {
    const search = (document.getElementById('mon-search').value || '').toLowerCase().trim();
    const status = document.getElementById('mon-filter-status').value;
    const rows = document.querySelectorAll('.mon-row');

    rows.forEach((r) => {
      const rowSearch = r.getAttribute('data-search') || '';
      const rowStatus = r.getAttribute('data-status') || '';
      const matchSearch = !search || rowSearch.includes(search);
      const matchStatus = status === 'ALL' || rowStatus === status;

      r.style.display = matchSearch && matchStatus ? '' : 'none';
    });
  }

  getBadgeClassForStatus(status) {
    switch (status) {
      case 'Completed': return 'badge-completed';
      case 'Ahead of Schedule': return 'badge-ahead';
      case 'On Track': return 'badge-ontrack';
      case 'Behind Schedule': return 'badge-behind';
      case 'Ongoing': return 'badge-ongoing';
      default: return 'badge-notstarted';
    }
  }

  calculateForecastCompletionDate(startDate, daysNeeded) {
    if (daysNeeded <= 0) return 'Completed';
    const date = new Date(startDate);
    let addedDays = 0;

    while (addedDays < daysNeeded) {
      date.setDate(date.getDate() + 1);
      // Skip Sundays (standard plantation rest day)
      if (date.getDay() !== 0) {
        addedDays++;
      }
    }
    return date.toISOString().split('T')[0];
  }

  /* ==========================================================================
     PAGE 12: MANPOWER MONITORING & FORECASTING
     ========================================================================== */

  async renderManpowerMonitoringView(container) {
    const reports = auth.filterAuthorizedRecords(await db.getAll('reports'));

    let totalManpower = 0;
    const activityManpowerMap = {};
    const farmManpowerMap = {};

    reports.forEach((r) => {
      const man = parseFloat(r.manpower || r.manpowerCount || 1);
      totalManpower += man;

      const act = r.activityType || 'Other';
      activityManpowerMap[act] = (activityManpowerMap[act] || 0) + man;

      const block = r.farmBlock || 'Unassigned';
      farmManpowerMap[block] = (farmManpowerMap[block] || 0) + man;
    });

    container.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Manpower Monitoring &amp; Forecasting</h2>
        <p style="font-size: 13.5px; color: var(--text-muted);">
          Monitor labor deployment, productivity per worker, and forecast completion dates based on available crew size.
        </p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon green">👥</div>
          <div class="stat-info">
            <div class="stat-label">Total Field Workers</div>
            <div class="stat-value">${totalManpower}</div>
            <div class="stat-sub">Cumulated Man-Days</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon emerald">⚡</div>
          <div class="stat-info">
            <div class="stat-label">Daily Productivity</div>
            <div class="stat-value">25 Palms</div>
            <div class="stat-sub">Average per person / day</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon amber">⏳</div>
          <div class="stat-info">
            <div class="stat-label">Est. Completion Days</div>
            <div class="stat-value">4.2 Days</div>
            <div class="stat-sub">Based on 4-man crew</div>
          </div>
        </div>
      </div>

      <!-- Manpower Deployment Table -->
      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="card-header" style="padding: 16px 20px;">
          <div class="card-title">Daily Manpower Deployment Log</div>
        </div>
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Activity</th>
                <th>Farm &amp; Block</th>
                <th>Supervisor / Lead</th>
                <th>Manpower Count</th>
                <th>Productivity</th>
              </tr>
            </thead>
            <tbody>
              ${reports.slice(0, 10).map((r) => `
                <tr>
                  <td><strong>${r.date || 'Today'}</strong></td>
                  <td>${r.activityType}</td>
                  <td>${this.esc(r.farmBlock || '—')}</td>
                  <td>${r.employeeName || 'Supervisor'}</td>
                  <td><span class="badge badge-completed">${r.manpower || r.manpowerCount || 1} pax</span></td>
                  <td>
                    ${r.roundWeedingPalms ? `${(r.roundWeedingPalms / (r.manpower || 1)).toFixed(1)} palms/pax` : 'Standard'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     PAGE 13: OFFLINE FARM MAPS (real GeoJSON rendering)
     ========================================================================== */

  async renderFarmMapView(container) {
    const maps = (await db.getAll('maps')).sort((a, b) => String(b.uploadDate || '').localeCompare(String(a.uploadDate || '')));
    if (!this.selectedMapId || !maps.some((m) => m.mapId === this.selectedMapId)) {
      this.selectedMapId = maps[0] ? maps[0].mapId : null;
    }
    const activeMap = maps.find((m) => m.mapId === this.selectedMapId);
    const e = (v) => this.esc(v);

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Offline Farm Maps</h2>
          <p style="font-size: 13.5px; color: var(--text-muted);">
            Parcel &amp; block boundaries with your live GPS position. Works offline after downloading.
          </p>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${auth.isAdmin() ? `<button class="btn btn-primary" onclick="app.openUploadMapModal()">+ Upload Map (KML / KMZ / GeoJSON)</button>` : ''}
          <button class="btn btn-secondary" onclick="app.downloadOfflineMapPackage()">⬇️ Download / Update Maps</button>
        </div>
      </div>

      ${maps.length === 0 ? `
        <div class="card" style="text-align:center;color:var(--text-muted);padding:40px;">
          🗺️ No farm maps on this device yet.<br/>Tap <strong>Download / Update Maps</strong> while online${auth.isAdmin() ? ', or upload a GeoJSON map' : ''}.
        </div>` : `
      <div class="card" style="padding: 0; overflow: hidden; border-radius: var(--radius-xl);">
        <div style="padding: 12px 18px; background: #ffffff; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <select class="form-control" style="width:auto;min-width:220px;" onchange="app.selectedMapId=this.value; app.navigateTo('farm-map')">
              ${maps.map((m) => `<option value="${e(m.mapId)}" ${m.mapId === this.selectedMapId ? 'selected' : ''}>🗺️ ${e(m.title)} (${e(m.version)})</option>`).join('')}
            </select>
            <span class="badge badge-completed">Offline Ready</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn-outline" style="padding: 4px 10px; font-size: 13px;" onclick="app.zoomMap(1.25)">＋</button>
            <button class="btn btn-outline" style="padding: 4px 10px; font-size: 13px;" onclick="app.zoomMap(0.8)">－</button>
            <button class="btn btn-outline" style="padding: 4px 10px; font-size: 13px;" onclick="app.fitMap()">⤢ Fit</button>
            <button class="btn btn-outline" style="padding: 4px 10px; font-size: 13px;" onclick="app.centerGpsOnMap()">📍 My Location</button>
            ${auth.isAdmin() && activeMap ? `<button class="btn btn-danger btn-icon" title="Deactivate map" onclick="app.deleteMap('${e(activeMap.mapId)}')">🗑️</button>` : ''}
          </div>
        </div>

        <div id="farm-map-canvas-container" style="position: relative; width: 100%; height: 520px; background: #e2e8f0; overflow: hidden; cursor: grab; touch-action: none;">
          <canvas id="farm-map-canvas" style="width: 100%; height: 100%; display:block;"></canvas>
          <div id="map-parcel-tooltip" style="position: absolute; display: none; background: rgba(6, 78, 59, 0.95); color: #ffffff; padding: 10px 14px; border-radius: 8px; font-size: 12px; pointer-events: none; z-index: 50; box-shadow: 0 4px 12px rgba(0,0,0,0.25); max-width: 260px;"></div>
        </div>

        <div style="padding: 12px 18px; background: #f8fafc; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
            <span style="display: flex; align-items: center; gap: 6px;"><span style="display:inline-block;width:12px;height:12px;background:#86efac;border:2px solid #166534;border-radius:2px;"></span> Your Farm &amp; Blocks</span>
            <span style="display: flex; align-items: center; gap: 6px;"><span style="display:inline-block;width:12px;height:12px;background:#e5e7eb;border:2px solid #9ca3af;border-radius:2px;"></span> Other areas</span>
            <span style="display: flex; align-items: center; gap: 6px;"><span style="display:inline-block;width:12px;height:12px;background:#2563eb;border-radius:50%;"></span> Your GPS</span>
          </div>
          <div>Drag to pan &bull; scroll / buttons to zoom &bull; tap an area for details</div>
        </div>
      </div>`}
    `;

    if (activeMap) this.initInteractiveCanvasMap(activeMap);
  }

  initInteractiveCanvasMap(mapRecord) {
    const canvas = document.getElementById('farm-map-canvas');
    const box = document.getElementById('farm-map-canvas-container');
    const tooltip = document.getElementById('map-parcel-tooltip');
    if (!canvas || !box) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = box.clientWidth * dpr;
      canvas.height = box.clientHeight * dpr;
    };
    resize();

    let geo = mapRecord.geoJson;
    if (typeof geo === 'string') { try { geo = JSON.parse(geo); } catch (err) { geo = null; } }
    const features = (geo && Array.isArray(geo.features)) ? geo.features : [];

    // Collect rings (polygons / multipolygons) in lon/lat
    const shapes = [];
    features.forEach((f) => {
      const g = f.geometry || {};
      const props = f.properties || {};
      if (g.type === 'Polygon') shapes.push({ kind: 'poly', props, rings: g.coordinates });
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => shapes.push({ kind: 'poly', props, rings: poly }));
      else if (g.type === 'LineString') shapes.push({ kind: 'line', props, rings: [g.coordinates] });
      else if (g.type === 'MultiLineString') g.coordinates.forEach((ln) => shapes.push({ kind: 'line', props, rings: [ln] }));
      else if (g.type === 'Point') shapes.push({ kind: 'point', props, rings: [[g.coordinates]] });
      else if (g.type === 'MultiPoint') g.coordinates.forEach((pt) => shapes.push({ kind: 'point', props, rings: [[pt]] }));
    });

    const authorizedNames = new Set(auth.getAuthorizedBlocks().map((b) => String(b.farmBlockName).toLowerCase()));
    const propOf = (p, keys) => { for (const k of keys) if (p[k] !== undefined && p[k] !== '') return p[k]; return ''; };
    const isMine = (p) => auth.hasAllBlocks() ||
      authorizedNames.has(String(propOf(p, ['block', 'farmBlock', 'Farm & Block', 'name', 'Name'])).toLowerCase());

    // Bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    shapes.forEach((s) => s.rings.forEach((r) => r.forEach(([x, y]) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    })));
    if (!isFinite(minX)) { minX = 121; maxX = 121.01; minY = 14; maxY = 14.01; }
    const latScale = Math.cos(((minY + maxY) / 2) * Math.PI / 180);

    let scale = 1, offsetX = 0, offsetY = 0;
    const toLocal = (lon, lat) => [(lon - minX) * latScale, (maxY - lat)];
    const toScreen = (lon, lat) => { const [x, y] = toLocal(lon, lat); return [x * scale + offsetX, y * scale + offsetY]; };

    const fit = () => {
      const w = (maxX - minX) * latScale || 0.001;
      const h = (maxY - minY) || 0.001;
      scale = Math.min(canvas.width / w, canvas.height / h) * 0.88;
      offsetX = (canvas.width - w * scale) / 2;
      offsetY = (canvas.height - h * scale) / 2;
    };
    fit();

    const tracePath = (s) => {
      ctx.beginPath();
      if (s.kind === 'point') {
        const [x, y] = toScreen(s.rings[0][0][0], s.rings[0][0][1]);
        ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
        return;
      }
      s.rings.forEach((ring) => {
        ring.forEach(([lon, lat], i) => {
          const [x, y] = toScreen(lon, lat);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        if (s.kind === 'poly') ctx.closePath();
      });
    };

    const draw = () => {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      shapes.forEach((s) => {
        const mine = isMine(s.props);
        tracePath(s);
        if (s.kind !== 'line') {
          ctx.fillStyle = s.kind === 'point' ? '#f59e0b' : (mine ? 'rgba(134, 239, 172, 0.75)' : 'rgba(229, 231, 235, 0.8)');
          ctx.fill('evenodd');
        }
        ctx.strokeStyle = s.kind === 'point' ? '#ffffff' : (mine ? '#166534' : '#9ca3af');
        ctx.lineWidth = (s.kind === 'line' ? 3 : 2) * dpr;
        ctx.stroke();
      });

      // Labels at ring centroid
      ctx.textAlign = 'center';
      shapes.forEach((s) => {
        const ring = s.rings[0] || [];
        if (!ring.length) return;
        let cx = 0, cy = 0;
        ring.forEach(([lon, lat]) => { cx += lon; cy += lat; });
        const [x, y] = toScreen(cx / ring.length, cy / ring.length);
        const label = propOf(s.props, ['block', 'farmBlock', 'Farm & Block', 'name', 'Name', 'parcel']);
        if (!label) return;
        ctx.fillStyle = '#064e3b';
        ctx.font = `bold ${12 * dpr}px sans-serif`;
        ctx.fillText(String(label), x, s.kind === 'point' ? y - 12 * dpr : y);
      });

      // Live GPS pin
      const gps = this.gpsCoordinates;
      if (gps) {
        const [x, y] = toScreen(gps.longitude, gps.latitude);
        ctx.beginPath(); ctx.arc(x, y, 14 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#2563eb'; ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * dpr; ctx.stroke();
      }
    };
    draw();

    // Pan (mouse + touch via pointer events)
    let dragging = false, moved = false, sx = 0, sy = 0;
    canvas.onpointerdown = (ev) => {
      dragging = true; moved = false;
      sx = ev.clientX * dpr - offsetX; sy = ev.clientY * dpr - offsetY;
      canvas.setPointerCapture(ev.pointerId);
      box.style.cursor = 'grabbing';
    };
    canvas.onpointermove = (ev) => {
      if (!dragging) return;
      moved = true;
      offsetX = ev.clientX * dpr - sx; offsetY = ev.clientY * dpr - sy;
      draw();
    };
    canvas.onpointerup = (ev) => {
      dragging = false;
      box.style.cursor = 'grab';
      if (moved) return;
      // Tap: find the shape under the pointer
      const rect = canvas.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * dpr, py = (ev.clientY - rect.top) * dpr;
      ctx.lineWidth = 10 * dpr;
      const hit = [...shapes].reverse().find((s) => {
        tracePath(s);
        return s.kind === 'line' ? ctx.isPointInStroke(px, py) : ctx.isPointInPath(px, py, 'evenodd');
      });
      if (hit && tooltip) {
        tooltip.innerHTML = Object.entries(hit.props).slice(0, 8)
          .map(([k, v]) => `<div><strong>${this.esc(k)}:</strong> ${this.esc(v)}</div>`).join('') || 'No details';
        tooltip.style.left = Math.min(ev.clientX - rect.left + 12, rect.width - 270) + 'px';
        tooltip.style.top = (ev.clientY - rect.top + 12) + 'px';
        tooltip.style.display = 'block';
      } else if (tooltip) {
        tooltip.style.display = 'none';
      }
      draw();
    };
    canvas.onwheel = (ev) => {
      ev.preventDefault();
      this.zoomMap(ev.deltaY < 0 ? 1.15 : 0.87);
    };

    this.zoomMap = (factor) => {
      const cx = canvas.width / 2, cy = canvas.height / 2;
      offsetX = cx - (cx - offsetX) * factor;
      offsetY = cy - (cy - offsetY) * factor;
      scale *= factor;
      draw();
    };
    this.fitMap = () => { fit(); draw(); };
    this.centerGpsOnMap = async () => {
      const gps = await this.captureCurrentGps();
      if (!gps) { this.showToast('GPS location unavailable. Check location permission.', 'warning'); return; }
      const [x, y] = toLocal(gps.longitude, gps.latitude);
      offsetX = canvas.width / 2 - x * scale;
      offsetY = canvas.height / 2 - y * scale;
      draw();
      this.showToast(`Centered on your location (±${Math.round(gps.accuracy || 0)} m).`, 'info');
    };
    window.onresize = () => { if (document.getElementById('farm-map-canvas')) { resize(); fit(); draw(); } };
  }

  async checkMapVersionNotification() {
    const latestVersion = await db.getSetting('activeMapVersion', '');
    const installedMaps = await db.getAll('maps');
    if (!latestVersion || !installedMaps.length) return;
    const installedVersions = installedMaps.map((m) => m.version);
    if (!installedVersions.includes(latestVersion)) {
      document.getElementById('map-current-version-text').textContent = installedVersions.join(', ');
      document.getElementById('map-latest-version-text').textContent = latestVersion;
      this.openModal('map-update-modal');
    }
  }

  async handleDownloadNewMapVersion() {
    this.closeModal('map-update-modal');
    await this.downloadOfflineMapPackage();
  }

  async downloadOfflineMapPackage() {
    this.showToast('Downloading the latest farm maps...', 'info');
    try {
      await syncService.pullMasterData();   // replaces old map versions on this device
      const maps = await db.getAll('maps');
      this.showToast(`${maps.length} map(s) saved on this device for offline use.`, 'success');
      if (this.currentView === 'farm-map') this.navigateTo('farm-map');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }

  async openUploadMapModal() {
    const lands = [...new Set((await db.getAll('farmsAndBlocks')).map((b) => b.landOwnerName))].sort();
    const e = (v) => this.esc(v);
    this._pendingMap = null;
    document.getElementById('form-modal-title').textContent = 'Upload Farm Map';
    document.getElementById('form-modal-body').innerHTML = `
      <div class="form-group">
        <label class="form-label required">Map File (KML, KMZ or GeoJSON)</label>
        <input type="file" id="map-file" class="form-control" onchange="app.previewMapFile()" />
        <div class="form-helper">
          From Google Earth: right-click your folder › <em>Save Place As…</em> › KMZ.
          From QGIS: Export › Save Features As › GeoJSON. Name each shape after its Farm &amp; Block so assigned blocks are highlighted.
        </div>
        <div id="map-upload-status" style="margin-top:8px;font-size:13px;font-weight:600;"></div>
      </div>
      <div class="form-group">
        <label class="form-label required">Map Title</label>
        <input type="text" id="map-title" class="form-control" placeholder="e.g. Santos Farm Parcel Map" />
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label required">Version</label>
          <input type="text" id="map-version" class="form-control" value="v${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}" />
        </div>
        <div class="form-group">
          <label class="form-label">Land Owner (who can see it)</label>
          <select id="map-landowner" class="form-control">
            <option value="">All users</option>
            ${lands.map((l) => `<option value="${e(l)}">${e(l)}</option>`).join('')}
          </select>
        </div>
      </div>
    `;

    const btn = document.getElementById('form-modal-submit-btn');
    btn.textContent = 'Upload';
    btn.onclick = () => this.uploadMapFromModal();
    this.openModal('form-modal');
  }

  async previewMapFile() {
    const status = document.getElementById('map-upload-status');
    const file = document.getElementById('map-file').files[0];
    this._pendingMap = null;
    if (!file) { status.textContent = ''; return; }
    status.style.color = '#15803d';
    status.textContent = '⏳ Reading ' + file.name + '...';
    try {
      const geo = await this.readMapFile(file);
      const kb = Math.round(JSON.stringify(geo).length / 1000);
      if (kb > 3000) throw new Error(`Map is too large (${kb} KB, max 3000 KB). Simplify the shapes or split the map per land owner.`);
      this._pendingMap = { geo, fileType: file.name.split('.').pop().toUpperCase() };
      status.textContent = `✅ ${geo.features.length} shape(s) found (${kb} KB). Ready to upload.`;
      const title = document.getElementById('map-title');
      if (!title.value) title.value = file.name.replace(/\.[^.]+$/, '');
    } catch (err) {
      status.style.color = '#ef4444';
      status.textContent = '❌ ' + err.message;
    }
  }

  async uploadMapFromModal() {
    const status = document.getElementById('map-upload-status');
    const title = document.getElementById('map-title').value.trim();
    if (!this._pendingMap) {
      if (document.getElementById('map-file').files[0]) await this.previewMapFile();
      if (!this._pendingMap) { this.showToast('Choose a valid KML, KMZ or GeoJSON file first.', 'warning'); return; }
    }
    if (!title) { this.showToast('Map title is required.', 'warning'); return; }

    const btn = document.getElementById('form-modal-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Uploading...';
    status.style.color = '#15803d';
    status.textContent = '⏳ Uploading to Google Sheets... (large maps can take up to a minute)';
    try {
      const res = await syncService.apiCall('SAVE_MAP', {
        mapData: {
          title,
          version: document.getElementById('map-version').value.trim(),
          landOwner: document.getElementById('map-landowner').value,
          fileType: this._pendingMap.fileType,
          geoJson: this._pendingMap.geo
        }
      });
      await syncService.pullMasterData();
      this.selectedMapId = res.mapId;
      this.closeModal('form-modal');
      this.showToast(res.message, 'success');
      this.navigateTo('farm-map');
    } catch (err) {
      status.style.color = '#ef4444';
      status.textContent = '❌ ' + err.message;
      this.showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Upload';
    }
  }

  async deleteMap(mapId) {
    if (!confirm('Deactivate this map for all users?')) return;
    await this.runServerAction('DELETE_MAP', { mapId }, 'Map deactivated.', 'farm-map');
  }

  /* ==========================================================================
     PAGE 14: DROPDOWN MANAGEMENT (ADMIN ONLY)
     ========================================================================== */

  async renderDropdownManagementView(container) {
    const dropdowns = (await db.getAll('dropdownOptions'))
      .filter((d) => d.status !== 'Deactivated')
      .sort((a, b) => String(a.activityType).localeCompare(String(b.activityType)) ||
        String(a.dropdownCategory).localeCompare(String(b.dropdownCategory)) || (a.sortOrder - b.sortOrder));
    const e = (v) => this.esc(v);

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Dropdown Options Management</h2>
          <p style="font-size: 13.5px; color: var(--text-muted);">Options are saved to Google Sheets and reach users on their next refresh.</p>
        </div>
        <button class="btn btn-primary" onclick="app.openAddDropdownModal()">+ Add Dropdown Option</button>
      </div>

      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="table-responsive">
          <table class="table">
            <thead><tr><th>Option ID</th><th>Activity Type</th><th>Category</th><th>Option Value</th><th>Actions</th></tr></thead>
            <tbody>
              ${dropdowns.map((d) => `
                <tr>
                  <td><code>${e(d.optionId)}</code></td>
                  <td><strong>${e(d.activityType)}</strong></td>
                  <td>${e(d.dropdownCategory)}</td>
                  <td>${e(d.optionValue)}</td>
                  <td><button class="btn btn-danger btn-icon" title="Deactivate" onclick="app.deleteDropdownOption('${e(d.optionId)}')">🗑️</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async openAddDropdownModal() {
    const categories = [...new Set((await db.getAll('dropdownOptions')).map((d) => d.dropdownCategory))].sort();
    document.getElementById('form-modal-title').textContent = 'Add New Dropdown Option';
    document.getElementById('form-modal-body').innerHTML = `
      <div class="form-group">
        <label class="form-label required">Activity Type</label>
        <select id="modal-drop-act" class="form-control">
          ${['Regular Activity', 'Irregular Activity', 'Other Farm Activity', 'Palm Category Activity', 'Seednut Collection', 'Pest and Disease Activity']
            .map((a) => `<option value="${a}">${a}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label required">Dropdown Category</label>
        <input type="text" id="modal-drop-cat" class="form-control" list="modal-drop-cat-list" placeholder="e.g. Target Pest, Unit, Cycle" />
        <datalist id="modal-drop-cat-list">${categories.map((c) => `<option value="${this.esc(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label required">Option Value</label>
        <input type="text" id="modal-drop-val" class="form-control" placeholder="e.g. Cycle 5 (Special)" />
      </div>
    `;
    const btn = document.getElementById('form-modal-submit-btn');
    btn.textContent = 'Save';
    btn.onclick = async () => {
      const dropdown = {
        activityType: document.getElementById('modal-drop-act').value,
        category: document.getElementById('modal-drop-cat').value.trim(),
        value: document.getElementById('modal-drop-val').value.trim()
      };
      if (!dropdown.category || !dropdown.value) { this.showToast('Category and value are required.', 'warning'); return; }
      btn.disabled = true;
      const res = await this.runServerAction('SAVE_DROPDOWN', { dropdown }, 'Dropdown option saved.', null);
      btn.disabled = false;
      if (res) { this.closeModal('form-modal'); this.navigateTo('dropdown-management'); }
    };
    this.openModal('form-modal');
  }

  async deleteDropdownOption(optionId) {
    if (!confirm('Deactivate this dropdown option?')) return;
    await this.runServerAction('DELETE_DROPDOWN', { optionId }, 'Dropdown option deactivated.', 'dropdown-management');
  }

  /* ==========================================================================
     LAND OWNER ENROLLMENT (ADMIN ONLY) — Manual Sequential Enrollment (v3.5)
     1) Land owner: CLAIF Number, Land Owner Name, Category.
     2) One or more parcel / block entries, each with a Sequence Number that is
        TYPED by the admin. Sequence numbers are never generated, incremented
        or renumbered by the app.
     The supervisor of each Farm & Block is found automatically from User Management.
     ========================================================================== */

  async renderLandownerEnrollmentView(container) {
    const blocks = await db.getAll('farmsAndBlocks');
    const landowners = await db.getAll('landowners');
    const parcels = await db.getAll('parcels');
    const e = (v) => this.esc(v);
    // Land owners are identified by Land Owner ID / CLAIF Number — never by name
    const loById = new Map(landowners.map((l) => [String(l.landOwnerId), l]));
    const loOf = (b) => loById.get(String(b.landOwnerId)) || {};
    // v3.8: Priority / Not Priority belongs to each sequence entry (block row), not to the land owner
    const isPriority = (b) => this.entryCategory(b, loOf(b)) === 'Priority';
    const activeOwners = landowners.filter((l) => l.status !== 'Deactivated');
    const activeEntries = blocks.filter((b) => b.status !== 'Deactivated');
    const priorityCount = activeEntries.filter(isPriority).length;
    const notPriorityCount = activeEntries.length - priorityCount;
    const fbCatalog = this.buildFarmBlockCatalog(activeEntries);
    // Sequence shown = the number typed for the block (older records: the land owner's saved number)
    const seqOf = (b) => parseInt(b.sequenceNo, 10) || parseInt(loOf(b).sequenceNo, 10) || 0;

    // Priority first, then Not Priority; inside each group by the typed sequence number
    blocks.sort((a, b) =>
      (isPriority(a) ? 0 : 1) - (isPriority(b) ? 0 : 1) ||
      (seqOf(a) || 999999) - (seqOf(b) || 999999) ||
      String(a.landOwnerName).localeCompare(String(b.landOwnerName)) ||
      String(a.parcelNumber).localeCompare(String(b.parcelNumber), undefined, { numeric: true }) ||
      String(a.farmBlockName).localeCompare(String(b.farmBlockName), undefined, { numeric: true })
    );

    const activeCount = blocks.filter((b) => b.status !== 'Deactivated').length;
    const unassigned = blocks.filter((b) => b.status !== 'Deactivated' && (!b.supervisorNames || !b.supervisorNames.length)).length;
    let lastGroup = '';

    container.innerHTML = `
      <style>
        .enr-entries-head, .enr-entry { display: grid; grid-template-columns: 120px 140px 1fr 1.3fr 100px 100px 44px; gap: 10px; align-items: end; }
        .enr-entries-head { font-size: 12px; font-weight: 700; color: var(--text-muted); padding: 0 12px 6px; }
        .enr-entry { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 8px; background: var(--bg-surface); }
        .enr-entry .form-group { margin: 0; }
        .enr-entry .enr-cell-label { display: none; font-size: 11.5px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px; }
        .enr-rm-text { display: none; }
        .enr-entry.has-error { border-color: var(--alert-red); background: #fef2f2; }
        .enr-seq-wrap { display: flex; align-items: center; gap: 6px; }
        .enr-seq-wrap span { font-weight: 800; min-width: 30px; color: var(--palm-dark); }
        .enr-existing { background: var(--palm-subtle); border: 1px solid var(--palm-border); border-radius: var(--radius-md); padding: 12px; margin-bottom: 14px; }
        .enr-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 12px; }
        @media (max-width: 760px) {
          .enr-entries-head { display: none; }
          .enr-entry { grid-template-columns: 1fr 1fr; }
          .enr-entry .enr-cell-label { display: block; }
          .enr-entry .enr-cell-block { grid-column: 1 / -1; }
          .enr-entry .enr-cell-remove { grid-column: 1 / -1; }
          .enr-entry .enr-cell-remove .btn { width: 100%; }
          .enr-rm-text { display: inline; }
          .enr-actions .btn { flex: 1 1 140px; }
        }
      </style>

      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Land Owner Enrollment</h2>
        <p style="font-size: 13.5px; color: var(--text-muted);">
          Enroll a land owner, then add each parcel / farm &amp; block with its own Sequence Number (typed by you).
          The supervisor is filled in automatically from User Management. Area and palm count are used for Cycle Monitoring.
        </p>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon green">🏡</div><div class="stat-info">
          <div class="stat-label">Land Owners</div><div class="stat-value">${activeOwners.length}</div>
          <div class="stat-sub">${activeEntries.length} sequence(s): ${priorityCount} Priority &bull; ${notPriorityCount} Not Priority</div></div></div>
        <div class="stat-card"><div class="stat-icon blue">🗂️</div><div class="stat-info">
          <div class="stat-label">Parcels</div><div class="stat-value">${parcels.filter((p) => p.status !== 'Deactivated').length}</div></div></div>
        <div class="stat-card"><div class="stat-icon green">🌴</div><div class="stat-info">
          <div class="stat-label">Active Farm &amp; Blocks</div><div class="stat-value">${activeCount}</div></div></div>
        <div class="stat-card"><div class="stat-icon amber">⚠️</div><div class="stat-info">
          <div class="stat-label">Blocks without Supervisor</div><div class="stat-value">${unassigned}</div>
          <div class="stat-sub">Assign in User Management</div></div></div>
      </div>

      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <div>
            <div class="card-title">➕ Enroll Land Owner</div>
            <div class="card-subtitle">Enter an existing CLAIF Number to add more parcels / blocks to that land owner.</div>
          </div>
        </div>
        <form id="enroll-form" onsubmit="event.preventDefault(); app.reviewLandownerEnrollment();" novalidate>
          <div style="font-weight:700;color:var(--palm-dark);margin-bottom:8px;">1. Land Owner Information</div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label required">CLAIF Number</label>
              <input type="text" id="enr-no" class="form-control" maxlength="30" value="CLAIF-"
                     placeholder="e.g. CLAIF-686" autocapitalize="characters" autocomplete="off"
                     oninput="app.lookupEnrollmentClaif()" />
              <div class="form-helper" id="enr-no-help">Word and number, e.g. CLAIF-686. Must be unique.</div>
            </div>
            <div class="form-group">
              <label class="form-label required">Land Owner Name</label>
              <input type="text" id="enr-landowner" class="form-control" maxlength="120" autocomplete="off"
                     placeholder="e.g. Onal Sumpo" oninput="app.lookupEnrollmentName()" />
              <div class="form-helper" id="enr-name-help"></div>
            </div>
          </div>

          <div id="enr-existing"></div>

          <div style="font-weight:700;color:var(--palm-dark);margin:6px 0 8px;">2. Parcel / Farm &amp; Block Entries</div>
          <div class="enr-entries-head">
            <div>Sequence No. *</div><div>Category *</div><div>Parcel Number *</div><div>Farm &amp; Block *</div><div>Area (Ha)</div><div>Palm Count</div><div></div>
          </div>
          <div id="enr-entries"></div>
          <div class="form-helper">Type each Sequence Number yourself — any number, gaps allowed (e.g. 1, 2, 5, 8) — and choose Priority or Not Priority for each sequence. The app never changes them.</div>

          <div class="enr-actions">
            <button type="button" class="btn btn-outline" onclick="app.addEnrollmentEntry()">➕ Add Another Block</button>
            <button type="button" class="btn btn-outline" onclick="app.clearEnrollmentForm()">Clear</button>
            <button type="submit" id="enr-submit" class="btn btn-primary">✓ Finish Enrollment</button>
          </div>
        </form>
      </div>

      ${this.sequenceSummaryHtml(activeEntries, true)}

      <div class="filter-toolbar">
        <input type="text" id="enr-search" class="form-control" placeholder="🔍 Search seq., CLAIF no., land owner, parcel, block or supervisor..." oninput="app.filterEnrollmentTable()" />
        <select id="enr-status" class="form-control" onchange="app.filterEnrollmentTable()">
          <option value="Active">Active only</option>
          <option value="ALL">All statuses</option>
          <option value="Deactivated">Deactivated only</option>
          <option value="NOSUP">Active without supervisor</option>
          <option value="PRIORITY">Priority only</option>
          <option value="NOTPRIORITY">Not Priority only</option>
          <option value="NOSIZE">Missing area / palms</option>
          <option value="NOSEQ">Missing sequence no.</option>
        </select>
        <select id="enr-fb" class="form-control" onchange="app.filterEnrollmentTable()">
          <option value="ALL">All Farm &amp; Blocks</option>
          ${fbCatalog.farms.map((f) => f.blocks.map((c) => `<option value="${e(c.code)}">${e(c.full)}</option>`).join('')).join('')}
        </select>
      </div>

      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th title="Permanent unique ID of this row">Record ID</th>
                <th title="Sequence Number typed during enrollment (Priority and Not Priority are separate)">Seq.</th>
                <th>CLAIF No.</th>
                <th>Land Owner</th>
                <th>Category</th>
                <th>Parcel</th>
                <th>Farm &amp; Block</th>
                <th>Area (Ha)</th>
                <th>Palms</th>
                <th>Supervisor (auto)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="enr-table-body">
              ${blocks.length === 0 ? `
                <tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:24px;">
                  No land owners enrolled yet. Use the form above to enroll the first one.</td></tr>` : blocks.map((b) => {
                  const lo = loOf(b);
                  const sup = (b.supervisorNames && b.supervisorNames.length) ? b.supervisorNames.join(', ') : '';
                  const active = b.status !== 'Deactivated';
                  const noSize = !b.areaHa || !b.palmCount;
                  const group = isPriority(b) ? 'P' : 'N';
                  const fbCode = this.farmBlockInfo(b).code;
                  const seq = seqOf(b);
                  const seqLabel = seq ? `${group === 'P' ? 'P' : 'NP'}-${seq}` : '';
                  let groupHeader = '';
                  if (group !== lastGroup) {
                    lastGroup = group;
                    groupHeader = `
                <tr class="enr-group" data-group="${group}">
                  <td colspan="12" style="background:${group === 'P' ? '#fef2f2' : '#f0fdf4'};font-weight:800;font-size:12.5px;letter-spacing:0.5px;color:${group === 'P' ? '#991b1b' : '#166534'};">
                    ${group === 'P' ? '⭐ PRIORITY' : 'NOT PRIORITY'} &bull; <span class="enr-group-count">${group === 'P' ? priorityCount : notPriorityCount}</span> sequence(s)
                  </td>
                </tr>`;
                  }
                  return `${groupHeader}
                <tr class="enr-row" data-group="${group}" data-fb="${e(fbCode)}" data-status="${active ? 'Active' : 'Deactivated'}" data-nosup="${sup ? '0' : '1'}"
                    data-priority="${group === 'P' ? '1' : '0'}" data-nosize="${noSize ? '1' : '0'}" data-noseq="${seq ? '0' : '1'}"
                    data-search="${e([b.recordId, seqLabel, lo.landOwnerNo, b.landOwnerName, b.parcelNumber, b.farmBlockName, sup].join(' ').toLowerCase())}">
                  <td style="white-space:nowrap;"><code style="font-size:11.5px;">${e(b.recordId || '—')}</code></td>
                  <td style="white-space:nowrap;"><strong>${seqLabel || '<span style="color:#92400e;">not set</span>'}</strong></td>
                  <td style="white-space:nowrap;"><strong>${e(lo.landOwnerNo || '—')}</strong></td>
                  <td><strong>${e(b.landOwnerName)}</strong></td>
                  <td>${this.categoryBadge(this.entryCategory(b, lo))}</td>
                  <td>${e(b.parcelNumber)}</td>
                  <td>${e(b.farmBlockName)}</td>
                  <td>${b.areaHa ? e(b.areaHa) : '<span style="color:#92400e;">—</span>'}</td>
                  <td>${b.palmCount ? e(b.palmCount) : '<span style="color:#92400e;">—</span>'}</td>
                  <td>${sup ? `👤 ${e(sup)}` : `<span class="badge badge-behind">Unassigned</span>`}</td>
                  <td><span class="badge ${active ? 'badge-completed' : 'badge-behind'}">${active ? 'Active' : 'Deactivated'}</span></td>
                  <td style="white-space:nowrap;">
                    ${b.recordId ? `
                    <button class="btn btn-outline btn-icon" title="Edit this entry (${e(b.recordId)})" onclick="app.openEditEnrollmentModal('${e(b.recordId)}')">✏️</button>
                    <button class="btn btn-danger btn-icon" title="Delete this entry (${e(b.recordId)})" onclick="app.confirmDeleteEntry('${e(b.recordId)}')">🗑️</button>` : `
                    <span class="badge badge-behind" title="This row has no Record ID yet. Deploy the new Code.gs (New version), then refresh.">no Record ID</span>`}
                    ${active
                      ? `<button class="btn btn-danger btn-icon" title="Deactivate" onclick="app.setBlockStatus('${e(b.blockId)}', 'Deactivated')">🚫</button>`
                      : `<button class="btn btn-outline btn-icon" title="Reactivate" onclick="app.setBlockStatus('${e(b.blockId)}', 'Active')">♻️</button>`}
                  </td>
                </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    this._enr = { landowners, blocks, parcels, existing: null, rowId: 0, seqOf };
    this.checkServerVersion(container);
    this.addEnrollmentEntry(false);
    this.filterEnrollmentTable();
  }

  /** Warns when the Apps Script server and this app are not the same version (old cache or old deployment). */
  async checkServerVersion(container) {
    if (!navigator.onLine) return;
    try {
      const r = await syncService.apiCall('PING');
      if (r && r.version && r.version !== FRONTEND_VERSION && container.isConnected) {
        container.insertAdjacentHTML('afterbegin', `
          <div class="card" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;margin-bottom:16px;font-size:13.5px;">
            <strong>⚠️ Version mismatch:</strong> this app is v${this.esc(FRONTEND_VERSION)} but the server (Code.gs) is v${this.esc(r.version)}.
            Editing land owners is blocked until both are the same.
            ${r.version < FRONTEND_VERSION
              ? 'Paste the new Code.gs into Apps Script, then Deploy › Manage deployments › ✏️ › Version: <strong>New version</strong> › Deploy.'
              : 'This app is an old copy: close it and open it again (or press Ctrl+Shift+R).'}
          </div>`);
      }
    } catch (err) { /* offline or server unreachable: nothing to show */ }
  }

  /** Category of ONE sequence entry (v3.8). Older entries without one fall back to the land owner's old category. */
  entryCategory(b, lo) {
    const c = b && b.category ? b.category : (lo && lo.category);
    return c === 'Priority' ? 'Priority' : 'Not Priority';
  }

  /**
   * "Sequences per Farm & Block" table: Priority / Not Priority / Total counted from individual
   * sequence entries (not land owners). clickable = counts filter the enrollment table.
   */
  sequenceSummaryHtml(entries, clickable = false) {
    const e = (v) => this.esc(v);
    const catalog = this.buildFarmBlockCatalog(entries);
    const count = new Map();
    entries.forEach((b) => {
      const code = this.farmBlockInfo(b).code;
      const c = count.get(code) || { p: 0, n: 0 };
      if (this.entryCategory(b) === 'Priority') c.p++; else c.n++;
      count.set(code, c);
    });
    let tp = 0, tn = 0;
    const link = (code, cat, n) => (clickable && n
      ? `<a href="#" onclick="event.preventDefault(); app.showEnrollmentSequences('${e(code)}', '${cat}')">${n}</a>` : String(n));
    const rows = catalog.farms.map((f) => f.blocks.map((blk) => {
      const c = count.get(blk.code) || { p: 0, n: 0 };
      tp += c.p; tn += c.n;
      return `<tr class="seq-sum-row" data-search="${e(blk.full.toLowerCase())}">
        <td><strong>${e(blk.full)}</strong></td>
        <td style="text-align:center;color:#991b1b;font-weight:700;">${link(blk.code, 'PRIORITY', c.p)}</td>
        <td style="text-align:center;color:#166534;font-weight:700;">${link(blk.code, 'NOTPRIORITY', c.n)}</td>
        <td style="text-align:center;font-weight:800;">${link(blk.code, 'Active', c.p + c.n)}</td>
      </tr>`;
    }).join('')).join('');
    if (!rows) return '';
    return `
      <div class="card" style="margin-bottom:20px;padding:0;overflow:hidden;">
        <div class="card-header" style="padding:14px 16px 0;">
          <div>
            <div class="card-title">📊 Sequences per Farm &amp; Block</div>
            <div class="card-subtitle">Counted per sequence entry, not per land owner.${clickable ? ' Tap a number to see those sequences below.' : ''}</div>
          </div>
        </div>
        <div class="table-responsive" style="max-height:320px;overflow:auto;">
          <table class="table">
            <thead><tr><th>Farm &amp; Block</th><th style="text-align:center;">⭐ Priority</th><th style="text-align:center;">Not Priority</th><th style="text-align:center;">Total</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr style="background:var(--bg-hover);font-weight:800;">
              <td>All Farm &amp; Blocks</td><td style="text-align:center;color:#991b1b;">${tp}</td><td style="text-align:center;color:#166534;">${tn}</td><td style="text-align:center;">${tp + tn}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;
  }

  /** From the summary: show only Priority / Not Priority / all sequences of one Farm & Block. */
  showEnrollmentSequences(code, status) {
    const fb = document.getElementById('enr-fb');
    const st = document.getElementById('enr-status');
    const q = document.getElementById('enr-search');
    if (!fb || !st) return;
    fb.value = code; st.value = status; if (q) q.value = '';
    this.filterEnrollmentTable();
    document.getElementById('enr-table-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Same rule as the server: "claif 686" / "CLAIF686" -> "CLAIF-686" ('' if not valid). */
  normalizeClaifInput(v) {
    const s = String(v || '').toUpperCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').trim();
    const m = s.match(/^([A-Z]+)-?(\d+)$/);
    return m ? `${m[1]}-${m[2]}` : '';
  }

  /** P- / NP- prefix of one entry row, from that row's own category. */
  enrollmentPrefix(category) {
    return category === 'Priority' ? 'P-' : (category === 'Not Priority' ? 'NP-' : '#');
  }

  /** One parcel / block entry row. Sequence is always typed by the user (starts empty). */
  addEnrollmentEntry(focus = true) {
    const box = document.getElementById('enr-entries');
    if (!box || !this._enr) return;
    const id = ++this._enr.rowId;
    const row = document.createElement('div');
    row.className = 'enr-entry';
    row.dataset.row = String(id);
    row.innerHTML = `
      <div class="form-group">
        <div class="enr-cell-label">Sequence No. *</div>
        <div class="enr-seq-wrap"><span class="enr-seq-prefix">#</span>
          <input type="text" class="form-control enr-f-seq" inputmode="numeric" maxlength="6" placeholder="e.g. 1" autocomplete="off" />
        </div>
      </div>
      <div class="form-group">
        <div class="enr-cell-label">Category *</div>
        <select class="form-control enr-f-cat">
          <option value="">Choose…</option>
          <option value="Priority">Priority</option>
          <option value="Not Priority">Not Priority</option>
        </select>
      </div>
      <div class="form-group">
        <div class="enr-cell-label">Parcel Number *</div>
        <input type="text" class="form-control enr-f-parcel" maxlength="120" placeholder="e.g. P1" autocomplete="off" />
      </div>
      <div class="form-group enr-cell-block">
        <div class="enr-cell-label">Farm &amp; Block *</div>
        <input type="text" class="form-control enr-f-block" maxlength="120" placeholder="e.g. Farm 1 Block 1" autocomplete="off" />
      </div>
      <div class="form-group">
        <div class="enr-cell-label">Area (Ha)</div>
        <input type="text" class="form-control enr-f-area" inputmode="decimal" maxlength="12" placeholder="e.g. 4.5" autocomplete="off" />
      </div>
      <div class="form-group">
        <div class="enr-cell-label">Palm Count</div>
        <input type="text" class="form-control enr-f-palms" inputmode="numeric" maxlength="9" placeholder="e.g. 640" autocomplete="off" />
      </div>
      <div class="enr-cell-remove">
        <button type="button" class="btn btn-danger btn-icon" title="Remove this entry" onclick="app.removeEnrollmentEntry(${id})">✕<span class="enr-rm-text"> Remove</span></button>
      </div>`;
    // Numbers only: digits for sequence / palms, digits and one dot for area
    row.querySelector('.enr-f-seq').addEventListener('input', (ev) => { ev.target.value = ev.target.value.replace(/\D/g, ''); });
    row.querySelector('.enr-f-palms').addEventListener('input', (ev) => { ev.target.value = ev.target.value.replace(/\D/g, ''); });
    row.querySelector('.enr-f-area').addEventListener('input', (ev) => {
      ev.target.value = ev.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    });
    // each sequence has its own category; the prefix of this row follows it
    row.querySelector('.enr-f-cat').addEventListener('change', (ev) => {
      row.querySelector('.enr-seq-prefix').textContent = this.enrollmentPrefix(ev.target.value);
      row.classList.remove('has-error');
    });
    row.addEventListener('input', () => row.classList.remove('has-error'));
    box.appendChild(row);
    if (focus) row.querySelector('.enr-f-seq').focus();
  }

  /** Removes one entry. Other entries (and their sequence numbers) are left exactly as typed. */
  removeEnrollmentEntry(id) {
    const rows = [...document.querySelectorAll('#enr-entries .enr-entry')];
    const row = rows.find((r) => r.dataset.row === String(id));
    if (!row) return;
    if (rows.length === 1) {
      row.querySelectorAll('input, select').forEach((i) => { i.value = ''; });
      row.querySelector('.enr-seq-prefix').textContent = '#';
      row.classList.remove('has-error');
      return;
    }
    row.remove();
  }

  clearEnrollmentForm() {
    const anything = [...document.querySelectorAll('#enroll-form input, #enroll-form select')].some((i) => i.value.trim() && i.value.trim().toUpperCase() !== 'CLAIF-');
    if (anything && !confirm('Clear the land owner and all entries?')) return;
    document.getElementById('enr-no').value = 'CLAIF-';
    document.getElementById('enr-landowner').value = '';
    document.getElementById('enr-entries').innerHTML = '';
    this.setEnrollmentExisting(null);
    document.getElementById('enr-name-help').textContent = '';
    this.addEnrollmentEntry(false);
  }

  /** Existing CLAIF Number: load the land owner and show its saved parcels / blocks. */
  lookupEnrollmentClaif() {
    if (!this._enr) return;
    const claif = this.normalizeClaifInput(document.getElementById('enr-no').value);
    const lo = claif ? this._enr.landowners.find((l) => String(l.landOwnerNo || '').toUpperCase() === claif) : null;
    this.setEnrollmentExisting(lo || null);
  }

  /** Typing a name that already has a CLAIF Number offers to load that land owner. */
  lookupEnrollmentName() {
    if (!this._enr || this._enr.existing) return;
    const name = document.getElementById('enr-landowner').value.trim().toLowerCase();
    const help = document.getElementById('enr-name-help');
    // Same name is allowed (each CLAIF Number is its own land owner). Just show who already has it.
    const same = name ? this._enr.landowners.filter((l) => String(l.landOwnerName).toLowerCase() === name && l.landOwnerNo) : [];
    help.innerHTML = same.length
      ? `Same name already enrolled as: ${same.map((l) => `<a href="#" onclick="event.preventDefault(); document.getElementById('enr-no').value='${this.esc(l.landOwnerNo)}'; app.lookupEnrollmentClaif();">${this.esc(l.landOwnerNo)}</a>`).join(', ')}.
         A new CLAIF Number creates a separate land owner.`
      : '';
  }

  setEnrollmentExisting(lo) {
    const st = this._enr;
    if (!st) return;
    const wasExisting = !!st.existing;
    st.existing = lo;
    const nameEl = document.getElementById('enr-landowner');
    const box = document.getElementById('enr-existing');
    const help = document.getElementById('enr-no-help');
    if (!lo) {
      if (wasExisting) nameEl.value = '';
      nameEl.readOnly = false;
      box.innerHTML = '';
      help.textContent = 'Word and number, e.g. CLAIF-686. Must be unique.';
      return;
    }
    nameEl.value = lo.landOwnerName;
    nameEl.readOnly = true;
    document.getElementById('enr-name-help').textContent = '';
    help.innerHTML = '✔ Existing land owner. New entries will be <strong>added</strong>; saved records are not changed.';

    const e = (v) => this.esc(v);
    const prefixOf = (b) => (this.entryCategory(b, lo) === 'Priority' ? 'P-' : 'NP-');
    const own = st.blocks.filter((b) => String(b.landOwnerId) === String(lo.landOwnerId))
      .sort((a, b) => (st.seqOf(a) || 999999) - (st.seqOf(b) || 999999) ||
        String(a.parcelNumber).localeCompare(String(b.parcelNumber), undefined, { numeric: true }));
    box.innerHTML = `
      <div class="enr-existing">
        <div style="font-weight:700;margin-bottom:8px;">📋 Existing records of ${e(lo.landOwnerName)} (${e(lo.landOwnerNo)}) &bull; ${own.length} sequence(s)</div>
        ${own.length ? `
        <div class="table-responsive">
          <table class="table" style="background:var(--bg-surface);">
            <thead><tr><th>Seq.</th><th>Category</th><th>Parcel</th><th>Farm &amp; Block</th><th>Area (Ha)</th><th>Palms</th><th>Status</th></tr></thead>
            <tbody>${own.map((b) => `
              <tr>
                <td><strong>${st.seqOf(b) ? prefixOf(b) + st.seqOf(b) : '—'}</strong></td>
                <td>${this.categoryBadge(this.entryCategory(b, lo))}</td>
                <td>${e(b.parcelNumber)}</td>
                <td>${e(b.farmBlockName)}</td>
                <td>${b.areaHa ? e(b.areaHa) : '—'}</td>
                <td>${b.palmCount ? e(b.palmCount) : '—'}</td>
                <td><span class="badge ${b.status !== 'Deactivated' ? 'badge-completed' : 'badge-behind'}">${b.status !== 'Deactivated' ? 'Active' : 'Deactivated'}</span></td>
              </tr>`).join('')}</tbody>
          </table>
        </div>` : '<div class="form-helper">No parcels / blocks yet.</div>'}
      </div>`;
  }

  /** Reads and checks the form. Returns { enrollment, errors }. */
  collectLandownerEnrollment() {
    const st = this._enr || {};
    const errors = [];
    const rawNo = document.getElementById('enr-no').value;
    const claif = this.normalizeClaifInput(rawNo);
    const name = document.getElementById('enr-landowner').value.trim();
    if (!claif) errors.push('CLAIF Number must be a word and a number, e.g. CLAIF-686.');
    if (!name) errors.push('Land Owner Name is required.');
    // Parcels already used by THIS land owner (by Land Owner ID; a new CLAIF Number has none yet)
    const ownerId = st.existing ? String(st.existing.landOwnerId) : null;
    const usedParcels = new Set((st.blocks || [])
      .filter((b) => ownerId && String(b.landOwnerId) === ownerId && b.status !== 'Deactivated')
      .map((b) => String(b.parcelNumber).trim().toLowerCase()));
    // Another land owner with the same name must not have the same Parcel + Farm & Block (reports would mix)
    const ownerName = (st.existing ? st.existing.landOwnerName : name).trim().toLowerCase();
    const clashOf = (parcel, block) => (st.blocks || []).find((b) => String(b.landOwnerId) !== String(ownerId) && b.status !== 'Deactivated' &&
      String(b.landOwnerName).trim().toLowerCase() === ownerName && String(b.parcelNumber).trim().toLowerCase() === parcel &&
      String(b.farmBlockName).trim().toLowerCase() === String(block).trim().toLowerCase());

    const seen = new Set();
    const entries = [];
    document.querySelectorAll('#enr-entries .enr-entry').forEach((row) => {
      const get = (c) => row.querySelector(c).value.trim();
      const en = {
        sequenceNo: get('.enr-f-seq'),
        category: get('.enr-f-cat'),
        parcelNumber: get('.enr-f-parcel').replace(/\s+/g, ' '),
        farmBlock: get('.enr-f-block').replace(/\s+/g, ' '),
        areaHa: get('.enr-f-area'),
        palmCount: get('.enr-f-palms')
      };
      row.classList.remove('has-error');
      if (!Object.values(en).some(Boolean)) return;    // empty row: ignored
      const n = entries.length + 1;
      const rowErr = [];
      if (!en.sequenceNo) rowErr.push('Sequence Number is required');
      else if (!/^\d+$/.test(en.sequenceNo) || parseInt(en.sequenceNo, 10) < 1) rowErr.push('Sequence Number must be a whole number');
      if (en.category !== 'Priority' && en.category !== 'Not Priority') rowErr.push('choose Priority or Not Priority');
      if (!en.parcelNumber) rowErr.push('Parcel Number is required');
      if (!en.farmBlock) rowErr.push('Farm & Block is required');
      if (en.areaHa && !/^\d+(\.\d+)?$/.test(en.areaHa)) rowErr.push('Area must be a number');
      if (en.palmCount && !/^\d+$/.test(en.palmCount)) rowErr.push('Palm Count must be a whole number');
      const pk = en.parcelNumber.toLowerCase();
      if (pk && seen.has(pk)) rowErr.push(`Parcel ${en.parcelNumber} is entered twice`);
      else if (pk && usedParcels.has(pk)) rowErr.push(`Parcel ${en.parcelNumber} is already enrolled under this land owner`);
      else if (pk && en.farmBlock && clashOf(pk, en.farmBlock)) {
        const c = clashOf(pk, en.farmBlock);
        rowErr.push(`another ${c.landOwnerName} (${c.landOwnerNo || c.landOwnerId}) already has ${en.parcelNumber} › ${en.farmBlock} — use a different parcel number`);
      }
      if (pk) seen.add(pk);
      if (rowErr.length) {
        row.classList.add('has-error');
        errors.push(`Entry ${n}: ${rowErr.join(', ')}.`);
      }
      entries.push(en);
    });
    if (!entries.length) errors.push('Add at least one parcel / block entry.');

    return {
      errors,
      enrollment: { landOwnerNo: claif || rawNo, landOwnerName: name, entries },   // category is inside each entry
      isExisting: !!st.existing
    };
  }

  /** Finish Enrollment: check everything, then show a review table before saving. */
  reviewLandownerEnrollment() {
    const { errors, enrollment, isExisting } = this.collectLandownerEnrollment();
    if (errors.length) {
      this.showToast(errors.slice(0, 3).join(' ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : ''), 'warning');
      return;
    }
    const e = (v) => this.esc(v);
    const pCount = enrollment.entries.filter((en) => en.category === 'Priority').length;
    document.getElementById('form-modal-title').textContent = 'Review Enrollment';
    document.getElementById('form-modal-body').innerHTML = `
      <div class="form-grid-3" style="margin-bottom:12px;">
        <div><div class="form-helper">CLAIF Number</div><strong>${e(enrollment.landOwnerNo)}</strong></div>
        <div><div class="form-helper">Land Owner Name</div><strong>${e(enrollment.landOwnerName)}</strong></div>
        <div><div class="form-helper">Sequences</div><strong>${pCount} Priority &bull; ${enrollment.entries.length - pCount} Not Priority</strong></div>
      </div>
      <div class="form-helper" style="margin-bottom:8px;">${isExisting
        ? 'Existing land owner: these entries will be <strong>added</strong>. Saved records stay as they are.'
        : 'New land owner.'}</div>
      <div class="table-responsive">
        <table class="table">
          <thead><tr><th>Sequence</th><th>Category</th><th>Parcel Number</th><th>Farm &amp; Block</th><th>Area (Ha)</th><th>Palm Count</th></tr></thead>
          <tbody>${enrollment.entries.map((en) => `
            <tr>
              <td><strong>${this.enrollmentPrefix(en.category)}${e(en.sequenceNo)}</strong></td>
              <td>${this.categoryBadge(en.category)}</td>
              <td>${e(en.parcelNumber)}</td>
              <td>${e(en.farmBlock)}</td>
              <td>${en.areaHa ? e(en.areaHa) : '—'}</td>
              <td>${en.palmCount ? e(en.palmCount) : '—'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="form-helper" style="margin-top:8px;">${enrollment.entries.length} entr${enrollment.entries.length === 1 ? 'y' : 'ies'}. Sequence numbers are saved exactly as typed. Press Cancel to go back and edit.</div>
    `;
    const btn = document.getElementById('form-modal-submit-btn');
    btn.textContent = '✓ Save Enrollment';
    btn.disabled = false;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        const result = await syncService.apiCall('ENROLL_LANDOWNER', { enrollment, clientVersion: FRONTEND_VERSION });
        try { await syncService.pullMasterData(); } catch (err) { console.warn(err); }
        this.closeModal('form-modal');
        this.showToast(result.message || 'Land owner enrolled.', 'success');
        this.navigateTo('landowner-enrollment');
      } catch (err) {
        this.showToast(err.message, 'error');   // the form keeps everything typed
      } finally {
        btn.disabled = false;
        btn.textContent = '✓ Save Enrollment';
      }
    };
    this.openModal('form-modal');
  }

  filterEnrollmentTable() {
    const q = (document.getElementById('enr-search')?.value || '').trim().toLowerCase();
    const st = document.getElementById('enr-status')?.value || 'Active';
    const fb = document.getElementById('enr-fb')?.value || 'ALL';
    document.querySelectorAll('.enr-row').forEach((row) => {
      const matchText = !q || row.dataset.search.includes(q);
      const active = row.dataset.status === 'Active';
      let matchStatus = true;
      if (st === 'Active') matchStatus = active;
      else if (st === 'Deactivated') matchStatus = !active;
      else if (st === 'NOSUP') matchStatus = active && row.dataset.nosup === '1';
      else if (st === 'PRIORITY') matchStatus = active && row.dataset.priority === '1';
      else if (st === 'NOTPRIORITY') matchStatus = active && row.dataset.priority === '0';
      else if (st === 'NOSIZE') matchStatus = active && row.dataset.nosize === '1';
      else if (st === 'NOSEQ') matchStatus = active && row.dataset.noseq === '1';
      const matchFb = fb === 'ALL' || row.dataset.fb === fb;
      row.style.display = matchText && matchStatus && matchFb ? '' : 'none';
    });
    // Hide a Priority / Not Priority heading when none of its rows are shown
    document.querySelectorAll('.enr-group').forEach((head) => {
      const shown = [...document.querySelectorAll(`.enr-row[data-group="${head.dataset.group}"]`)].filter((r) => r.style.display !== 'none').length;
      head.style.display = shown ? '' : 'none';
      const cnt = head.querySelector('.enr-group-count');
      if (cnt) cnt.textContent = shown;   // sequences shown in this group
    });
  }

  /**
   * Edit ONE parcel / farm & block entry, identified only by its Record ID (Block ID).
   * Other entries of the same land owner / CLAIF Number are never changed here.
   */
  /** The ONE entry with this Record ID (REC-xxxx) on this device. */
  async getEntryByRecordId(recordId) {
    const hits = (await db.getAll('farmsAndBlocks')).filter((b) => String(b.recordId || '') === String(recordId));
    return hits.length === 1 ? hits[0] : null;
  }

  async openEditEnrollmentModal(recordId) {
    const block = await this.getEntryByRecordId(recordId);
    if (!block) { this.showToast(`Entry ${recordId} was not found. Please refresh.`, 'error'); return; }
    const lo = (await db.getAll('landowners')).find((l) => String(l.landOwnerId) === String(block.landOwnerId)) || {};
    const allBlocks = await db.getAll('farmsAndBlocks');
    const siblings = allBlocks.filter((b) => String(b.landOwnerId) === String(block.landOwnerId) && b.blockId !== block.blockId);
    const ownerParcels = (await db.getAll('parcels'))
      .filter((p) => String(p.landOwnerId) === String(block.landOwnerId) && p.status !== 'Deactivated')
      .map((p) => p.parcelNumber);
    const e = (v) => this.esc(v);
    const currentSeq = parseInt(block.sequenceNo, 10) || parseInt(lo.sequenceNo, 10) || '';
    const cat = this.entryCategory(block, lo);   // THIS sequence's own category

    document.getElementById('form-modal-title').textContent = `Edit Entry ${block.recordId}`;
    document.getElementById('form-modal-body').innerHTML = `
      <div style="background:var(--palm-subtle);border:1px solid var(--palm-border);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:14px;font-size:13px;">
        <div><strong>Record ID:</strong> <code>${e(block.recordId)}</code> &nbsp;•&nbsp; ${e(block.parcelNumber)} › ${e(block.farmBlockName)}</div>
        <div class="form-helper" style="margin-top:4px;">Only this entry is changed. ${siblings.length ? `The other ${siblings.length} entr${siblings.length === 1 ? 'y' : 'ies'} of ${e(lo.landOwnerNo || block.landOwnerName)} stay as they are.` : ''}</div>
        ${lo.landOwnerId ? `<button type="button" class="btn btn-outline" style="margin-top:8px;padding:5px 10px;font-size:12.5px;"
           onclick="app.openEditLandownerProfileModal('${e(lo.landOwnerId)}')">🏡 Edit land owner profile (CLAIF, name)…</button>` : ''}
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">CLAIF Number</label>
          <input type="text" class="form-control" value="${e(lo.landOwnerNo || '—')}" readonly style="background:#f1f5f9;" />
        </div>
        <div class="form-group">
          <label class="form-label">Land Owner Name</label>
          <input type="text" class="form-control" value="${e(block.landOwnerName)}" readonly style="background:#f1f5f9;" />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label required">Category (this sequence only)</label>
          <select id="ed-category" class="form-control" onchange="document.getElementById('ed-seq-prefix').textContent = this.value === 'Priority' ? 'P-' : 'NP-'">
            <option value="Priority" ${cat === 'Priority' ? 'selected' : ''}>Priority</option>
            <option value="Not Priority" ${cat !== 'Priority' ? 'selected' : ''}>Not Priority</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label required">Sequence No.</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <span id="ed-seq-prefix" style="font-weight:700;min-width:34px;">${cat === 'Priority' ? 'P-' : 'NP-'}</span>
            <input type="text" id="ed-seq" class="form-control" inputmode="numeric" maxlength="6" value="${e(currentSeq)}"
                   oninput="this.value = this.value.replace(/\\D/g, '')" />
          </div>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label required">Parcel Number</label>
          <input type="text" id="ed-parcel" class="form-control" maxlength="120" list="ed-parcel-list" value="${e(block.parcelNumber)}" />
          <datalist id="ed-parcel-list">${ownerParcels.map((p) => `<option value="${e(p)}"></option>`).join('')}</datalist>
        </div>
        <div class="form-group">
          <label class="form-label required">Farm &amp; Block</label>
          <input type="text" id="ed-block" class="form-control" maxlength="120" value="${e(block.farmBlockName)}" placeholder="e.g. Farm 5 Block 1" />
        </div>
      </div>
      <div class="form-helper" style="margin:-6px 0 12px;">Changing the parcel or Farm &amp; Block also moves this entry's own reports and KPIs. Supervisor access follows the new Farm &amp; Block.</div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Area (Ha)</label>
          <input type="text" id="ed-area" class="form-control" inputmode="decimal" maxlength="12" value="${e(block.areaHa || '')}"
                 oninput="this.value = this.value.replace(/[^\\d.]/g, '').replace(/(\\..*)\\./g, '$1')" />
        </div>
        <div class="form-group">
          <label class="form-label">Palm Count</label>
          <input type="text" id="ed-palms" class="form-control" inputmode="numeric" maxlength="9" value="${e(block.palmCount || '')}"
                 oninput="this.value = this.value.replace(/\\D/g, '')" />
        </div>
      </div>
    `;

    const btn = document.getElementById('form-modal-submit-btn');
    btn.textContent = 'Save Entry';
    btn.className = 'btn btn-primary';
    btn.disabled = false;
    btn.onclick = async () => {
      if (btn.disabled) return;   // no double submit
      const newParcel = document.getElementById('ed-parcel').value.trim().replace(/\s+/g, ' ');
      const newBlock = document.getElementById('ed-block').value.trim().replace(/\s+/g, ' ');
      const newSeq = document.getElementById('ed-seq').value.trim();
      const area = document.getElementById('ed-area').value.trim();
      const palms = document.getElementById('ed-palms').value.trim();
      if (!newParcel || !newBlock) { this.showToast('Parcel Number and Farm & Block cannot be empty.', 'warning'); return; }
      if (!/^\d+$/.test(newSeq) || parseInt(newSeq, 10) < 1) { this.showToast('Type a Sequence No. (whole number, 1 or more).', 'warning'); return; }
      if (area && !/^\d+(\.\d+)?$/.test(area)) { this.showToast('Area must be a number.', 'warning'); return; }
      if (palms && !/^\d+$/.test(palms)) { this.showToast('Palm Count must be a whole number.', 'warning'); return; }
      const moved = newParcel.toLowerCase() !== String(block.parcelNumber).toLowerCase() || newBlock !== block.farmBlockName;
      if (moved && !confirm(`Change entry ${block.recordId} from ${block.parcelNumber} › ${block.farmBlockName} to ${newParcel} › ${newBlock}?\nOnly this entry and its own reports are updated.`)) return;

      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        const r = await syncService.apiCall('UPDATE_BLOCK', {
          recordId: block.recordId,        // the ONLY key used to find the row (REC-xxxx)
          blockId: block.blockId,          // cross-check: the server refuses if it does not belong to that Record ID
          clientVersion: FRONTEND_VERSION,
          category: document.getElementById('ed-category').value,   // this sequence only
          sequenceNo: newSeq,
          parcelNumber: newParcel,
          farmBlock: newBlock,
          areaHa: area,
          palmCount: palms
        });
        await syncService.pullMasterData();
        if (moved) await syncService.pullReports();
        this.closeModal('form-modal');
        this.showToast(r.message, 'success');
        this.navigateTo('landowner-enrollment');
      } catch (err) {
        this.showToast(`Update failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Entry';
      }
    };
    this.openModal('form-modal');
  }

  /** Land owner profile (one LandOwners row). Shared by all entries of this CLAIF Number, so it is edited separately. */
  async openEditLandownerProfileModal(landOwnerId) {
    const lo = (await db.getAll('landowners')).find((l) => String(l.landOwnerId) === String(landOwnerId));
    if (!lo) { this.showToast('Land owner not found. Please refresh.', 'error'); return; }
    const entries = (await db.getAll('farmsAndBlocks')).filter((b) => String(b.landOwnerId) === String(landOwnerId));
    const e = (v) => this.esc(v);

    document.getElementById('form-modal-title').textContent = `Land Owner Profile: ${lo.landOwnerNo || lo.landOwnerName}`;
    document.getElementById('form-modal-body').innerHTML = `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius-md);padding:10px 12px;margin-bottom:14px;font-size:13px;color:#92400e;">
        This is the land owner's profile (${e(lo.landOwnerId)}). It is shown on all ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}
        of this CLAIF Number: ${entries.map((b) => `${e(b.blockId)} (${e(b.parcelNumber)} › ${e(b.farmBlockName)})`).join(', ') || 'none'}.
        Other land owners with the same name are not affected. To change one parcel / block, use ✏️ on that row instead.
      </div>
      <div class="form-group">
        <label class="form-label required">CLAIF Number</label>
        <input type="text" id="lp-no" class="form-control" maxlength="30" value="${e(lo.landOwnerNo || 'CLAIF-')}" autocapitalize="characters" />
        <div class="form-helper">Priority / Not Priority is set on each sequence (✏️ on its row), not here.</div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label required">Land Owner Name</label>
          <input type="text" id="lp-name" class="form-control" maxlength="120" value="${e(lo.landOwnerName)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input type="text" id="lp-phone" class="form-control" value="${e(lo.phone || '')}" />
        </div>
      </div>
    `;
    const btn = document.getElementById('form-modal-submit-btn');
    btn.textContent = 'Save Profile';
    btn.className = 'btn btn-primary';
    btn.disabled = false;
    btn.onclick = async () => {
      if (btn.disabled) return;
      const name = document.getElementById('lp-name').value.trim();
      if (!name) { this.showToast('Land Owner Name cannot be empty.', 'warning'); return; }
      const renamed = name !== lo.landOwnerName;
      if (renamed && !confirm(`Rename ${lo.landOwnerNo || ''} "${lo.landOwnerName}" to "${name}"?\nIts ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} and their reports show the new name.`)) return;
      btn.disabled = true;
      try {
        const r = await syncService.apiCall('UPDATE_LANDOWNER', {
          clientVersion: FRONTEND_VERSION,
          landOwnerId: lo.landOwnerId,
          landOwnerNo: document.getElementById('lp-no').value,
          landOwnerName: name,
          phone: document.getElementById('lp-phone').value
        });
        await syncService.pullMasterData();
        if (renamed) await syncService.pullReports();
        this.closeModal('form-modal');
        this.showToast(r.message, 'success');
        this.navigateTo('landowner-enrollment');
      } catch (err) {
        this.showToast(`Update failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
      }
    };
    this.openModal('form-modal');
  }

  /** Delete ONE entry (by Record ID) after a confirmation that shows exactly what is deleted. */
  async confirmDeleteEntry(recordId) {
    const block = await this.getEntryByRecordId(recordId);
    if (!block) { this.showToast(`Entry ${recordId} was not found. Please refresh.`, 'error'); return; }
    const blockId = block.blockId;
    const lo = (await db.getAll('landowners')).find((l) => String(l.landOwnerId) === String(block.landOwnerId)) || {};
    const others = (await db.getAll('farmsAndBlocks')).filter((b) => String(b.landOwnerId) === String(block.landOwnerId) && b.blockId !== blockId).length;
    const e = (v) => this.esc(v);
    const seq = parseInt(block.sequenceNo, 10) || parseInt(lo.sequenceNo, 10);

    document.getElementById('form-modal-title').textContent = 'Delete Entry';
    document.getElementById('form-modal-body').innerHTML = `
      <p style="font-weight:700;margin-bottom:10px;">Are you sure you want to delete this entry?</p>
      <div class="table-responsive">
        <table class="table">
          <tbody>
            <tr><th style="width:140px;">Record ID</th><td><code>${e(block.recordId)}</code></td></tr>
            <tr><th>Sequence</th><td>${seq ? `${this.entryCategory(block, lo) === 'Priority' ? 'P-' : 'NP-'}${seq}` : '—'}</td></tr>
            <tr><th>Category</th><td>${this.categoryBadge(this.entryCategory(block, lo))}</td></tr>
            <tr><th>CLAIF Number</th><td>${e(lo.landOwnerNo || '—')}</td></tr>
            <tr><th>Land Owner</th><td>${e(block.landOwnerName)}</td></tr>
            <tr><th>Parcel</th><td>${e(block.parcelNumber)}</td></tr>
            <tr><th>Farm &amp; Block</th><td>${e(block.farmBlockName)}</td></tr>
            <tr><th>Area / Palms</th><td>${e(block.areaHa || '—')} ha &bull; ${e(block.palmCount || '—')} palms</td></tr>
          </tbody>
        </table>
      </div>
      <div class="form-helper" style="margin-top:8px;">
        Only this entry is deleted. The land owner profile ${others ? `and the other ${others} entr${others === 1 ? 'y' : 'ies'} of ${e(lo.landOwnerNo || block.landOwnerName)} stay` : 'stays'}.
        Reports already submitted for it are kept as history; its KPIs are switched off.
      </div>
    `;
    const btn = document.getElementById('form-modal-submit-btn');
    btn.textContent = '🗑️ Confirm Delete';
    btn.className = 'btn btn-danger';
    btn.disabled = false;
    btn.onclick = async () => {
      if (btn.disabled) return;   // no double submit
      btn.disabled = true;
      btn.textContent = 'Deleting...';
      try {
        const r = await syncService.apiCall('DELETE_BLOCK', { recordId: block.recordId, blockId: block.blockId, clientVersion: FRONTEND_VERSION });
        await syncService.pullMasterData();
        this.closeModal('form-modal');
        this.showToast(r.message || 'Entry deleted.', 'success');
        this.navigateTo('landowner-enrollment');
      } catch (err) {
        this.showToast(`Delete failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.className = 'btn btn-primary';
        btn.textContent = 'Save';
      }
    };
    this.openModal('form-modal');
  }

  async setBlockStatus(blockId, status) {
    const verb = status === 'Active' ? 'Reactivate' : 'Deactivate';
    if (!confirm(`${verb} this Farm & Block? ${status === 'Active' ? '' : 'Users assigned to it will no longer be able to record activities for it.'}`)) return;
    await this.runServerAction('SET_BLOCK_STATUS', { blockId, status }, 'Farm & Block updated.', 'landowner-enrollment');
  }

  /* ==========================================================================
     PAGE 15: USER MANAGEMENT & PERMISSIONS (ADMIN ONLY)
     Users are assigned to FARM & BLOCKS only. The supervisor of a field
     worker is found automatically from the blocks they share.
     ========================================================================== */

  /* ---------- Farm & Block codes (same rule as the server): "Farm 04 Block 1" -> "F04-B01" ---------- */
  farmBlockCodeOf(name) {
    const s = String(name == null ? '' : name).trim();
    const m = s.match(/farm\s*[-#:.]?\s*0*(\d+)[\s\-–,/_.]*(?:block|blk)\s*[-#:.]?\s*0*(\d+)/i);
    if (m) return `F${String(parseInt(m[1], 10)).padStart(2, '0')}-B${String(parseInt(m[2], 10)).padStart(2, '0')}`;
    return `N:${s.toLowerCase().replace(/\s+/g, ' ')}`;
  }

  /** Farm & Block of a block row: { code, farmCode, farm, block, full }. */
  farmBlockInfo(b) {
    const name = String(b.farmBlockName || '').trim();
    const code = b.farmBlockCode || this.farmBlockCodeOf(name);
    const m = code.match(/^F(\d+)-B(\d+)$/);
    if (m) {
      const blockNo = parseInt(m[2], 10);
      return { code, farmCode: `F${m[1]}`, farm: `Farm ${m[1]}`, block: `Block ${blockNo}`, blockNo, full: `Farm ${m[1]} – Block ${blockNo}` };
    }
    const f = name.match(/^(.*?)[\s\-–,/]*\b((?:block|blk)\b.*)$/i);
    const farm = f && f[1].trim() ? f[1].trim() : (name || 'Other');
    return { code, farmCode: `N:${farm.toLowerCase()}`, farm, block: f && f[1].trim() ? f[2].trim() : name, blockNo: 0, full: name };
  }

  /** Codes a user is assigned to (newer servers send them; older data: from the block IDs). */
  userFarmBlockCodes(u, blocks) {
    if (Array.isArray(u.assignedFarmBlockCodes) && u.assignedFarmBlockCodes.length) return u.assignedFarmBlockCodes;
    const ids = u.assignedFarmAndBlocks || [];
    if (ids.includes('ALL')) return ['ALL'];
    const byId = new Map(blocks.map((b) => [b.blockId, b]));
    return [...new Set(ids.map((id) => (byId.get(id) ? this.farmBlockInfo(byId.get(id)).code : id)))];
  }

  /** All Farm & Blocks (one entry per code, covering every land owner / parcel in it), grouped by farm. */
  buildFarmBlockCatalog(blocks) {
    const codes = new Map();
    blocks.forEach((b) => {
      const info = this.farmBlockInfo(b);
      if (!codes.has(info.code)) codes.set(info.code, { ...info, owners: new Set(), rows: 0 });
      const c = codes.get(info.code);
      c.owners.add(b.landOwnerId || b.landOwnerName);
      c.rows++;
    });
    const farms = new Map();
    [...codes.values()].forEach((c) => {
      if (!farms.has(c.farmCode)) farms.set(c.farmCode, { farmCode: c.farmCode, farm: c.farm, blocks: [] });
      farms.get(c.farmCode).blocks.push(c);
    });
    const list = [...farms.values()].sort((a, b) => a.farm.localeCompare(b.farm, undefined, { numeric: true }));
    list.forEach((f) => f.blocks.sort((a, b) => (a.blockNo - b.blockNo) || a.block.localeCompare(b.block, undefined, { numeric: true })));
    return { farms: list, codes };
  }

  async renderUserManagementView(container) {
    const users = await db.getAll('userDirectory');
    const blocks = await db.getAll('farmsAndBlocks');
    const catalog = this.buildFarmBlockCatalog(blocks);
    const codeLabel = (c) => (catalog.codes.get(c) ? catalog.codes.get(c).full : String(c).replace(/^N:/, ''));
    const e = (v) => this.esc(v);

    const roleOrder = { Administrator: 0, Supervisor: 1, 'Field Personnel': 2 };
    users.sort((a, b) => (roleOrder[a.role] - roleOrder[b.role]) || String(a.fullName).localeCompare(String(b.fullName)));

    const blocksLabel = (u) => {
      const codes = this.userFarmBlockCodes(u, blocks);
      if (codes.includes('ALL')) return '<em>All Farm &amp; Blocks</em>';
      if (!codes.length) return '<span class="badge badge-behind">None</span>';
      return codes.map((c) => `<div style="font-size:12px;">• ${e(codeLabel(c))}</div>`).join('');
    };

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">User Management &amp; Permissions</h2>
          <p style="font-size: 13.5px; color: var(--text-muted);">
            Assign each Supervisor and Field Personnel to Farm &amp; Blocks. They automatically see every land owner and parcel
            enrolled under those Farm &amp; Blocks (now and later). A Field Personnel's supervisor is detected automatically.
          </p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-outline" onclick="app.refreshUsersFromServer()">⬇️ Refresh</button>
          <button class="btn btn-primary" onclick="app.openUserModal()">+ Add New User</button>
        </div>
      </div>

      ${blocks.length === 0 ? `
        <div class="card" style="background:#fffbeb;border-color:#fde68a;color:#92400e;margin-bottom:16px;">
          No Farm &amp; Blocks yet. Enroll land owners first in <a href="#" onclick="app.navigateTo('landowner-enrollment');return false;">Land Owner Enrollment</a>.
        </div>` : ''}

      <div class="filter-toolbar">
        <input type="text" id="usr-search" class="form-control" placeholder="🔍 Search name, username, block..." oninput="app.filterUserTable()" />
        <select id="usr-role-filter" class="form-control" onchange="app.filterUserTable()">
          <option value="ALL">All roles</option>
          <option value="Administrator">Administrator</option>
          <option value="Supervisor">Supervisor</option>
          <option value="Field Personnel">Field Personnel</option>
        </select>
      </div>

      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Emp ID</th>
                <th>Full Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Assigned Farm &amp; Blocks</th>
                <th>Supervisor (auto)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${users.length === 0 ? `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">No users loaded. Click Refresh while online.</td></tr>` : users.map((u) => `
                <tr class="usr-row" data-role="${e(u.role)}"
                    data-search="${e([u.fullName, u.username, u.employeeId, this.userFarmBlockCodes(u, blocks).map(codeLabel).join(' ')].join(' ').toLowerCase())}">
                  <td><code>${e(u.employeeId)}</code></td>
                  <td><strong>${e(u.fullName)}</strong></td>
                  <td>${e(u.username)}</td>
                  <td><span class="badge ${u.role === 'Administrator' ? 'badge-completed' : (u.role === 'Supervisor' ? 'badge-ahead' : 'badge-ontrack')}">${e(u.role)}</span></td>
                  <td>${blocksLabel(u)}</td>
                  <td>${u.role === 'Field Personnel' ? e(u.assignedSupervisor || 'None') : '—'}</td>
                  <td><span class="badge ${u.accountStatus === 'Active' ? 'badge-completed' : 'badge-behind'}">${e(u.accountStatus)}</span></td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn-outline btn-icon" title="Edit" onclick="app.openUserModal('${e(u.userId)}')">✏️</button>
                    <button class="btn btn-outline btn-icon" title="Set temporary password" onclick="app.resetUserPassword('${e(u.userId)}')">🔑</button>
                    ${u.userId !== auth.getUserId() ? `
                    <button class="btn ${u.accountStatus === 'Active' ? 'btn-danger' : 'btn-outline'} btn-icon"
                            title="${u.accountStatus === 'Active' ? 'Deactivate' : 'Activate'}"
                            onclick="app.toggleUserStatus('${e(u.userId)}', '${u.accountStatus === 'Active' ? 'Deactivated' : 'Active'}')">
                      ${u.accountStatus === 'Active' ? '🚫' : '♻️'}
                    </button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  filterUserTable() {
    const q = (document.getElementById('usr-search')?.value || '').trim().toLowerCase();
    const role = document.getElementById('usr-role-filter')?.value || 'ALL';
    document.querySelectorAll('.usr-row').forEach((row) => {
      const ok = (!q || row.dataset.search.includes(q)) && (role === 'ALL' || row.dataset.role === role);
      row.style.display = ok ? '' : 'none';
    });
  }

  async refreshUsersFromServer() {
    try {
      await syncService.pullMasterData();
      this.showToast('Users and farm data refreshed.', 'success');
      this.navigateTo('user-management');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }

  /** Add (no userId) or edit (userId) a user. */
  async openUserModal(userId = null) {
    const users = await db.getAll('userDirectory');
    const blocks = (await db.getAll('farmsAndBlocks')).filter((b) => b.status !== 'Deactivated');
    const user = userId ? users.find((u) => u.userId === userId) : null;
    if (userId && !user) return;
    const e = (v) => this.esc(v);

    const activityTypes = ['Regular Activity', 'Irregular Activity', 'Other Farm Activity', 'Palm Category Activity', 'Seednut Collection', 'Pest and Disease Activity']
      .concat((await this.getCustomActivities()).map((d) => d.name));
    const userActs = user ? (user.assignedActivities || ['ALL']) : ['ALL'];

    document.getElementById('form-modal-title').textContent = user ? `Edit User: ${user.fullName}` : 'Add New User Account';
    document.getElementById('form-modal-body').innerHTML = `
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Employee ID</label>
          <input type="text" id="usr-emp-id" class="form-control" value="${e(user ? user.employeeId : '')}" placeholder="e.g. EMP-004" />
        </div>
        <div class="form-group">
          <label class="form-label required">Full Name</label>
          <input type="text" id="usr-fullname" class="form-control" value="${e(user ? user.fullName : '')}" placeholder="e.g. Maria Clara Santos" required />
        </div>
      </div>

      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label required">Username</label>
          <input type="text" id="usr-username" class="form-control" value="${e(user ? user.username : '')}" placeholder="e.g. maria" ${user ? 'readonly style="background:#f1f5f9;"' : ''} />
        </div>
        ${user ? `
        <div class="form-group">
          <label class="form-label">Account Status</label>
          <select id="usr-status" class="form-control">
            <option value="Active" ${user.accountStatus === 'Active' ? 'selected' : ''}>Active</option>
            <option value="Deactivated" ${user.accountStatus !== 'Active' ? 'selected' : ''}>Deactivated</option>
          </select>
        </div>` : `
        <div class="form-group">
          <label class="form-label required">Temporary Password (min. 8)</label>
          <input type="password" id="usr-password" class="form-control" autocomplete="new-password" placeholder="User must change it at first login" />
        </div>`}
      </div>

      <div class="form-group">
        <label class="form-label required">Role</label>
        <select id="usr-role" class="form-control" onchange="app.renderUserBlockPicker()">
          ${['Field Personnel', 'Supervisor', 'Administrator'].map((r) => `<option value="${r}" ${user && user.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>

      <div id="usr-activities-wrap" class="form-group">
        <label class="form-label">Assigned Activities</label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;font-size:13px;">
          <label><input type="checkbox" class="usr-act" value="ALL" ${userActs.includes('ALL') ? 'checked' : ''} onchange="app.onUserActivityAllToggle(this)" /> <strong>All activities</strong></label>
          ${activityTypes.map((a) => `<label><input type="checkbox" class="usr-act" value="${e(a)}" ${userActs.includes(a) || userActs.includes('ALL') ? 'checked' : ''} /> ${e(a)}</label>`).join('')}
        </div>
      </div>

      <div id="usr-blocks-wrap" class="form-group">
        <style>
          .fb-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
          .fb-tools input { flex: 1 1 200px; }
          .fb-farm { border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 8px; background: var(--bg-surface); }
          .fb-farm-head { display: flex; align-items: center; gap: 10px; padding: 9px 12px; cursor: pointer; font-weight: 700; font-size: 13.5px; color: var(--palm-dark); }
          .fb-farm-head .fb-count { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
          .fb-farm-head .fb-caret { transition: transform .15s; }
          .fb-farm.open .fb-caret { transform: rotate(90deg); }
          .fb-blocks { display: none; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; padding: 0 12px 10px 36px; }
          .fb-farm.open .fb-blocks { display: grid; }
          .fb-block { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; padding: 6px 8px; border-radius: 6px; background: var(--bg-hover); }
          .fb-block small { display: block; font-size: 11px; color: var(--text-muted); }
          .fb-block.taken { opacity: 0.55; }
          .fb-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; min-height: 8px; }
          .fb-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--palm-subtle); border: 1px solid var(--palm-border); color: var(--palm-dark); border-radius: 999px; padding: 3px 4px 3px 10px; font-size: 12px; font-weight: 600; }
          .fb-chip button { border: 0; background: transparent; cursor: pointer; color: var(--palm-dark); font-size: 13px; line-height: 1; padding: 2px 6px; }
          @media (max-width: 540px) { .fb-blocks { grid-template-columns: 1fr 1fr; padding-left: 12px; } .fb-tools .btn { flex: 1 1 120px; } }
        </style>
        <label class="form-label required">Assigned Farm &amp; Blocks</label>
        <div class="form-helper" style="margin:-2px 0 8px;">Covers every land owner and parcel under the chosen Farm &amp; Blocks, including ones enrolled later.</div>
        <div class="fb-tools">
          <input type="text" id="usr-block-search" class="form-control" placeholder="🔍 Search farm or block (e.g. Farm 04, Block 2)..." oninput="app.filterUserBlockPicker()" />
          <button type="button" class="btn btn-outline" onclick="app.selectAllUserFarmBlocks()">✔ Select All Farms &amp; Blocks</button>
          <button type="button" class="btn btn-outline" onclick="app.clearUserFarmBlocks()">Clear Selection</button>
        </div>
        <div id="usr-fb-chips" class="fb-chips"></div>
        <div id="usr-block-picker" style="max-height:340px;overflow:auto;"></div>
        <div id="usr-auto-supervisor" class="form-helper" style="margin-top:8px;"></div>
      </div>
    `;

    const catalog = this.buildFarmBlockCatalog(blocks);
    const startCodes = user ? this.userFarmBlockCodes(user, await db.getAll('farmsAndBlocks')) : [];
    this._userModal = {
      user,
      users,
      blocks,
      catalog,
      open: new Set(),
      // only Farm & Block codes; duplicates are impossible in a Set
      selected: new Set(startCodes.includes('ALL') ? [...catalog.codes.keys()] : startCodes)
    };
    // open the farms that already have a selection
    catalog.farms.forEach((f) => { if (f.blocks.some((b) => this._userModal.selected.has(b.code))) this._userModal.open.add(f.farmCode); });
    this.renderUserBlockPicker();

    const submitBtn = document.getElementById('form-modal-submit-btn');
    submitBtn.textContent = 'Save';
    submitBtn.onclick = () => this.saveUserFromModal();
    this.openModal('form-modal');
  }

  onUserActivityAllToggle(el) {
    document.querySelectorAll('.usr-act').forEach((cb) => { if (cb.value !== 'ALL') cb.checked = el.checked; });
  }

  /** Map Farm & Block code -> supervisor user (excluding the user being edited). */
  getSupervisorByCode(excludeUserId) {
    const map = new Map();
    const m = this._userModal;
    if (!m) return map;
    m.users.forEach((u) => {
      if (u.role !== 'Supervisor' || u.accountStatus !== 'Active' || u.userId === excludeUserId) return;
      const codes = this.userFarmBlockCodes(u, m.blocks);
      (codes.includes('ALL') ? [...m.catalog.codes.keys()] : codes).forEach((c) => map.set(c, u));
    });
    return map;
  }

  renderUserBlockPicker() {
    const m = this._userModal;
    if (!m) return;
    const role = document.getElementById('usr-role').value;
    const wrap = document.getElementById('usr-blocks-wrap');
    const actWrap = document.getElementById('usr-activities-wrap');
    const picker = document.getElementById('usr-block-picker');
    const e = (v) => this.esc(v);

    if (role === 'Administrator') {
      wrap.style.display = 'none';
      actWrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    actWrap.style.display = '';

    const supByCode = this.getSupervisorByCode(m.user ? m.user.userId : null);
    m.taken = new Set(role === 'Supervisor' ? [...supByCode.keys()] : []);

    picker.innerHTML = m.catalog.farms.map((f) => `
      <div class="fb-farm ${m.open.has(f.farmCode) ? 'open' : ''}" data-farm="${e(f.farmCode)}"
           data-search="${e([f.farm, ...f.blocks.map((b) => `${b.full} ${b.block}`)].join(' ').toLowerCase())}">
        <div class="fb-farm-head" onclick="app.toggleUserFarmOpen(event, '${e(f.farmCode)}')">
          <span class="fb-caret">▶</span>
          <input type="checkbox" class="fb-farm-cb" data-farm="${e(f.farmCode)}" onclick="event.stopPropagation()"
                 onchange="app.onUserFarmToggle('${e(f.farmCode)}', this.checked)" title="Select every block of ${e(f.farm)}" />
          <span>🌴 ${e(f.farm)}</span>
          <span class="fb-count" data-count="${e(f.farmCode)}"></span>
        </div>
        <div class="fb-blocks">
          ${f.blocks.map((b) => {
            const sup = supByCode.get(b.code);
            const taken = m.taken.has(b.code);
            return `
            <label class="fb-block ${taken && !m.selected.has(b.code) ? 'taken' : ''}" data-search="${e(`${b.full} ${b.block} ${f.farm}`.toLowerCase())}">
              <input type="checkbox" class="usr-block-cb" value="${e(b.code)}" data-farm="${e(f.farmCode)}"
                     ${m.selected.has(b.code) ? 'checked' : ''} ${taken && !m.selected.has(b.code) ? 'disabled' : ''}
                     onchange="app.onUserBlockToggle(this)" />
              <span><strong>${e(b.block)}</strong>
                <small>${b.owners.size} land owner(s) &bull; ${b.rows} parcel/block(s)</small>
                <small>${sup ? `👤 ${e(sup.fullName)}${taken ? ' (already supervisor)' : ''}` : '<em>no supervisor</em>'}</small>
              </span>
            </label>`;
          }).join('')}
        </div>
      </div>
    `).join('') || '<div style="color:var(--text-muted);font-size:13px;">No active Farm &amp; Blocks. Enroll land owners first.</div>';

    this.filterUserBlockPicker();
    this.refreshUserFarmBlockState();
  }

  toggleUserFarmOpen(ev, farmCode) {
    if (ev.target.closest('input')) return;
    const m = this._userModal;
    if (m.open.has(farmCode)) m.open.delete(farmCode); else m.open.add(farmCode);
    document.querySelector(`.fb-farm[data-farm="${CSS.escape(farmCode)}"]`)?.classList.toggle('open', m.open.has(farmCode));
  }

  onUserFarmToggle(farmCode, checked) {
    const m = this._userModal;
    const farm = m.catalog.farms.find((f) => f.farmCode === farmCode);
    if (!farm) return;
    farm.blocks.forEach((b) => {
      if (checked && !m.taken.has(b.code)) m.selected.add(b.code);
      if (!checked) m.selected.delete(b.code);
    });
    m.open.add(farmCode);
    this.syncUserFarmBlockCheckboxes();
  }

  onUserBlockToggle(cb) {
    if (cb.checked) this._userModal.selected.add(cb.value);
    else this._userModal.selected.delete(cb.value);
    this.refreshUserFarmBlockState();
  }

  selectAllUserFarmBlocks() {
    const m = this._userModal;
    m.catalog.codes.forEach((c, code) => { if (!m.taken.has(code)) m.selected.add(code); });
    this.syncUserFarmBlockCheckboxes();
    if (m.taken.size) this.showToast('Blocks that already have a supervisor were skipped.', 'info');
  }

  clearUserFarmBlocks() {
    this._userModal.selected.clear();
    this.syncUserFarmBlockCheckboxes();
  }

  removeUserFarmBlock(code) {
    this._userModal.selected.delete(code);
    this.syncUserFarmBlockCheckboxes();
  }

  syncUserFarmBlockCheckboxes() {
    const m = this._userModal;
    document.querySelectorAll('.usr-block-cb').forEach((cb) => { cb.checked = m.selected.has(cb.value); });
    document.querySelectorAll('.fb-farm').forEach((el) => el.classList.toggle('open', m.open.has(el.dataset.farm)));
    this.refreshUserFarmBlockState();
  }

  /** Farm checkboxes (full / partial), per-farm counts, the selected chips and the supervisor hint. */
  refreshUserFarmBlockState() {
    const m = this._userModal;
    if (!m) return;
    const e = (v) => this.esc(v);
    m.catalog.farms.forEach((f) => {
      const n = f.blocks.filter((b) => m.selected.has(b.code)).length;
      const cb = document.querySelector(`.fb-farm-cb[data-farm="${CSS.escape(f.farmCode)}"]`);
      if (cb) { cb.checked = n > 0 && n === f.blocks.length; cb.indeterminate = n > 0 && n < f.blocks.length; }
      const cnt = document.querySelector(`[data-count="${CSS.escape(f.farmCode)}"]`);
      if (cnt) cnt.textContent = `${n} / ${f.blocks.length} block(s)`;
    });
    const chips = document.getElementById('usr-fb-chips');
    if (chips) {
      const sel = [...m.selected].map((c) => m.catalog.codes.get(c) || { code: c, full: String(c).replace(/^N:/, ''), farm: '', blockNo: 0 })
        .sort((a, b) => String(a.farm).localeCompare(String(b.farm), undefined, { numeric: true }) || (a.blockNo - b.blockNo) || String(a.full).localeCompare(String(b.full)));
      chips.innerHTML = sel.length
        ? sel.map((c) => `<span class="fb-chip">${e(c.full)}<button type="button" title="Remove" onclick="app.removeUserFarmBlock('${e(c.code)}')">✕</button></span>`).join('')
        : '<span class="form-helper">No Farm &amp; Block selected yet.</span>';
    }
    this.updateAutoSupervisorHint();
  }

  filterUserBlockPicker() {
    const q = (document.getElementById('usr-block-search')?.value || '').trim().toLowerCase();
    document.querySelectorAll('.fb-farm').forEach((farm) => {
      const farmHit = !q || farm.dataset.search.includes(q);
      let anyBlock = false;
      farm.querySelectorAll('.fb-block').forEach((el) => {
        const hit = !q || el.dataset.search.includes(q) || farm.querySelector('.fb-farm-head').textContent.toLowerCase().includes(q);
        el.style.display = hit ? '' : 'none';
        if (hit) anyBlock = true;
      });
      farm.style.display = farmHit || anyBlock ? '' : 'none';
      if (q && (farmHit || anyBlock)) farm.classList.add('open');
      else if (!q) farm.classList.toggle('open', this._userModal.open.has(farm.dataset.farm));
    });
  }

  updateAutoSupervisorHint() {
    const hint = document.getElementById('usr-auto-supervisor');
    if (!hint || !this._userModal) return;
    const role = document.getElementById('usr-role').value;
    const count = this._userModal.selected.size;
    if (role !== 'Field Personnel') {
      hint.innerHTML = `${count} Farm &amp; Block(s) selected. Field Personnel in these blocks will report to this supervisor automatically.`;
      return;
    }
    const supByCode = this.getSupervisorByCode(null);
    const names = [...new Set([...this._userModal.selected].map((c) => supByCode.get(c)).filter(Boolean).map((u) => u.fullName))];
    hint.innerHTML = `${count} Farm &amp; Block(s) selected. <strong>Auto supervisor:</strong> ${names.length ? this.esc(names.join(', ')) : '<em>none yet — assign a Supervisor to these blocks</em>'}`;
  }

  async saveUserFromModal() {
    const m = this._userModal;
    const role = document.getElementById('usr-role').value;
    const acts = [...document.querySelectorAll('.usr-act:checked')].map((cb) => cb.value);
    const userData = {
      userId: m.user ? m.user.userId : undefined,
      employeeId: document.getElementById('usr-emp-id').value.trim(),
      fullName: document.getElementById('usr-fullname').value.trim(),
      username: document.getElementById('usr-username').value.trim().toLowerCase(),
      role,
      assignedFarmAndBlocks: role === 'Administrator' ? ['ALL'] : [...m.selected],
      assignedActivities: role === 'Administrator' || acts.includes('ALL') ? ['ALL'] : acts,
      accountStatus: m.user ? document.getElementById('usr-status').value : 'Active'
    };

    if (!userData.fullName || !userData.username) { this.showToast('Full Name and Username are required.', 'warning'); return; }
    if (role !== 'Administrator' && !userData.assignedFarmAndBlocks.length) { this.showToast('Select at least one Farm & Block.', 'warning'); return; }
    if (role !== 'Administrator' && !userData.assignedActivities.length) { this.showToast('Select at least one activity.', 'warning'); return; }

    if (!m.user) {
      const pw = document.getElementById('usr-password').value;
      if (!pw || pw.length < 8) { this.showToast('Temporary password must be at least 8 characters.', 'warning'); return; }
      userData.passwordHash = await auth.hashPassword(pw);
    }

    const btn = document.getElementById('form-modal-submit-btn');
    btn.disabled = true;
    const res = await this.runServerAction('SAVE_USER', { userData }, 'User saved.', null);
    btn.disabled = false;
    if (res) {
      this.closeModal('form-modal');
      this.navigateTo('user-management');
    }
  }

  async toggleUserStatus(userId, newStatus) {
    if (!confirm(`${newStatus === 'Active' ? 'Activate' : 'Deactivate'} this account?`)) return;
    await this.runServerAction('TOGGLE_USER_STATUS', { userId, newStatus }, 'User status updated.', 'user-management');
  }

  async resetUserPassword(userId) {
    const pw = prompt('Enter a temporary password for this user (min. 8 characters). They must change it at next login:');
    if (pw === null) return;
    if (pw.length < 8) { this.showToast('Temporary password must be at least 8 characters.', 'warning'); return; }
    const newPasswordHash = await auth.hashPassword(pw);
    await this.runServerAction('RESET_PASSWORD', { userId, newPasswordHash }, 'Temporary password set.', 'user-management');
  }

  /* ==========================================================================
     PAGE 16: REPORTING & DATA EXPORT (EXCEL, CSV, PRINT/PDF)
     ========================================================================== */

  async renderReportsView(container) {
    const reports = auth.filterAuthorizedRecords(await db.getAll('reports'))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const customDefs = await this.getCustomActivities(true);

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Reports &amp; Data Export</h2>
          <p style="font-size: 13.5px; color: var(--text-muted);">
            Generate filtered accomplishment reports and export to Excel, CSV, or printable PDF.
          </p>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-outline" onclick="app.refreshReportsFromServer()">⬇️ Download from Server</button>
          <button class="btn btn-primary" onclick="app.exportReportsToExcel()">📊 Export to Excel</button>
          <button class="btn btn-secondary" onclick="app.exportReportsToCSV()">📁 Export CSV</button>
          <button class="btn btn-outline" onclick="window.print()">🖨️ Print / PDF</button>
        </div>
      </div>

      <!-- Filter Controls -->
      <div class="filter-toolbar">
        <select id="rpt-filter-activity" class="form-control" onchange="app.applyReportFilters()">
          <option value="ALL">All Activity Types</option>
          <option value="Regular Activity">Regular Activity</option>
          <option value="Irregular Activity">Irregular Activity</option>
          <option value="Other Farm Activity">Other Farm Activity</option>
          <option value="Palm Category Activity">Palm Category Activity</option>
          <option value="Seednut Collection">Seednut Collection</option>
          <option value="Pest and Disease Activity">Pest and Disease Activity</option>
          ${customDefs.map((d) => `<option value="${this.esc(d.name)}">${this.esc(d.name)}</option>`).join('')}
        </select>
        <input type="date" id="rpt-filter-from" class="form-control" onchange="app.applyReportFilters()" />
        <input type="date" id="rpt-filter-to" class="form-control" onchange="app.applyReportFilters()" />
      </div>

      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="table-responsive">
          <table class="table" id="reports-export-table">
            <thead>
              <tr>
                <th>Report ID</th>
                <th>Date</th>
                <th>Activity</th>
                <th>Landowner &amp; Parcel</th>
                <th>Farm &amp; Block</th>
                <th>Manpower</th>
                <th>Key Accomplishment</th>
                <th>Submitted By</th>
                <th>Sync Status</th>
              </tr>
            </thead>
            <tbody>
              ${reports.map((r) => `
                <tr class="rpt-row" data-activity="${this.esc(r.activityType)}" data-date="${this.esc(r.date || '')}">
                  <td><code>${this.esc(r.reportId)}</code></td>
                  <td>${this.esc(r.date || '—')}</td>
                  <td><strong>${this.esc(r.activityType)}</strong></td>
                  <td>${this.esc(r.landOwnersName || '—')}${r.landOwnerNo ? ` <span style="font-size:11px;color:var(--text-muted);">${this.esc(r.landOwnerNo)}</span>` : ''} &bull; ${this.esc(r.parcelNumber || '—')}</td>
                  <td>${this.esc(r.farmBlock || '—')}</td>
                  <td>${this.esc(r.manpower || r.manpowerCount || 1)}</td>
                  <td>
                    ${r.weedingSlashingHa ? `${r.weedingSlashingHa} Ha` : ''}
                    ${r.roundWeedingPalms ? `${r.roundWeedingPalms} palms` : ''}
                    ${r.nutCountCollected ? `${r.nutCountCollected} nuts` : ''}
                    ${r.quantity ? `${this.esc(r.quantity)} ${this.esc(r.unit || '')}` : ''}
                    ${r.customFields ? `<span style="font-size:12px;">${this.esc(this.describeCustomFields(r, customDefs))}</span>` : ''}
                  </td>
                  <td>${this.esc(r.employeeName || '—')}</td>
                  <td><span class="badge ${r.syncStatus === 'SENT' ? 'badge-completed' : (r.syncStatus === 'REJECTED' ? 'badge-behind' : 'badge-ongoing')}">${this.esc(r.syncStatus)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  applyReportFilters() {
    const actFilter = document.getElementById('rpt-filter-activity').value;
    const rows = document.querySelectorAll('.rpt-row');

    rows.forEach((r) => {
      const act = r.getAttribute('data-activity');
      const date = r.getAttribute('data-date') || '';
      const from = document.getElementById('rpt-filter-from').value;
      const to = document.getElementById('rpt-filter-to').value;
      const match = (actFilter === 'ALL' || act === actFilter) && (!from || date >= from) && (!to || date <= to);
      r.style.display = match ? '' : 'none';
    });
  }

  async exportReportsToCSV() {
    const reports = auth.filterAuthorizedRecords(await db.getAll('reports'));
    if (!reports.length) {
      this.showToast('No reports available to export.', 'warning');
      return;
    }

    const customDefs = await this.getCustomActivities(true);
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const headers = ['Report ID', 'Unique UUID', 'Activity Type', 'Date', 'CLAIF Number', 'Landowner', 'Parcel', 'Block', 'Manpower', 'Details', 'Remarks', 'Device ID', 'Sync Status'];
    const rows = reports.map((r) => [
      q(r.reportId),
      q(r.uniqueUuid || ''),
      q(r.activityType),
      q(r.date || ''),
      q(r.landOwnerNo || ''),
      q(r.landOwnersName || ''),
      q(r.parcelNumber || ''),
      q(r.farmBlock || ''),
      r.manpower || r.manpowerCount || 1,
      q(this.describeCustomFields(r, customDefs)),
      q(r.remarks || ''),
      r.deviceId || '',
      r.syncStatus || 'PENDING'
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Farm_Operations_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast('CSV export downloaded.', 'success');
  }

  async exportReportsToExcel() {
    const reports = auth.filterAuthorizedRecords(await db.getAll('reports'));
    const customDefs = await this.getCustomActivities(true);
    if (!reports.length) {
      this.showToast('No reports to export.', 'warning');
      return;
    }

    let tableHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8"></head>
      <body>
        <table border="1">
          <tr style="background:#14532d;color:#ffffff;font-weight:bold;">
            <th>Report ID</th><th>Date</th><th>Activity Type</th><th>CLAIF Number</th><th>Landowner</th><th>Parcel</th><th>Farm Block</th><th>Manpower</th><th>Details</th><th>Remarks</th><th>Device ID</th><th>Status</th>
          </tr>
          ${reports.map((r) => `
            <tr>
              <td>${this.esc(r.reportId)}</td>
              <td>${this.esc(r.date || '')}</td>
              <td>${this.esc(r.activityType)}</td>
              <td>${this.esc(r.landOwnerNo || '')}</td>
              <td>${this.esc(r.landOwnersName || '')}</td>
              <td>${this.esc(r.parcelNumber || '')}</td>
              <td>${this.esc(r.farmBlock || '')}</td>
              <td>${this.esc(r.manpower || r.manpowerCount || 1)}</td>
              <td>${this.esc(this.describeCustomFields(r, customDefs))}</td>
              <td>${this.esc(r.remarks || '')}</td>
              <td>${this.esc(r.deviceId || '')}</td>
              <td>${this.esc(r.syncStatus || 'PENDING')}</td>
            </tr>
          `).join('')}
        </table>
      </body>
    </html>`;

    const blob = new Blob([tableHtml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Farm_Operations_${new Date().toISOString().split('T')[0]}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast('Excel report downloaded.', 'success');
  }

  /* ==========================================================================
     PAGE 17: SYNC CENTER
     ========================================================================== */

  async renderSyncCenterView(container) {
    const allPending = await db.getAll('pendingQueue');
    const me = auth.getUserId();
    const mine = auth.isAdmin() ? allPending : allPending.filter((p) => p.userId === me);
    const others = allPending.length - mine.length;
    const rejected = (await db.getAll('reports')).filter((r) => r.syncStatus === 'REJECTED' && (auth.isAdmin() || r.userId === me));
    const status = syncService.getStatus();
    const lastSync = await db.getSetting('lastSyncTime', 'Never');
    const e = (v) => this.esc(v);

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Synchronization Center</h2>
          <p style="font-size: 13.5px; color: var(--text-muted);">Offline queue and Google Sheets synchronization.</p>
        </div>
        <button class="btn btn-primary" onclick="app.triggerManualSync()">🔄 Sync My Pending (${mine.length})</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon ${status === 'ONLINE' || status === 'SYNCED' ? 'green' : 'amber'}">🌐</div>
          <div class="stat-info"><div class="stat-label">Network Status</div><div class="stat-value">${e(status)}</div>
            <div class="stat-sub">${navigator.onLine ? 'Connected to Internet' : 'Offline Mode Active'}</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon amber">⏳</div>
          <div class="stat-info"><div class="stat-label">My Pending Records</div><div class="stat-value">${mine.length}</div>
            <div class="stat-sub">${others ? `${others} from other users on this device` : 'Waiting for upload'}</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue">📅</div>
          <div class="stat-info"><div class="stat-label">Last Successful Sync</div>
            <div class="stat-value" style="font-size: 15px;">${lastSync !== 'Never' ? new Date(lastSync).toLocaleTimeString() : 'Pending'}</div>
            <div class="stat-sub">${lastSync !== 'Never' ? new Date(lastSync).toLocaleDateString() : 'Awaiting first sync'}</div></div>
        </div>
      </div>

      ${rejected.length ? `
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px;border-color:#fecaca;">
        <div class="card-header" style="padding:16px 20px;background:#fef2f2;">
          <div class="card-title" style="color:#991b1b;">❌ Rejected by Server (${rejected.length})</div>
          <div class="card-subtitle">These reports are kept on this device. Ask your administrator to check your Farm &amp; Block / activity assignment.</div>
        </div>
        <div class="table-responsive"><table class="table">
          <thead><tr><th>Report ID</th><th>Activity</th><th>Date</th><th>Farm &amp; Block</th><th>Reason</th><th></th></tr></thead>
          <tbody>${rejected.map((r) => `
            <tr><td><code>${e(r.reportId)}</code></td><td>${e(r.activityType)}</td><td>${e(r.date)}</td>
              <td>${e(r.farmBlock || '—')}</td><td style="color:#991b1b;">${e(r.syncError)}</td>
              <td><button class="btn btn-outline" style="font-size:12px;padding:4px 8px;" onclick="app.retryRejectedReport('${e(r.reportId)}')">Retry</button></td></tr>`).join('')}
          </tbody></table></div>
      </div>` : ''}

      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="card-header" style="padding: 16px 20px;">
          <div class="card-title">Pending Submission Queue (this device)</div>
        </div>
        <div class="table-responsive">
          <table class="table">
            <thead><tr><th>Report ID</th><th>Activity Type</th><th>Date</th><th>Land Owner &amp; Block</th><th>Submitted By</th><th>Status</th></tr></thead>
            <tbody>
              ${allPending.length === 0 ? `
                <tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">✓ All reports are synchronized. Queue is empty.</td></tr>
              ` : allPending.map((p) => `
                <tr>
                  <td><code>${e(p.reportId)}</code></td>
                  <td><strong>${e(p.activityType)}</strong></td>
                  <td>${e(p.date || '—')}</td>
                  <td>${e(p.landOwnersName || '—')} &bull; ${e(p.farmBlock || '—')}</td>
                  <td>${e(p.employeeName || p.userId)}${p.userId !== me ? ' <span class="badge badge-behind">other user</span>' : ''}</td>
                  <td><span class="badge badge-ongoing">⏳ Pending Sync</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async retryRejectedReport(reportId) {
    const rec = await db.get('reports', reportId);
    if (!rec) return;
    rec.syncStatus = 'PENDING';
    delete rec.syncError;
    await db.put('reports', rec);
    await db.put('pendingQueue', rec);
    await this.triggerManualSync();
  }

  async triggerManualSync() {
    this.showToast('Synchronizing with Google Sheets...', 'info');
    const result = await syncService.syncPendingRecords();
    this.showToast(result.message || result.error, result.success ? 'success' : 'error');
    if (this.currentView === 'sync') this.renderSyncCenterView(document.getElementById('view-content-root'));
  }

  async triggerQuickSync() {
    this.showToast('Syncing with Google Sheets...', 'info');
    const res = await syncService.syncPendingRecords();
    this.showToast(res.message || res.error, res.success ? 'success' : 'warning');
    if (res.success) this.backgroundRefresh();
  }

  /* ==========================================================================
     PAGE 18: DEVICE MANAGEMENT
     ========================================================================== */

  async renderDeviceManagementView(container) {
    const devInfo = syncService.getDeviceInfo();
    const localCount = (await db.getAll('reports')).filter((r) => r.deviceId === devInfo.deviceId).length;
    const devices = await db.getAll('devices');
    const e = (v) => this.esc(v);
    const g = (d, k1, k2) => d[k1] !== undefined ? d[k1] : (d[k2] !== undefined ? d[k2] : '');

    container.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Device Identification &amp; Registry</h2>
        <p style="font-size: 13.5px; color: var(--text-muted);">Installation IDs and which user last synced from each device.</p>
      </div>

      <div class="card" style="max-width: 700px; margin-bottom: 20px;">
        <div class="card-header"><div class="card-title">📱 This Device</div><span class="badge badge-completed">Active Installation</span></div>
        <div style="display: grid; grid-template-columns: 140px 1fr; gap: 12px; font-size: 13.5px;">
          <div style="color: var(--text-muted); font-weight: 600;">Device ID:</div><div><code>${e(devInfo.deviceId)}</code></div>
          <div style="color: var(--text-muted); font-weight: 600;">Hardware / Name:</div><div><strong>${e(devInfo.deviceName)}</strong></div>
          <div style="color: var(--text-muted); font-weight: 600;">Browser &amp; OS:</div><div>${e(devInfo.browserOs)}</div>
          <div style="color: var(--text-muted); font-weight: 600;">Screen:</div><div>${e(devInfo.screenResolution)}</div>
          <div style="color: var(--text-muted); font-weight: 600;">Reports:</div><div><strong>${localCount} recorded on this device</strong></div>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden;">
        <div class="card-header" style="padding:16px 20px;"><div class="card-title">All Registered Devices (from Google Sheets)</div></div>
        <div class="table-responsive"><table class="table">
          <thead><tr><th>Device ID</th><th>Device</th><th>Last User</th><th>Browser / OS</th><th>Last Seen</th><th>Submissions</th></tr></thead>
          <tbody>
            ${devices.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px;">No devices loaded. Refresh master data while online.</td></tr>` :
              devices.map((d) => `<tr>
                <td><code>${e(g(d, 'Device ID', 'deviceId'))}</code></td>
                <td>${e(g(d, 'Device Name', 'deviceName'))}</td>
                <td>${e(g(d, 'Employee Name', 'employeeName'))}</td>
                <td>${e(g(d, 'Browser OS', 'browserOs'))}</td>
                <td>${g(d, 'Last Seen', 'lastSeen') ? new Date(g(d, 'Last Seen', 'lastSeen')).toLocaleString() : '—'}</td>
                <td>${e(g(d, 'Total Submissions', 'totalSubmissions'))}</td>
              </tr>`).join('')}
          </tbody></table></div>
      </div>
    `;
  }

  /* ==========================================================================
     PAGE 19: SETTINGS
     ========================================================================== */

  async renderSettingsView(container) {
    const apiUrl = await syncService.getApiUrl();
    const workingDays = await db.getSetting('workingDaysPerWeek', 6);
    const restDays = await db.getSetting('restDays', 'Sunday');
    const lastPull = await db.getSetting('lastMasterPull', '');
    const e = (v) => this.esc(v);

    container.innerHTML = `
      <div class="card" style="max-width: 760px; margin: 0 auto;">
        <div class="card-header">
          <div>
            <div class="card-title">⚙️ System &amp; API Settings</div>
            <div class="card-subtitle">Google Apps Script connection and calendar settings</div>
          </div>
        </div>

        <form id="settings-form" onsubmit="event.preventDefault(); app.saveSettings();">
          <div class="form-group">
            <label class="form-label required">Google Apps Script Web App URL</label>
            <input type="url" id="setting-api-url" class="form-control" value="${e(apiUrl)}" placeholder="https://script.google.com/macros/s/.../exec" ${auth.isAdmin() ? '' : 'readonly style="background:#f1f5f9;"'} required />
            <div class="form-helper">The deployed Web App URL ending in <code>/exec</code>.${auth.isAdmin() ? '' : ' Only an administrator can change it.'}</div>
          </div>

          <div style="margin: 14px 0; display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline" style="flex:1;" onclick="app.testApiConnection()">🔌 Test Connection</button>
            ${auth.isAdmin() ? `<button type="button" class="btn btn-outline" style="flex:1;" onclick="app.reinitializeSheets()">🧱 Re-check Database Sheets</button>` : ''}
          </div>
          <div id="settings-test-status" style="margin-top: 8px; font-size: 13px; font-weight: 600;"></div>

          <div class="form-grid-2" style="margin-top: 18px;">
            <div class="form-group">
              <label class="form-label">Working Days per Week</label>
              <input type="number" id="setting-working-days" class="form-control" value="${e(workingDays)}" min="1" max="7" />
            </div>
            <div class="form-group">
              <label class="form-label">Scheduled Weekly Rest Days</label>
              <input type="text" id="setting-rest-days" class="form-control" value="${e(restDays)}" />
            </div>
          </div>
          <div class="form-helper">Last farm data download: ${lastPull ? new Date(lastPull).toLocaleString() : 'never'}</div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline" onclick="app.pullMasterDataFromServer()">⬇️ Refresh Farm Data &amp; Reports</button>
            <button type="submit" class="btn btn-primary">Save Settings</button>
          </div>
        </form>
      </div>
    `;
  }

  async testApiConnection(urlOverride) {
    const input = document.getElementById('setting-api-url') || document.getElementById('login-api-url');
    const url = (urlOverride || (input ? input.value : '')).trim();
    const statusEl = document.getElementById('settings-test-status') || document.getElementById('login-api-status');
    const say = (msg, ok) => { if (statusEl) { statusEl.textContent = msg; statusEl.style.color = ok ? '#15803d' : '#ef4444'; } };

    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      say('❌ Enter the Google Apps Script Web App URL (https://script.google.com/macros/s/.../exec).', false);
      return false;
    }
    say('⏳ Connecting...', true);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'PING' })
      });
      const result = await response.json();
      if (result.success) {
        say(`✅ Connected (server v${result.version || '?'}). Database sheets verified.`, true);
        await db.setSetting('apiUrl', url);
        return true;
      }
      say('❌ ' + result.error, false);
    } catch (err) {
      say('❌ Connection failed: ' + err.message, false);
    }
    return false;
  }

  async reinitializeSheets() {
    try {
      const res = await syncService.apiCall('SETUP_DB');
      this.showToast(res.message, 'success');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }

  async saveSettings() {
    if (auth.isAdmin()) {
      const url = document.getElementById('setting-api-url').value.trim();
      if (url) await db.setSetting('apiUrl', url);
    }
    await db.setSetting('workingDaysPerWeek', parseInt(document.getElementById('setting-working-days').value) || 6);
    await db.setSetting('restDays', document.getElementById('setting-rest-days').value.trim());
    this.showToast('Settings saved on this device.', 'success');
  }

  async pullMasterDataFromServer() {
    this.showToast('Downloading farm data and reports...', 'info');
    try {
      await syncService.pullMasterData();
      const r = await syncService.pullReports();
      this.showToast(`Farm data updated. ${r.count} report(s) downloaded.`, 'success');
      if (this.currentView === 'settings') this.renderSettingsView(document.getElementById('view-content-root'));
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }

  async refreshReportsFromServer() {
    this.showToast('Downloading reports for your Farm & Blocks...', 'info');
    try {
      const r = await syncService.pullReports();
      this.showToast(r.message, 'success');
      this.navigateTo(this.currentView);
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }

  /* ==========================================================================
     PAGE 20: USER PROFILE
     ========================================================================== */

  async renderProfileView(container) {
    const user = auth.getCurrentUser();
    if (!user) return;
    await auth.refreshScope();
    const blocks = auth.getAuthorizedBlocks();
    const e = (v) => this.esc(v);
    const acts = Array.isArray(user.assignedActivities) ? user.assignedActivities.join(', ') : user.assignedActivities;

    container.innerHTML = `
      <div class="card" style="max-width: 680px; margin: 0 auto;">
        <div class="card-header">
          <div class="card-title">👤 User Profile</div>
          <span class="badge badge-completed">${e(user.role)}</span>
        </div>

        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
          <div class="user-avatar" style="width: 54px; height: 54px; font-size: 20px;">${e((user.fullName || user.username).charAt(0).toUpperCase())}</div>
          <div>
            <h3 style="font-size: 18px; font-weight: 700; color: var(--text-main);">${e(user.fullName)}</h3>
            <div style="font-size: 13px; color: var(--text-muted);">@${e(user.username)} &bull; ${e(user.employeeId)}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 150px 1fr; gap: 12px; font-size: 13.5px; border-top: 1px solid var(--border); padding-top: 16px;">
          ${user.role === 'Field Personnel' ? `
          <div style="color: var(--text-muted); font-weight: 600;">Supervisor (auto):</div>
          <div>${e(user.assignedSupervisor || 'None')}</div>` : ''}

          <div style="color: var(--text-muted); font-weight: 600;">Farm &amp; Blocks:</div>
          <div>${auth.hasAllBlocks() ? '<em>All Farm &amp; Blocks</em>' :
            (blocks.length ? blocks.map((b) => `<div>• ${e(b.farmBlockName)} <span style="color:var(--text-muted);font-size:12px;">(${e(b.landOwnerName)} › ${e(b.parcelNumber)})</span></div>`).join('') : 'None assigned')}</div>

          <div style="color: var(--text-muted); font-weight: 600;">Activities:</div>
          <div>${e(acts || 'ALL')}</div>

          <div style="color: var(--text-muted); font-weight: 600;">Session:</div>
          <div>${user.isOfflineSession ? '<span class="badge badge-ongoing">Offline (saved credentials)</span>' : '<span class="badge badge-completed">Online</span>'}
            ${user.tokenExpiresAt ? `<span style="font-size:12px;color:var(--text-muted);"> &bull; valid until ${new Date(user.tokenExpiresAt).toLocaleDateString()}</span>` : ''}</div>
        </div>

        <div style="margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap;">
          <button class="btn btn-outline" onclick="app.openChangePasswordModal()">🔑 Change Password</button>
          <button class="btn btn-danger" onclick="app.handleLogout()">Sign Out</button>
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     QR CODE SCANNER MODAL (Camera + Canvas + Manual Fallback)
     ========================================================================== */

  openQrScanner(targetInputId) {
    this.qrTargetInputId = targetInputId;
    this.openModal('qr-modal');

    const video = document.getElementById('qr-video');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then((stream) => {
          this.qrStream = stream;
          video.srcObject = stream;
        })
        .catch((err) => {
          console.warn('[QR] Camera access blocked or not available:', err);
        });
    }
  }

  applyManualQrInput() {
    const val = document.getElementById('qr-manual-input').value.trim();
    if (!val) {
      this.showToast('Please type a code or number.', 'warning');
      return;
    }

    if (this.qrTargetInputId) {
      const input = document.getElementById(this.qrTargetInputId);
      if (input) input.value = val;
    }

    this.closeModal('qr-modal');
    this.showToast(`Code "${val}" applied.`, 'success');
  }

  /* ==========================================================================
     MODAL CONTROLS & TOAST NOTIFICATIONS
     ========================================================================== */

  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('active');
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('active');
    if (modalId === 'form-modal') {
      const btn = document.getElementById('form-modal-submit-btn');
      if (btn) { btn.textContent = 'Save'; btn.disabled = false; btn.className = 'btn btn-primary'; }
      this._userModal = null;
    }

    if (modalId === 'qr-modal' && this.qrStream) {
      this.qrStream.getTracks().forEach((track) => track.stop());
      this.qrStream = null;
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast-error' : (type === 'warning' ? 'toast-warning' : '')}`;
    toast.innerHTML = `
      <span>${type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : '✅')}</span>
      <span>${this.esc(message)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

// Global Application Instance
const app = new FarmOpsApp();

// Boot application upon DOM ready
window.addEventListener('DOMContentLoaded', () => {
  app.init();
});
