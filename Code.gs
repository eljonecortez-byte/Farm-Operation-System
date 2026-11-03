/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * GOOGLE APPS SCRIPT BACKEND API (Central Database in Google Sheets)
 * Version 3.1.0 — secured API, Farm & Block based access, Land Owner Enrollment,
 *                 custom activities, large map upload (KML / KMZ / GeoJSON)
 *
 * WHAT CHANGED IN v3
 *  - Every request (except PING / LOGIN) needs a signed session token.
 *  - Role checks are enforced on the server (Administrator / Supervisor / Field Personnel).
 *  - Password hashes are never sent to the browser. Stored hashes are salted + stretched.
 *  - Users are assigned to FARM & BLOCKS only (no more land owner assignment).
 *  - Supervisor of a Farm & Block is found automatically from the user assignments.
 *  - Supervisors / Field Personnel only receive data for their assigned Farm & Blocks.
 *  - Land Owner Enrollment: Land Owner Name + Parcel Number + Farm & Block.
 *  - Reads/writes use header names, so adding columns never breaks old sheets.
 *
 * 19 Central Database Sheets:
 *  Users, UserPermissions, LandOwners, Parcels, FarmsAndBlocks, DropdownOptions,
 *  RegularActivity, IrregularActivity, OtherFarmActivity, PalmCategoryActivity,
 *  SeednutCollection, PestAndDiseaseActivity, KPIRegistration, ManpowerRecords,
 *  MapRegistry, DeviceRegistry, SyncLogs, AuditLogs, SystemSettings
 */

var APP_VERSION = '3.1.0';
var MAP_CELL_LIMIT = 45000;       // characters per sheet cell for map data
var MAP_MAX_CHARS = 3000000;      // ~3 MB per map (keeps phones fast)
var TOKEN_TTL_DAYS = 30;          // Field devices can stay offline for long periods
var MAX_LOGIN_FAILURES = 5;       // per username
var LOGIN_LOCK_SECONDS = 900;     // 15 minutes
var HASH_ROUNDS = 200;            // server-side key stretching rounds

// SHA-256('admin123') — the old demo password. Accounts still using it are forced to change it.
var DEFAULT_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

var ROLES = { ADMIN: 'Administrator', SUPERVISOR: 'Supervisor', FIELD: 'Field Personnel' };

var ACTIVITY_TYPES = [
  'Regular Activity',
  'Irregular Activity',
  'Other Farm Activity',
  'Palm Category Activity',
  'Seednut Collection',
  'Pest and Disease Activity'
];

var SHEET_NAMES = {
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
  SETTINGS: 'SystemSettings',
  CUSTOM_ACTIVITIES: 'CustomActivities',
  MAP_CHUNKS: 'MapChunks'
};

var ACTIVITY_SHEETS = {
  'Regular Activity': SHEET_NAMES.REGULAR,
  'Irregular Activity': SHEET_NAMES.IRREGULAR,
  'Other Farm Activity': SHEET_NAMES.OTHER,
  'Palm Category Activity': SHEET_NAMES.PALM_CATEGORY,
  'Seednut Collection': SHEET_NAMES.SEEDNUT,
  'Pest and Disease Activity': SHEET_NAMES.PEST_DISEASE
};

var HEADERS = {
  USERS: [
    'User ID', 'Employee ID', 'Full Name', 'Username', 'Password Hash', 'Role',
    'Assigned Supervisor', 'Assigned Farm and Blocks', 'Assigned Activities',
    'Account Status', 'Date Created', 'Last Login', 'Must Change Password', 'Token Version'
  ],
  PERMISSIONS: [
    'Permission ID', 'User ID', 'Can Manage Users', 'Can Manage Dropdowns',
    'Can Manage KPIs', 'Can Manage Maps', 'Can View All Reports', 'Can Export Data', 'Status'
  ],
  LANDOWNERS: [
    'Land Owner ID', 'Land Owner Name', 'Contact Person', 'Phone', 'Total Hectares', 'Status', 'Date Enrolled'
  ],
  PARCELS: [
    'Parcel ID', 'Parcel Number', 'Land Owner ID', 'Land Owner Name', 'Total Area Ha', 'Total Palms', 'Status', 'Date Enrolled'
  ],
  FARMS_BLOCKS: [
    'Block ID', 'Farm and Block Name', 'Parcel ID', 'Parcel Number', 'Land Owner ID', 'Land Owner Name',
    'Area Ha', 'Palm Count', 'Status', 'Supervisor ID', 'Supervisor Name', 'Date Enrolled'
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
    'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status', 'Date'
  ],
  SEEDNUT: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Area Code', 'Palm Number', 'Nut Count Collected', 'Count of Nuts for Next Collection',
    'Count of Rejected Nuts', 'GPS Latitude', 'GPS Longitude', 'GPS Accuracy', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'Server Timestamp', 'Sync Status',
    'Land Owners Name', 'Parcel Number', 'Farm & Block'
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
  ],
  CUSTOM_ACTIVITIES: [
    'Activity ID', 'Activity Name', 'Description', 'Icon', 'Fields JSON', 'KPI Field',
    'Sheet Name', 'Status', 'Created By', 'Date Created', 'Last Updated'
  ],
  MAP_CHUNKS: [
    'Map ID', 'Chunk Index', 'Data'
  ]
};

// Columns every custom activity sheet has (custom fields go between Manpower and Remarks)
var CUSTOM_PREFIX_HEADERS = [
  'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
  'Land Owners Name', 'Parcel Number', 'Farm & Block', 'Manpower'
];
var CUSTOM_SUFFIX_HEADERS = [
  'Remarks', 'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude',
  'Server Timestamp', 'Sync Status'
];

/**
 * Sheet column header  ->  [frontend field key, type]   (type: 's' text, 'n' number, 'g' number or blank)
 * One shared map for all 6 activity sheets (same header = same field everywhere).
 */
var REPORT_FIELDS = {
  'Report ID': ['reportId', 's'],
  'Unique UUID': ['uniqueUuid', 's'],
  'User ID': ['userId', 's'],
  'Employee Name': ['employeeName', 's'],
  'Supervisor ID': ['supervisorId', 's'],
  'Date': ['date', 's'],
  'Timestamp': ['timestamp', 's'],
  'Land Owners Name': ['landOwnersName', 's'],
  'Parcel Number': ['parcelNumber', 's'],
  'Farm & Block': ['farmBlock', 's'],
  'Manpower': ['manpower', 'n'],
  'Manpower Count': ['manpowerCount', 'n'],
  'Cycle': ['cycle', 's'],
  'Weeding Rolling Slashing Ha': ['weedingSlashingHa', 'n'],
  'Round Weeding Palms': ['roundWeedingPalms', 'n'],
  'Compost Palms': ['compostPalms', 'n'],
  'Quantity Sacks': ['quantitySacks', 'n'],
  'Quantity Kilo': ['quantityKilo', 'n'],
  'BOF Request No': ['bofRequestNo', 's'],
  'Pruning Palms': ['pruningPalms', 'n'],
  'Soil Drenching Premix Palms': ['soilDrenchingPalms', 'n'],
  'Quantity Liters': ['quantityLiters', 'n'],
  'Foliar Request Code': ['foliarRequestCode', 's'],
  'Pest Treatment Soil Drench': ['pestTreatmentSoilDrench', 's'],
  'Count of Palms': ['countOfPalms', 'n'],
  'Foliar Request Number': ['foliarRequestNumber', 's'],
  'Irregular Activity': ['irregularActivity', 's'],
  'Count of Palms 2': ['countOfPalms2', 'n'],
  'Count of Manpower 2': ['countOfManpower2', 'n'],
  'Other Activities': ['otherActivities', 's'],
  'Quantity': ['quantity', 'n'],
  'Unit': ['unit', 's'],
  'Palm Number': ['palmNumber', 's'],
  'Palm Numbers': ['palmNumbers', 's'],
  'Seedling Stage': ['seedlingStage', 'n'],
  'Juvenile Stage': ['juvenileStage', 'n'],
  'Pre-trunk Reproductive Stage': ['preTrunkReproductiveStage', 'n'],
  'Pre-trunk Fruiting Stage': ['preTrunkFruitingStage', 'n'],
  'Mature Stage': ['matureStage', 'n'],
  'Fruiting Stage': ['fruitingStage', 'n'],
  'Problem Palms': ['problemPalms', 'n'],
  'Area Code': ['areaCode', 's'],
  'Nut Count Collected': ['nutCountCollected', 'n'],
  'Count of Nuts for Next Collection': ['countOfNutsNextCollection', 'n'],
  'Count of Rejected Nuts': ['countOfRejectedNuts', 'n'],
  'GPS Accuracy': ['gpsAccuracy', 'g'],
  'Target Pest': ['targetPest', 's'],
  'Total Palms Affected': ['totalPalmsAffected', 'n'],
  'Input Used': ['inputUsed', 's'],
  'Ratio': ['ratio', 's'],
  'Method Used': ['methodUsed', 's'],
  'Target Parts Application': ['targetPartsApplication', 's'],
  'Remarks': ['remarks', 's'],
  'Device ID': ['deviceId', 's'],
  'Device Name': ['deviceName', 's'],
  'Browser OS': ['browserOs', 's'],
  'GPS Latitude': ['gpsLatitude', 'g'],
  'GPS Longitude': ['gpsLongitude', 'g'],
  'Server Timestamp': ['serverTimestamp', 's'],
  'Sync Status': ['syncStatus', 's']
};

/* ==========================================================================
   HTTP ENTRY POINTS
   ========================================================================== */

/** GET = health check only (does not touch the database). */
function doGet(e) {
  return respondJSON({
    success: true,
    message: 'Coconut Farm Operations & KPI Management System API is active.',
    app: 'FarmOps KPI Management',
    version: APP_VERSION,
    timestamp: new Date().toISOString()
  });
}

// Actions that do not need a session token
var PUBLIC_ACTIONS = { PING: true, LOGIN: true };

// Actions that change data (need the script lock)
var WRITE_ACTIONS = {
  LOGIN: true, SETUP_DB: true, SYNC_REPORTS_BATCH: true, SAVE_DROPDOWN: true, DELETE_DROPDOWN: true,
  SAVE_KPI: true, DELETE_KPI: true, SAVE_USER: true, TOGGLE_USER_STATUS: true, RESET_PASSWORD: true,
  CHANGE_PASSWORD: true, SAVE_MAP: true, DELETE_MAP: true, REGISTER_DEVICE: true,
  ENROLL_LANDOWNER: true, SET_BLOCK_STATUS: true, PING: true,
  SAVE_ACTIVITY_TYPE: true, SET_ACTIVITY_TYPE_STATUS: true
};

