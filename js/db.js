/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * IndexedDB Database Service (Offline Storage Engine)
 * Database Name: FarmOpsDB
 */

class FarmOpsDB {
  constructor() {
    this.dbName = 'FarmOpsDB';
    this.dbVersion = 2;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const upgradeTx = event.target.transaction;
        const oldVersion = event.oldVersion;

        // 1. Users Store
        if (!db.objectStoreNames.contains('users')) {
          const userStore = db.createObjectStore('users', { keyPath: 'userId' });
          userStore.createIndex('username', 'username', { unique: true });
          userStore.createIndex('role', 'role', { unique: false });
        }

        // 2. Land Owners Store
        if (!db.objectStoreNames.contains('landowners')) {
          const landStore = db.createObjectStore('landowners', { keyPath: 'landOwnerId' });
          landStore.createIndex('landOwnerName', 'landOwnerName', { unique: false });
        }

        // 3. Parcels Store
        if (!db.objectStoreNames.contains('parcels')) {
          const parcelStore = db.createObjectStore('parcels', { keyPath: 'parcelId' });
          parcelStore.createIndex('landOwnerName', 'landOwnerName', { unique: false });
          parcelStore.createIndex('parcelNumber', 'parcelNumber', { unique: false });
        }

        // 4. Farms & Blocks Store
        if (!db.objectStoreNames.contains('farmsAndBlocks')) {
          const blockStore = db.createObjectStore('farmsAndBlocks', { keyPath: 'blockId' });
          blockStore.createIndex('parcelNumber', 'parcelNumber', { unique: false });
          blockStore.createIndex('landOwnerName', 'landOwnerName', { unique: false });
        }

        // 5. Dropdown Options Store
        if (!db.objectStoreNames.contains('dropdownOptions')) {
          const dropStore = db.createObjectStore('dropdownOptions', { keyPath: 'optionId' });
          dropStore.createIndex('activityType', 'activityType', { unique: false });
          dropStore.createIndex('dropdownCategory', 'dropdownCategory', { unique: false });
        }

        // 6. KPIs Store
        if (!db.objectStoreNames.contains('kpis')) {
          const kpiStore = db.createObjectStore('kpis', { keyPath: 'kpiId' });
          kpiStore.createIndex('activityType', 'activityType', { unique: false });
        }

        // 7. Reports Store (Consolidated across all 6 activities)
        if (!db.objectStoreNames.contains('reports')) {
          const repStore = db.createObjectStore('reports', { keyPath: 'reportId' });
          repStore.createIndex('activityType', 'activityType', { unique: false });
          repStore.createIndex('date', 'date', { unique: false });
          repStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          repStore.createIndex('userId', 'userId', { unique: false });
          repStore.createIndex('uniqueUuid', 'uniqueUuid', { unique: true });
        }

        // 8. Pending Synchronization Queue Store
        if (!db.objectStoreNames.contains('pendingQueue')) {
          const pendStore = db.createObjectStore('pendingQueue', { keyPath: 'reportId' });
          pendStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          pendStore.createIndex('createdTimestamp', 'createdTimestamp', { unique: false });
        }

        // 9. Maps Store (GeoJSON farm boundaries and offline packages)
        if (!db.objectStoreNames.contains('maps')) {
          const mapStore = db.createObjectStore('maps', { keyPath: 'mapId' });
          mapStore.createIndex('version', 'version', { unique: false });
        }

        // 10. Devices Store
        if (!db.objectStoreNames.contains('devices')) {
          db.createObjectStore('devices', { keyPath: 'deviceId' });
        }

        // 11. System Settings Store (API URL, active user, device ID, offline seed flags)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // 12. Audit Logs Store
        if (!db.objectStoreNames.contains('auditLogs')) {
          const auditStore = db.createObjectStore('auditLogs', { keyPath: 'logId' });
          auditStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 13. User Directory (users visible to the signed-in user; never holds password hashes)
        if (!db.objectStoreNames.contains('userDirectory')) {
          const dirStore = db.createObjectStore('userDirectory', { keyPath: 'userId' });
          dirStore.createIndex('role', 'role', { unique: false });
        }

        // v1 -> v2 migration: remove the demo accounts (password admin123) and demo farm data
        // that v1 seeded on every device. Real reports and the pending queue are kept.
        if (oldVersion >= 1 && oldVersion < 2) {
          ['users', 'landowners', 'parcels', 'farmsAndBlocks', 'kpis', 'maps', 'dropdownOptions'].forEach((name) => {
            if (db.objectStoreNames.contains(name)) upgradeTx.objectStore(name).clear();
          });
          const reportStore = upgradeTx.objectStore('reports');
          reportStore.delete('REP-REG-001');
          reportStore.delete('REP-SEED-002');
          const settingsStore = upgradeTx.objectStore('settings');
          settingsStore.delete('currentUser'); // forces a fresh online sign-in to get a secure session token
          settingsStore.delete('db_seeded_v1');
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        console.log('[IndexedDB] FarmOpsDB initialized successfully.');
        await this.ensureSeedData();
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[IndexedDB] Error opening FarmOpsDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async getTransaction(storeNames, mode = 'readonly') {
    const db = await this.init();
    return db.transaction(storeNames, mode);
  }

  async put(storeName, item) {
    const tx = await this.getTransaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.put(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async putBatch(storeName, items) {
    if (!items || !items.length) return;
    const tx = await this.getTransaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      items.forEach((item) => store.put(item));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async get(storeName, key) {
    const tx = await this.getTransaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(storeName) {
    const tx = await this.getTransaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, key) {
    const tx = await this.getTransaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName) {
    const tx = await this.getTransaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async count(storeName) {
    const tx = await this.getTransaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Settings Key-Value helpers
  async getSetting(key, defaultValue = null) {
    const record = await this.get('settings', key);
    return record ? record.value : defaultValue;
  }

  async setSetting(key, value) {
    return this.put('settings', { key, value, updatedAt: new Date().toISOString() });
  }

  /**
   * First-run defaults only. No demo users, land owners or reports are created on the device:
   * everything comes from the Google Sheets server after the first online sign-in.
   */
  async ensureSeedData() {
    const seeded = await this.getSetting('db_seeded_v2', false);
    if (seeded) return;

    if ((await this.getSetting('workingDaysPerWeek')) === null) await this.setSetting('workingDaysPerWeek', 6);
    if ((await this.getSetting('restDays')) === null) await this.setSetting('restDays', 'Sunday');
    if ((await this.getSetting('dailyWorkingHours')) === null) await this.setSetting('dailyWorkingHours', 8);
    if ((await this.getSetting('holidays')) === null) {
      await this.setSetting('holidays', '2026-01-01,2026-04-02,2026-04-03,2026-05-01,2026-06-12,2026-11-30,2026-12-25,2026-12-30');
    }
    await this.setSetting('db_seeded_v2', true);
  }

  /** Replace every item in a store (used when fresh master data arrives from the server). */
  async replaceAll(storeName, items) {
    const tx = await this.getTransaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      store.clear();
      (items || []).forEach((item) => store.put(item));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Global Singleton Instance
const db = new FarmOpsDB();
