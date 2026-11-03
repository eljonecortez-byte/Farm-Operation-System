/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Device Identification, Telemetry & Background Synchronization Service
 */

/**
 * OPTIONAL: paste your Google Apps Script Web App URL here (ends with /exec)
 * so every phone is connected automatically. It can also be set on the login screen.
 */
const DEFAULT_API_URL = '';

class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || '';
  }
}

class SyncService {
  constructor() {
    this.status = 'ONLINE'; // ONLINE, OFFLINE, PENDING SYNC, SYNCING, SYNCED, SYNC ERROR
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.listeners = [];
    this.deviceInfo = null;
    this.syncIntervalId = null;
  }

  async init() {
    await this.initDeviceInfo();
    this.setupNetworkListeners();
    this.startPeriodicSync();
    await this.updateSyncStatus();
  }

  /**
   * Generates or retrieves unique persistent Device ID and telemetry
   */
  async initDeviceInfo() {
    let devId = localStorage.getItem('farmops_device_id');
    if (!devId) {
      devId = await db.getSetting('deviceId');
    }

    if (!devId) {
      devId = 'FARM-DEV-' + this.generateUUID().substring(0, 8).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
      localStorage.setItem('farmops_device_id', devId);
      await db.setSetting('deviceId', devId);
    }

    // Telemetry detection
    const ua = navigator.userAgent;
    let devName = 'Web Browser';
    let browserOs = 'Unknown OS';

    if (/android/i.test(ua)) {
      devName = 'Android Mobile Device';
      browserOs = 'Android (' + (ua.match(/Android\s([0-9\.]+)/) ? ua.match(/Android\s([0-9\.]+)/)[1] : 'OS') + ')';
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
      devName = 'Apple iOS Device';
      browserOs = 'iOS / Safari';
    } else if (/Windows/i.test(ua)) {
      devName = 'Windows Desktop / Laptop';
      browserOs = 'Windows PC';
    } else if (/Macintosh/i.test(ua)) {
      devName = 'Apple Mac';
      browserOs = 'macOS';
    } else if (/Linux/i.test(ua)) {
      devName = 'Linux Workstation';
      browserOs = 'Linux';
    }

    this.deviceInfo = {
      deviceId: devId,
      deviceName: devName,
      browserOs: browserOs,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      platform: navigator.platform || 'Unknown'
    };

    console.log('[Sync] Device ID initialized:', this.deviceInfo.deviceId, this.deviceInfo.deviceName);
  }

  getDeviceInfo() {
    return this.deviceInfo;
  }

  getDeviceId() {
    return this.deviceInfo ? this.deviceInfo.deviceId : 'FARM-DEV-UNKNOWN';
  }

  async getApiUrl() {
    return (await db.getSetting('apiUrl', '')) || DEFAULT_API_URL || '';
  }

