/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * IndexedDB Database Service (Offline Storage Engine)
 * Database Name: FarmOpsDB
 */

class FarmOpsDB {
  constructor() {
    this.dbName = 'FarmOpsDB';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

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
   * Seeds default local data for instant offline testing and first run
   */
  async ensureSeedData() {
    const seeded = await this.getSetting('db_seeded_v1', false);
    if (seeded) return;

    console.log('[IndexedDB] Seeding default offline database items...');

    // SHA-256 hash for 'admin123'
    const defaultHash = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

    // 1. Default Users
    await this.putBatch('users', [
      {
        userId: 'USR-0001',
        employeeId: 'EMP-001',
        fullName: 'Admin Director',
        username: 'admin',
        passwordHash: defaultHash,
        role: 'Administrator',
        assignedSupervisor: 'None',
        assignedLandOwners: ['ALL'],
        assignedFarmAndBlocks: ['ALL'],
        assignedActivities: ['ALL'],
        accountStatus: 'Active',
        dateCreated: new Date().toISOString()
      },
      {
        userId: 'USR-0002',
        employeeId: 'EMP-002',
        fullName: 'Carlos Mendoza (Supervisor)',
        username: 'supervisor1',
        passwordHash: defaultHash,
        role: 'Supervisor',
        assignedSupervisor: 'None',
        assignedLandOwners: ['Hacienda San Isidro', 'Palm Valley Estate'],
        assignedFarmAndBlocks: ['Block A1 - North Grove', 'Block A2 - South Grove', 'Block B1 - East Ridge', 'Block C1 - Valley Floor'],
        assignedActivities: [
          'Regular Activity',
          'Irregular Activity',
          'Other Farm Activity',
          'Palm Category Activity',
          'Seednut Collection',
          'Pest and Disease Activity'
        ],
        accountStatus: 'Active',
        dateCreated: new Date().toISOString()
      },
      {
        userId: 'USR-0003',
        employeeId: 'EMP-003',
        fullName: 'Juan Dela Cruz (Field Lead)',
        username: 'field1',
        passwordHash: defaultHash,
        role: 'Field Personnel',
        assignedSupervisor: 'Carlos Mendoza (Supervisor)',
        assignedLandOwners: ['Hacienda San Isidro'],
        assignedFarmAndBlocks: ['Block A1 - North Grove', 'Block A2 - South Grove'],
        assignedActivities: ['Regular Activity', 'Palm Category Activity', 'Seednut Collection'],
        accountStatus: 'Active',
        dateCreated: new Date().toISOString()
      }
    ]);

    // 2. Default Landowners
    await this.putBatch('landowners', [
      { landOwnerId: 'LND-001', landOwnerName: 'Hacienda San Isidro', contactPerson: 'Don Roberto Alcantara', phone: '+63 917 123 4567', totalHectares: 45.5, status: 'Active' },
      { landOwnerId: 'LND-002', landOwnerName: 'Palm Valley Estate', contactPerson: 'Maria Santos', phone: '+63 918 234 5678', totalHectares: 32.0, status: 'Active' },
      { landOwnerId: 'LND-003', landOwnerName: 'Green Grove Plantation', contactPerson: 'Engr. Antonio Reyes', phone: '+63 920 345 6789', totalHectares: 60.8, status: 'Active' }
    ]);

    // 3. Default Parcels
    await this.putBatch('parcels', [
      { parcelId: 'PRC-001', parcelNumber: 'Parcel 101', landOwnerId: 'LND-001', landOwnerName: 'Hacienda San Isidro', totalAreaHa: 15.5, totalPalms: 2200, status: 'Active' },
      { parcelId: 'PRC-002', parcelNumber: 'Parcel 102', landOwnerId: 'LND-001', landOwnerName: 'Hacienda San Isidro', totalAreaHa: 18.0, totalPalms: 2600, status: 'Active' },
      { parcelId: 'PRC-003', parcelNumber: 'Parcel 201', landOwnerId: 'LND-002', landOwnerName: 'Palm Valley Estate', totalAreaHa: 16.0, totalPalms: 2300, status: 'Active' },
      { parcelId: 'PRC-004', parcelNumber: 'Parcel 202', landOwnerId: 'LND-002', landOwnerName: 'Palm Valley Estate', totalAreaHa: 16.0, totalPalms: 2400, status: 'Active' },
      { parcelId: 'PRC-005', parcelNumber: 'Parcel 301', landOwnerId: 'LND-003', landOwnerName: 'Green Grove Plantation', totalAreaHa: 30.4, totalPalms: 4500, status: 'Active' }
    ]);

    // 4. Default Farms & Blocks
    await this.putBatch('farmsAndBlocks', [
      { blockId: 'BLK-001', farmBlockName: 'Block A1 - North Grove', parcelId: 'PRC-001', parcelNumber: 'Parcel 101', landOwnerName: 'Hacienda San Isidro', areaHa: 7.5, palmCount: 1100, status: 'Active' },
      { blockId: 'BLK-002', farmBlockName: 'Block A2 - South Grove', parcelId: 'PRC-001', parcelNumber: 'Parcel 101', landOwnerName: 'Hacienda San Isidro', areaHa: 8.0, palmCount: 1100, status: 'Active' },
      { blockId: 'BLK-003', farmBlockName: 'Block B1 - East Ridge', parcelId: 'PRC-002', parcelNumber: 'Parcel 102', landOwnerName: 'Hacienda San Isidro', areaHa: 9.0, palmCount: 1300, status: 'Active' },
      { blockId: 'BLK-004', farmBlockName: 'Block B2 - West Ridge', parcelId: 'PRC-002', parcelNumber: 'Parcel 102', landOwnerName: 'Hacienda San Isidro', areaHa: 9.0, palmCount: 1300, status: 'Active' },
      { blockId: 'BLK-005', farmBlockName: 'Block C1 - Valley Floor', parcelId: 'PRC-003', parcelNumber: 'Parcel 201', landOwnerName: 'Palm Valley Estate', areaHa: 8.0, palmCount: 1150, status: 'Active' },
      { blockId: 'BLK-006', farmBlockName: 'Block C2 - Hilltop', parcelId: 'PRC-004', parcelNumber: 'Parcel 202', landOwnerName: 'Palm Valley Estate', areaHa: 8.0, palmCount: 1200, status: 'Active' }
    ]);

    // 5. Default Dropdown Options
    await this.putBatch('dropdownOptions', [
      // Cycles
      { optionId: 'OPT-001', activityType: 'Regular Activity', dropdownCategory: 'Cycle', optionValue: 'Cycle 1 (Q1)', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-002', activityType: 'Regular Activity', dropdownCategory: 'Cycle', optionValue: 'Cycle 2 (Q2)', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-003', activityType: 'Regular Activity', dropdownCategory: 'Cycle', optionValue: 'Cycle 3 (Q3)', parentValue: '', sortOrder: 3, status: 'Active' },
      { optionId: 'OPT-004', activityType: 'Regular Activity', dropdownCategory: 'Cycle', optionValue: 'Cycle 4 (Q4)', parentValue: '', sortOrder: 4, status: 'Active' },

      // Irregular Activity Options
      { optionId: 'OPT-005', activityType: 'Irregular Activity', dropdownCategory: 'Pest and Disease Treatment (Soil Drench)', optionValue: 'Imidacloprid Premix 200SL', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-006', activityType: 'Irregular Activity', dropdownCategory: 'Pest and Disease Treatment (Soil Drench)', optionValue: 'Chlorpyrifos 40EC', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-007', activityType: 'Irregular Activity', dropdownCategory: 'Pest and Disease Treatment (Soil Drench)', optionValue: 'Trichoderma Bio-Inoculant', parentValue: '', sortOrder: 3, status: 'Active' },
      { optionId: 'OPT-008', activityType: 'Irregular Activity', dropdownCategory: 'Pest and Disease Treatment (Soil Drench)', optionValue: 'Bacillus Thuringiensis Drench', parentValue: '', sortOrder: 4, status: 'Active' },
      { optionId: 'OPT-009', activityType: 'Irregular Activity', dropdownCategory: 'Irregular Activity', optionValue: 'Rhinoceros Beetle Pheromone Trapping', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-010', activityType: 'Irregular Activity', dropdownCategory: 'Irregular Activity', optionValue: 'Crown Cleaning & Sanitation', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-011', activityType: 'Irregular Activity', dropdownCategory: 'Irregular Activity', optionValue: 'Drainage Clearing & Rehabilitation', parentValue: '', sortOrder: 3, status: 'Active' },
      { optionId: 'OPT-012', activityType: 'Irregular Activity', dropdownCategory: 'Irregular Activity', optionValue: 'Lightning Strike Removal & Burial', parentValue: '', sortOrder: 4, status: 'Active' },

      // Other Farm Activity Options
      { optionId: 'OPT-013', activityType: 'Other Farm Activity', dropdownCategory: 'Other Activities', optionValue: 'Cover Crop Planting (Calopogonium)', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-014', activityType: 'Other Farm Activity', dropdownCategory: 'Other Activities', optionValue: 'Farm Road Maintenance & Grading', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-015', activityType: 'Other Farm Activity', dropdownCategory: 'Other Activities', optionValue: 'Fence Repair & Boundary Marking', parentValue: '', sortOrder: 3, status: 'Active' },
      { optionId: 'OPT-016', activityType: 'Other Farm Activity', dropdownCategory: 'Other Activities', optionValue: 'Seedling Nursery Bagging & Watering', parentValue: '', sortOrder: 4, status: 'Active' },
      { optionId: 'OPT-017', activityType: 'Other Farm Activity', dropdownCategory: 'Other Activities', optionValue: 'Coconut Husk Mulching along Basins', parentValue: '', sortOrder: 5, status: 'Active' },
      { optionId: 'OPT-018', activityType: 'Other Farm Activity', dropdownCategory: 'Unit', optionValue: 'Hectares', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-019', activityType: 'Other Farm Activity', dropdownCategory: 'Unit', optionValue: 'Palms', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-020', activityType: 'Other Farm Activity', dropdownCategory: 'Unit', optionValue: 'Meters', parentValue: '', sortOrder: 3, status: 'Active' },
      { optionId: 'OPT-021', activityType: 'Other Farm Activity', dropdownCategory: 'Unit', optionValue: 'Sacks', parentValue: '', sortOrder: 4, status: 'Active' },

      // Pest and Disease Activity Options
      { optionId: 'OPT-022', activityType: 'Pest and Disease Activity', dropdownCategory: 'Target Pest', optionValue: 'Oryctes rhinoceros (Rhinoceros Beetle)', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-023', activityType: 'Pest and Disease Activity', dropdownCategory: 'Target Pest', optionValue: 'Rhynchophorus ferrugineus (Red Palm Weevil)', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-024', activityType: 'Pest and Disease Activity', dropdownCategory: 'Target Pest', optionValue: 'Brontispa longissima (Coconut Leaf Beetle)', parentValue: '', sortOrder: 3, status: 'Active' },
      { optionId: 'OPT-025', activityType: 'Pest and Disease Activity', dropdownCategory: 'Target Pest', optionValue: 'Phytophthora palmivora (Bud Rot)', parentValue: '', sortOrder: 4, status: 'Active' },
      { optionId: 'OPT-026', activityType: 'Pest and Disease Activity', dropdownCategory: 'Input Used', optionValue: 'Bio-Metarhizium anisopliae Green Fungus', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-027', activityType: 'Pest and Disease Activity', dropdownCategory: 'Input Used', optionValue: 'Cypermethrin 5EC', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-028', activityType: 'Pest and Disease Activity', dropdownCategory: 'Input Used', optionValue: 'Copper Oxychloride 50WP', parentValue: '', sortOrder: 3, status: 'Active' },
      { optionId: 'OPT-029', activityType: 'Pest and Disease Activity', dropdownCategory: 'Unit', optionValue: 'Liters', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-030', activityType: 'Pest and Disease Activity', dropdownCategory: 'Unit', optionValue: 'Grams', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-031', activityType: 'Pest and Disease Activity', dropdownCategory: 'Unit', optionValue: 'Kilograms', parentValue: '', sortOrder: 3, status: 'Active' },
      { optionId: 'OPT-032', activityType: 'Pest and Disease Activity', dropdownCategory: 'Method Used', optionValue: 'Soil Drenching Basal Application', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-033', activityType: 'Pest and Disease Activity', dropdownCategory: 'Method Used', optionValue: 'Crown Spraying with Mist Blower', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-034', activityType: 'Pest and Disease Activity', dropdownCategory: 'Method Used', optionValue: 'Stem Injection (Trunk Infusion)', parentValue: '', sortOrder: 3, status: 'Active' },
      { optionId: 'OPT-035', activityType: 'Pest and Disease Activity', dropdownCategory: 'Target Parts for Application', optionValue: 'Basal Root Zone (Basin)', parentValue: '', sortOrder: 1, status: 'Active' },
      { optionId: 'OPT-036', activityType: 'Pest and Disease Activity', dropdownCategory: 'Target Parts for Application', optionValue: 'Spear Leaf and Crown Apex', parentValue: '', sortOrder: 2, status: 'Active' },
      { optionId: 'OPT-037', activityType: 'Pest and Disease Activity', dropdownCategory: 'Target Parts for Application', optionValue: 'Trunk Lower Cavities', parentValue: '', sortOrder: 3, status: 'Active' }
    ]);

    // 6. Default KPIs
    await this.putBatch('kpis', [
      { kpiId: 'KPI-001', activityType: 'Weeding / Slashing Cleared', farmBlock: 'Block A1 - North Grove', landOwner: 'Hacienda San Isidro', parcelNumber: 'Parcel 101', cycle: 'Cycle 1 (Q1)', targetQuantity: 2.0, targetUnit: 'Hectares', requiredManpower: 4, targetWorkingDays: 1, dailyExpectedAccomplishment: 2.0, effectiveDate: '2026-01-01', status: 'Active' },
      { kpiId: 'KPI-002', activityType: 'Round Weeding Count', farmBlock: 'Block A1 - North Grove', landOwner: 'Hacienda San Isidro', parcelNumber: 'Parcel 101', cycle: 'Cycle 1 (Q1)', targetQuantity: 100, targetUnit: 'Palms', requiredManpower: 4, targetWorkingDays: 1, dailyExpectedAccomplishment: 100, effectiveDate: '2026-01-01', status: 'Active' },
      { kpiId: 'KPI-003', activityType: 'Compost Application', farmBlock: 'Block A1 - North Grove', landOwner: 'Hacienda San Isidro', parcelNumber: 'Parcel 101', cycle: 'Cycle 1 (Q1)', targetQuantity: 80, targetUnit: 'Palms', requiredManpower: 4, targetWorkingDays: 1, dailyExpectedAccomplishment: 80, effectiveDate: '2026-01-01', status: 'Active' },
      { kpiId: 'KPI-004', activityType: 'Pruning Palms', farmBlock: 'Block A1 - North Grove', landOwner: 'Hacienda San Isidro', parcelNumber: 'Parcel 101', cycle: 'Cycle 1 (Q1)', targetQuantity: 60, targetUnit: 'Palms', requiredManpower: 3, targetWorkingDays: 1, dailyExpectedAccomplishment: 60, effectiveDate: '2026-01-01', status: 'Active' },
      { kpiId: 'KPI-005', activityType: 'Soil Drenching Premix', farmBlock: 'Block A1 - North Grove', landOwner: 'Hacienda San Isidro', parcelNumber: 'Parcel 101', cycle: 'Cycle 1 (Q1)', targetQuantity: 100, targetUnit: 'Palms', requiredManpower: 4, targetWorkingDays: 1, dailyExpectedAccomplishment: 100, effectiveDate: '2026-01-01', status: 'Active' },
      { kpiId: 'KPI-006', activityType: 'Seednut Collection', farmBlock: 'Block A2 - South Grove', landOwner: 'Hacienda San Isidro', parcelNumber: 'Parcel 101', cycle: 'Cycle 1 (Q1)', targetQuantity: 500, targetUnit: 'Nuts', requiredManpower: 2, targetWorkingDays: 1, dailyExpectedAccomplishment: 500, effectiveDate: '2026-01-01', status: 'Active' }
    ]);

    // 7. Default Offline Farm Map Package
    const sampleGeoJSON = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            landowner: "Hacienda San Isidro",
            parcel: "Parcel 101",
            block: "Block A1 - North Grove",
            palms: 1100,
            areaHa: 7.5,
            variety: "Hybrid Dwarf & Laguna Tall"
          },
          geometry: {
            type: "Polygon",
            coordinates: [[[121.0500, 14.1500], [121.0540, 14.1500], [121.0540, 14.1540], [121.0500, 14.1540], [121.0500, 14.1500]]]
          }
        },
        {
          type: "Feature",
          properties: {
            landowner: "Hacienda San Isidro",
            parcel: "Parcel 101",
            block: "Block A2 - South Grove",
            palms: 1100,
            areaHa: 8.0,
            variety: "Laguna Tall"
          },
          geometry: {
            type: "Polygon",
            coordinates: [[[121.0500, 14.1460], [121.0540, 14.1460], [121.0540, 14.1500], [121.0500, 14.1500], [121.0500, 14.1460]]]
          }
        },
        {
          type: "Feature",
          properties: {
            landowner: "Hacienda San Isidro",
            parcel: "Parcel 102",
            block: "Block B1 - East Ridge",
            palms: 1300,
            areaHa: 9.0,
            variety: "Tagnanan Tall"
          },
          geometry: {
            type: "Polygon",
            coordinates: [[[121.0550, 14.1500], [121.0600, 14.1500], [121.0600, 14.1550], [121.0550, 14.1550], [121.0550, 14.1500]]]
          }
        }
      ]
    };

    await this.put('maps', {
      mapId: 'MAP-001',
      title: 'Hacienda San Isidro Master Parcel Map',
      version: 'v1.0.0',
      landOwner: 'Hacienda San Isidro',
      parcelNumber: 'Parcel 101, Parcel 102',
      farmBlock: 'Block A1, Block A2, Block B1',
      fileType: 'GeoJSON',
      geoJson: sampleGeoJSON,
      downloadedAt: new Date().toISOString(),
      status: 'Installed'
    });

    // 8. Sample Recent Activity Reports
    const sampleToday = new Date().toISOString().split('T')[0];
    await this.putBatch('reports', [
      {
        reportId: 'REP-REG-001',
        uniqueUuid: 'UUID-REG-001',
        activityType: 'Regular Activity',
        userId: 'USR-0003',
        employeeName: 'Juan Dela Cruz (Field Lead)',
        date: sampleToday,
        landOwnersName: 'Hacienda San Isidro',
        parcelNumber: 'Parcel 101',
        farmBlock: 'Block A1 - North Grove',
        manpower: 4,
        cycle: 'Cycle 1 (Q1)',
        weedingSlashingHa: 1.8,
        roundWeedingPalms: 95,
        compostPalms: 75,
        quantitySacks: 38,
        quantityKilo: 1900,
        bofRequestNo: 'BOF-2026-091',
        pruningPalms: 55,
        soilDrenchingPalms: 90,
        quantityLiters: 180,
        foliarRequestCode: 'FOL-778',
        remarks: 'Normal field operations completed on schedule.',
        syncStatus: 'SENT',
        createdTimestamp: new Date().toISOString()
      },
      {
        reportId: 'REP-SEED-002',
        uniqueUuid: 'UUID-SEED-002',
        activityType: 'Seednut Collection',
        userId: 'USR-0003',
        employeeName: 'Juan Dela Cruz (Field Lead)',
        date: sampleToday,
        areaCode: 'SEC-A2-PLM',
        palmNumber: 42,
        nutCountCollected: 480,
        countOfNutsNextCollection: 520,
        countOfRejectedNuts: 18,
        gpsLatitude: 14.1482,
        gpsLongitude: 121.0521,
        gpsAccuracy: 4.2,
        remarks: 'Healthy high-yield harvest.',
        syncStatus: 'SENT',
        createdTimestamp: new Date().toISOString()
      }
    ]);

    // 9. Default System Settings
    await this.setSetting('workingDaysPerWeek', 6);
    await this.setSetting('restDays', 'Sunday');
    await this.setSetting('dailyWorkingHours', 8);
    await this.setSetting('holidays', '2026-01-01,2026-04-02,2026-04-03,2026-05-01,2026-06-12,2026-11-30,2026-12-25,2026-12-30');
    await this.setSetting('activeMapVersion', 'v1.0.0');
    await this.setSetting('db_seeded_v1', true);

    console.log('[IndexedDB] Offline database successfully initialized and seeded.');
  }
}

// Global Singleton Instance
const db = new FarmOpsDB();
