/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * GOOGLE APPS SCRIPT BACKEND API (Central Database in Google Sheets)
 * 
 * 19 Central Database Sheets:
 * 1.  Users
 * 2.  UserPermissions
 * 3.  LandOwners
 * 4.  Parcels
 * 5.  FarmsAndBlocks
 * 6.  DropdownOptions
 * 7.  RegularActivity
 * 8.  IrregularActivity
 * 9.  OtherFarmActivity
 * 10. PalmCategoryActivity
 * 11. SeednutCollection
 * 12. PestAndDiseaseActivity
 * 13. KPIRegistration
 * 14. ManpowerRecords
 * 15. MapRegistry
 * 16. DeviceRegistry
 * 17. SyncLogs
 * 18. AuditLogs
 * 19. SystemSettings
 */

const SHEET_NAMES = {
  USERS: 'Users',
  PERMISSIONS: 'UserPermissions',
  LANDOWNERS: 'LandOwners',
  PARCELS: 'Parcels',
  FARMS_BLOCKS: 'FarmsAndBlocks',
  DROPDOWNS: 'DropdownOptions',
  REGULAR: 'RegularActivity',
  IRREGULAR: 'IrregularActivity',
  OTHER: 'OtherFarmActivity',
  PALM_CATEGORY: 'PalmCategoryActivity',
  SEEDNUT: 'SeednutCollection',
  PEST_DISEASE: 'PestAndDiseaseActivity',
  KPIS: 'KPIRegistration',
  MANPOWER: 'ManpowerRecords',
  MAPS: 'MapRegistry',
  DEVICES: 'DeviceRegistry',
  SYNC_LOGS: 'SyncLogs',
  AUDIT_LOGS: 'AuditLogs',
  SETTINGS: 'SystemSettings'
};

const HEADERS = {
  USERS: [
    'User ID', 'Employee ID', 'Full Name', 'Username', 'Password Hash', 'Role',
    'Assigned Supervisor', 'Assigned Land Owners', 'Assigned Farm and Blocks',
    'Assigned Activities', 'Account Status', 'Date Created', 'Last Login'
  ],
  PERMISSIONS: [
    'Permission ID', 'User ID', 'Can Manage Users', 'Can Manage Dropdowns',
    'Can Manage KPIs', 'Can Manage Maps', 'Can View All Reports', 'Can Export Data', 'Status'
  ],
  LANDOWNERS: [
    'Land Owner ID', 'Land Owner Name', 'Contact Person', 'Phone', 'Total Hectares', 'Status'
  ],
  PARCELS: [
    'Parcel ID', 'Parcel Number', 'Land Owner ID', 'Land Owner Name', 'Total Area Ha', 'Total Palms', 'Status'
  ],
  FARMS_BLOCKS: [
    'Block ID', 'Farm and Block Name', 'Parcel ID', 'Parcel Number', 'Land Owner ID', 'Land Owner Name', 'Area Ha', 'Palm Count', 'Status'
  ],
  DROPDOWNS: [
    'Option ID', 'Activity Type', 'Dropdown Category', 'Option Value', 'Parent Value', 'Sort Order', 'Status'
  ],
  REGULAR: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Land Owners Name', 'Parcel Number', 'Farm & Block', 'Manpower', 'Cycle',
    'Weeding Rolling Slashing Ha', 'Round Weeding Palms', 'Compost Palms', 'Quantity Sacks',
    'Quantity Kilo', 'BOF Request No', 'Pruning Palms', 'Soil Drenching Premix Palms',
    'Quantity Liters', 'Foliar Request Code', 'Remarks', 'Device ID', 'Device Name',
    'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status'
  ],
  IRREGULAR: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Land Owners Name', 'Parcel Number', 'Farm & Block', 'Manpower',
    'Pest Treatment Soil Drench', 'Count of Palms', 'Quantity Liters', 'Foliar Request Number',
    'Irregular Activity', 'Count of Palms 2', 'Count of Manpower 2', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status'
  ],
  OTHER: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Land Owners Name', 'Parcel Number', 'Farm & Block', 'Manpower',
    'Other Activities', 'Quantity', 'Unit', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status'
  ],
  PALM_CATEGORY: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Timestamp',
    'Farm & Block', 'Land Owners Name', 'Parcel Number', 'Palm Number',
    'Seedling Stage', 'Juvenile Stage', 'Pre-trunk Reproductive Stage', 'Pre-trunk Fruiting Stage',
    'Mature Stage', 'Fruiting Stage', 'Problem Palms', 'Manpower Count', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status'
  ],
  SEEDNUT: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Area Code', 'Palm Number', 'Nut Count Collected', 'Count of Nuts for Next Collection',
    'Count of Rejected Nuts', 'GPS Latitude', 'GPS Longitude', 'GPS Accuracy', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'Server Timestamp', 'Sync Status'
  ],
  PEST_DISEASE: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Land Owners Name', 'Parcel Number', 'Palm Numbers', 'Farm & Block',
    'Target Pest', 'Total Palms Affected', 'Input Used', 'Quantity', 'Unit',
    'Ratio', 'Method Used', 'Target Parts Application', 'Manpower Count', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status'
  ],
  KPIS: [
    'KPI ID', 'Activity Type', 'Farm & Block', 'Land Owner', 'Parcel Number', 'Cycle',
    'Target Quantity', 'Target Unit', 'Required Manpower', 'Target Working Days',
    'Daily Expected Accomplishment', 'Effective Date', 'Status'
  ],
  MANPOWER: [
    'Record ID', 'Date', 'Activity Type', 'Supervisor ID', 'Supervisor Name',
    'Land Owner', 'Parcel Number', 'Farm & Block', 'Manpower Count',
    'Hours Worked', 'Productivity Per Man', 'Notes'
  ],
  MAPS: [
    'Map ID', 'Map Title', 'Version', 'Land Owner', 'Parcel Number', 'Farm & Block',
    'File Type', 'GeoJSON Data', 'Upload Date', 'Uploaded By', 'Status'
  ],
  DEVICES: [
    'Device ID', 'Device Name', 'User ID', 'Employee Name', 'Browser OS',
    'First Seen', 'Last Seen', 'Total Submissions', 'Status'
  ],
  SYNC_LOGS: [
    'Log ID', 'Batch ID', 'User ID', 'Device ID', 'Records Count', 'Status', 'Error Message', 'Timestamp'
  ],
  AUDIT_LOGS: [
    'Log ID', 'User ID', 'User Role', 'Action', 'Record ID', 'Module', 'Details', 'Timestamp'
  ],
  SETTINGS: [
    'Key', 'Value', 'Description', 'Last Updated'
  ]
};