function doPost(e) {
  var payload;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respondJSON({ success: false, error: 'Missing request body.' });
    }
    payload = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return respondJSON({ success: false, error: 'Invalid JSON body.' });
  }

  var action = String(payload.action || '');
  var lock = null;

  if (WRITE_ACTIONS[action]) {
    lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
    } catch (lockError) {
      return respondJSON({ success: false, error: 'Database busy, please retry in a moment.' });
    }
  }

  try {
    ensureDatabaseReady();

    if (action === 'PING') {
      return respondJSON({ success: true, message: 'Connected. Database sheets verified.', version: APP_VERSION });
    }
    if (action === 'LOGIN') {
      return handleLogin(payload);
    }

    // ---- everything below needs a valid session ----
    var ctx = authenticate(payload.token);
    if (!ctx.ok) {
      return respondJSON({ success: false, code: ctx.code, error: ctx.error });
    }

    switch (action) {
      case 'SETUP_DB':
        requireRole(ctx, [ROLES.ADMIN]);
        setupDatabase();
        return respondJSON({ success: true, message: 'All database sheets verified and initialized.' });

      case 'GET_BOOTSTRAP_DATA':   return handleGetBootstrapData(ctx);
      case 'SYNC_REPORTS_BATCH':   return handleSyncReportsBatch(ctx, payload);
      case 'GET_REPORTS':          return handleGetReports(ctx, payload);
      case 'GET_MONITORING':       return handleGetMonitoring(ctx);
      case 'REGISTER_DEVICE':      return handleRegisterDevice(ctx, payload);
      case 'CHANGE_PASSWORD':      return handleChangePassword(ctx, payload);

      case 'SAVE_DROPDOWN':        requireRole(ctx, [ROLES.ADMIN]); return handleSaveDropdown(ctx, payload);
      case 'DELETE_DROPDOWN':      requireRole(ctx, [ROLES.ADMIN]); return handleDeleteDropdown(ctx, payload);

      case 'SAVE_KPI':             requireRole(ctx, [ROLES.ADMIN, ROLES.SUPERVISOR]); return handleSaveKPI(ctx, payload);
      case 'DELETE_KPI':           requireRole(ctx, [ROLES.ADMIN, ROLES.SUPERVISOR]); return handleDeleteKPI(ctx, payload);

      case 'SAVE_USER':            requireRole(ctx, [ROLES.ADMIN]); return handleSaveUser(ctx, payload);
      case 'TOGGLE_USER_STATUS':   requireRole(ctx, [ROLES.ADMIN]); return handleToggleUserStatus(ctx, payload);
      case 'RESET_PASSWORD':       requireRole(ctx, [ROLES.ADMIN]); return handleResetPassword(ctx, payload);

      case 'ENROLL_LANDOWNER':     requireRole(ctx, [ROLES.ADMIN]); return handleEnrollLandowner(ctx, payload);
      case 'SET_BLOCK_STATUS':     requireRole(ctx, [ROLES.ADMIN]); return handleSetBlockStatus(ctx, payload);

      case 'SAVE_ACTIVITY_TYPE':   requireRole(ctx, [ROLES.ADMIN]); return handleSaveActivityType(ctx, payload);
      case 'SET_ACTIVITY_TYPE_STATUS': requireRole(ctx, [ROLES.ADMIN]); return handleSetActivityTypeStatus(ctx, payload);

      case 'SAVE_MAP':             requireRole(ctx, [ROLES.ADMIN]); return handleSaveMap(ctx, payload);
      case 'DELETE_MAP':           requireRole(ctx, [ROLES.ADMIN]); return handleDeleteMap(ctx, payload);

      default:
        return respondJSON({ success: false, error: 'Unrecognized API action: ' + action });
    }
  } catch (fatalError) {
    if (fatalError && fatalError.code === 'FORBIDDEN') {
      return respondJSON({ success: false, code: 'FORBIDDEN', error: fatalError.message });
    }
    return respondJSON({ success: false, error: (fatalError && fatalError.message) || 'Internal Server Error' });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function respondJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/* ==========================================================================
   DATABASE SETUP
   ========================================================================== */

/** Runs the full setup only once (or again when the version changes). */
function ensureDatabaseReady() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DB_READY_VERSION') !== APP_VERSION) {
    setupDatabase();
    props.setProperty('DB_READY_VERSION', APP_VERSION);
  }
}

/**
 * Creates missing sheets, adds missing header columns (never removes or reorders
 * existing ones) and seeds the first Administrator + default dropdowns/settings.
 * You can run this manually from the Apps Script editor.
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  for (var key in SHEET_NAMES) {
    var sheet = ss.getSheetByName(SHEET_NAMES[key]);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAMES[key]);
    ensureHeaders(sheet, HEADERS[key]);
  }

  seedInitialData(ss);
  readCustomActivities(ss).forEach(function (def) { ensureCustomActivitySheet(ss, def); });
  getTokenSecret(); // make sure a signing secret exists
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    styleHeader(sheet, headers.length);
    for (var col = 1; col <= headers.length; col++) sheet.setColumnWidth(col, 150);
    return;
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });

  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    styleHeader(sheet, lastCol + missing.length);
  }
}

function styleHeader(sheet, width) {
  var headerRange = sheet.getRange(1, 1, 1, width);
  headerRange.setBackground('#14532d');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}

/**
 * Seeds ONLY what the system needs to start:
 *  - one Administrator (username: admin / password: admin123, MUST be changed at first login)
 *  - default dropdown options and system settings
 * Land owners, parcels and blocks are now added through Land Owner Enrollment.
 */
function seedInitialData(ss) {
  var nowIso = new Date().toISOString();

  var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  if (usersSheet.getLastRow() <= 1) {
    // SHA-256('admin123') as sent by the browser, then salted on the server
    var clientHash = DEFAULT_PASSWORD_HASH;
    appendObject(usersSheet, {
      'User ID': 'USR-0001',
      'Employee ID': 'EMP-001',
      'Full Name': 'System Administrator',
      'Username': 'admin',
      'Password Hash': makeStoredHash(clientHash),
      'Role': ROLES.ADMIN,
      'Assigned Supervisor': 'None',
      'Assigned Farm and Blocks': 'ALL',
      'Assigned Activities': 'ALL',
      'Account Status': 'Active',
      'Date Created': nowIso,
      'Last Login': '',
      'Must Change Password': 'TRUE',
      'Token Version': 1
    });
  }

  var dropSheet = ss.getSheetByName(SHEET_NAMES.DROPDOWNS);
  if (dropSheet.getLastRow() <= 1) {
    var d = [
      ['Regular Activity', 'Cycle', 'Cycle 1 (Q1)'], ['Regular Activity', 'Cycle', 'Cycle 2 (Q2)'],
      ['Regular Activity', 'Cycle', 'Cycle 3 (Q3)'], ['Regular Activity', 'Cycle', 'Cycle 4 (Q4)'],
      ['Irregular Activity', 'Pest and Disease Treatment (Soil Drench)', 'Imidacloprid Premix 200SL'],
      ['Irregular Activity', 'Pest and Disease Treatment (Soil Drench)', 'Chlorpyrifos 40EC'],
      ['Irregular Activity', 'Pest and Disease Treatment (Soil Drench)', 'Trichoderma Bio-Inoculant'],
      ['Irregular Activity', 'Pest and Disease Treatment (Soil Drench)', 'Bacillus Thuringiensis Drench'],
      ['Irregular Activity', 'Irregular Activity', 'Rhinoceros Beetle Pheromone Trapping'],
      ['Irregular Activity', 'Irregular Activity', 'Crown Cleaning & Sanitation'],
      ['Irregular Activity', 'Irregular Activity', 'Drainage Clearing & Rehabilitation'],
      ['Irregular Activity', 'Irregular Activity', 'Lightning Strike Removal & Burial'],
      ['Other Farm Activity', 'Other Activities', 'Cover Crop Planting (Calopogonium)'],
      ['Other Farm Activity', 'Other Activities', 'Farm Road Maintenance & Grading'],
      ['Other Farm Activity', 'Other Activities', 'Fence Repair & Boundary Marking'],
      ['Other Farm Activity', 'Other Activities', 'Seedling Nursery Bagging & Watering'],
      ['Other Farm Activity', 'Other Activities', 'Coconut Husk Mulching along Basins'],
      ['Other Farm Activity', 'Unit', 'Hectares'], ['Other Farm Activity', 'Unit', 'Palms'],
      ['Other Farm Activity', 'Unit', 'Meters'], ['Other Farm Activity', 'Unit', 'Sacks'],
      ['Other Farm Activity', 'Unit', 'Pieces / Bags'],
      ['Pest and Disease Activity', 'Target Pest', 'Oryctes rhinoceros (Rhinoceros Beetle)'],
      ['Pest and Disease Activity', 'Target Pest', 'Rhynchophorus ferrugineus (Red Palm Weevil)'],
      ['Pest and Disease Activity', 'Target Pest', 'Brontispa longissima (Coconut Leaf Beetle)'],
      ['Pest and Disease Activity', 'Target Pest', 'Phytophthora palmivora (Bud Rot)'],
      ['Pest and Disease Activity', 'Target Pest', 'Cadang-Cadang Viroid Syndrome'],
      ['Pest and Disease Activity', 'Input Used', 'Bio-Metarhizium anisopliae Green Fungus'],
      ['Pest and Disease Activity', 'Input Used', 'Cypermethrin 5EC'],
      ['Pest and Disease Activity', 'Input Used', 'Copper Oxychloride 50WP'],
      ['Pest and Disease Activity', 'Input Used', 'Fosetyl-Alum Drench 80WP'],
      ['Pest and Disease Activity', 'Unit', 'Liters'], ['Pest and Disease Activity', 'Unit', 'Grams'],
      ['Pest and Disease Activity', 'Unit', 'Kilograms'], ['Pest and Disease Activity', 'Unit', 'Milliliters'],
      ['Pest and Disease Activity', 'Method Used', 'Soil Drenching Basal Application'],
      ['Pest and Disease Activity', 'Method Used', 'Crown Spraying with Mist Blower'],
      ['Pest and Disease Activity', 'Method Used', 'Stem Injection (Trunk Infusion)'],
      ['Pest and Disease Activity', 'Method Used', 'Pheromone Trap Bucket Hanging'],
      ['Pest and Disease Activity', 'Target Parts for Application', 'Basal Root Zone (Basin)'],
      ['Pest and Disease Activity', 'Target Parts for Application', 'Spear Leaf and Crown Apex'],
      ['Pest and Disease Activity', 'Target Parts for Application', 'Trunk Lower Cavities'],
      ['Pest and Disease Activity', 'Target Parts for Application', 'Entire Canopy Fronds']
    ];
    var sortCounter = {};
    var rows = d.map(function (r, i) {
      var k = r[0] + '|' + r[1];
      sortCounter[k] = (sortCounter[k] || 0) + 1;
      return ['OPT-' + pad(i + 1, 3), r[0], r[1], r[2], '', sortCounter[k], 'Active'];
    });
    dropSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }

  var settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (settingsSheet.getLastRow() <= 1) {
    settingsSheet.getRange(2, 1, 5, 4).setValues([
      ['workingDaysPerWeek', '6', 'Standard working days per week (Monday to Saturday)', nowIso],
      ['restDays', 'Sunday', 'Weekly scheduled rest days', nowIso],
      ['dailyWorkingHours', '8', 'Daily operational working hours per manpower', nowIso],
      ['holidays', '2026-01-01,2026-04-02,2026-04-03,2026-05-01,2026-06-12,2026-11-30,2026-12-25,2026-12-30', 'Comma separated list of non-working holidays', nowIso],
      ['activeMapVersion', 'v1.0.0', 'Latest published farm map version', nowIso]
    ]);
  }
}

/* ==========================================================================
   AUTHENTICATION, SESSION TOKENS & PASSWORDS
   ========================================================================== */

function getTokenSecret() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('TOKEN_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', secret);
  }
  return secret;
}

function signToken(user) {
  var body = {
    uid: String(user['User ID']),
    tv: parseInt(user['Token Version'], 10) || 1,
    exp: Date.now() + TOKEN_TTL_DAYS * 24 * 3600 * 1000
  };
  var encoded = Utilities.base64EncodeWebSafe(JSON.stringify(body));
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(encoded, getTokenSecret()));
  return encoded + '.' + sig;
}

