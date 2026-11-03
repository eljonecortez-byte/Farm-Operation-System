/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Main Frontend Application Controller & Router
 * Implements all 20 views, cascading dropdowns, KPI computations,
 * interactive charts, offline maps, QR code scanner, and local profile photo upload.
 */

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
      this.navigateTo('dashboard');
      this.checkMapVersionNotification();
    } else {
      this.showLoginView();
    }

    console.log('[App] System ready.');
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
          resolve(this.gpsCoordinates);
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
    if (avatarEl) {
      if (user.avatarUrl) {
        avatarEl.innerHTML = `<img src="${user.avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" alt="Avatar" />`;
      } else {
        avatarEl.textContent = (user.fullName || user.username).charAt(0).toUpperCase();
      }
    }
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

          <ellipse cx="230" cy="355" rx="140" ry="18" fill="#14532d" opacity="0.35" />

          <g class="palm-sway-trunk">
            <path d="M 215 355 Q 225 260 215 190 Q 210 165 228 150 Q 242 165 238 190 Q 248 260 245 355 Z" fill="url(#palmTrunkGrad)" />
            <path d="M 219 320 Q 230 315 241 320" stroke="#b45309" stroke-width="3" fill="none" opacity="0.8" />
            <path d="M 217 280 Q 228 275 239 280" stroke="#b45309" stroke-width="3" fill="none" opacity="0.8" />
            <path d="M 216 240 Q 226 235 236 240" stroke="#b45309" stroke-width="2.5" fill="none" opacity="0.8" />
            <path d="M 216 200 Q 224 195 234 200" stroke="#b45309" stroke-width="2.5" fill="none" opacity="0.8" />
          </g>

          <g class="palm-frond-left-1">
            <path d="M 228 150 C 180 130 110 145 60 210 C 105 185 170 170 228 150 Z" fill="url(#frondGradLeft)" />
            <path d="M 228 150 C 170 95 100 85 50 130 C 95 115 160 125 228 150 Z" fill="url(#frondGradRight)" />
          </g>

          <g class="palm-frond-left-2">
            <path d="M 228 150 C 190 70 130 45 70 70 C 115 75 170 100 228 150 Z" fill="url(#frondGradLeft)" />
            <path d="M 228 150 C 210 50 230 20 255 30 C 250 70 240 110 228 150 Z" fill="url(#frondGradRight)" />
          </g>

          <g class="palm-frond-right-1">
            <path d="M 228 150 C 275 60 335 50 380 80 C 335 95 285 115 228 150 Z" fill="url(#frondGradLeft)" />
            <path d="M 228 150 C 305 100 370 120 415 170 C 365 155 295 145 228 150 Z" fill="url(#frondGradRight)" />
          </g>

          <g class="palm-frond-right-2">
            <path d="M 228 150 C 295 145 365 185 390 250 C 350 210 280 180 228 150 Z" fill="url(#frondGradLeft)" />
          </g>

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
    ].includes(view);
  }

  async navigateTo(viewName) {
    this.currentView = viewName;
    this.closeSidebar();
    this.renderNavLinks();

    const titleEl = document.getElementById('page-title-text');
    const container = document.getElementById('view-content-root');

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

        <h2 style="font-size: 21px; font-weight: 800; color: var(--palm-dark); margin-top: 8px;">
          Farm Operations System
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 22px;">
          Activity Monitoring &amp; KPI Management &bull; Coconut Plantation
        </p>

        <form id="login-form" onsubmit="event.preventDefault(); app.handleLoginSubmit();" style="text-align: left;">
          <div class="form-group">
            <label class="form-label required">Username</label>
            <input type="text" id="login-username" class="form-control" placeholder="Enter username (e.g. admin)" required autocomplete="username" />
          </div>

          <div class="form-group">
            <label class="form-label required">Password</label>
            <div style="position: relative;">
              <input type="password" id="login-password" class="form-control" placeholder="Enter password" required autocomplete="current-password" />
              <button type="button" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--text-muted);" onclick="app.togglePasswordVisibility('login-password')">
                👁️
              </button>
            </div>
          </div>

          <button type="submit" id="login-submit-btn" class="btn btn-primary btn-lg" style="width: 100%; margin-top: 8px;">
            <span>Sign In to Plantation System</span>
          </button>
        </form>

        <div style="margin-top: 22px; padding-top: 18px; border-top: 1px dashed var(--border); font-size: 12px; color: var(--text-muted);">
          <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-main);">Quick Demo Accounts:</div>
          <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline" style="padding: 4px 8px; font-size: 11.5px;" onclick="app.fillDemoLogin('admin', 'admin123')">
              👑 Admin
            </button>
            <button type="button" class="btn btn-outline" style="padding: 4px 8px; font-size: 11.5px;" onclick="app.fillDemoLogin('supervisor1', 'admin123')">
              📋 Supervisor
            </button>
            <button type="button" class="btn btn-outline" style="padding: 4px 8px; font-size: 11.5px;" onclick="app.fillDemoLogin('field1', 'admin123')">
              🌱 Field Lead
            </button>
          </div>
          <div style="margin-top: 10px; font-size: 11px; color: var(--text-light);">
            Offline authentication supported for previously logged-in accounts.
          </div>
        </div>
      </div>
    `;
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
      this.showToast(result.message || 'Login successful!', 'success');
      this.showAppLayout();
      this.navigateTo('dashboard');
      this.checkMapVersionNotification();
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
    const rawReports = await db.getAll('reports');
    const reports = auth.filterAuthorizedRecords(rawReports);
    const kpis = await db.getAll('kpis');
    const landowners = await db.getAll('landowners');
    const farmsAndBlocks = await db.getAll('farmsAndBlocks');

    const totalReports = reports.length;
    let totalManpower = 0;
    let totalPalmsServiced = 0;
    let totalHectaresAccomplished = 0;
    let totalMaterialsUsed = 0;

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

    let totalTargetQty = 0;
    let totalActualQty = 0;
    let completedCount = 0;
    let aheadCount = 0;
    let behindCount = 0;
    let ongoingCount = 0;

    kpis.forEach((k) => {
      const target = parseFloat(k.targetQuantity) || 0;
      totalTargetQty += target;

      const matchedReports = reports.filter((r) => {
        const typeMatch = !k.activityType || r.activityType === k.activityType || (r.activityType === 'Regular Activity' && k.activityType.indexOf('Weeding') !== -1);
        const blockMatch = !k.farmBlock || r.farmBlock === k.farmBlock;
        return typeMatch && blockMatch;
      });

      let actual = 0;
      matchedReports.forEach((mr) => {
        actual += parseFloat(mr.weedingSlashingHa || mr.roundWeedingPalms || mr.nutCountCollected || mr.quantity || 0);
      });

      totalActualQty += actual;
      const pct = target > 0 ? (actual / target) * 100 : 0;

      if (actual >= target && target > 0) completedCount++;
      else if (pct >= 80) aheadCount++;
      else if (pct >= 40) ongoingCount++;
      else behindCount++;
    });

    const overallKpiPct = totalTargetQty > 0 ? Math.min(100, Math.round((totalActualQty / totalTargetQty) * 100)) : 88;

    container.innerHTML = `
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

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 20px; margin-bottom: 22px;">
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

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📝 Recent Activity Reports</div>
            <div class="card-subtitle">Latest operations registered on this device</div>
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
                  <td>${r.activityType}</td>
                  <td>${r.landOwnersName || 'Hacienda San Isidro'} &bull; ${r.parcelNumber || 'P-101'}</td>
                  <td>${r.farmBlock || 'Block A1'}</td>
                  <td>${r.manpower || r.manpowerCount || 1} pax</td>
                  <td>
                    ${r.weedingSlashingHa ? `${r.weedingSlashingHa} Ha cleared` : ''}
                    ${r.roundWeedingPalms ? `${r.roundWeedingPalms} palms weeded` : ''}
                    ${r.nutCountCollected ? `${r.nutCountCollected} seednuts` : ''}
                    ${r.totalPalmsAffected ? `${r.totalPalmsAffected} palms treated` : ''}
                    ${r.quantity ? `${r.quantity} ${r.unit || 'units'}` : ''}
                  </td>
                  <td>
                    <span class="badge ${r.syncStatus === 'SENT' ? 'badge-completed' : 'badge-ongoing'}">
                      ${r.syncStatus === 'SENT' ? '✓ Synced' : '⏳ Pending'}
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
        <rect x="${x}" y="${targetY}" width="${barWidth}" height="${targetHeight}" rx="4" fill="#e2e8f0" />
        <rect x="${x + barWidth + 4}" y="${actualY}" width="${barWidth}" height="${actualHeight}" rx="4" fill="${actualPct >= 1 ? '#15803d' : '#22c55e'}" />
        <text x="${x + barWidth}" y="200" font-size="10" font-weight="600" text-anchor="middle" fill="#64748b">${item.label.substring(0, 14)}</text>
        <text x="${x + barWidth + 4 + barWidth/2}" y="${actualY - 4}" font-size="10" font-weight="700" text-anchor="middle" fill="#15803d">${item.actual}</text>
      `;
    });

    return `
      <svg viewBox="0 0 ${totalWidth} ${chartHeight}" width="100%" height="100%">
        <line x1="30" y1="180" x2="${totalWidth - 20}" y2="180" stroke="#cbd5e1" stroke-width="1.5" />
        ${svgBars}
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
    container.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main);">Activity Registration Modules</h2>
        <p style="font-size: 13.5px; color: var(--text-muted);">
          Select an activity module to record daily field accomplishments and manpower.
        </p>
      </div>

      <div class="activity-hub-grid">
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
     CASCADING DROPDOWNS HELPER
     ========================================================================== */

  async populateCascadingDropdowns(landSelectId, parcelSelectId, blockSelectId) {
    const landowners = await db.getAll('landowners');
    const parcels = await db.getAll('parcels');
    const blocks = await db.getAll('farmsAndBlocks');

    const landEl = document.getElementById(landSelectId);
    const parcelEl = document.getElementById(parcelSelectId);
    const blockEl = document.getElementById(blockSelectId);

    if (!landEl || !parcelEl || !blockEl) return;

    const authorizedLands = landowners.filter((l) => auth.canAccessLandowner(l.landOwnerName));

    landEl.innerHTML = `<option value="">-- Select Landowner --</option>` +
      authorizedLands.map((l) => `<option value="${l.landOwnerName}">${l.landOwnerName}</option>`).join('');

    const updateParcels = () => {
      const selectedLand = landEl.value;
      const filteredParcels = parcels.filter((p) => !selectedLand || p.landOwnerName === selectedLand);
      parcelEl.innerHTML = `<option value="">-- Select Parcel --</option>` +
        filteredParcels.map((p) => `<option value="${p.parcelNumber}">${p.parcelNumber} (${p.totalAreaHa || 0} Ha)</option>`).join('');
      updateBlocks();
    };

    const updateBlocks = () => {
      const selectedLand = landEl.value;
      const selectedParcel = parcelEl.value;
      const filteredBlocks = blocks.filter((b) => {
        const matchLand = !selectedLand || b.landOwnerName === selectedLand;
        const matchParcel = !selectedParcel || b.parcelNumber === selectedParcel;
        return matchLand && matchParcel && auth.canAccessBlock(b.farmBlockName);
      });

      blockEl.innerHTML = `<option value="">-- Select Farm & Block --</option>` +
        filteredBlocks.map((b) => `<option value="${b.farmBlockName}">${b.farmBlockName}</option>`).join('');
    };

    landEl.onchange = updateParcels;
    parcelEl.onchange = updateBlocks;

    updateParcels();
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
      landOwnersName: document.getElementById('reg-landowner').value,
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
    await this.populateActivityDropdown('irreg-treatment', 'Irregular Activity', 'Pest and Disease Treatment (