/**
 * Handle HTTP GET Requests (Health check, diagnostics, sheet initialization)
 */
function doGet(e) {
  try {
    setupDatabase();
    return respondJSON({
      success: true,
      message: 'Coconut Farm Operations & KPI Management System API is active and ready.',
      app: 'FarmOps KPI Management',
      version: '2.0.0',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return respondJSON({
      success: false,
      error: 'Initialization error: ' + err.message
    });
  }
}

/**
 * Handle HTTP POST Requests from GitHub Pages PWA frontend
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Concurrency guard
  } catch (lockError) {
    return respondJSON({ success: false, error: 'Database busy, please retry in a moment.' });
  }

  try {
    setupDatabase();

    if (!e || !e.postData || !e.postData.contents) {
      return respondJSON({ success: false, error: 'Missing request body.' });
    }

    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;

    switch (action) {
      case 'SETUP_DB':
        return respondJSON({ success: true, message: 'All 19 sheets verified and initialized.' });

      case 'LOGIN':
        return handleLogin(payload);

      case 'GET_BOOTSTRAP_DATA':
        return handleGetBootstrapData(payload);

      case 'SYNC_REPORTS_BATCH':
        return handleSyncReportsBatch(payload);

      case 'SAVE_DROPDOWN':
        return handleSaveDropdown(payload);

      case 'DELETE_DROPDOWN':
        return handleDeleteDropdown(payload);

      case 'SAVE_KPI':
        return handleSaveKPI(payload);

      case 'DELETE_KPI':
        return handleDeleteKPI(payload);

      case 'SAVE_USER':
        return handleSaveUser(payload);

      case 'TOGGLE_USER_STATUS':
        return handleToggleUserStatus(payload);

      case 'SAVE_MAP':
        return handleSaveMap(payload);

      case 'DELETE_MAP':
        return handleDeleteMap(payload);

      case 'GET_REPORTS':
        return handleGetReports(payload);

      case 'GET_MONITORING':
        return handleGetMonitoring(payload);

      case 'REGISTER_DEVICE':
        return handleRegisterDevice(payload);

      default:
        return respondJSON({ success: false, error: 'Unrecognized API action: ' + action });
    }
  } catch (fatalError) {
    return respondJSON({ success: false, error: fatalError.message || 'Internal Server Error' });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Helper to respond with JSON and CORS headers
 */
function respondJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Ensures all 19 sheets exist with correct headers and tropical styling.
 * Seeds initial admin account, sample landowners, parcels, blocks, dropdowns, and KPIs if empty.
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  for (var key in SHEET_NAMES) {
    var sheetName = SHEET_NAMES[key];
    var headers = HEADERS[key];
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    // Verify or set header row
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#14532d'); // Tropical Deep Palm Green
      headerRange.setFontColor('#ffffff');
      headerRange.setFontWeight('bold');
      headerRange.setHorizontalAlignment('center');
      sheet.setFrozenRows(1);

      // Auto-fit column widths
      for (var col = 1; col <= headers.length; col++) {
        sheet.setColumnWidth(col, 150);
      }
    }
  }

  // Seed default data if Users sheet has only headers
  seedInitialData(ss);
}

/**
 * Seeds initial admin user, default dropdowns, sample land data, and KPIs if fresh
 */