/** Verifies the token and re-reads the user, so role / status changes apply immediately. */
function authenticate(token) {
  if (!token || String(token).indexOf('.') === -1) {
    return { ok: false, code: 'AUTH_REQUIRED', error: 'Please sign in again (no session).' };
  }
  var parts = String(token).split('.');
  var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], getTokenSecret()));
  if (expected !== parts[1]) {
    return { ok: false, code: 'AUTH_REQUIRED', error: 'Invalid session. Please sign in again.' };
  }

  var body;
  try {
    body = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (e) {
    return { ok: false, code: 'AUTH_REQUIRED', error: 'Invalid session. Please sign in again.' };
  }
  if (!body.exp || Date.now() > body.exp) {
    return { ok: false, code: 'AUTH_EXPIRED', error: 'Your session expired. Please sign in again.' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var users = readObjects(ss.getSheetByName(SHEET_NAMES.USERS));
  var user = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i]['User ID']) === String(body.uid)) { user = users[i]; break; }
  }
  if (!user) return { ok: false, code: 'AUTH_REQUIRED', error: 'User no longer exists.' };
  if (norm(user['Account Status']) !== 'active') {
    return { ok: false, code: 'AUTH_REQUIRED', error: 'Account is deactivated. Please contact your Administrator.' };
  }
  if ((parseInt(user['Token Version'], 10) || 1) !== body.tv) {
    return { ok: false, code: 'AUTH_EXPIRED', error: 'Your password or access was changed. Please sign in again.' };
  }

  var blocks = readObjects(ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS));
  return buildContext(ss, user, users, blocks);
}

function buildContext(ss, user, users, blocks) {
  var role = String(user['Role']);
  var isAdmin = role === ROLES.ADMIN;
  var assignedIds = resolveAssignedBlockIds(user['Assigned Farm and Blocks'], blocks);
  var allowAll = isAdmin || assignedIds === 'ALL';

  var scopeBlocks = blocks.filter(function (b) {
    if (norm(b['Status']) === 'deactivated') return false;
    return allowAll || assignedIds.indexOf(String(b['Block ID'])) !== -1;
  });

  var scopeKeys = {};
  scopeBlocks.forEach(function (b) {
    scopeKeys[blockKey(b['Land Owner Name'], b['Parcel Number'], b['Farm and Block Name'])] = b;
  });

  return {
    ok: true,
    ss: ss,
    user: user,
    users: users,
    blocks: blocks,
    userId: String(user['User ID']),
    role: role,
    isAdmin: isAdmin,
    allowAll: allowAll,
    scopeBlocks: scopeBlocks,
    scopeKeys: scopeKeys,
    activities: parseList(user['Assigned Activities'])
  };
}

function requireRole(ctx, roles) {
  if (roles.indexOf(ctx.role) === -1) {
    var err = new Error('You do not have permission to perform this action.');
    err.code = 'FORBIDDEN';
    throw err;
  }
}

/** Server-side stored hash: v2$salt$hex(stretch(salt + clientSha256)) */
function makeStoredHash(clientHash, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, '');
  var h = String(clientHash);
  for (var i = 0; i < HASH_ROUNDS; i++) {
    h = sha256Hex(salt + h);
  }
  return 'v2$' + salt + '$' + h;
}

function verifyStoredHash(stored, clientHash) {
  stored = String(stored || '');
  if (!clientHash) return false;
  if (stored.indexOf('v2$') === 0) {
    var parts = stored.split('$');
    return makeStoredHash(clientHash, parts[1]) === stored;
  }
  // Legacy (v2.0) unsalted hash — accepted once, then upgraded at login
  return stored.length === 64 && stored === String(clientHash);
}

