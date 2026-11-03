/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Authentication, Session Token & Farm-and-Block Access Control Service
 *
 * Access rule (v3): users are assigned to FARM & BLOCKS only.
 *  - Administrator      -> everything
 *  - Supervisor         -> reports / KPIs of their assigned Farm & Blocks
 *  - Field Personnel    -> reports / KPIs of their assigned Farm & Blocks (+ always their own reports)
 * The server enforces the same rule; this file only hides what the user cannot use.
 */

class AuthService {
  constructor() {
    this.currentUser = null;
    this.blocks = [];          // Farm & Block master list cached on this device
    this.allowedKeys = new Set();
  }

  // SHA-256 of the password (the server salts and stretches it again before storing)
  async hashPassword(password) {
    if (!password) return '';
    const data = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async initSession() {
    await db.init();
    const user = await db.getSetting('currentUser');
    if (user && user.sessionToken) {
      this.currentUser = user;
      await this.refreshScope();
    } else if (user) {
      // Session from v2 (no token) — require a fresh sign-in
      await db.setSetting('currentUser', null);
    }
    return this.currentUser;
  }

  getCurrentUser() { return this.currentUser; }
  getToken() { return this.currentUser ? this.currentUser.sessionToken || '' : ''; }
  isAuthenticated() { return !!this.currentUser; }
  isAdmin() { return !!this.currentUser && this.currentUser.role === 'Administrator'; }
  isSupervisor() { return !!this.currentUser && this.currentUser.role === 'Supervisor'; }
  isSupervisorOrAdmin() { return this.isAdmin() || this.isSupervisor(); }
  isFieldPersonnel() { return !!this.currentUser && this.currentUser.role === 'Field Personnel'; }
  getUserRole() { return this.currentUser ? this.currentUser.role : 'Guest'; }
  getUserId() { return this.currentUser ? this.currentUser.userId : ''; }
  getEmployeeName() { return this.currentUser ? (this.currentUser.fullName || this.currentUser.username) : ''; }

  static key(landOwner, parcel, block) {
    const n = (v) => String(v == null ? '' : v).trim().toLowerCase();
    return `${n(landOwner)}|${n(parcel)}|${n(block)}`;
  }

  hasAllBlocks() {
    if (!this.currentUser) return false;
    if (this.isAdmin()) return true;
    const a = this.currentUser.assignedFarmAndBlocks;
    return a === 'ALL' || (Array.isArray(a) && a.includes('ALL'));
  }

  /** Reload the Farm & Block list from IndexedDB and rebuild the allowed set. */
  async refreshScope() {
    this.blocks = (await db.getAll('farmsAndBlocks')).filter((b) => (b.status || 'Active') !== 'Deactivated');
    const assigned = (this.currentUser && this.currentUser.assignedFarmAndBlocks) || [];
    const ids = Array.isArray(assigned) ? assigned : String(assigned).split(',').map((s) => s.trim());

    const allowed = this.hasAllBlocks()
      ? this.blocks
      : this.blocks.filter((b) => ids.includes(b.blockId));

    this.allowedKeys = new Set(allowed.map((b) => AuthService.key(b.landOwnerName, b.parcelNumber, b.farmBlockName)));
  }

  /** Farm & Blocks this user may record for / view. */
  getAuthorizedBlocks() {
    if (this.hasAllBlocks()) return this.blocks.slice();
    return this.blocks.filter((b) => this.allowedKeys.has(AuthService.key(b.landOwnerName, b.parcelNumber, b.farmBlockName)));
  }

  canAccessBlockOf(landOwner, parcel, block) {
    if (!this.currentUser) return false;
    if (this.hasAllBlocks()) return true;
    return this.allowedKeys.has(AuthService.key(landOwner, parcel, block));
  }

  /** Kept for older code: true if ANY assigned block has this name. */
  canAccessBlock(blockName) {
    if (this.hasAllBlocks()) return true;
    return this.getAuthorizedBlocks().some((b) => b.farmBlockName === blockName);
  }

  /** Kept for older code: a land owner is visible if one of its blocks is assigned. */
  canAccessLandowner(landOwnerName) {
    if (this.hasAllBlocks()) return true;
    return this.getAuthorizedBlocks().some((b) => b.landOwnerName === landOwnerName);
  }

  canAccessActivity(activityType) {
    if (!this.currentUser) return false;
    if (this.isAdmin()) return true;
    const assigned = this.currentUser.assignedActivities;
    if (!assigned) return false;
    const list = Array.isArray(assigned) ? assigned : String(assigned).split(',');
    const clean = list.map((s) => String(s).trim().toLowerCase());
    return clean.includes('all') || clean.includes(String(activityType).trim().toLowerCase());
  }

  /** Reports this user may see: own reports + reports inside assigned Farm & Blocks. */
  filterAuthorizedRecords(records) {
    if (!this.currentUser || !records) return [];
    if (this.hasAllBlocks()) return records;
    return records.filter((rec) =>
      rec.userId === this.currentUser.userId ||
      (rec.farmBlock && this.canAccessBlockOf(rec.landOwnersName, rec.parcelNumber, rec.farmBlock))
    );
  }

  filterAuthorizedKpis(kpis) {
    if (!this.currentUser || !kpis) return [];
    const active = kpis.filter((k) => (k.status || 'Active') !== 'Deactivated');
    if (this.hasAllBlocks()) return active;
    return active.filter((k) => this.canAccessBlockOf(k.landOwner, k.parcelNumber, k.farmBlock));
  }

  /**
   * Sign in. Online first (gets a signed session token); falls back to the
   * credentials cached on this device when there is no connection.
   */
  async login(username, password) {
    if (!username || !password) throw new Error('Please enter both username and password.');

    const cleanUsername = username.trim().toLowerCase();
    const passwordHash = await this.hashPassword(password);
    const apiUrl = await syncService.getApiUrl();
    const isOnline = navigator.onLine && !!apiUrl;

    if (isOnline) {
      let result = null;
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'LOGIN', username: cleanUsername, passwordHash })
        });
        result = await response.json();
      } catch (networkErr) {
        console.warn('[Auth] Server unreachable, trying offline sign-in.', networkErr.message);
      }

      if (result) {
        if (!result.success || !result.user) {
          // The server answered: wrong password / locked / deactivated. Do NOT fall back offline.
          throw new Error(result.error || 'Invalid username or password.');
        }

        const user = { ...result.user, passwordHash, isOfflineSession: false };
        // Remove any other cached account with the same username (e.g. old demo data)
        const cached = await db.getAll('users');
        for (const u of cached) {
          if ((u.username || '').toLowerCase() === cleanUsername && u.userId !== user.userId) {
            await db.delete('users', u.userId);
          }
        }
        await db.put('users', user);   // cached for offline sign-in on THIS device only
        await db.setSetting('currentUser', user);
        if (Array.isArray(user.assignedBlockDetails) && user.assignedBlockDetails.length) {
          // make sure the scope works immediately, even before master data is pulled
          const existing = await db.getAll('farmsAndBlocks');
          if (!existing.length) await db.putBatch('farmsAndBlocks', user.assignedBlockDetails);
        }
        this.currentUser = user;
        await this.refreshScope();
        return { success: true, user, mode: 'online', message: 'Signed in successfully.' };
      }
    }

    // Offline fallback (only accounts that signed in online on this device before)
    const allUsers = await db.getAll('users');
    const matchedUser = allUsers.find((u) => (u.username || '').toLowerCase() === cleanUsername);

    if (!matchedUser || !matchedUser.sessionToken) {
      throw new Error(`No offline account for "${cleanUsername}" on this device. Connect to the internet to sign in the first time.`);
    }
    if (matchedUser.accountStatus && matchedUser.accountStatus.toLowerCase() !== 'active') {
      throw new Error('Account is deactivated. Please contact your Farm Administrator.');
    }
    if (matchedUser.passwordHash !== passwordHash) {
      throw new Error('Invalid username or password.');
    }

    const offlineUser = { ...matchedUser, isOfflineSession: true };
    await db.setSetting('currentUser', offlineUser);
    this.currentUser = offlineUser;
    await this.refreshScope();
    return { success: true, user: offlineUser, mode: 'offline', message: 'Signed in offline using this device\'s saved credentials.' };
  }

  /** Change own password (online only). */
  async changePassword(currentPassword, newPassword) {
    if (!newPassword || newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
    const oldHash = await this.hashPassword(currentPassword);
    const newHash = await this.hashPassword(newPassword);
    const result = await syncService.apiCall('CHANGE_PASSWORD', { oldPasswordHash: oldHash, newPasswordHash: newHash });

    const user = { ...this.currentUser, passwordHash: newHash, sessionToken: result.sessionToken, mustChangePassword: false };
    await db.put('users', user);
    await db.setSetting('currentUser', user);
    this.currentUser = user;
    return result;
  }

  /** Update the cached profile with fresh data from the server (role / blocks / activities). */
  async updateProfile(serverMe) {
    if (!serverMe || !this.currentUser || serverMe.userId !== this.currentUser.userId) return;
    const user = {
      ...this.currentUser,
      fullName: serverMe.fullName,
      employeeId: serverMe.employeeId,
      role: serverMe.role,
      assignedSupervisor: serverMe.assignedSupervisor,
      assignedFarmAndBlocks: serverMe.assignedFarmAndBlocks,
      assignedActivities: serverMe.assignedActivities,
      accountStatus: serverMe.accountStatus,
      mustChangePassword: serverMe.mustChangePassword
    };
    await db.put('users', user);
    await db.setSetting('currentUser', user);
    this.currentUser = user;
    await this.refreshScope();
  }

  async logout() {
    this.currentUser = null;
    this.allowedKeys = new Set();
    await db.setSetting('currentUser', null);
  }
}

const auth = new AuthService();