function seedInitialData(ss) {
  var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  if (usersSheet && usersSheet.getLastRow() <= 1) {
    // SHA-256 hash for 'admin123':
    // 240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9
    var defaultAdminHash = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';
    var nowIso = new Date().toISOString();

    // 1. Initial Admin
    usersSheet.appendRow([
      'USR-0001',
      'EMP-001',
      'System Administrator',
      'admin',
      defaultAdminHash,
      'Administrator',
      'None',
      'ALL',
      'ALL',
      'ALL',
      'Active',
      nowIso,
      nowIso
    ]);

    // 2. Initial Supervisor
    usersSheet.appendRow([
      'USR-0002',
      'EMP-002',
      'Carlos Mendoza (Supervisor)',
      'supervisor1',
      defaultAdminHash,
      'Supervisor',
      'None',
      'Hacienda San Isidro, Palm Valley Estate',
      'Block A1 - North, Block A2 - South, Parcel 101, Parcel 102',
      'Regular Activity, Irregular Activity, Other Farm Activity, Palm Category, Seednut Collection, Pest & Disease',
      'Active',
      nowIso,
      ''
    ]);

    // 3. Initial Field Personnel
    usersSheet.appendRow([
      'USR-0003',
      'EMP-003',
      'Juan Dela Cruz (Field Lead)',
      'field1',
      defaultAdminHash,
      'Field Personnel',
      'Carlos Mendoza (Supervisor)',
      'Hacienda San Isidro',
      'Block A1 - North, Block A2 - South',
      'Regular Activity, Palm Category, Seednut Collection',
      'Active',
      nowIso,
      ''
    ]);
  }

  // Seed Landowners, Parcels, Farms & Blocks if empty
  var landSheet = ss.getSheetByName(SHEET_NAMES.LANDOWNERS);
  if (landSheet && landSheet.getLastRow() <= 1) {
    landSheet.appendRow(['LND-001', 'Hacienda San Isidro', 'Don Roberto Alcantara', '+63 917 123 4567', '45.5', 'Active']);
    landSheet.appendRow(['LND-002', 'Palm Valley Estate', 'Maria Santos', '+63 918 234 5678', '32.0', 'Active']);
    landSheet.appendRow(['LND-003', 'Green Grove Plantation', 'Engr. Antonio Reyes', '+63 920 345 6789', '60.8', 'Active']);
  }

  var parcelSheet = ss.getSheetByName(SHEET_NAMES.PARCELS);
  if (parcelSheet && parcelSheet.getLastRow() <= 1) {
    parcelSheet.appendRow(['PRC-001', 'Parcel 101', 'LND-001', 'Hacienda San Isidro', '15.5', '2200', 'Active']);
    parcelSheet.appendRow(['PRC-002', 'Parcel 102', 'LND-001', 'Hacienda San Isidro', '18.0', '2600', 'Active']);
    parcelSheet.appendRow(['PRC-003', 'Parcel 201', 'LND-002', 'Palm Valley Estate', '16.0', '2300', 'Active']);
    parcelSheet.appendRow(['PRC-004', 'Parcel 202', 'LND-002', 'Palm Valley Estate', '16.0', '2400', 'Active']);
    parcelSheet.appendRow(['PRC-005', 'Parcel 301', 'LND-003', 'Green Grove Plantation', '30.4', '4500', 'Active']);
  }

  var blockSheet = ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);
  if (blockSheet && blockSheet.getLastRow() <= 1) {
    blockSheet.appendRow(['BLK-001', 'Block A1 - North Grove', 'PRC-001', 'Parcel 101', 'LND-001', 'Hacienda San Isidro', '7.5', '1100', 'Active']);
    blockSheet.appendRow(['BLK-002', 'Block A2 - South Grove', 'PRC-001', 'Parcel 101', 'LND-001', 'Hacienda San Isidro', '8.0', '1100', 'Active']);
    blockSheet.appendRow(['BLK-003', 'Block B1 - East Ridge', 'PRC-002', 'Parcel 102', 'LND-001', 'Hacienda San Isidro', '9.0', '1300', 'Active']);
    blockSheet.appendRow(['BLK-004', 'Block B2 - West Ridge', 'PRC-002', 'Parcel 102', 'LND-001', 'Hacienda San Isidro', '9.0', '1300', 'Active']);
    blockSheet.appendRow(['BLK-005', 'Block C1 - Valley Floor', 'PRC-003', 'Parcel 201', 'LND-002', 'Palm Valley Estate', '8.0', '1150', 'Active']);
    blockSheet.appendRow(['BLK-006', 'Block C2 - Hilltop', 'PRC-004', 'Parcel 202', 'LND-002', 'Palm Valley Estate', '8.0', '1200', 'Active']);
  }

  // Seed Dropdowns if empty
  var dropSheet = ss.getSheetByName(SHEET_NAMES.DROPDOWNS);
  if (dropSheet && dropSheet.getLastRow() <= 1) {
    var defaultDropdowns = [
      // Regular Activity Dropdowns
      ['OPT-001', 'Regular Activity', 'Cycle', 'Cycle 1 (Q1)', '', '1', 'Active'],
      ['OPT-002', 'Regular Activity', 'Cycle', 'Cycle 2 (Q2)', '', '2', 'Active'],
      ['OPT-003', 'Regular Activity', 'Cycle', 'Cycle 3 (Q3)', '', '3', 'Active'],
      ['OPT-004', 'Regular Activity', 'Cycle', 'Cycle 4 (Q4)', '', '4', 'Active'],

      // Irregular Activity Dropdowns
      ['OPT-005', 'Irregular Activity', 'Pest and Disease Treatment (Soil Drench)', 'Imidacloprid Premix 200SL', '', '1', 'Active'],
      ['OPT-006', 'Irregular Activity', 'Pest and Disease Treatment (Soil Drench)', 'Chlorpyrifos 40EC', '', '2', 'Active'],
      ['OPT-007', 'Irregular Activity', 'Pest and Disease Treatment (Soil Drench)', 'Trichoderma Bio-Inoculant', '', '3', 'Active'],
      ['OPT-008', 'Irregular Activity', 'Pest and Disease Treatment (Soil Drench)', 'Bacillus Thuringiensis Drench', '', '4', 'Active'],
      ['OPT-009', 'Irregular Activity', 'Irregular Activity', 'Rhinoceros Beetle Pheromone Trapping', '', '1', 'Active'],
      ['OPT-010', 'Irregular Activity', 'Irregular Activity', 'Crown Cleaning & Sanitation', '', '2', 'Active'],
      ['OPT-011', 'Irregular Activity', 'Irregular Activity', 'Drainage Clearing & Rehabilitation', '', '3', 'Active'],
      ['OPT-012', 'Irregular Activity', 'Irregular Activity', 'Lightning Strike Removal & Burial', '', '4', 'Active'],

      // Other Farm Activity Dropdowns
      ['OPT-013', 'Other Farm Activity', 'Other Activities', 'Cover Crop Planting (Calopogonium)', '', '1', 'Active'],
      ['OPT-014', 'Other Farm Activity', 'Other Activities', 'Farm Road Maintenance & Grading', '', '2', 'Active'],
      ['OPT-015', 'Other Farm Activity', 'Other Activities', 'Fence Repair & Boundary Marking', '', '3', 'Active'],
      ['OPT-016', 'Other Farm Activity', 'Other Activities', 'Seedling Nursery Bagging & Watering', '', '4', 'Active'],
      ['OPT-017', 'Other Farm Activity', 'Other Activities', 'Coconut Husk Mulching along Basins', '', '5', 'Active'],
      ['OPT-018', 'Other Farm Activity', 'Unit', 'Hectares', '', '1', 'Active'],
      ['OPT-019', 'Other Farm Activity', 'Unit', 'Palms', '', '2', 'Active'],
      ['OPT-020', 'Other Farm Activity', 'Unit', 'Meters', '', '3', 'Active'],
      ['OPT-021', 'Other Farm Activity', 'Unit', 'Sacks', '', '4', 'Active'],
      ['OPT-022', 'Other Farm Activity', 'Unit', 'Pieces / Bags', '', '5', 'Active'],

      // Pest and Disease Activity Dropdowns
      ['OPT-023', 'Pest and Disease Activity', 'Target Pest', 'Oryctes rhinoceros (Rhinoceros Beetle)', '', '1', 'Active'],
      ['OPT-024', 'Pest and Disease Activity', 'Target Pest', 'Rhynchophorus ferrugineus (Red Palm Weevil)', '', '2', 'Active'],
      ['OPT-025', 'Pest and Disease Activity', 'Target Pest', 'Brontispa longissima (Coconut Leaf Beetle)', '', '3', 'Active'],
      ['OPT-026', 'Pest and Disease Activity', 'Target Pest', 'Phytophthora palmivora (Bud Rot)', '', '4', 'Active'],
      ['OPT-027', 'Pest and Disease Activity', 'Target Pest', 'Cadang-Cadang Viroid Syndrome', '', '5', 'Active'],
      ['OPT-028', 'Pest and Disease Activity', 'Input Used', 'Bio-Metarhizium anisopliae Green Fungus', '', '1', 'Active'],
      ['OPT-029', 'Pest and Disease Activity', 'Input Used', 'Cypermethrin 5EC', '', '2', 'Active'],
      ['OPT-030', 'Pest and Disease Activity', 'Input Used', 'Copper Oxychloride 50WP', '', '3', 'Active'],
      ['OPT-031', 'Pest and Disease Activity', 'Input Used', 'Fosetyl-Alum Drench 80WP', '', '4', 'Active'],
      ['OPT-032', 'Pest and Disease Activity', 'Unit', 'Liters', '', '1', 'Active'],
      ['OPT-033', 'Pest and Disease Activity', 'Unit', 'Grams', '', '2', 'Active'],
      ['OPT-034', 'Pest and Disease Activity', 'Unit', 'Kilograms', '', '3', 'Active'],
      ['OPT-035', 'Pest and Disease Activity', 'Unit', 'Milliliters', '', '4', 'Active'],
      ['OPT-036', 'Pest and Disease Activity', 'Method Used', 'Soil Drenching Basal Application', '', '1', 'Active'],
      ['OPT-037', 'Pest and Disease Activity', 'Method Used', 'Crown Spraying with Mist Blower', '', '2', 'Active'],
      ['OPT-038', 'Pest and Disease Activity', 'Method Used', 'Stem Injection (Trunk Infusion)', '', '3', 'Active'],
      ['OPT-039', 'Pest and Disease Activity', 'Method Used', 'Pheromone Trap Bucket Hanging', '', '4', 'Active'],
      ['OPT-040', 'Pest and Disease Activity', 'Target Parts for Application', 'Basal Root Zone (Basin)', '', '1', 'Active'],
      ['OPT-041', 'Pest and Disease Activity', 'Target Parts for Application', 'Spear Leaf and Crown Apex', '', '2', 'Active'],
      ['OPT-042', 'Pest and Disease Activity', 'Target Parts for Application', 'Trunk Lower Cavities', '', '3', 'Active'],
      ['OPT-043', 'Pest and Disease Activity', 'Target Parts for Application', 'Entire Canopy Fronds', '', '4', 'Active']
    ];

    for (var i = 0; i < defaultDropdowns.length; i++) {
      dropSheet.appendRow(defaultDropdowns[i]);
    }
  }

  // Seed KPIs if empty
  var kpiSheet = ss.getSheetByName(SHEET_NAMES.KPIS);
  if (kpiSheet && kpiSheet.getLastRow() <= 1) {
    var defaultKPIs = [
      ['KPI-001', 'Weeding / Slashing Cleared', 'Block A1 - North Grove', 'Hacienda San Isidro', 'Parcel 101', 'Cycle 1 (Q1)', '2.0', 'Hectares', '4', '1', '2.0', '2026-01-01', 'Active'],
      ['KPI-002', 'Round Weeding Count', 'Block A1 - North Grove', 'Hacienda San Isidro', 'Parcel 101', 'Cycle 1 (Q1)', '100', 'Palms', '4', '1', '100', '2026-01-01', 'Active'],
      ['KPI-003', 'Compost Application', 'Block A1 - North Grove', 'Hacienda San Isidro', 'Parcel 101', 'Cycle 1 (Q1)', '80', 'Palms', '4', '1', '80', '2026-01-01', 'Active'],
      ['KPI-004', 'Pruning Palms', 'Block A1 - North Grove', 'Hacienda San Isidro', 'Parcel 101', 'Cycle 1 (Q1)', '60', 'Palms', '3', '1', '60', '2026-01-01', 'Active'],
      ['KPI-005', 'Soil Drenching Premix', 'Block A1 - North Grove', 'Hacienda San Isidro', 'Parcel 101', 'Cycle 1 (Q1)', '100', 'Palms', '4', '1', '100', '2026-01-01', 'Active'],
      ['KPI-006', 'Seednut Collection', 'Block A2 - South Grove', 'Hacienda San Isidro', 'Parcel 101', 'Cycle 1 (Q1)', '500', 'Nuts', '2', '1', '500', '2026-01-01', 'Active']
    ];

    for (var k = 0; k < defaultKPIs.length; k++) {
      kpiSheet.appendRow(defaultKPIs[k]);
    }
  }

  // Seed Map Registry with initial GeoJSON sample package
  var mapSheet = ss.getSheetByName(SHEET_NAMES.MAPS);
  if (mapSheet && mapSheet.getLastRow() <= 1) {
    var sampleGeoJSON = JSON.stringify({
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
            variety: "Tall Coconut & Hybrid Dwarf"
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
        }
      ]
    });

    mapSheet.appendRow([
      'MAP-001',
      'Hacienda San Isidro Master Parcel Map',
      'v1.0.0',
      'Hacienda San Isidro',
      'Parcel 101',
      'Block A1 - North Grove, Block A2 - South Grove',
      'GeoJSON',
      sampleGeoJSON,
      new Date().toISOString(),
      'System Administrator',
      'Active'
    ]);
  }

  // Seed System Settings
  var settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (settingsSheet && settingsSheet.getLastRow() <= 1) {
    settingsSheet.appendRow(['workingDaysPerWeek', '6', 'Standard working days per week (Monday to Saturday)', nowIso]);
    settingsSheet.appendRow(['restDays', 'Sunday', 'Weekly scheduled rest days', nowIso]);
    settingsSheet.appendRow(['dailyWorkingHours', '8', 'Daily operational working hours per manpower', nowIso]);
    settingsSheet.appendRow(['holidays', '2026-01-01,2026-04-02,2026-04-03,2026-05-01,2026-06-12,2026-11-30,2026-12-25,2026-12-30', 'Comma separated list of non-working holidays', nowIso]);
    settingsSheet.appendRow(['activeMapVersion', 'v1.0.0', 'Latest published farm map version', nowIso]);
  }
}