function sha256Hex(text) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < raw.length; i++) {
    var b = raw[i] < 0 ? raw[i] + 256 : raw[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function isValidClientHash(h) {
  return /^[a-f0-9]{64}$/.test(String(h || ''));
}

function handleLogin(payload) {
  var username = String(payload.username || '').trim().toLowerCase();
  var passwordHash = String(payload.passwordHash || '').trim().toLowerCase();

  if (!username || !passwordHash) {
    return respondJSON({ success: false, error: 'Username and password are required.' });
  }

  var cache = CacheService.getScriptCache();
  var failKey = 'login_fail_' + username;
  var fails = parseInt(cache.get(failKey), 10) || 0;
  if (fails >= MAX_LOGIN_FAILURES) {
    return respondJSON({ success: false, error: 'Too many failed attempts. Please wait 15 minutes and try again.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  var users = readObjects(usersSheet);
  var user = null;
  for (var i = 0; i < users.length; i++) {
    if (norm(users[i]['Username']) === username) { user = users[i]; break; }
  }

  if (!user || !verifyStoredHash(user['Password Hash'], passwordHash)) {
    cache.put(failKey, String(fails + 1), LOGIN_LOCK_SECONDS);
    return respondJSON({ success: false, error: 'Invalid username or password.' });
  }
  if (norm(user['Account Status']) !== 'active') {
    return respondJSON({ success: false, error: 'Account is deactivated. Please contact your Administrator.' });
  }

  cache.remove(failKey);
  var now = new Date().toISOString();
  var updates = { 'Last Login': now };
  if (String(user['Password Hash']).indexOf('v2$') !== 0) {
    updates['Password Hash'] = makeStoredHash(passwordHash); // upgrade legacy hash
  }
  if (passwordHash === DEFAULT_PASSWORD_HASH) {
    updates['Must Change Password'] = 'TRUE'; // anyone still using admin123 must change it
    user['Must Change Password'] = 'TRUE';
  }
  if (!user['Token Version']) {
    updates['Token Version'] = 1;
    user['Token Version'] = 1;
  }
  updateObjectById(usersSheet, 'User ID', user['User ID'], updates);

  var blocks = readObjects(ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS));
  var ctx = buildContext(ss, user, users, blocks);
  var userObj = publicUser(user, blocks, computeBlockSupervisors(users, blocks));
  userObj.lastLogin = now;
  userObj.sessionToken = signToken(user);
  userObj.tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 3600 * 1000).toISOString();
  userObj.assignedBlockDetails = ctx.scopeBlocks.map(publicBlock);

  logAudit(userObj.userId, userObj.role, 'LOGIN', userObj.userId, 'Users', 'User logged in successfully.');

  return respondJSON({ success: true, message: 'Login successful.', user: userObj });
}

function handleChangePassword(ctx, payload) {
  var oldHash = String(payload.oldPasswordHash || '').toLowerCase();
  var newHash = String(payload.newPasswordHash || '').toLowerCase();
  if (!isValidClientHash(newHash)) {
    return respondJSON({ success: false, error: 'Invalid new password.' });
  }
  if (!verifyStoredHash(ctx.user['Password Hash'], oldHash)) {
    return respondJSON({ success: false, error: 'Current password is incorrect.' });
  }
  if (newHash === oldHash) {
    return respondJSON({ success: false, error: 'New password must be different from the current password.' });
  }

  var tv = (parseInt(ctx.user['Token Version'], 10) || 1) + 1;
  var sheet = ctx.ss.getSheetByName(SHEET_NAMES.USERS);
  updateObjectById(sheet, 'User ID', ctx.userId, {
    'Password Hash': makeStoredHash(newHash),
    'Must Change Password': 'FALSE',
    'Token Version': tv
  });
  ctx.user['Token Version'] = tv;

  logAudit(ctx.userId, ctx.role, 'CHANGE_PASSWORD', ctx.userId, 'Users', 'Password changed by user.');
  return respondJSON({ success: true, message: 'Password changed.', sessionToken: signToken(ctx.user) });
}

/* ==========================================================================
   FARM & BLOCK SCOPE HELPERS
   ========================================================================== */

function blockKey(landOwner, parcel, block) {
  return norm(landOwner) + '|' + norm(parcel) + '|' + norm(block);
}

/**
 * Users store Block IDs ("BLK-001, BLK-004"). Older rows may contain block names —
 * those are still accepted and matched by name.
 */
function resolveAssignedBlockIds(raw, blocks) {
  var list = parseList(raw);
  if (list.indexOf('ALL') !== -1) return 'ALL';
  var ids = [];
  list.forEach(function (item) {
    var matchedById = blocks.filter(function (b) { return String(b['Block ID']) === item; });
    var matched = matchedById.length ? matchedById
      : blocks.filter(function (b) { return norm(b['Farm and Block Name']) === norm(item); });
    matched.forEach(function (b) {
      if (ids.indexOf(String(b['Block ID'])) === -1) ids.push(String(b['Block ID']));
    });
  });
  return ids;
}

function isRecordInScope(ctx, rec) {
  if (ctx.allowAll) return true;
  if (String(rec.userId) === ctx.userId) return true; // always see your own records
  if (!rec.farmBlock) return false;
  return !!ctx.scopeKeys[blockKey(rec.landOwnersName, rec.parcelNumber, rec.farmBlock)];
}

function canUseActivity(ctx, activityType) {
  if (ctx.isAdmin) return true;
  if (ctx.activities.indexOf('ALL') !== -1) return true;
  return ctx.activities.some(function (a) { return norm(a) === norm(activityType); });
}

/** Map BlockID -> [supervisor users] based on active Supervisor assignments */
function computeBlockSupervisors(users, blocks) {
  var map = {};
  users.forEach(function (u) {
    if (String(u['Role']) !== ROLES.SUPERVISOR) return;
    if (norm(u['Account Status']) !== 'active') return;
    var ids = resolveAssignedBlockIds(u['Assigned Farm and Blocks'], blocks);
    if (ids === 'ALL') ids = blocks.map(function (b) { return String(b['Block ID']); });
    ids.forEach(function (id) {
      if (!map[id]) map[id] = [];
      map[id].push({ userId: String(u['User ID']), fullName: String(u['Full Name']) });
    });
  });
  return map;
}

/** Supervisors of the given block IDs (unique) */
function supervisorsForBlocks(blockIds, supMap) {
  var out = [];
  var seen = {};
  (blockIds || []).forEach(function (id) {
    (supMap[id] || []).forEach(function (s) {
      if (!seen[s.userId]) { seen[s.userId] = true; out.push(s); }
    });
  });
  return out;
}

/**
 * Writes the auto-detected supervisor onto every block row and every Field Personnel row,
 * so the Google Sheet always shows who supervises what.
 */
function refreshDerivedSupervisors(ss) {
  var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  var blockSheet = ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);
  var users = readObjects(usersSheet);
  var blocks = readObjects(blockSheet);
  var supMap = computeBlockSupervisors(users, blocks);

  // Blocks
  if (blocks.length) {
    var bh = getHeaderIndex(blockSheet);
    var idCol = bh['Supervisor ID'], nameCol = bh['Supervisor Name'];
    if (idCol !== undefined && nameCol !== undefined) {
      var ids = [], names = [];
      blocks.forEach(function (b) {
        var sups = supMap[String(b['Block ID'])] || [];
        ids.push([sups.map(function (s) { return s.userId; }).join(', ')]);
        names.push([sups.map(function (s) { return s.fullName; }).join(', ') || 'Unassigned']);
      });
      blockSheet.getRange(2, idCol + 1, ids.length, 1).setValues(ids);
      blockSheet.getRange(2, nameCol + 1, names.length, 1).setValues(names);
    }
  }

  // Field personnel
  if (users.length) {
    var uh = getHeaderIndex(usersSheet);
    var supCol = uh['Assigned Supervisor'];
    if (supCol !== undefined) {
      var col = users.map(function (u) {
        if (String(u['Role']) !== ROLES.FIELD) return [u['Assigned Supervisor'] || 'None'];
        var ids = resolveAssignedBlockIds(u['Assigned Farm and Blocks'], blocks);
        if (ids === 'ALL') ids = blocks.map(function (b) { return String(b['Block ID']); });
        var sups = supervisorsForBlocks(ids, supMap);
        return [sups.length ? sups.map(function (s) { return s.fullName; }).join(', ') : 'None'];
      });
      usersSheet.getRange(2, supCol + 1, col.length, 1).setValues(col);
    }
  }
}

function publicBlock(b) {
  return {
    blockId: String(b['Block ID']),
    farmBlockName: String(b['Farm and Block Name']),
    parcelId: String(b['Parcel ID']),
    parcelNumber: String(b['Parcel Number']),
    landOwnerId: String(b['Land Owner ID']),
    landOwnerName: String(b['Land Owner Name']),
    areaHa: parseFloat(b['Area Ha']) || 0,
    palmCount: parseInt(b['Palm Count'], 10) || 0,
    status: String(b['Status'] || 'Active')
  };
}

/** User object safe to send to the browser (NO password hash). */
function publicUser(u, blocks, supMap) {
  var ids = resolveAssignedBlockIds(u['Assigned Farm and Blocks'], blocks);
  var supervisor = String(u['Assigned Supervisor'] || 'None');
  if (String(u['Role']) === ROLES.FIELD && supMap) {
    var blockIds = ids === 'ALL' ? blocks.map(function (b) { return String(b['Block ID']); }) : ids;
    var sups = supervisorsForBlocks(blockIds, supMap);
    supervisor = sups.length ? sups.map(function (s) { return s.fullName; }).join(', ') : 'None';
  }
  return {
    userId: String(u['User ID']),
    employeeId: String(u['Employee ID'] || ''),
    fullName: String(u['Full Name'] || ''),
    username: String(u['Username'] || ''),
    role: String(u['Role'] || ''),
    assignedSupervisor: supervisor,
    assignedFarmAndBlocks: ids === 'ALL' ? ['ALL'] : ids,
    assignedActivities: parseList(u['Assigned Activities']),
    accountStatus: String(u['Account Status'] || ''),
    dateCreated: String(u['Date Created'] || ''),
    lastLogin: String(u['Last Login'] || ''),
    mustChangePassword: norm(u['Must Change Password']) === 'true'
  };
}

/* ==========================================================================
   BOOTSTRAP (master data, scoped by Farm & Block)
   ========================================================================== */

function handleGetBootstrapData(ctx) {
  var ss = ctx.ss;
  var supMap = computeBlockSupervisors(ctx.users, ctx.blocks);

  var sourceBlocks = ctx.isAdmin ? ctx.blocks : ctx.scopeBlocks;
  var blocks = sourceBlocks.map(function (b) {
    var pb = publicBlock(b);
    var sups = supMap[pb.blockId] || [];
    pb.supervisorIds = sups.map(function (s) { return s.userId; });
    pb.supervisorNames = sups.map(function (s) { return s.fullName; });
    pb.supervisorName = pb.supervisorNames.join(', ') || 'Unassigned';
    return pb;
  });

  var landOwnerNames = {};
  var parcelKeys = {};
  sourceBlocks.forEach(function (b) {
    landOwnerNames[norm(b['Land Owner Name'])] = true;
    parcelKeys[norm(b['Land Owner Name']) + '|' + norm(b['Parcel Number'])] = true;
  });

  var landowners = readObjects(ss.getSheetByName(SHEET_NAMES.LANDOWNERS))
    .filter(function (l) { return ctx.isAdmin || landOwnerNames[norm(l['Land Owner Name'])]; })
    .map(function (l) {
      return {
        landOwnerId: String(l['Land Owner ID']),
        landOwnerName: String(l['Land Owner Name']),
        contactPerson: String(l['Contact Person'] || ''),
        phone: String(l['Phone'] || ''),
        totalHectares: parseFloat(l['Total Hectares']) || 0,
        status: String(l['Status'] || 'Active'),
        dateEnrolled: String(l['Date Enrolled'] || '')
      };
    });

  var parcels = readObjects(ss.getSheetByName(SHEET_NAMES.PARCELS))
    .filter(function (p) { return ctx.isAdmin || parcelKeys[norm(p['Land Owner Name']) + '|' + norm(p['Parcel Number'])]; })
    .map(function (p) {
      return {
        parcelId: String(p['Parcel ID']),
        parcelNumber: String(p['Parcel Number']),
        landOwnerId: String(p['Land Owner ID']),
        landOwnerName: String(p['Land Owner Name']),
        totalAreaHa: parseFloat(p['Total Area Ha']) || 0,
        totalPalms: parseInt(p['Total Palms'], 10) || 0,
        status: String(p['Status'] || 'Active')
      };
    });

  var kpis = readObjects(ss.getSheetByName(SHEET_NAMES.KPIS))
    .filter(function (k) { return norm(k['Status']) !== 'deactivated'; })
    .filter(function (k) { return ctx.allowAll || ctx.scopeKeys[blockKey(k['Land Owner'], k['Parcel Number'], k['Farm & Block'])]; })
    .map(function (k) {
      return {
        kpiId: String(k['KPI ID']),
        activityType: String(k['Activity Type']),
        farmBlock: String(k['Farm & Block']),
        landOwner: String(k['Land Owner']),
        parcelNumber: String(k['Parcel Number']),
        cycle: String(k['Cycle'] || ''),
        targetQuantity: parseFloat(k['Target Quantity']) || 0,
        targetUnit: String(k['Target Unit'] || ''),
        requiredManpower: parseInt(k['Required Manpower'], 10) || 1,
        targetWorkingDays: parseInt(k['Target Working Days'], 10) || 1,
        dailyExpectedAccomplishment: parseFloat(k['Daily Expected Accomplishment']) || 0,
        effectiveDate: String(k['Effective Date'] || ''),
        status: String(k['Status'] || 'Active')
      };
    });

  var dropdowns = readObjects(ss.getSheetByName(SHEET_NAMES.DROPDOWNS))
    .filter(function (d) { return norm(d['Status']) !== 'deactivated'; })
    .map(function (d) {
      return {
        optionId: String(d['Option ID']),
        activityType: String(d['Activity Type']),
        dropdownCategory: String(d['Dropdown Category']),
        optionValue: String(d['Option Value']),
        parentValue: String(d['Parent Value'] || ''),
        sortOrder: parseInt(d['Sort Order'], 10) || 1,
        status: String(d['Status'] || 'Active')
      };
    });

  var maps = readObjects(ss.getSheetByName(SHEET_NAMES.MAPS))
    .filter(function (m) { return norm(m['Status']) === 'active'; })
    .filter(function (m) { return ctx.isAdmin || !m['Land Owner'] || landOwnerNames[norm(m['Land Owner'])]; })
    .map(function (m) {
      var geo = {};
      try { geo = JSON.parse(readMapGeoText(ss, m)); } catch (e) { geo = {}; }
      return {
        mapId: String(m['Map ID']),
        title: String(m['Map Title']),
        version: String(m['Version']),
        landOwner: String(m['Land Owner'] || ''),
        parcelNumber: String(m['Parcel Number'] || ''),
        farmBlock: String(m['Farm & Block'] || ''),
        fileType: String(m['File Type'] || 'GeoJSON'),
        geoJson: geo,
        uploadDate: String(m['Upload Date'] || ''),
        status: 'Installed'
      };
    });

  var settings = {};
  readObjects(ss.getSheetByName(SHEET_NAMES.SETTINGS)).forEach(function (s) {
    settings[String(s['Key'])] = String(s['Value']);
  });

  // User directory (never includes password hashes)
  var users;
  if (ctx.isAdmin) {
    users = ctx.users.map(function (u) { return publicUser(u, ctx.blocks, supMap); });
  } else {
    var myBlockIds = ctx.scopeBlocks.map(function (b) { return String(b['Block ID']); });
    users = ctx.users.filter(function (u) {
      if (String(u['User ID']) === ctx.userId) return true;
      if (norm(u['Account Status']) !== 'active') return false;
      var ids = resolveAssignedBlockIds(u['Assigned Farm and Blocks'], ctx.blocks);
      if (ids === 'ALL') return false;
      return ids.some(function (id) { return myBlockIds.indexOf(id) !== -1; });
    }).map(function (u) { return publicUser(u, ctx.blocks, supMap); });
  }

  var me = publicUser(ctx.user, ctx.blocks, supMap);
  me.assignedBlockDetails = ctx.scopeBlocks.map(publicBlock);

  return respondJSON({
    success: true,
    me: me,
    users: users,
    landowners: landowners,
    parcels: parcels,
    farmsAndBlocks: blocks,
    dropdowns: dropdowns,
    kpis: kpis,
    maps: maps,
    settings: settings,
    devices: ctx.isAdmin ? readObjects(ss.getSheetByName(SHEET_NAMES.DEVICES)) : [],
    customActivities: readCustomActivities(ss)
      .filter(function (d) { return ctx.isAdmin || d.status === 'Active'; })
      .map(function (d) { return publicActivityDef(d); }),
    timestamp: new Date().toISOString()
  });
}

/* ==========================================================================
   REPORT SYNCHRONIZATION (idempotent by UUID, validated per user scope)
   ========================================================================== */

function handleSyncReportsBatch(ctx, payload) {
  var records = payload.records || [];
  var device = payload.device || {};
  var batchId = String(payload.batchId || Utilities.getUuid());

  if (!records.length) {
    return respondJSON({ success: true, count: 0, syncedIds: [], rejected: [], message: 'No records to synchronize.' });
  }
  if (records.length > 500) {
    return respondJSON({ success: false, error: 'Batch too large. Please sync at most 500 records at a time.' });
  }

  var ss = ctx.ss;
  var serverTimestamp = new Date().toISOString();
  var supMap = computeBlockSupervisors(ctx.users, ctx.blocks);
  var syncedIds = [];
  var rejected = [];   // permanent errors (will never succeed) -> client stops retrying
  var errors = [];

  var sheetCache = {};
  var customDefs = readCustomActivities(ss);

  for (var i = 0; i < records.length; i++) {
    var rec = records[i] || {};
    var reportId = String(rec.reportId || '');
    try {
      var actType = String(rec.activityType || '');
      var sheetName = ACTIVITY_SHEETS[actType];
      var customDef = null;
      if (!sheetName) {
        customDef = findCustomDef(customDefs, rec.customActivityId, actType);
        if (!customDef) throw permanent('Unknown activity type: ' + actType);
        if (customDef.status !== 'Active') throw permanent('Activity "' + actType + '" is deactivated.');
        sheetName = customDef.sheetName;
        actType = customDef.name;
        rec.activityType = customDef.name;
      }
      if (!reportId) throw permanent('Missing report ID.');

      if (!ctx.isAdmin && String(rec.userId) !== ctx.userId) {
        throw permanent('Report belongs to another user. Sign in as that user to sync it.');
      }
      if (!canUseActivity(ctx, actType)) {
        throw permanent('You are not assigned to "' + actType + '".');
      }

      var block = null;
      if (rec.farmBlock) {
        block = ctx.scopeKeys[blockKey(rec.landOwnersName, rec.parcelNumber, rec.farmBlock)];
        if (!block && !ctx.allowAll) throw permanent('Farm & Block "' + rec.farmBlock + '" is not assigned to you.');
      } else if (!ctx.allowAll && actType !== 'Seednut Collection') {
        throw permanent('Farm & Block is required.');
      }

      // Server-controlled fields
      var owner = ctx.isAdmin && rec.userId ? findUser(ctx.users, rec.userId) : ctx.user;
      rec.userId = owner ? String(owner['User ID']) : ctx.userId;
      rec.employeeName = owner ? String(owner['Full Name']) : String(rec.employeeName || '');
      var sups = block ? (supMap[String(block['Block ID'])] || []) : [];
      rec.supervisorId = sups.map(function (s) { return s.userId; }).join(', ');
      rec.uniqueUuid = String(rec.uniqueUuid || reportId);
      rec.deviceId = rec.deviceId || device.deviceId || '';
      rec.deviceName = rec.deviceName || device.deviceName || '';
      rec.browserOs = rec.browserOs || device.browserOs || '';
      rec.serverTimestamp = serverTimestamp;
      rec.syncStatus = 'SENT';
      if (actType === 'Palm Category Activity') {
        rec.timestamp = rec.timestamp || serverTimestamp;
        rec.date = rec.date || String(rec.timestamp).substring(0, 10);
      }

      if (!sheetCache[sheetName]) {
        sheetCache[sheetName] = customDef ? ensureCustomActivitySheet(ss, customDef) : ss.getSheetByName(sheetName);
      }
      upsertReport(ctx, sheetCache[sheetName], rec, customDef);
      syncedIds.push(reportId);
    } catch (recErr) {
      var msg = 'Record ' + reportId + ': ' + recErr.message;
      if (recErr.permanent) rejected.push({ reportId: reportId, error: recErr.message });
      errors.push(msg);
    }
  }

  registerDeviceInternal(ss, device, ctx.user, syncedIds.length);

  appendObject(ss.getSheetByName(SHEET_NAMES.SYNC_LOGS), {
    'Log ID': 'SYNC-' + Date.now(),
    'Batch ID': batchId,
    'User ID': ctx.userId,
    'Device ID': device.deviceId || 'Unknown',
    'Records Count': syncedIds.length,
    'Status': errors.length === 0 ? 'Success' : 'Partial / With Errors',
    'Error Message': errors.join('; ').substring(0, 45000),
    'Timestamp': serverTimestamp
  });

  return respondJSON({
    success: true,
    batchId: batchId,
    syncedIds: syncedIds,
    rejected: rejected,
    errors: errors,
    serverTimestamp: serverTimestamp,
    message: 'Synchronized ' + syncedIds.length + ' report(s).' + (errors.length ? ' ' + errors.length + ' with errors.' : '')
  });
}

function permanent(message) {
  var e = new Error(message);
  e.permanent = true;
  return e;
}

function findUser(users, userId) {
  for (var i = 0; i < users.length; i++) {
    if (String(users[i]['User ID']) === String(userId)) return users[i];
  }
  return null;
}

/** Insert or update a report by Unique UUID. A user can never overwrite someone else's row. */
function upsertReport(ctx, sheet, rec, customDef) {
  var headers = getHeaders(sheet);
  var hIdx = getHeaderIndex(sheet);
  var uuidCol = hIdx['Unique UUID'];
  var userCol = hIdx['User ID'];

  var customByHeader = {};
  if (customDef) customDef.fields.forEach(function (fd) { customByHeader[fd.header] = fd; });
  var customValues = rec.customFields || {};

  var row = headers.map(function (h) {
    var cf = customByHeader[h];
    if (cf) {
      var cv = customValues[cf.key];
      if (cf.type === 'number') return (cv === '' || cv === null || cv === undefined || isNaN(parseFloat(cv))) ? '' : parseFloat(cv);
      return safeText(cv === undefined || cv === null ? '' : cv);
    }
    var f = REPORT_FIELDS[h];
    if (!f) return '';
    var v = rec[f[0]];
    if (f[1] === 'n') return toNumber(v);
    if (f[1] === 'g') return (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? '' : parseFloat(v);
    return safeText(v);
  });

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var existing = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][uuidCol]) === String(rec.uniqueUuid)) {
        if (!ctx.isAdmin && String(existing[i][userCol]) !== ctx.userId) {
          throw permanent('Duplicate UUID owned by another user.');
        }
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(row);
}

/* ==========================================================================
   REPORTS QUERY (scoped) — returns frontend field names
   ========================================================================== */

function readReports(ctx, activityFilter) {
  var all = [];
  readCustomActivities(ctx.ss).forEach(function (def) {
    if (activityFilter && activityFilter !== 'All' && activityFilter !== def.name) return;
    var sheet = ctx.ss.getSheetByName(def.sheetName);
    var byHeader = {};
    def.fields.forEach(function (fd) { byHeader[fd.header] = fd; });
    readObjects(sheet).forEach(function (row) {
      var rec = { activityType: def.name, customActivityId: def.id, customFields: {} };
      for (var h in row) {
        if (byHeader[h]) {
          var fd = byHeader[h];
          rec.customFields[fd.key] = fd.type === 'number' ? (row[h] === '' ? '' : toNumber(row[h])) : String(row[h]);
          continue;
        }
        var f = REPORT_FIELDS[h];
        if (!f) continue;
        var raw = row[h];
        if (f[1] === 'n') rec[f[0]] = toNumber(raw);
        else if (f[1] === 'g') rec[f[0]] = raw === '' ? '' : toNumber(raw);
        else rec[f[0]] = String(raw);
      }
      if (def.kpiField) rec.kpiValue = toNumber(rec.customFields[def.kpiField]);
      if (isRecordInScope(ctx, rec)) all.push(rec);
    });
  });
  for (var typeName in ACTIVITY_SHEETS) {
    if (activityFilter && activityFilter !== 'All' && activityFilter !== typeName) continue;
    var sheet = ctx.ss.getSheetByName(ACTIVITY_SHEETS[typeName]);
    var rows = readObjects(sheet);
    for (var r = 0; r < rows.length; r++) {
      var rec = { activityType: typeName };
      for (var h in rows[r]) {
        var f = REPORT_FIELDS[h];
        if (!f) continue;
        var raw = rows[r][h];
        if (f[1] === 'n') rec[f[0]] = toNumber(raw);
        else if (f[1] === 'g') rec[f[0]] = raw === '' ? '' : toNumber(raw);
        else rec[f[0]] = String(raw);
      }
      if (!rec.date && rec.timestamp) rec.date = String(rec.timestamp).substring(0, 10);
      if (isRecordInScope(ctx, rec)) all.push(rec);
    }
  }
  return all;
}

function handleGetReports(ctx, payload) {
  var filters = payload.filters || {};
  var records = readReports(ctx, filters.activityType || 'All').filter(function (rec) {
    if (filters.startDate && rec.date && rec.date < filters.startDate) return false;
    if (filters.endDate && rec.date && rec.date > filters.endDate) return false;
    if (filters.landOwner && norm(rec.landOwnersName) !== norm(filters.landOwner)) return false;
    if (filters.parcelNumber && norm(rec.parcelNumber) !== norm(filters.parcelNumber)) return false;
    if (filters.farmBlock && norm(rec.farmBlock) !== norm(filters.farmBlock)) return false;
    if (filters.employee && String(rec.userId) !== String(filters.employee)) return false;
    return true;
  });

  // Keep the response size reasonable: newest first, max 5000
  records.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  var limit = Math.min(parseInt(filters.limit, 10) || 5000, 5000);

  return respondJSON({ success: true, count: records.length, records: records.slice(0, limit) });
}

/* ==========================================================================
   KPI MONITORING (scoped)
   ========================================================================== */

/** Which report field counts toward a KPI. Returns null when the report does not apply. */
function kpiValueForReport(kpi, rec) {
  var t = norm(kpi.activityType);
  var a = rec.activityType;
  if (rec.customActivityId) return norm(a) === t && rec.kpiValue !== undefined ? rec.kpiValue : null;
  if (t.indexOf('slashing') !== -1 || t.indexOf('weeding / slashing') !== -1) return a === 'Regular Activity' ? rec.weedingSlashingHa : null;
  if (t.indexOf('round weeding') !== -1) return a === 'Regular Activity' ? rec.roundWeedingPalms : null;
  if (t.indexOf('compost') !== -1) return a === 'Regular Activity' ? rec.compostPalms : null;
  if (t.indexOf('pruning') !== -1) return a === 'Regular Activity' ? rec.pruningPalms : null;
  if (t.indexOf('soil drench') !== -1) return a === 'Regular Activity' ? rec.soilDrenchingPalms : null;
  if (t.indexOf('seednut') !== -1) return a === 'Seednut Collection' ? rec.nutCountCollected : null;
  if (t.indexOf('pest') !== -1 || t.indexOf('disease') !== -1) return a === 'Pest and Disease Activity' ? rec.totalPalmsAffected : null;
  if (a === 'Other Farm Activity' && norm(rec.otherActivities) === t) return rec.quantity;
  if (a === 'Irregular Activity' && norm(rec.irregularActivity) === t) return rec.countOfPalms2;
  return null;
}

function handleGetMonitoring(ctx) {
  var kpis = readObjects(ctx.ss.getSheetByName(SHEET_NAMES.KPIS))
    .filter(function (k) { return norm(k['Status']) !== 'deactivated'; })
    .filter(function (k) { return ctx.allowAll || ctx.scopeKeys[blockKey(k['Land Owner'], k['Parcel Number'], k['Farm & Block'])]; });
  var reports = readReports(ctx, 'All');

  var monitoring = kpis.map(function (k) {
    var kpi = {
      activityType: String(k['Activity Type'] || ''),
      landOwner: String(k['Land Owner'] || ''),
      parcelNumber: String(k['Parcel Number'] || ''),
      farmBlock: String(k['Farm & Block'] || ''),
      cycle: String(k['Cycle'] || '')
    };
    var targetQty = parseFloat(k['Target Quantity']) || 0;
    var targetDays = parseFloat(k['Target Working Days']) || 1;
    var dailyExpected = parseFloat(k['Daily Expected Accomplishment']) || (targetQty / targetDays);

    var total = 0, totalMan = 0, latestVal = 0, latestDate = '';
    reports.forEach(function (r) {
      if (kpi.landOwner && norm(r.landOwnersName) !== norm(kpi.landOwner)) return;
      if (kpi.parcelNumber && norm(r.parcelNumber) !== norm(kpi.parcelNumber)) return;
      if (kpi.farmBlock && norm(r.farmBlock) !== norm(kpi.farmBlock)) return;
      if (kpi.cycle && r.cycle && norm(r.cycle) !== norm(kpi.cycle)) return; // cycle now respected
      var val = kpiValueForReport(kpi, r);
      if (val === null || val === undefined) return;
      val = toNumber(val);
      if (!val) return;
      total += val;
      totalMan += toNumber(r.manpower || r.manpowerCount || r.countOfManpower2) || 1;
      if (String(r.date) >= latestDate) { latestDate = String(r.date); latestVal = val; }
    });

    var pct = targetQty > 0 ? (total / targetQty) * 100 : 0;
    var remaining = Math.max(0, targetQty - total);
    var productivity = totalMan > 0 ? total / totalMan : 0;
    var daysToComplete = dailyExpected > 0 ? Math.ceil(remaining / dailyExpected) : 0;

    // Status compares actual progress to where the KPI should be by today
    var status = 'Not Started';
    if (targetQty > 0 && total >= targetQty) {
      status = 'Completed';
    } else if (total > 0) {
      var effective = k['Effective Date'] ? new Date(String(k['Effective Date'])) : null;
      var elapsedDays = effective && !isNaN(effective) ? Math.max(1, Math.ceil((Date.now() - effective.getTime()) / 86400000)) : targetDays;
      var expectedByNow = Math.min(targetQty, dailyExpected * Math.min(elapsedDays, targetDays));
      var ratio = expectedByNow > 0 ? total / expectedByNow : 1;
      if (ratio >= 1.1) status = 'Ahead of Schedule';
      else if (ratio >= 0.9) status = 'On Track';
      else status = 'Behind Schedule';
    }

    return {
      kpiId: String(k['KPI ID']),
      activityType: kpi.activityType,
      landOwner: kpi.landOwner,
      parcelNumber: kpi.parcelNumber,
      farmBlock: kpi.farmBlock,
      cycle: kpi.cycle,
      targetQuantity: targetQty,
      targetUnit: String(k['Target Unit'] || ''),
      dailyAccomplishment: latestVal,
      cumulativeAccomplishment: total,
      remainingTarget: remaining,
      actualManpower: totalMan,
      dailyProductivity: Math.round(productivity * 100) / 100,
      kpiPercentage: Math.round(pct * 10) / 10,
      expectedDaysToComplete: daysToComplete,
      latestDate: latestDate,
      status: status
    };
  });

  return respondJSON({ success: true, monitoring: monitoring });
}

/* ==========================================================================
   LAND OWNER ENROLLMENT (Land Owner Name + Parcel Number + Farm & Block)
   ========================================================================== */

function handleEnrollLandowner(ctx, payload) {
  var data = payload.enrollment || {};
  var landOwnerName = cleanName(data.landOwnerName);
  var parcelNumber = cleanName(data.parcelNumber);
  var blockNames = (Array.isArray(data.farmBlocks) ? data.farmBlocks : String(data.farmBlock || '').split(','))
    .map(cleanName)
    .filter(function (b) { return b; });

  if (!landOwnerName) return respondJSON({ success: false, error: 'Land Owner Name is required.' });
  if (!parcelNumber) return respondJSON({ success: false, error: 'Parcel Number is required.' });
  if (!blockNames.length) return respondJSON({ success: false, error: 'At least one Farm & Block is required.' });

  var ss = ctx.ss;
  var now = new Date().toISOString();
  var landSheet = ss.getSheetByName(SHEET_NAMES.LANDOWNERS);
  var parcelSheet = ss.getSheetByName(SHEET_NAMES.PARCELS);
  var blockSheet = ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);

  // 1) Land owner: reuse if the name already exists
  var landowners = readObjects(landSheet);
  var land = landowners.filter(function (l) { return norm(l['Land Owner Name']) === norm(landOwnerName); })[0];
  var createdLand = false;
  if (!land) {
    land = {
      'Land Owner ID': nextId(landowners, 'Land Owner ID', 'LND-', 3),
      'Land Owner Name': landOwnerName,
      'Contact Person': '', 'Phone': '', 'Total Hectares': '',
      'Status': 'Active',
      'Date Enrolled': now
    };
    appendObject(landSheet, land);
    createdLand = true;
  } else if (norm(land['Status']) === 'deactivated') {
    updateObjectById(landSheet, 'Land Owner ID', land['Land Owner ID'], { 'Status': 'Active' });
  }
  landOwnerName = String(land['Land Owner Name']); // keep the original spelling

  // 2) Parcel: reuse if this land owner already has the parcel number
  var parcels = readObjects(parcelSheet);
  var parcel = parcels.filter(function (p) {
    return norm(p['Land Owner Name']) === norm(landOwnerName) && norm(p['Parcel Number']) === norm(parcelNumber);
  })[0];
  var createdParcel = false;
  if (!parcel) {
    parcel = {
      'Parcel ID': nextId(parcels, 'Parcel ID', 'PRC-', 3),
      'Parcel Number': parcelNumber,
      'Land Owner ID': land['Land Owner ID'],
      'Land Owner Name': landOwnerName,
      'Total Area Ha': '', 'Total Palms': '',
      'Status': 'Active',
      'Date Enrolled': now
    };
    appendObject(parcelSheet, parcel);
    createdParcel = true;
  } else if (norm(parcel['Status']) === 'deactivated') {
    updateObjectById(parcelSheet, 'Parcel ID', parcel['Parcel ID'], { 'Status': 'Active' });
  }
  parcelNumber = String(parcel['Parcel Number']);

  // 3) Farm & Blocks inside that parcel
  var blocks = readObjects(blockSheet);
  var created = [], reactivated = [], duplicates = [];
  blockNames.forEach(function (name) {
    var existing = blocks.filter(function (b) {
      return blockKey(b['Land Owner Name'], b['Parcel Number'], b['Farm and Block Name']) === blockKey(landOwnerName, parcelNumber, name);
    })[0];
    if (existing) {
      if (norm(existing['Status']) === 'deactivated') {
        updateObjectById(blockSheet, 'Block ID', existing['Block ID'], { 'Status': 'Active' });
        reactivated.push(name);
      } else {
        duplicates.push(name);
      }
      return;
    }
    var newBlock = {
      'Block ID': nextId(blocks, 'Block ID', 'BLK-', 3),
      'Farm and Block Name': name,
      'Parcel ID': parcel['Parcel ID'],
      'Parcel Number': parcelNumber,
      'Land Owner ID': land['Land Owner ID'],
      'Land Owner Name': landOwnerName,
      'Area Ha': '', 'Palm Count': '',
      'Status': 'Active',
      'Supervisor ID': '', 'Supervisor Name': 'Unassigned',
      'Date Enrolled': now
    };
    appendObject(blockSheet, newBlock);
    blocks.push(newBlock);
    created.push(name);
  });

  if (!created.length && !reactivated.length) {
    return respondJSON({ success: false, error: 'Already enrolled: ' + duplicates.join(', ') + ' under ' + landOwnerName + ' / ' + parcelNumber + '.' });
  }

  refreshDerivedSupervisors(ss);
  logAudit(ctx.userId, ctx.role, 'ENROLL_LANDOWNER', land['Land Owner ID'], 'LandOwners',
    landOwnerName + ' / ' + parcelNumber + ' / ' + created.concat(reactivated).join(', '));

  var msg = 'Enrolled ' + landOwnerName + ' › ' + parcelNumber + ' › ' + created.concat(reactivated).join(', ') + '.';
  if (duplicates.length) msg += ' Skipped (already enrolled): ' + duplicates.join(', ') + '.';

  return respondJSON({
    success: true,
    message: msg,
    createdLandOwner: createdLand,
    createdParcel: createdParcel,
    createdBlocks: created,
    reactivatedBlocks: reactivated,
    skipped: duplicates
  });
}

