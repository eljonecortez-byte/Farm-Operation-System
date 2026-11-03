/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Authentication & Role-Based Access Control Service
 */

class AuthService {
  constructor() {
    this.currentUser = null;
  }

  // Cryptographic SHA-256 hash using standard Web Crypto API
  async hashPassword(password) {
    if (!password) return '';
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Load existing session on application boot
  async initSession() {
    await db.init();
    const user = await db.getSetting('currentUser');
    if (user) {
      this.currentUser = user;
    }
    return this.currentUser;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isAuthenticated() {
    return !!this.currentUser;
  }

  isAdmin() {
    return this.currentUser && this.currentUser.role === 'Administrator';
  }

  isSupervisor() {
    return this.currentUser && (this.currentUser.role === 'Supervisor' || this.currentUser.role === 'Administrator');
  }

  isFieldPersonnel() {
    return this.currentUser && this.currentUser.role === 'Field Personnel';
  }

  getUserRole() {
    return this.currentUser ? this.currentUser.role : 'Guest';
  }

  getUserId() {
    return this.currentUser ? this.currentUser.userId : '';
  }

  getEmployeeName() {
    return this.currentUser ? (this.currentUser.fullName || this.currentUser.username) : '';
  }

  /**
   * Check if the user is authorized for a specific Landowner
   */
  canAccessLandowner(landOwnerName) {
    if (!this.currentUser) return false;
    if (this.isAdmin()) return true;

    const assigned = this.currentUser.assignedLandOwners;
    if (!assigned) return false;
    if (assigned === 'ALL' || (Array.isArray(assigned) && assigned.includes('ALL'))) return true;

    if (Array.isArray(assigned)) {
      return assigned.includes(landOwnerName);
    }
    return String(assigned).split(',').map((s) => s.trim()).includes(landOwnerName);
  }

  /**
   * Check if user is authorized for a specific Farm & Block
   */
  canAccessBlock(blockName) {
    if (!this.currentUser) return false;
    if (this.isAdmin()) return true;

    const assigned = this.currentUser.assignedFarmAndBlocks;
    if (!assigned) return false;
    if (assigned === 'ALL' || (Array.isArray(assigned) && assigned.includes('ALL'))) return true;

    if (Array.isArray(assigned)) {
      return assigned.includes(blockName);
    }
    return String(assigned).split(',').map((s) => s.trim()).includes(blockName);
  }

  /**
   * Check if user is authorized for a specific Activity Type
   */
  canAccessActivity(activityType) {
    if (!this.currentUser) return false;
    if (this.isAdmin()) return true;

    const assigned = this.currentUser.assignedActivities;
    if (!assigned) return false;
    if (assigned === 'ALL' || (Array.isArray(assigned) && assigned.includes('ALL'))) return true;

    if (Array.isArray(assigned)) {
      return assigned.some((act) => act.toLowerCase().trim() === activityType.toLowerCase().trim());
    }
    return String(assigned).split(',').map((s) => s.trim().toLowerCase()).includes(activityType.toLowerCase().trim());
  }

  /**
   * Filters records to only include those authorized for the current user
   */
  filterAuthorizedRecords(records) {
    if (!this.currentUser || !records) return [];
    if (this.isAdmin()) return records;

    return records.filter((rec) => {
      // Field personnel only sees own submitted records
      if (this.isFieldPersonnel()) {
        return rec.userId === this.currentUser.userId;
      }

      // Supervisor sees assigned landowners and blocks, or assigned employees
      if (this.isSupervisor()) {
        const landMatch = !rec.landOwnersName || this.canAccessLandowner(rec.landOwnersName);
        const blockMatch = !rec.farmBlock || this.canAccessBlock(rec.farmBlock);
        return landMatch && blockMatch;
      }

      return false;
    });
  }

  /**
   * Unified Login Handler with Automatic Seamless Offline Fallback
   */
  async login(username, password) {
    if (!username || !password) {
      throw new Error('Please enter both username and password.');
    }

    const cleanUsername = username.trim().toLowerCase();
    const passwordHash = await this.hashPassword(password);
    const apiUrl = await db.getSetting('apiUrl', '');
    const isOnline = navigator.onLine && !!apiUrl;

    // 1. Online Attempt
    if (isOnline) {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'LOGIN',
            username: cleanUsername,
            passwordHash: passwordHash
          })
        });

        const result = await response.json();

        if (result && result.success && result.user) {
          const user = {
            ...result.user,
            passwordHash: passwordHash, // Cached securely for offline login
            isOfflineSession: false
          };

          // Cache user credentials into IndexedDB
          await db.put('users', user);
          await db.setSetting('currentUser', user);
          this.currentUser = user;

          return { success: true, user: user, mode: 'online', message: 'Logged in online successfully.' };
        } else {
          // Explicit server credential rejection
          throw new Error(result.error || 'Invalid credentials.');
        }
      } catch (err) {
        console.warn('[Auth] Online authentication failed or network down. Falling back to offline check...', err.message);
        if (err.message && err.message.includes('Invalid credentials')) {
          throw err;
        }
      }
    }

    // 2. Offline Fallback using cached IndexedDB users
    const allUsers = await db.getAll('users');
    const matchedUser = allUsers.find(
      (u) => (u.username || '').toLowerCase() === cleanUsername
    );

    if (!matchedUser) {
      throw new Error('No offline user account found for "' + cleanUsername + '". Please connect online to log in for the first time.');
    }

    if (matchedUser.accountStatus && matchedUser.accountStatus.toLowerCase() !== 'active') {
      throw new Error('Account is deactivated. Please contact your Farm Administrator.');
    }

    if (matchedUser.passwordHash === passwordHash) {
      const offlineUser = {
        ...matchedUser,
        lastLogin: new Date().toISOString(),
        isOfflineSession: true
      };

      await db.setSetting('currentUser', offlineUser);
      this.currentUser = offlineUser;

      return {
        success: true,
        user: offlineUser,
        mode: 'offline',
        message: 'Logged in offline successfully using cached credentials.'
      };
    } else {
      throw new Error('Invalid username or password.');
    }
  }

  /**
   * Log out current user and clear active session
   */
  async logout() {
    this.currentUser = null;
    await db.setSetting('currentUser', null);
  }
}

// Global Singleton Instance
const auth = new AuthService();