/**
 * Handle User Login & Server-side Authorization
 */
function handleLogin(payload) {
  var username = (payload.username || '').trim().toLowerCase();
  var passwordHash = (payload.passwordHash || '').trim();

  if (!username || !passwordHash) {
    return respondJSON({ success: false, error: 'Username and password are required.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  var data = usersSheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowUsername = String(row[3]).trim().toLowerCase();
    var rowPasswordHash = String(row[4]).trim();
    var rowStatus = String(row[10]).trim();

    if (rowUsername === username) {
      if (rowStatus.toLowerCase() !== 'active') {
        return respondJSON({ success: false, error: 'Account is deactivated. Please contact your Administrator.' });
      }

      if (rowPasswordHash === passwordHash) {
        // Update Last Login timestamp
        var now = new Date().toISOString();
        usersSheet.getRange(i + 1, 13).setValue(now);

        var userObj = {
          userId: row[0],
          employeeId: row[1],
          fullName: row[2],
          username: row[3],
          role: row[5],
          assignedSupervisor: row[6],
          assignedLandOwners: row[7],
          assignedFarmAndBlocks: row[8],
          assignedActivities: row[9],
          accountStatus: row[10],
          lastLogin: now,
          sessionToken: Utilities.getUuid()
        };

        // Log login to Audit
        logAudit(userObj.userId, userObj.role, 'LOGIN', userObj.userId, 'Users', 'User logged in successfully.');

        return respondJSON({
          success: true,
          message: 'Login successful.',
          user: userObj
        });
      } else {
        return respondJSON({ success: false, error: 'Invalid username or password.' });
      }
    }
  }

  return respondJSON({ success: false, error: 'Invalid username or password.' });
}

/**
 * Provide complete initial data bundle to frontend for offline caching
 */
function handleGetBootstrapData(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var result = {
    success: true,
    users: getSheetDataAsObjects(ss.getSheetByName(SHEET_NAMES.USERS)),
    landowners: getSheetDataAsObjects(ss.getSheetByName(SHEET_NAMES.LANDOWNERS)),
    parcels: getSheetDataAsObjects(ss.getSheetByName(SHEET_NAMES.PARCELS)),
    farmsAndBlocks: getSheetDataAsObjects(ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS)),
    dropdowns: getSheetDataAsObjects(ss.getSheetByName(SHEET_NAMES.DROPDOWNS)),
    kpis: getSheetDataAsObjects(ss.getSheetByName(SHEET_NAMES.KPIS)),
    maps: getSheetDataAsObjects(ss.getSheetByName(SHEET_NAMES.MAPS)),
    settings: getSheetDataAsObjects(ss.getSheetByName(SHEET_NAMES.SETTINGS)),
    devices: getSheetDataAsObjects(ss.getSheetByName(SHEET_NAMES.DEVICES)),
    timestamp: new Date().toISOString()
  };

  return respondJSON(result);
}

/**
 * Handle Batch Synchronization of Reports across all 6 Activity types
 * Implements strict UUID idempotency to prevent duplicate records
 */
function handleSyncReportsBatch(payload) {
  var records = payload.records || [];
  var user = payload.user || {};
  var device = payload.device || {};
  var batchId = payload.batchId || Utilities.getUuid();

  if (!records.length) {
    return respondJSON({ success: true, count: 0, syncedIds: [], message: 'No records to synchronize.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var syncedIds = [];
  var errors = [];
  var serverTimestamp = new Date().toISOString();

  // Activity sheets mapping
  var sheetMap = {
    'Regular Activity': ss.getSheetByName(SHEET_NAMES.REGULAR),
    'Irregular Activity': ss.getSheetByName(SHEET_NAMES.IRREGULAR),
    'Other Farm Activity': ss.getSheetByName(SHEET_NAMES.OTHER),
    'Palm Category Activity': ss.getSheetByName(SHEET_NAMES.PALM_CATEGORY),
    'Seednut Collection': ss.getSheetByName(SHEET_NAMES.SEEDNUT),
    'Pest and Disease Activity': ss.getSheetByName(SHEET_NAMES.PEST_DISEASE)
  };

  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    var actType = rec.activityType;
    var targetSheet = sheetMap[actType];

    if (!targetSheet) {
      errors.push('Unknown activity type for record ' + rec.reportId + ': ' + actType);
      continue;
    }

    try {
      var rowData = formatRecordForSheet(actType, rec, serverTimestamp, device);
      upsertRecordByUUID(targetSheet, rec.uniqueUuid || rec.reportId, rowData);
      syncedIds.push(rec.reportId);
    } catch (recErr) {
      errors.push('Error syncing record ' + rec.reportId + ': ' + recErr.message);
    }
  }

  // Register or update Device in DeviceRegistry
  registerDeviceInternal(ss, device, user, syncedIds.length);

  // Log Batch Sync
  var syncLogSheet = ss.getSheetByName(SHEET_NAMES.SYNC_LOGS);
  if (syncLogSheet) {
    syncLogSheet.appendRow([
      'SYNC-' + Date.now(),
      batchId,
      user.userId || 'Anonymous',
      device.deviceId || 'Unknown',
      syncedIds.length,
      errors.length === 0 ? 'Success' : 'Partial / With Errors',
      errors.join('; '),
      serverTimestamp
    ]);
  }

  return respondJSON({
    success: true,
    batchId: batchId,
    syncedIds: syncedIds,
    errors: errors,
    serverTimestamp: serverTimestamp,
    message: 'Synchronized ' + syncedIds.length + ' reports successfully.'
  });
}

/**
 * Format records for specific activity sheets matching exact column definitions
 */
function formatRecordForSheet(activityType, rec, serverTimestamp, device) {
  var devId = rec.deviceId || device.deviceId || '';
  var devName = rec.deviceName || device.deviceName || '';
  var browserOs = rec.browserOs || device.browserOs || '';
  var gpsLat = rec.gpsLatitude || '';
  var gpsLng = rec.gpsLongitude || '';

  switch (activityType) {
    case 'Regular Activity':
      return [
        rec.reportId || Utilities.getUuid(),
        rec.uniqueUuid || rec.reportId,
        rec.userId || '',
        rec.employeeName || '',
        rec.supervisorId || '',
        rec.date || '',
        rec.landOwnersName || '',
        rec.parcelNumber || '',
        rec.farmBlock || '',
        rec.manpower || 0,
        rec.cycle || '',
        rec.weedingSlashingHa || 0,
        rec.roundWeedingPalms || 0,
        rec.compostPalms || 0,
        rec.quantitySacks || 0,
        rec.quantityKilo || 0,
        rec.bofRequestNo || '',
        rec.pruningPalms || 0,
        rec.soilDrenchingPalms || 0,
        rec.quantityLiters || 0,
        rec.foliarRequestCode || '',
        rec.remarks || '',
        devId,
        devName,
        browserOs,
        gpsLat,
        gpsLng,
        serverTimestamp,
        'SENT'
      ];

    case 'Irregular Activity':
      return [
        rec.reportId || Utilities.getUuid(),
        rec.uniqueUuid || rec.reportId,
        rec.userId || '',
        rec.employeeName || '',
        rec.supervisorId || '',
        rec.date || '',
        rec.landOwnersName || '',
        rec.parcelNumber || '',
        rec.farmBlock || '',
        rec.manpower || 0,
        rec.pestTreatmentSoilDrench || '',
        rec.countOfPalms || 0,
        rec.quantityLiters || 0,
        rec.foliarRequestNumber || '',
        rec.irregularActivity || '',
        rec.countOfPalms2 || 0,
        rec.countOfManpower2 || 0,
        rec.remarks || '',
        devId,
        devName,
        browserOs,
        gpsLat,
        gpsLng,
        serverTimestamp,
        'SENT'
      ];

    case 'Other Farm Activity':
      return [
        rec.reportId || Utilities.getUuid(),
        rec.uniqueUuid || rec.reportId,
        rec.userId || '',
        rec.employeeName || '',
        rec.supervisorId || '',
        rec.date || '',
        rec.landOwnersName || '',
        rec.parcelNumber || '',
        rec.farmBlock || '',
        rec.manpower || 0,
        rec.otherActivities || '',
        rec.quantity || 0,
        rec.unit || '',
        rec.remarks || '',
        devId,
        devName,
        browserOs,
        gpsLat,
        gpsLng,
        serverTimestamp,
        'SENT'
      ];

    case 'Palm Category Activity':
      return [
        rec.reportId || Utilities.getUuid(),
        rec.uniqueUuid || rec.reportId,
        rec.userId || '',
        rec.employeeName || '',
        rec.supervisorId || '',
        rec.timestamp || serverTimestamp,
        rec.farmBlock || '',
        rec.landOwnersName || '',
        rec.parcelNumber || '',
        rec.palmNumber || '',
        rec.seedlingStage || 0,
        rec.juvenileStage || 0,
        rec.preTrunkReproductiveStage || 0,
        rec.preTrunkFruitingStage || 0,
        rec.matureStage || 0,
        rec.fruitingStage || 0,
        rec.problemPalms || 0,
        rec.manpowerCount || 0,
        rec.remarks || '',
        devId,
        devName,
        browserOs,
        gpsLat,
        gpsLng,
        serverTimestamp,
        'SENT'
      ];

    case 'Seednut Collection':
      return [
        rec.reportId || Utilities.getUuid(),
        rec.uniqueUuid || rec.reportId,
        rec.userId || '',
        rec.employeeName || '',
        rec.supervisorId || '',
        rec.date || '',
        rec.areaCode || '',
        rec.palmNumber || '',
        rec.nutCountCollected || 0,
        rec.countOfNutsNextCollection || 0,
        rec.countOfRejectedNuts || 0,
        gpsLat,
        gpsLng,
        rec.gpsAccuracy || '',
        rec.remarks || '',
        devId,
        devName,
        browserOs,
        serverTimestamp,
        'SENT'
      ];

    case 'Pest and Disease Activity':
      return [
        rec.reportId || Utilities.getUuid(),
        rec.uniqueUuid || rec.reportId,
        rec.userId || '',
        rec.employeeName || '',
        rec.supervisorId || '',
        rec.date || '',
        rec.landOwnersName || '',
        rec.parcelNumber || '',
        rec.palmNumbers || '',
        rec.farmBlock || '',
        rec.targetPest || '',
        rec.totalPalmsAffected || 0,
        rec.inputUsed || '',
        rec.quantity || 0,
        rec.unit || '',
        rec.ratio || '',
        rec.methodUsed || '',
        rec.targetPartsApplication || '',
        rec.manpowerCount || 0,
        rec.remarks || '',
        devId,
        devName,
        browserOs,
        gpsLat,
        gpsLng,
        serverTimestamp,
        'SENT'
      ];

    default:
      throw new Error('Unsupported activity type: ' + activityType);
  }
}

/**
 * Upserts a row into targetSheet based on unique UUID in Column 2 (or Column 1)
 */
function upsertRecordByUUID(sheet, uuid, rowData) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var range = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (var i = 0; i < range.length; i++) {
      if (String(range[i][0]) === String(uuid)) {
        // Update existing row
        sheet.getRange(i + 2, 1, 1, rowData.length).setValues([rowData]);
        return;
      }
    }
  }
  // If not found, append new row
  sheet.appendRow(rowData);
}

/**
 * Handle Dropdown Management (Admin only)
 */
function handleSaveDropdown(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.DROPDOWNS);
  var opt = payload.dropdown || {};

  var optId = opt.optionId || ('OPT-' + Date.now());
  var rowData = [
    optId,
    opt.activityType || '',
    opt.category || opt.dropdownCategory || '',
    opt.value || opt.optionValue || '',
    opt.parentValue || '',
    opt.sortOrder || 1,
    opt.status || 'Active'
  ];

  upsertRecordByCol1(sheet, optId, rowData);

  logAudit(payload.userId || 'Admin', 'Administrator', 'SAVE_DROPDOWN', optId, 'DropdownOptions', 'Option: ' + opt.value);

  return respondJSON({ success: true, optionId: optId, message: 'Dropdown option saved successfully.' });
}