function handleSetBlockStatus(ctx, payload) {
  var blockId = String(payload.blockId || '');
  var status = payload.status === 'Active' ? 'Active' : 'Deactivated';
  var sheet = ctx.ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);
  if (!updateObjectById(sheet, 'Block ID', blockId, { 'Status': status })) {
    return respondJSON({ success: false, error: 'Farm & Block not found.' });
  }
  refreshDerivedSupervisors(ctx.ss);
  logAudit(ctx.userId, ctx.role, 'SET_BLOCK_STATUS', blockId, 'FarmsAndBlocks', 'Status: ' + status);
  return respondJSON({ success: true, message: 'Farm & Block ' + (status === 'Active' ? 'reactivated' : 'deactivated') + '.' });
}

/* ==========================================================================
   USER MANAGEMENT (Administrator only)
   ========================================================================== */

function handleSaveUser(ctx, payload) {
  var ss = ctx.ss;
  var sheet = ss.getSheetByName(SHEET_NAMES.USERS);
  var data = payload.userData || {};
  var users = ctx.users;
  var blocks = ctx.blocks;

  var isNew = !data.userId;
  var existing = isNew ? null : findUser(users, data.userId);
  if (!isNew && !existing) return respondJSON({ success: false, error: 'User not found.' });

  var username = String(data.username || (existing && existing['Username']) || '').trim().toLowerCase();
  var fullName = cleanName(data.fullName || (existing && existing['Full Name']));
  var role = String(data.role || (existing && existing['Role']) || ROLES.FIELD);

  if (!username || !/^[a-z0-9._-]{3,30}$/.test(username)) {
    return respondJSON({ success: false, error: 'Username must be 3-30 characters (letters, numbers, . _ -).' });
  }
  if (!fullName) return respondJSON({ success: false, error: 'Full Name is required.' });
  if ([ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.FIELD].indexOf(role) === -1) {
    return respondJSON({ success: false, error: 'Invalid role.' });
  }
  var taken = users.some(function (u) {
    return norm(u['Username']) === username && (isNew || String(u['User ID']) !== String(data.userId));
  });
  if (taken) return respondJSON({ success: false, error: 'Username "' + username + '" is already used.' });

  if (isNew && !isValidClientHash(data.passwordHash)) {
    return respondJSON({ success: false, error: 'A password is required for a new user.' });
  }

  // Farm & Block assignment (Block IDs). Administrators always get ALL.
  var blockIds;
  if (role === ROLES.ADMIN) {
    blockIds = 'ALL';
  } else {
    var requested = Array.isArray(data.assignedFarmAndBlocks) ? data.assignedFarmAndBlocks : parseList(data.assignedFarmAndBlocks);
    blockIds = resolveAssignedBlockIds(requested.join(','), blocks);
    if (blockIds === 'ALL') {
      return respondJSON({ success: false, error: 'Only Administrators can have ALL Farm & Blocks. Please select specific blocks.' });
    }
    if (!blockIds.length) {
      return respondJSON({ success: false, error: 'Please assign at least one Farm & Block.' });
    }
  }

  // One supervisor per Farm & Block, so the supervisor can be found automatically
  if (role === ROLES.SUPERVISOR) {
    var supMap = computeBlockSupervisors(users, blocks);
    var conflicts = [];
    blockIds.forEach(function (id) {
      (supMap[id] || []).forEach(function (s) {
        if (s.userId !== String(data.userId || '')) {
          var b = blocks.filter(function (x) { return String(x['Block ID']) === id; })[0];
          conflicts.push((b ? b['Farm and Block Name'] : id) + ' (already supervised by ' + s.fullName + ')');
        }
      });
    });
    if (conflicts.length) {
      return respondJSON({ success: false, error: 'Each Farm & Block can only have one supervisor: ' + conflicts.join('; ') });
    }
  }

  var activities = role === ROLES.ADMIN ? ['ALL'] :
    (Array.isArray(data.assignedActivities) ? data.assignedActivities : parseList(data.assignedActivities))
      .filter(function (a) { return a === 'ALL' || allActivityNames(ss).indexOf(a) !== -1; });
  if (!activities.length) activities = ['ALL'];

  var userId = isNew ? 'USR-' + Date.now() : String(data.userId);
  var obj = {
    'User ID': userId,
    'Employee ID': safeText(data.employeeId !== undefined ? data.employeeId : (existing ? existing['Employee ID'] : '')),
    'Full Name': safeText(fullName),
    'Username': username,
    'Role': role,
    'Assigned Farm and Blocks': blockIds === 'ALL' ? 'ALL' : blockIds.join(', '),
    'Assigned Activities': activities.join(', '),
    'Account Status': data.accountStatus || (existing ? existing['Account Status'] : 'Active')
  };

  var roleOrScopeChanged = existing && (
    String(existing['Role']) !== role ||
    String(existing['Account Status']) !== obj['Account Status']
  );

  if (isNew) {
    obj['Password Hash'] = makeStoredHash(String(data.passwordHash).toLowerCase());
    obj['Date Created'] = new Date().toISOString();
    obj['Last Login'] = '';
    obj['Must Change Password'] = 'TRUE';
    obj['Token Version'] = 1;
    obj['Assigned Supervisor'] = 'None';
    appendObject(sheet, obj);
  } else {
    if (roleOrScopeChanged) obj['Token Version'] = (parseInt(existing['Token Version'], 10) || 1) + 1;
    updateObjectById(sheet, 'User ID', userId, obj);
  }

  refreshDerivedSupervisors(ss);
  logAudit(ctx.userId, ctx.role, 'SAVE_USER', userId, 'Users', (isNew ? 'Created ' : 'Updated ') + username + ' (' + role + ')');

  return respondJSON({ success: true, userId: userId, message: 'User saved successfully.' });
}