  /**
   * Authenticated call to the Google Apps Script API.
   * Throws ApiError on failure; handles expired sessions centrally.
   */
  async apiCall(action, data = {}) {
    const apiUrl = await this.getApiUrl();
    if (!apiUrl) throw new ApiError('Server URL is not set. Open Settings and paste the Google Apps Script Web App URL.', 'NO_URL');
    if (!navigator.onLine) throw new ApiError('You are offline. This action needs an internet connection.', 'OFFLINE');

    let result;
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...data, action, token: auth.getToken() })
      });
      result = await response.json();
    } catch (err) {
      throw new ApiError('Cannot reach the server: ' + err.message, 'NETWORK');
    }

    if (!result || !result.success) {
      const code = result && result.code;
      if ((code === 'AUTH_REQUIRED' || code === 'AUTH_EXPIRED') && typeof app !== 'undefined' && app.handleSessionExpired) {
        app.handleSessionExpired(result.error);
      }
      throw new ApiError((result && result.error) || 'Server error.', code);
    }
    return result;
  }

  generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  setupNetworkListeners() {
    window.addEventListener('online', async () => {
      console.log('[Sync] Internet connection detected (ONLINE).');
      this.setStatus('ONLINE');
      // Automatically attempt background sync when online
      await this.syncPendingRecords();
      await this.refreshFromServer();
    });

    window.addEventListener('offline', () => {
      console.log('[Sync] Internet connection lost (OFFLINE).');
      this.setStatus('OFFLINE');
    });

    // Check initial online status
    if (!navigator.onLine) {
      this.setStatus('OFFLINE');
    }
  }

  startPeriodicSync() {
    // Check every 60 seconds
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);
    this.syncIntervalId = setInterval(async () => {
      if (navigator.onLine && !this.isSyncing) {
        const pendingCount = await this.countMyPending();
        if (pendingCount > 0 && auth.getToken()) {
          console.log(`[Sync] Periodic auto-sync triggered for ${pendingCount} pending records.`);
          await this.syncPendingRecords();
        }
      }
    }, 60000);
  }

  /**
   * Save a newly registered activity report:
   * 1. Saves locally in IndexedDB `reports`
   * 2. Adds to `pendingQueue`
   * 3. Triggers immediate sync if online
   */
  async submitReportLocally(reportData) {
    const reportId = reportData.reportId || ('REP-' + Date.now() + '-' + Math.floor(Math.random() * 1000));
    const uniqueUuid = reportData.uniqueUuid || this.generateUUID();
    const createdTimestamp = new Date().toISOString();

    const fullRecord = {
      ...reportData,
      reportId: reportId,
      uniqueUuid: uniqueUuid,
      deviceId: this.getDeviceId(),
      deviceName: this.deviceInfo.deviceName,
      browserOs: this.deviceInfo.browserOs,
      syncStatus: 'PENDING',
      createdTimestamp: createdTimestamp
    };

    // 1. Put in IndexedDB reports store
    await db.put('reports', fullRecord);

    // 2. Put in pendingQueue store
    await db.put('pendingQueue', fullRecord);

    console.log('[Sync] Report queued locally in IndexedDB:', reportId);
    await this.updateSyncStatus();

    // 3. Trigger immediate background sync if online
    if (navigator.onLine) {
      this.syncPendingRecords().catch((err) => {
        console.warn('[Sync] Immediate sync failed, queued for retry:', err.message);
      });
    }

    return fullRecord;
  }

  /**
   * Upload the current user's pending reports.
   * Reports created by another account on this device stay queued until that person signs in.
   */
  async syncPendingRecords() {
    if (this.isSyncing) return { success: false, message: 'Sync already in progress.' };

    if (!(await this.getApiUrl())) {
      this.setStatus('OFFLINE');
      return { success: false, message: 'Server URL is not set in Settings.' };
    }
    if (!navigator.onLine) {
      this.setStatus('OFFLINE');
      return { success: false, message: 'Device is offline.' };
    }
    if (!auth.getToken()) {
      return { success: false, message: 'Please sign in online to sync.' };
    }

    const me = auth.getUserId();
    const allPending = await db.getAll('pendingQueue');
    const pending = auth.isAdmin() ? allPending : allPending.filter((r) => r.userId === me);

    if (!pending.length) {
      await this.updateSyncStatus();
      return {
        success: true,
        count: 0,
        message: allPending.length
          ? `${allPending.length} report(s) on this device belong to another user and will sync when they sign in.`
          : 'All reports are already synchronized.'
      };
    }

    this.isSyncing = true;
    this.setStatus('SYNCING');

    try {
      let totalSynced = 0;
      let totalRejected = 0;

      // Upload in chunks of 100 to stay within Apps Script limits
      for (let i = 0; i < pending.length; i += 100) {
        const chunk = pending.slice(i, i + 100);
        const result = await this.apiCall('SYNC_REPORTS_BATCH', {
          batchId: 'BATCH-' + Date.now() + '-' + i,
          records: chunk,
          device: this.deviceInfo
        });

        const serverTimestamp = result.serverTimestamp || new Date().toISOString();

        for (const reportId of result.syncedIds || []) {
          const localRecord = await db.get('reports', reportId);
          if (localRecord) {
            localRecord.syncStatus = 'SENT';
            localRecord.serverTimestamp = serverTimestamp;
            delete localRecord.syncError;
            await db.put('reports', localRecord);
          }
          await db.delete('pendingQueue', reportId);
          totalSynced++;
        }

        // Permanently rejected (e.g. block not assigned) -> keep locally, stop retrying
        for (const rej of result.rejected || []) {
          const localRecord = await db.get('reports', rej.reportId);
          if (localRecord) {
            localRecord.syncStatus = 'REJECTED';
            localRecord.syncError = rej.error;
            await db.put('reports', localRecord);
          }
          await db.delete('pendingQueue', rej.reportId);
          totalRejected++;
        }
      }

      this.lastSyncTime = new Date();
      await db.setSetting('lastSyncTime', this.lastSyncTime.toISOString());
      await this.updateSyncStatus();

      let message = `Synchronized ${totalSynced} report(s) to Google Sheets.`;
      if (totalRejected) message += ` ${totalRejected} rejected by the server (see Sync Center).`;
      return { success: true, count: totalSynced, rejected: totalRejected, message };
    } catch (err) {
      console.error('[Sync] Sync failed:', err);
      this.setStatus('SYNC ERROR');
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Download master data from Google Sheets. The server only returns what the
   * signed-in user is allowed to see (their Farm & Blocks), so each store is replaced.
   */
  async pullMasterData() {
    const result = await this.apiCall('GET_BOOTSTRAP_DATA');

    await db.replaceAll('farmsAndBlocks', result.farmsAndBlocks || []);
    await db.replaceAll('landowners', result.landowners || []);
    await db.replaceAll('parcels', result.parcels || []);
    await db.replaceAll('dropdownOptions', result.dropdowns || []);
    await db.replaceAll('kpis', result.kpis || []);
    await db.replaceAll('userDirectory', result.users || []);
    if (Array.isArray(result.maps)) {
      await db.replaceAll('maps', result.maps.map((m) => ({ ...m, downloadedAt: new Date().toISOString() })));
    }
    if (Array.isArray(result.devices)) {
      await db.replaceAll('devices', result.devices.map((d) => ({ ...d, deviceId: d['Device ID'] || d.deviceId })).filter((d) => d.deviceId));
    }

    const settings = result.settings || {};
    for (const key of ['workingDaysPerWeek', 'restDays', 'dailyWorkingHours', 'holidays', 'activeMapVersion']) {
      if (settings[key] !== undefined && settings[key] !== '') await db.setSetting(key, settings[key]);
    }

    if (result.me) await auth.updateProfile(result.me);
    await auth.refreshScope();
    await db.setSetting('lastMasterPull', new Date().toISOString());

    return { success: true, message: 'Farm data updated from the server.' };
  }

  /**
   * Download reports from the server for the user's Farm & Blocks (so supervisors
   * see their team's work, not only what was typed on this phone).
   * Local reports that are still pending are never overwritten.
   */
  async pullReports(filters = {}) {
    const result = await this.apiCall('GET_REPORTS', { filters });
    const records = result.records || [];
    const pendingIds = new Set((await db.getAll('pendingQueue')).map((p) => p.reportId));

    const toSave = records
      .filter((r) => r.reportId && !pendingIds.has(r.reportId))
      .map((r) => ({ ...r, syncStatus: 'SENT', fromServer: true }));

    // uniqueUuid has a unique index: drop local copies whose UUID matches but ID differs
    const local = await db.getAll('reports');
    const byUuid = new Map(local.map((r) => [r.uniqueUuid, r.reportId]));
    for (const r of toSave) {
      const localId = byUuid.get(r.uniqueUuid);
      if (localId && localId !== r.reportId) await db.delete('reports', localId);
    }

    await db.putBatch('reports', toSave);
    await db.setSetting('lastReportsPull', new Date().toISOString());
    return { success: true, count: toSave.length, message: `Downloaded ${toSave.length} report(s) for your Farm & Blocks.` };
  }

  /** Pull master data + reports in the background (used after sign-in / when back online). */
  async refreshFromServer() {
    if (!navigator.onLine || !auth.getToken()) return { success: false };
    try {
      await this.pullMasterData();
      await this.pullReports();
      return { success: true };
    } catch (err) {
      console.warn('[Sync] Background refresh failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async updateSyncStatus() {
    if (!navigator.onLine) {
      this.setStatus('OFFLINE');
      return;
    }

    const pendingCount = await this.countMyPending();
    if (pendingCount > 0) {
      this.setStatus('PENDING SYNC');
    } else {
      this.setStatus('ONLINE');
    }
  }

  async countMyPending() {
    const all = await db.getAll('pendingQueue');
    if (auth.isAdmin()) return all.length;
    const me = auth.getUserId();
    return all.filter((r) => r.userId === me).length;
  }

  setStatus(newStatus) {
    this.status = newStatus;
    this.notifyListeners(newStatus);
  }

  getStatus() {
    return this.status;
  }

  onStatusChange(callback) {
    this.listeners.push(callback);
  }

  notifyListeners(status) {
    for (const cb of this.listeners) {
      try {
        cb(status);
      } catch (e) {
        console.error('[Sync] Listener error:', e);
      }
    }
  }
}

// Global Singleton Instance
const syncService = new SyncService();