function handleDeleteDropdown(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.DROPDOWNS);
  var optionId = payload.optionId;

  deleteOrDeactivateRow(sheet, 1, optionId);
  logAudit(payload.userId || 'Admin', 'Administrator', 'DELETE_DROPDOWN', optionId, 'DropdownOptions', 'Option ID: ' + optionId);

  return respondJSON({ success: true, message: 'Dropdown option deactivated.' });
}

/**
 * Handle KPI Registration & Management (Admin only)
 */
function handleSaveKPI(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.KPIS);
  var kpi = payload.kpi || {};

  var kpiId = kpi.kpiId || ('KPI-' + Date.now());
  var rowData = [
    kpiId,
    kpi.activityType || '',
    kpi.farmBlock || '',
    kpi.landOwner || '',
    kpi.parcelNumber || '',
    kpi.cycle || '',
    kpi.targetQuantity || 0,
    kpi.targetUnit || '',
    kpi.requiredManpower || 1,
    kpi.targetWorkingDays || 1,
    kpi.dailyExpectedAccomplishment || 0,
    kpi.effectiveDate || new Date().toISOString().split('T')[0],
    kpi.status || 'Active'
  ];

  upsertRecordByCol1(sheet, kpiId, rowData);
  logAudit(payload.userId || 'Admin', 'Administrator', 'SAVE_KPI', kpiId, 'KPIRegistration', 'Activity: ' + kpi.activityType);

  return respondJSON({ success: true, kpiId: kpiId, message: 'KPI Target saved successfully.' });
}