function handleToggleUserStatus(ctx, payload) {
  var userId = String(payload.userId || '');
  var newStatus = payload.newStatus === 'Active' ? 'Active' : 'Deactivated';
  if (userId === ctx.userId && newStatus !== 'Active') {
    return respondJSON({ success: false, error: 'You cannot deactivate your own account.' });
  }
  var target = findUser(ctx.users, userId);
  if (!target) return respondJSON({ success: false, error: 'User not found.' });

  var sheet = ctx.ss.getSheetByName(SHEET_NAMES.USERS);
  updateObjectById(sheet, 'User ID', userId, {
    'Account Status': newStatus,
    'Token Version': (parseInt(target['Token Version'], 10) || 1) + 1   // signs the user out everywhere
  });
  refreshDerivedSupervisors(ctx.ss);
  logAudit(ctx.userId, ctx.role, 'TOGGLE_USER_STATUS', userId, 'Users', 'Status: ' + newStatus);
  return respondJSON({ success: true, message: 'User status updated to ' + newStatus });
}

function handleResetPassword(ctx, payload) {
  var userId = String(payload.userId || '');
  var newHash = String(payload.newPasswordHash || '').toLowerCase();
  if (!isValidClientHash(newHash)) return respondJSON({ success: false, error: 'Invalid password.' });
  var target = findUser(ctx.users, userId);
  if (!target) return respondJSON({ success: false, error: 'User not found.' });

  updateObjectById(ctx.ss.getSheetByName(SHEET_NAMES.USERS), 'User ID', userId, {
    'Password Hash': makeStoredHash(newHash),
    'Must Change Password': 'TRUE',
    'Token Version': (parseInt(target['Token Version'], 10) || 1) + 1
  });
  CacheService.getScriptCache().remove('login_fail_' + norm(target['Username']));
  logAudit(ctx.userId, ctx.role, 'RESET_PASSWORD', userId, 'Users', 'Temporary password set by administrator.');
  return respondJSON({ success: true, message: 'Temporary password set. The user must change it at next login.' });
}

