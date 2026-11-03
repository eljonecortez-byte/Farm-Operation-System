/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Device Identification, Telemetry & Background Synchronization Service
 */

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
        const pendingCount = await db.count('pendingQueue');
        if (pendingCount > 0) {
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
   * Execute Synchronization of all pending reports
   */
  async syncPendingRecords() {
    if (this.isSyncing) return { success: false, message: 'Sync already in progress.' };

    const apiUrl = await db.getSetting('apiUrl', '');
    if (!apiUrl) {
      console.warn('[Sync] Google Apps Script API URL not configured.');
      this.setStatus('OFFLINE');
      return { success: false, message: 'Google Apps Script URL not configured in Settings.' };
    }

    if (!navigator.onLine) {
      this.setStatus('OFFLINE');
      return { success: false, message: 'Device is offline.' };
    }

    const pending = await db.getAll('pendingQueue');
    if (!pending || pending.length === 0) {
      this.setStatus('SYNCED');
      return { success: true, count: 0, message: 'All reports are already synchronized.' };
    }

    this.isSyncing = true;
    this.setStatus('SYNCING');

    const currentUser = auth.getCurrentUser() || {};
    const batchId = 'BATCH-' + Date.now();

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'SYNC_REPORTS_BATCH',
          batchId: batchId,
          records: pending,
          user: {
            userId: currentUser.userId || '',
            fullName: currentUser.fullName || currentUser.username || '',
            role: currentUser.role || 'Field Personnel'
          },
          device: this.deviceInfo
        })
      });

      const result = await response.json();

      if (result && result.success) {
        const syncedIds = result.syncedIds || [];
        const serverTimestamp = result.serverTimestamp || new Date().toISOString();

        // Update local reports to SENT and remove from pendingQueue
        for (const reportId of syncedIds) {
          const localRecord = await db.get('reports', reportId);
          if (localRecord) {
            localRecord.syncStatus = 'SENT';
            localRecord.serverTimestamp = serverTimestamp;
            await db.put('reports', localRecord);
          }
          await db.delete('pendingQueue', reportId);
        }

        this.lastSyncTime = new Date();
        await db.setSetting('lastSyncTime', this.lastSyncTime.toISOString());

        // Check if any remain
        const remainingCount = await db.count('pendingQueue');
        if (remainingCount === 0) {
          this.setStatus('SYNCED');
        } else {
          this.setStatus('PENDING SYNC');
        }

        console.log(`[Sync] Successfully synchronized ${syncedIds.length} reports to Google Sheets.`);
        return {
          success: true,
          count: syncedIds.length,
          message: `Synchronized ${syncedIds.length} reports to Google Sheets central database.`
        };
      } else {
        throw new Error(result.error || 'Server rejected batch synchronization.');
      }
    } catch (err) {
      console.error('[Sync] Sync failed:', err);
      this.setStatus('SYNC ERROR');
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Pull latest dropdowns, landowners, parcels, blocks, and KPIs from Google Sheets
   */
  async pullMasterData() {
    const apiUrl = await db.getSetting('apiUrl', '');
    if (!apiUrl || !navigator.onLine) {
      throw new Error('Online connection to Google Apps Script is required to pull master data.');
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'GET_BOOTSTRAP_DATA',
        user: auth.getCurrentUser() || {}
      })
    });

    const result = await response.json();

    if (result && result.success) {
      if (result.landowners && result.landowners.length) {
        const mappedLandowners = result.landowners.map((l) => ({
          landOwnerId: l['Land Owner ID'] || l.landOwnerId,
          landOwnerName: l['Land Owner Name'] || l.landOwnerName,
          contactPerson: l['Contact Person'] || l.contactPerson,
          phone: l['Phone'] || l.phone,
          totalHectares: parseFloat(l['Total Hectares']) || 0,
          status: l['Status'] || 'Active'
        }));
        await db.putBatch('landowners', mappedLandowners);
      }

      if (result.parcels && result.parcels.length) {
        const mappedParcels = result.parcels.map((p) => ({
          parcelId: p['Parcel ID'] || p.parcelId,
          parcelNumber: p['Parcel Number'] || p.parcelNumber,
          landOwnerId: p['Land Owner ID'] || p.landOwnerId,
          landOwnerName: p['Land Owner Name'] || p.landOwnerName,
          totalAreaHa: parseFloat(p['Total Area Ha']) || 0,
          totalPalms: parseInt(p['Total Palms']) || 0,
          status: p['Status'] || 'Active'
        }));
        await db.putBatch('parcels', mappedParcels);
      }

      if (result.farmsAndBlocks && result.farmsAndBlocks.length) {
        const mappedBlocks = result.farmsAndBlocks.map((b) => ({
          blockId: b['Block ID'] || b.blockId,
          farmBlockName: b['Farm and Block Name'] || b.farmBlockName,
          parcelId: b['Parcel ID'] || b.parcelId,
          parcelNumber: b['Parcel Number'] || b.parcelNumber,
          landOwnerName: b['Land Owner Name'] || b.landOwnerName,
          areaHa: parseFloat(b['Area Ha']) || 0,
          palmCount: parseInt(b['Palm Count']) || 0,
          status: b['Status'] || 'Active'
        }));
        await db.putBatch('farmsAndBlocks', mappedBlocks);
      }

      if (result.dropdowns && result.dropdowns.length) {
        const mappedDrops = result.dropdowns.map((d) => ({
          optionId: d['Option ID'] || d.optionId,
          activityType: d['Activity Type'] || d.activityType,
          dropdownCategory: d['Dropdown Category'] || d.dropdownCategory,
          optionValue: d['Option Value'] || d.optionValue,
          parentValue: d['Parent Value'] || d.parentValue || '',
          sortOrder: parseInt(d['Sort Order']) || 1,
          status: d['Status'] || 'Active'
        }));
        await db.putBatch('dropdownOptions', mappedDrops);
      }

      if (result.kpis && result.kpis.length) {
        const mappedKpis = result.kpis.map((k) => ({
          kpiId: k['KPI ID'] || k.kpiId,
          activityType: k['Activity Type'] || k.activityType,
          farmBlock: k['Farm & Block'] || k.farmBlock,
          landOwner: k['Land Owner'] || k.landOwner,
          parcelNumber: k['Parcel Number'] || k.parcelNumber,
          cycle: k['Cycle'] || k.cycle,
          targetQuantity: parseFloat(k['Target Quantity']) || 0,
          targetUnit: k['Target Unit'] || k.targetUnit,
          requiredManpower: parseInt(k['Required Manpower']) || 1,
          targetWorkingDays: parseInt(k['Target Working Days']) || 1,
          dailyExpectedAccomplishment: parseFloat(k['Daily Expected Accomplishment']) || 0,
          effectiveDate: k['Effective Date'] || k.effectiveDate,
          status: k['Status'] || 'Active'
        }));
        await db.putBatch('kpis', mappedKpis);
      }

      return { success: true, message: 'Master dropdowns and farm data updated successfully from server.' };
    } else {
      throw new Error(result.error || 'Failed to pull master data.');
    }
  }

  async updateSyncStatus() {
    if (!navigator.onLine) {
      this.setStatus('OFFLINE');
      return;
    }

    const pendingCount = await db.count('pendingQueue');
    if (pendingCount > 0) {
      this.setStatus('PENDING SYNC');
    } else {
      this.setStatus('ONLINE');
    }
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