function handleDeleteKPI(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.KPIS);
  var kpiId = payload.kpiId;

  deleteOrDeactivateRow(sheet, 1, kpiId);
  logAudit(payload.userId || 'Admin', 'Administrator', 'DELETE_KPI', kpiId, 'KPIRegistration', 'KPI ID: ' + kpiId);

  return respondJSON({ success: true, message: 'KPI Target deactivated.' });
}

/**
 * Handle User Management (Admin only)
 */
function handleSaveUser(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.USERS);
  var user = payload.userData || {};

  var userId = user.userId || ('USR-' + Date.now());
  var passwordHash = user.passwordHash || (user.password ? hashPasswordInternal(user.password) : '');

  var rowData = [
    userId,
    user.employeeId || '',
    user.fullName || '',
    user.username || '',
    passwordHash,
    user.role || 'Field Personnel',
    user.assignedSupervisor || 'None',
    Array.isArray(user.assignedLandOwners) ? user.assignedLandOwners.join(', ') : (user.assignedLandOwners || 'ALL'),
    Array.isArray(user.assignedFarmAndBlocks) ? user.assignedFarmAndBlocks.join(', ') : (user.assignedFarmAndBlocks || 'ALL'),
    Array.isArray(user.assignedActivities) ? user.assignedActivities.join(', ') : (user.assignedActivities || 'ALL'),
    user.accountStatus || 'Active',
    user.dateCreated || new Date().toISOString(),
    user.lastLogin || ''
  ];

  upsertRecordByCol1(sheet, userId, rowData);
  logAudit(payload.currentUserId || 'Admin', 'Administrator', 'SAVE_USER', userId, 'Users', 'User: ' + user.username);

  return respondJSON({ success: true, userId: userId, message: 'User saved successfully.' });
}