/* ==========================================================================
   DROPDOWNS, KPIs, MAPS
   ========================================================================== */

function handleSaveDropdown(ctx, payload) {
  var sheet = ctx.ss.getSheetByName(SHEET_NAMES.DROPDOWNS);
  var opt = payload.dropdown || {};
  var value = cleanName(opt.value || opt.optionValue);
  var category = cleanName(opt.category || opt.dropdownCategory);
  if (!value || !category || allActivityNames(ctx.ss).indexOf(opt.activityType) === -1) {
    return respondJSON({ success: false, error: 'Activity Type, Category and Value are required.' });
  }
  var optId = opt.optionId || ('OPT-' + Date.now());
  upsertObject(sheet, 'Option ID', optId, {
    'Option ID': optId,
    'Activity Type': opt.activityType,
    'Dropdown Category': safeText(category),
    'Option Value': safeText(value),
    'Parent Value': safeText(opt.parentValue || ''),
    'Sort Order': parseInt(opt.sortOrder, 10) || 1,
    'Status': opt.status === 'Deactivated' ? 'Deactivated' : 'Active'
  });
  logAudit(ctx.userId, ctx.role, 'SAVE_DROPDOWN', optId, 'DropdownOptions', 'Option: ' + value);
  return respondJSON({ success: true, optionId: optId, message: 'Dropdown option saved successfully.' });
}

function handleDeleteDropdown(ctx, payload) {
  var sheet = ctx.ss.getSheetByName(SHEET_NAMES.DROPDOWNS);
  updateObjectById(sheet, 'Option ID', payload.optionId, { 'Status': 'Deactivated' });
  logAudit(ctx.userId, ctx.role, 'DELETE_DROPDOWN', payload.optionId, 'DropdownOptions', 'Deactivated');
  return respondJSON({ success: true, message: 'Dropdown option deactivated.' });
}

function handleSaveKPI(ctx, payload) {
  var sheet = ctx.ss.getSheetByName(SHEET_NAMES.KPIS);
  var kpi = payload.kpi || {};

  if (!kpi.activityType || !kpi.farmBlock) {
    return respondJSON({ success: false, error: 'Activity Type and Farm & Block are required.' });
  }
  if (!ctx.allowAll && !ctx.scopeKeys[blockKey(kpi.landOwner, kpi.parcelNumber, kpi.farmBlock)]) {
    return respondJSON({ success: false, code: 'FORBIDDEN', error: 'You can only set KPIs for your assigned Farm & Blocks.' });
  }
  if (kpi.kpiId && !ctx.allowAll) {
    var old = readObjects(sheet).filter(function (k) { return String(k['KPI ID']) === String(kpi.kpiId); })[0];
    if (old && !ctx.scopeKeys[blockKey(old['Land Owner'], old['Parcel Number'], old['Farm & Block'])]) {
      return respondJSON({ success: false, code: 'FORBIDDEN', error: 'This KPI belongs to a Farm & Block that is not assigned to you.' });
    }
  }

  var targetQty = toNumber(kpi.targetQuantity);
  var days = parseInt(kpi.targetWorkingDays, 10) || 1;
  var kpiId = kpi.kpiId || ('KPI-' + Date.now());
  upsertObject(sheet, 'KPI ID', kpiId, {
    'KPI ID': kpiId,
    'Activity Type': safeText(kpi.activityType),
    'Farm & Block': safeText(kpi.farmBlock),
    'Land Owner': safeText(kpi.landOwner || ''),
    'Parcel Number': safeText(kpi.parcelNumber || ''),
    'Cycle': safeText(kpi.cycle || ''),
    'Target Quantity': targetQty,
    'Target Unit': safeText(kpi.targetUnit || ''),
    'Required Manpower': parseInt(kpi.requiredManpower, 10) || 1,
    'Target Working Days': days,
    'Daily Expected Accomplishment': toNumber(kpi.dailyExpectedAccomplishment) || (targetQty / days),
    'Effective Date': safeText(kpi.effectiveDate || new Date().toISOString().split('T')[0]),
    'Status': kpi.status === 'Deactivated' ? 'Deactivated' : 'Active'
  });
  logAudit(ctx.userId, ctx.role, 'SAVE_KPI', kpiId, 'KPIRegistration', 'Activity: ' + kpi.activityType);
  return respondJSON({ success: true, kpiId: kpiId, message: 'KPI Target saved successfully.' });
}

function handleDeleteKPI(ctx, payload) {
  var sheet = ctx.ss.getSheetByName(SHEET_NAMES.KPIS);
  var old = readObjects(sheet).filter(function (k) { return String(k['KPI ID']) === String(payload.kpiId); })[0];
  if (!old) return respondJSON({ success: false, error: 'KPI not found.' });
  if (!ctx.allowAll && !ctx.scopeKeys[blockKey(old['Land Owner'], old['Parcel Number'], old['Farm & Block'])]) {
    return respondJSON({ success: false, code: 'FORBIDDEN', error: 'This KPI belongs to a Farm & Block that is not assigned to you.' });
  }
  updateObjectById(sheet, 'KPI ID', payload.kpiId, { 'Status': 'Deactivated' });
  logAudit(ctx.userId, ctx.role, 'DELETE_KPI', payload.kpiId, 'KPIRegistration', 'Deactivated');
  return respondJSON({ success: true, message: 'KPI Target deactivated.' });
}

function handleSaveMap(ctx, payload) {
  var ss = ctx.ss;
  var sheet = ss.getSheetByName(SHEET_NAMES.MAPS);
  var mapData = payload.mapData || {};
  var geo = typeof mapData.geoJson === 'object' ? mapData.geoJson : null;
  if (!geo) {
    try { geo = JSON.parse(String(mapData.geoJson || '')); } catch (e) { geo = null; }
  }
  if (geo && geo.type === 'Feature') geo = { type: 'FeatureCollection', features: [geo] };
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    return respondJSON({ success: false, error: 'Map must be a GeoJSON FeatureCollection (KML/KMZ are converted in the app).' });
  }
  if (!geo.features.length) {
    return respondJSON({ success: false, error: 'The map file has no shapes (features).' });
  }
  var geoText = JSON.stringify(geo);
  if (geoText.length > MAP_MAX_CHARS) {
    return respondJSON({ success: false, error: 'Map is too large (' + Math.round(geoText.length / 1000) + ' KB, max ' + (MAP_MAX_CHARS / 1000) + ' KB). Simplify the shapes in QGIS or split the map per land owner.' });
  }

  var mapId = mapData.mapId || ('MAP-' + Date.now());
  var version = safeText(mapData.version || 'v1.0.0');

  // Large maps are split into several rows of the MapChunks sheet
  deleteMapChunks(ss, mapId);
  var cellValue = geoText;
  if (geoText.length > MAP_CELL_LIMIT) {
    var chunkSheet = ss.getSheetByName(SHEET_NAMES.MAP_CHUNKS);
    var rows = [];
    for (var i = 0, n = 0; i < geoText.length; i += MAP_CELL_LIMIT, n++) {
      rows.push([mapId, n, '~' + geoText.substring(i, i + MAP_CELL_LIMIT)]); // '~' keeps Sheets from changing the text
    }
    var start = chunkSheet.getLastRow() + 1;
    var range = chunkSheet.getRange(start, 1, rows.length, 3);
    range.setNumberFormat('@'); // keep the text exactly as-is
    range.setValues(rows);
    cellValue = '__CHUNKED__:' + rows.length;
  }

  upsertObject(sheet, 'Map ID', mapId, {
    'Map ID': mapId,
    'Map Title': safeText(mapData.title || 'Farm Parcel Map'),
    'Version': version,
    'Land Owner': safeText(mapData.landOwner || ''),
    'Parcel Number': safeText(mapData.parcelNumber || ''),
    'Farm & Block': safeText(mapData.farmBlock || ''),
    'File Type': safeText(mapData.fileType || 'GeoJSON'),
    'GeoJSON Data': cellValue,
    'Upload Date': new Date().toISOString(),
    'Uploaded By': String(ctx.user['Full Name']),
    'Status': 'Active'
  });
  updateSettingValue(ss.getSheetByName(SHEET_NAMES.SETTINGS), 'activeMapVersion', version);
  logAudit(ctx.userId, ctx.role, 'SAVE_MAP', mapId, 'MapRegistry',
    'Map: ' + mapData.title + ' (' + version + ', ' + geo.features.length + ' shapes, ' + Math.round(geoText.length / 1000) + ' KB)');
  return respondJSON({
    success: true, mapId: mapId, version: version,
    message: 'Map uploaded: ' + geo.features.length + ' shape(s), ' + Math.round(geoText.length / 1000) + ' KB.'
  });
}

/** Returns the map's GeoJSON text, joining chunks when the map was split. */
function readMapGeoText(ss, mapRow) {
  var cell = String(mapRow['GeoJSON Data'] || '');
  if (cell.indexOf('__CHUNKED__:') !== 0) return cell || '{}';
  var chunks = readObjects(ss.getSheetByName(SHEET_NAMES.MAP_CHUNKS))
    .filter(function (c) { return String(c['Map ID']) === String(mapRow['Map ID']); })
    .sort(function (a, b) { return toNumber(a['Chunk Index']) - toNumber(b['Chunk Index']); });
  return chunks.map(function (c) { return String(c['Data']).replace(/^~/, ''); }).join('') || '{}';
}

function deleteMapChunks(ss, mapId) {
  var sheet = ss.getSheetByName(SHEET_NAMES.MAP_CHUNKS);
  var last = sheet.getLastRow();
  if (last <= 1) return;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(mapId)) sheet.deleteRow(i + 2);
  }
}

function handleDeleteMap(ctx, payload) {
  updateObjectById(ctx.ss.getSheetByName(SHEET_NAMES.MAPS), 'Map ID', payload.mapId, { 'Status': 'Deactivated' });
  logAudit(ctx.userId, ctx.role, 'DELETE_MAP', payload.mapId, 'MapRegistry', 'Deactivated map');
  return respondJSON({ success: true, message: 'Map deactivated successfully.' });
}

/* ==========================================================================
   CUSTOM ACTIVITIES (Administrator adds new activity modules)
   Each custom activity gets its own sheet: ACT_<name>
   ========================================================================== */

function readCustomActivities(ss) {
  return readObjects(ss.getSheetByName(SHEET_NAMES.CUSTOM_ACTIVITIES)).map(function (r) {
    var fields = [];
    try { fields = JSON.parse(String(r['Fields JSON'] || '[]')); } catch (e) { fields = []; }
    return {
      id: String(r['Activity ID']),
      name: String(r['Activity Name']),
      description: String(r['Description'] || ''),
      icon: String(r['Icon'] || '📋'),
      fields: Array.isArray(fields) ? fields : [],
      kpiField: String(r['KPI Field'] || ''),
      sheetName: String(r['Sheet Name']),
      status: String(r['Status'] || 'Active')
    };
  });
}

function publicActivityDef(d) {
  return {
    id: d.id, name: d.name, description: d.description, icon: d.icon,
    fields: d.fields, kpiField: d.kpiField, status: d.status
  };
}

function findCustomDef(defs, id, name) {
  for (var i = 0; i < defs.length; i++) {
    if ((id && defs[i].id === String(id)) || norm(defs[i].name) === norm(name)) return defs[i];
  }
  return null;
}

function allActivityNames(ss) {
  return ACTIVITY_TYPES.concat(readCustomActivities(ss).map(function (d) { return d.name; }));
}

function ensureCustomActivitySheet(ss, def) {
  var sheet = ss.getSheetByName(def.sheetName);
  if (!sheet) sheet = ss.insertSheet(def.sheetName);
  var headers = CUSTOM_PREFIX_HEADERS
    .concat(def.fields.map(function (f) { return f.header; }))
    .concat(CUSTOM_SUFFIX_HEADERS);
  ensureHeaders(sheet, headers);
  return sheet;
}

function slugKey(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40) || 'field';
}

function handleSaveActivityType(ctx, payload) {
  var ss = ctx.ss;
  var data = payload.activity || {};
  var name = cleanName(data.name);
  if (!name) return respondJSON({ success: false, error: 'Activity name is required.' });
  if (ACTIVITY_TYPES.some(function (t) { return norm(t) === norm(name); })) {
    return respondJSON({ success: false, error: '"' + name + '" is already a built-in activity.' });
  }

  var defs = readCustomActivities(ss);
  var existing = data.id ? findCustomDef(defs, data.id, null) : null;
  if (data.id && !existing) return respondJSON({ success: false, error: 'Activity not found.' });
  var clash = defs.filter(function (d) { return norm(d.name) === norm(name) && (!existing || d.id !== existing.id); })[0];
  if (clash) return respondJSON({ success: false, error: 'An activity named "' + name + '" already exists.' });

  // Fields: existing fields keep their key + sheet header so old data stays aligned
  var reserved = CUSTOM_PREFIX_HEADERS.concat(CUSTOM_SUFFIX_HEADERS).map(norm);
  var oldByKey = {};
  (existing ? existing.fields : []).forEach(function (f) { oldByKey[f.key] = f; });
  var usedKeys = {}, usedHeaders = {};
  var fields = [];
  (Array.isArray(data.fields) ? data.fields : []).forEach(function (f) {
    var label = cleanName(f.label);
    if (!label) return;
    var type = ['number', 'text', 'select', 'date'].indexOf(f.type) !== -1 ? f.type : 'text';
    var old = f.key && oldByKey[f.key];
    var key = old ? old.key : slugKey(label);
    while (usedKeys[key]) key += '_2';
    var header = old ? old.header : label;
    if (!old && (reserved.indexOf(norm(header)) !== -1 || usedHeaders[norm(header)])) header = label + ' (' + name + ')';
    usedKeys[key] = true;
    usedHeaders[norm(header)] = true;
    fields.push({
      key: key,
      label: label,
      header: header,
      type: type,
      unit: cleanName(f.unit || ''),
      required: !!f.required,
      options: type === 'select' ? parseList(f.options).map(cleanName).filter(String) : []
    });
  });
  // Removed fields are kept (hidden) so old reports still read correctly
  (existing ? existing.fields : []).forEach(function (f) {
    if (!usedKeys[f.key]) { f.hidden = true; fields.push(f); }
  });
  if (!fields.filter(function (f) { return !f.hidden; }).length) {
    return respondJSON({ success: false, error: 'Add at least one field (e.g. "Palms Planted", number).' });
  }
  if (fields.some(function (f) { return f.type === 'select' && !f.hidden && !f.options.length; })) {
    return respondJSON({ success: false, error: 'Dropdown fields need at least one option.' });
  }

  var kpiField = String(data.kpiField || '');
  var kpiDef = fields.filter(function (f) { return f.key === kpiField && f.type === 'number' && !f.hidden; })[0];
  if (!kpiDef) {
    var firstNum = fields.filter(function (f) { return f.type === 'number' && !f.hidden; })[0];
    kpiField = firstNum ? firstNum.key : '';
  }

  var now = new Date().toISOString();
  var id = existing ? existing.id : nextId(readObjects(ss.getSheetByName(SHEET_NAMES.CUSTOM_ACTIVITIES)), 'Activity ID', 'ACT-', 3);
  var sheetName = existing ? existing.sheetName : ('ACT_' + name.replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '_')).substring(0, 90);
  if (!existing && ss.getSheetByName(sheetName)) sheetName = (sheetName + '_' + id).substring(0, 99);

  var def = {
    id: id, name: name, description: cleanName(data.description || '').substring(0, 300),
    icon: String(data.icon || '📋').substring(0, 4), fields: fields, kpiField: kpiField,
    sheetName: sheetName, status: data.status === 'Deactivated' ? 'Deactivated' : 'Active'
  };

  upsertObject(ss.getSheetByName(SHEET_NAMES.CUSTOM_ACTIVITIES), 'Activity ID', id, {
    'Activity ID': id,
    'Activity Name': safeText(def.name),
    'Description': safeText(def.description),
    'Icon': def.icon,
    'Fields JSON': JSON.stringify(def.fields),
    'KPI Field': def.kpiField,
    'Sheet Name': def.sheetName,
    'Status': def.status,
    'Created By': existing ? undefined : String(ctx.user['Full Name']),
    'Date Created': existing ? undefined : now,
    'Last Updated': now
  });
  ensureCustomActivitySheet(ss, def);

  // Renaming: keep users' activity assignments pointing to the new name
  if (existing && existing.name !== def.name) renameActivityInUsers(ss, existing.name, def.name);

  logAudit(ctx.userId, ctx.role, 'SAVE_ACTIVITY_TYPE', id, 'CustomActivities', def.name + ' (' + fields.length + ' fields)');
  return respondJSON({ success: true, activityId: id, message: 'Activity "' + def.name + '" saved.' });
}

function renameActivityInUsers(ss, oldName, newName) {
  var sheet = ss.getSheetByName(SHEET_NAMES.USERS);
  readObjects(sheet).forEach(function (u) {
    var list = parseList(u['Assigned Activities']);
    var idx = list.indexOf(oldName);
    if (idx !== -1) {
      list[idx] = newName;
      updateObjectById(sheet, 'User ID', u['User ID'], { 'Assigned Activities': list.join(', ') });
    }
  });
}

function handleSetActivityTypeStatus(ctx, payload) {
  var status = payload.status === 'Active' ? 'Active' : 'Deactivated';
  var ok = updateObjectById(ctx.ss.getSheetByName(SHEET_NAMES.CUSTOM_ACTIVITIES), 'Activity ID', payload.activityId,
    { 'Status': status, 'Last Updated': new Date().toISOString() });
  if (!ok) return respondJSON({ success: false, error: 'Activity not found.' });
  logAudit(ctx.userId, ctx.role, 'SET_ACTIVITY_TYPE_STATUS', payload.activityId, 'CustomActivities', 'Status: ' + status);
  return respondJSON({ success: true, message: 'Activity ' + (status === 'Active' ? 'reactivated' : 'deactivated') + '.' });
}

/* ==========================================================================
   DEVICES & AUDIT
   ========================================================================== */

function handleRegisterDevice(ctx, payload) {
  registerDeviceInternal(ctx.ss, payload.device, ctx.user, 0);
  return respondJSON({ success: true, message: 'Device registered.' });
}

function registerDeviceInternal(ss, device, user, addedSubmissions) {
  if (!device || !device.deviceId) return;
  var sheet = ss.getSheetByName(SHEET_NAMES.DEVICES);
  var now = new Date().toISOString();
  var existing = readObjects(sheet).filter(function (d) { return String(d['Device ID']) === String(device.deviceId); })[0];

  if (existing) {
    updateObjectById(sheet, 'Device ID', device.deviceId, {
      'Last Seen': now,
      'Total Submissions': (parseInt(existing['Total Submissions'], 10) || 0) + addedSubmissions,
      'User ID': user ? String(user['User ID']) : existing['User ID'],
      'Employee Name': user ? String(user['Full Name']) : existing['Employee Name']
    });
    return;
  }
  appendObject(sheet, {
    'Device ID': safeText(device.deviceId),
    'Device Name': safeText(device.deviceName || 'Mobile Browser'),
    'User ID': user ? String(user['User ID']) : '',
    'Employee Name': user ? String(user['Full Name']) : '',
    'Browser OS': safeText(device.browserOs || ''),
    'First Seen': now,
    'Last Seen': now,
    'Total Submissions': addedSubmissions,
    'Status': 'Active'
  });
}

function logAudit(userId, role, action, recordId, module, details) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.AUDIT_LOGS);
    if (sheet) {
      appendObject(sheet, {
        'Log ID': 'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        'User ID': userId || 'Anonymous',
        'User Role': role || 'User',
        'Action': action || 'ACTION',
        'Record ID': recordId || 'N/A',
        'Module': module || 'General',
        'Details': safeText(details || ''),
        'Timestamp': new Date().toISOString()
      });
    }
  } catch (e) {
    console.error('Audit log failed', e);
  }
}

/* ==========================================================================
   SHEET UTILITIES (header-name based)
   ========================================================================== */

function getHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

function getHeaderIndex(sheet) {
  var idx = {};
  getHeaders(sheet).forEach(function (h, i) { if (h && idx[h] === undefined) idx[h] = i; });
  return idx;
}

/** Reads all rows as objects keyed by header. Dates become yyyy-MM-dd / ISO strings. */
function readObjects(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var tz = Session.getScriptTimeZone();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    var empty = true;
    for (var j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      var v = data[i][j];
      if (v instanceof Date) {
        v = (headers[j] === 'Date' || headers[j] === 'Effective Date')
          ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
          : v.toISOString();
      }
      if (v !== '' && v !== null) empty = false;
      obj[headers[j]] = v;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

function appendObject(sheet, obj) {
  var headers = getHeaders(sheet);
  sheet.appendRow(headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; }));
}

/** Updates only the given columns of the row whose idHeader = id. Returns true if found. */
function updateObjectById(sheet, idHeader, id, updates) {
  var idx = getHeaderIndex(sheet);
  var idCol = idx[idHeader];
  var lastRow = sheet.getLastRow();
  if (idCol === undefined || lastRow <= 1) return false;
  var ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      for (var h in updates) {
        if (updates[h] === undefined) continue;
        if (idx[h] !== undefined) sheet.getRange(i + 2, idx[h] + 1).setValue(updates[h]);
      }
      return true;
    }
  }
  return false;
}

function upsertObject(sheet, idHeader, id, obj) {
  if (!updateObjectById(sheet, idHeader, id, obj)) appendObject(sheet, obj);
}

function updateSettingValue(sheet, key, value) {
  if (!updateObjectById(sheet, 'Key', key, { 'Value': value, 'Last Updated': new Date().toISOString() })) {
    appendObject(sheet, { 'Key': key, 'Value': value, 'Description': '', 'Last Updated': new Date().toISOString() });
  }
}

function nextId(rows, idHeader, prefix, width) {
  var max = 0;
  rows.forEach(function (r) {
    var m = String(r[idHeader] || '').match(/(\d+)$/);
    if (m && String(r[idHeader]).indexOf(prefix) === 0) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + pad(max + 1, width);
}

function pad(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function norm(v) {
  return String(v === undefined || v === null ? '' : v).trim().toLowerCase();
}

function parseList(raw) {
  if (Array.isArray(raw)) return raw.map(function (s) { return String(s).trim(); }).filter(String);
  return String(raw || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
}

function cleanName(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().substring(0, 120);
}

function toNumber(v) {
  var n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/** Stops spreadsheet formula injection ("=IMPORTXML(...)" typed into a remark). */
function safeText(v) {
  var s = String(v === undefined || v === null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