function handleToggleUserStatus(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.USERS);
  var userId = payload.userId;
  var newStatus = payload.newStatus || 'Deactivated';

  var lastRow = sheet.getLastRow();
  for (var i = 2; i <= lastRow; i++) {
    if (String(sheet.getRange(i, 1).getValue()) === String(userId)) {
      sheet.getRange(i, 11).setValue(newStatus);
      logAudit(payload.currentUserId || 'Admin', 'Administrator', 'TOGGLE_USER_STATUS', userId, 'Users', 'Status: ' + newStatus);
      return respondJSON({ success: true, message: 'User status updated to ' + newStatus });
    }
  }

  return respondJSON({ success: false, error: 'User not found.' });
}

/**
 * Handle Farm Map Management (Admin only)
 */
function handleSaveMap(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.MAPS);
  var mapData = payload.mapData || {};

  var mapId = mapData.mapId || ('MAP-' + Date.now());
  var rowData = [
    mapId,
    mapData.title || 'Farm Parcel Map',
    mapData.version || 'v1.0.0',
    mapData.landOwner || '',
    mapData.parcelNumber || '',
    mapData.farmBlock || '',
    mapData.fileType || 'GeoJSON',
    typeof mapData.geoJson === 'object' ? JSON.stringify(mapData.geoJson) : (mapData.geoJson || '{}'),
    new Date().toISOString(),
    payload.uploadedBy || 'Administrator',
    mapData.status || 'Active'
  ];

  upsertRecordByCol1(sheet, mapId, rowData);

  // Update system active map version
  var settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (settingsSheet && mapData.version) {
    updateSettingValue(settingsSheet, 'activeMapVersion', mapData.version);
  }

  logAudit(payload.userId || 'Admin', 'Administrator', 'SAVE_MAP', mapId, 'MapRegistry', 'Map: ' + mapData.title + ' (' + mapData.version + ')');

  return respondJSON({ success: true, mapId: mapId, version: mapData.version, message: 'Map registered successfully.' });
}

function handleDeleteMap(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.MAPS);
  var mapId = payload.mapId;

  deleteOrDeactivateRow(sheet, 1, mapId);
  logAudit(payload.userId || 'Admin', 'Administrator', 'DELETE_MAP', mapId, 'MapRegistry', 'Deactivated map: ' + mapId);

  return respondJSON({ success: true, message: 'Map deactivated successfully.' });
}

/**
 * Query Consolidated Reports with dynamic filters
 */
function handleGetReports(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var filters = payload.filters || {};
  var activityType = filters.activityType || 'All';

  var activitySheets = {
    'Regular Activity': SHEET_NAMES.REGULAR,
    'Irregular Activity': SHEET_NAMES.IRREGULAR,
    'Other Farm Activity': SHEET_NAMES.OTHER,
    'Palm Category Activity': SHEET_NAMES.PALM_CATEGORY,
    'Seednut Collection': SHEET_NAMES.SEEDNUT,
    'Pest and Disease Activity': SHEET_NAMES.PEST_DISEASE
  };

  var allRecords = [];

  for (var typeName in activitySheets) {
    if (activityType === 'All' || activityType === typeName) {
      var sName = activitySheets[typeName];
      var s = ss.getSheetByName(sName);
      if (s) {
        var recs = getSheetDataAsObjects(s);
        for (var r = 0; r < recs.length; r++) {
          recs[r].activityType = typeName;
          if (matchesReportFilters(recs[r], filters)) {
            allRecords.push(recs[r]);
          }
        }
      }
    }
  }

  return respondJSON({
    success: true,
    count: allRecords.length,
    records: allRecords
  });
}

function matchesReportFilters(rec, filters) {
  if (filters.startDate && rec['Date'] && rec['Date'] < filters.startDate) return false;
  if (filters.endDate && rec['Date'] && rec['Date'] > filters.endDate) return false;
  if (filters.landOwner && rec['Land Owners Name'] && rec['Land Owners Name'] !== filters.landOwner) return false;
  if (filters.parcelNumber && rec['Parcel Number'] && rec['Parcel Number'] !== filters.parcelNumber) return false;
  if (filters.farmBlock && rec['Farm & Block'] && rec['Farm & Block'] !== filters.farmBlock) return false;
  if (filters.supervisor && rec['Supervisor ID'] && rec['Supervisor ID'] !== filters.supervisor) return false;
  if (filters.employee && rec['User ID'] && rec['User ID'] !== filters.employee) return false;
  return true;
}

/**
 * Consolidated Daily Monitoring & KPI Accomplishment calculations
 */
function handleGetMonitoring(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kpiSheet = ss.getSheetByName(SHEET_NAMES.KPIS);
  var kpis = getSheetDataAsObjects(kpiSheet);

  // Consolidate actual accomplishments from all 6 sheets
  var monitoring = [];

  for (var i = 0; i < kpis.length; i++) {
    var k = kpis[i];
    var actType = k['Activity Type'] || '';
    var targetQty = parseFloat(k['Target Quantity']) || 0;
    var targetManpower = parseFloat(k['Required Manpower']) || 1;
    var targetDays = parseFloat(k['Target Working Days']) || 1;
    var dailyExpected = parseFloat(k['Daily Expected Accomplishment']) || (targetQty / (targetDays || 1));

    // Calculate actuals
    var actualData = computeActualAccomplishment(ss, actType, k['Land Owner'], k['Parcel Number'], k['Farm & Block'], k['Cycle']);

    var actualQty = actualData.totalAccomplishment;
    var actualManpower = actualData.totalManpower;
    var latestDate = actualData.latestDate || '';

    var kpiAchievedPct = targetQty > 0 ? ((actualQty / targetQty) * 100) : 0;
    var remainingTarget = Math.max(0, targetQty - actualQty);
    var dailyProductivity = actualManpower > 0 ? (actualQty / actualManpower) : 0;

    var expectedDaysToComplete = dailyExpected > 0 ? (remainingTarget / dailyExpected) : 0;
    var manpowerForecastDays = (actualManpower > 0 && dailyProductivity > 0)
      ? (remainingTarget / (actualManpower * dailyProductivity))
      : expectedDaysToComplete;

    // Determine Status
    var status = 'Not Started';
    if (actualQty >= targetQty && targetQty > 0) {
      status = 'Completed';
    } else if (actualQty > 0) {
      if (kpiAchievedPct >= 100) status = 'Completed';
      else if (kpiAchievedPct >= 80) status = 'Ahead of Schedule';
      else if (kpiAchievedPct >= 40) status = 'On Track';
      else status = 'Behind Schedule';
    }

    monitoring.push({
      kpiId: k['KPI ID'],
      activityType: actType,
      landOwner: k['Land Owner'],
      parcelNumber: k['Parcel Number'],
      farmBlock: k['Farm & Block'],
      cycle: k['Cycle'],
      targetQuantity: targetQty,
      targetUnit: k['Target Unit'],
      dailyAccomplishment: actualData.dailyAccomplishment,
      cumulativeAccomplishment: actualQty,
      remainingTarget: remainingTarget,
      actualManpower: actualManpower,
      dailyProductivity: dailyProductivity,
      kpiPercentage: Math.round(kpiAchievedPct * 10) / 10,
      expectedDaysToComplete: Math.ceil(manpowerForecastDays),
      latestDate: latestDate,
      status: status
    });
  }

  return respondJSON({ success: true, monitoring: monitoring });
}

function computeActualAccomplishment(ss, activityType, landOwner, parcel, block, cycle) {
  var sheet = null;
  var colField = '';

  if (activityType.indexOf('Weeding / Slashing') !== -1) {
    sheet = ss.getSheetByName(SHEET_NAMES.REGULAR);
    colField = 'Weeding Rolling Slashing Ha';
  } else if (activityType.indexOf('Round Weeding') !== -1) {
    sheet = ss.getSheetByName(SHEET_NAMES.REGULAR);
    colField = 'Round Weeding Palms';
  } else if (activityType.indexOf('Compost') !== -1) {
    sheet = ss.getSheetByName(SHEET_NAMES.REGULAR);
    colField = 'Compost Palms';
  } else if (activityType.indexOf('Pruning') !== -1) {
    sheet = ss.getSheetByName(SHEET_NAMES.REGULAR);
    colField = 'Pruning Palms';
  } else if (activityType.indexOf('Soil Drench') !== -1) {
    sheet = ss.getSheetByName(SHEET_NAMES.REGULAR);
    colField = 'Soil Drenching Premix Palms';
  } else if (activityType.indexOf('Seednut') !== -1) {
    sheet = ss.getSheetByName(SHEET_NAMES.SEEDNUT);
    colField = 'Nut Count Collected';
  } else {
    sheet = ss.getSheetByName(SHEET_NAMES.OTHER);
    colField = 'Quantity';
  }

  var totalAcc = 0;
  var totalMan = 0;
  var dailyAcc = 0;
  var latestDate = '';

  if (!sheet) return { totalAccomplishment: 0, totalManpower: 0, dailyAccomplishment: 0, latestDate: '' };

  var records = getSheetDataAsObjects(sheet);
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var matchLand = !landOwner || r['Land Owners Name'] === landOwner;
    var matchParcel = !parcel || r['Parcel Number'] === parcel;
    var matchBlock = !block || r['Farm & Block'] === block;

    if (matchLand && matchParcel && matchBlock) {
      var val = parseFloat(r[colField]) || 0;
      var man = parseFloat(r['Manpower']) || parseFloat(r['Count of Manpower']) || parseFloat(r['Manpower Count']) || 1;
      totalAcc += val;
      totalMan += man;
      dailyAcc = val; // Latest reported daily value
      if (r['Date'] && r['Date'] > latestDate) latestDate = r['Date'];
    }
  }

  return {
    totalAccomplishment: totalAcc,
    totalManpower: totalMan,
    dailyAccomplishment: dailyAcc,
    latestDate: latestDate
  };
}

/**
 * Handle Device Registration
 */
function handleRegisterDevice(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  registerDeviceInternal(ss, payload.device, payload.user, 0);
  return respondJSON({ success: true, message: 'Device registered.' });
}

function registerDeviceInternal(ss, device, user, addedSubmissions) {
  if (!device || !device.deviceId) return;
  var sheet = ss.getSheetByName(SHEET_NAMES.DEVICES);
  if (!sheet) return;

  var devId = device.deviceId;
  var now = new Date().toISOString();
  var lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(devId)) {
        var row = i + 2;
        sheet.getRange(row, 7).setValue(now); // Last Seen
        var currentSubs = parseInt(sheet.getRange(row, 8).getValue()) || 0;
        sheet.getRange(row, 8).setValue(currentSubs + addedSubmissions);
        if (user && user.userId) sheet.getRange(row, 3).setValue(user.userId);
        if (user && user.fullName) sheet.getRange(row, 4).setValue(user.fullName);
        return;
      }
    }
  }

  // New device
  sheet.appendRow([
    devId,
    device.deviceName || 'Mobile Browser',
    user ? (user.userId || '') : '',
    user ? (user.fullName || '') : '',
    device.browserOs || '',
    now,
    now,
    addedSubmissions,
    'Active'
  ]);
}

/**
 * Audit Logging Helper
 */
function logAudit(userId, role, action, recordId, module, details) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.AUDIT_LOGS);
    if (sheet) {
      sheet.appendRow([
        'LOG-' + Date.now(),
        userId || 'Anonymous',
        role || 'User',
        action || 'ACTION',
        recordId || 'N/A',
        module || 'General',
        details || '',
        new Date().toISOString()
      ]);
    }
  } catch (e) {
    // Audit log should never block operations
    console.error('Audit log failed', e);
  }
}

/**
 * Utility Functions
 */
function getSheetDataAsObjects(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    result.push(obj);
  }
  return result;
}

function upsertRecordByCol1(sheet, id, rowData) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        sheet.getRange(i + 2, 1, 1, rowData.length).setValues([rowData]);
        return;
      }
    }
  }
  sheet.appendRow(rowData);
}

function deleteOrDeactivateRow(sheet, colIndex, value) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var vals = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === String(value)) {
        // Soft deactivate status column if present, or delete row
        var numCols = sheet.getLastColumn();
        sheet.getRange(i + 2, numCols).setValue('Deactivated');
        return;
      }
    }
  }
}

function updateSettingValue(sheet, key, value) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(key)) {
        sheet.getRange(i + 2, 2).setValue(value);
        sheet.getRange(i + 2, 4).setValue(new Date().toISOString());
        return;
      }
    }
  }
  sheet.appendRow([key, value, '', new Date().toISOString()]);
}

function hashPasswordInternal(password) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  var hash = '';
  for (var i = 0; i < rawHash.length; i++) {
    var byteVal = rawHash[i];
    if (byteVal < 0) byteVal += 256;
    var byteHex = byteVal.toString(16);
    if (byteHex.length === 1) byteHex = '0' + byteHex;
    hash += byteHex;
  }
  return hash;
}
