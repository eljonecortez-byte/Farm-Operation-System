/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * GOOGLE APPS SCRIPT BACKEND API (Central Database in Google Sheets)
 * Version 3.2.0 — secured API, Farm & Block based access, Land Owner Enrollment
 *                 (numbering + Priority category), custom activities,
 *                 large map upload (KML / KMZ / GeoJSON), cycle monitoring data
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

var APP_VERSION = '4.6.0';
var MAP_CELL_LIMIT = 45000;       // characters per sheet cell for map data
var MAP_MAX_CHARS = 3000000;      // ~3 MB per map (keeps phones fast)
var TOKEN_TTL_DAYS = 30;          // Field devices can stay offline for long periods
var MAX_LOGIN_FAILURES = 5;       // per username
var LOGIN_LOCK_SECONDS = 900;     // 15 minutes
var HASH_ROUNDS = 200;            // server-side key stretching rounds

// SHA-256('admin123') — the old demo password. Accounts still using it are forced to change it.
var DEFAULT_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

var ROLES = { ADMIN: 'Administrator', SUPERVISOR: 'Supervisor', FARM_OFFICER: 'Farm Officer', FIELD: 'Field Personnel' };
/** Supervisor-level roles: Supervisor (his blocks) and Farm Officer (whole farms). */
var SUP_ROLES = [ROLES.SUPERVISOR, ROLES.FARM_OFFICER];

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
  MAP_CHUNKS: 'MapChunks',
  JOB_ORDERS: 'JobOrders',
  JO_RESPONSES: 'JO_Responses',
  JO_AUDIT: 'JO_AuditLog',
  NOTIFICATIONS: 'Notifications',
  VALIDATION_RULES: 'ValidationRules',
  DATA_VALIDATOR: 'DataValidator',
  REPORT_PHOTOS: 'ReportPhotos'
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
    'Account Status', 'Date Created', 'Last Login', 'Must Change Password', 'Token Version', 'Profile Photo', 'Theme'
  ],
  PERMISSIONS: [
    'Permission ID', 'User ID', 'Can Manage Users', 'Can Manage Dropdowns',
    'Can Manage KPIs', 'Can Manage Maps', 'Can View All Reports', 'Can Export Data', 'Status'
  ],
  LANDOWNERS: [
    'Land Owner ID', 'Land Owner Name', 'Contact Person', 'Phone', 'Total Hectares', 'Status', 'Date Enrolled',
    'CLAIF Number', 'Category', 'Sequence No.'
  ],
  PARCELS: [
    'Parcel ID', 'Parcel Number', 'Land Owner ID', 'Land Owner Name', 'Total Area Ha', 'Total Palms', 'Status', 'Date Enrolled'
  ],
  FARMS_BLOCKS: [
    'Block ID', 'Farm and Block Name', 'Parcel ID', 'Parcel Number', 'Land Owner ID', 'Land Owner Name',
    'Area Ha', 'Palm Count', 'Status', 'Supervisor ID', 'Supervisor Name', 'Date Enrolled',
    'Sequence No.', 'Category', 'CLAIF Number', 'Farm Block Code', 'Record ID'
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
    'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status', 'CLAIF Number', 'Foliar Palms', 'Record ID', 'Validation Status'
  ],
  IRREGULAR: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Land Owners Name', 'Parcel Number', 'Farm & Block', 'Manpower',
    'Pest Treatment Soil Drench', 'Count of Palms', 'Quantity Liters', 'Foliar Request Number',
    'Irregular Activity', 'Count of Palms 2', 'Count of Manpower 2', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status', 'CLAIF Number', 'Record ID', 'Validation Status'
  ],
  OTHER: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Land Owners Name', 'Parcel Number', 'Farm & Block', 'Manpower',
    'Other Activities', 'Quantity', 'Unit', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status', 'CLAIF Number', 'Record ID', 'Validation Status'
  ],
  PALM_CATEGORY: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Timestamp',
    'Farm & Block', 'Land Owners Name', 'Parcel Number', 'Palm Number',
    'Seedling Stage', 'Juvenile Stage', 'Pre-trunk Reproductive Stage', 'Pre-trunk Fruiting Stage',
    'Mature Stage', 'Fruiting Stage', 'Problem Palms', 'Manpower Count', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status', 'Date', 'CLAIF Number', 'Record ID', 'Validation Status'
  ],
  SEEDNUT: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Area Code', 'Palm Number', 'Nut Count Collected', 'Count of Nuts for Next Collection',
    'Count of Rejected Nuts', 'GPS Latitude', 'GPS Longitude', 'GPS Accuracy', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'Server Timestamp', 'Sync Status',
    'Land Owners Name', 'Parcel Number', 'Farm & Block', 'CLAIF Number', 'Record ID', 'Validation Status'
  ],
  PEST_DISEASE: [
    'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
    'Land Owners Name', 'Parcel Number', 'Palm Numbers', 'Farm & Block',
    'Target Pest', 'Total Palms Affected', 'Input Used', 'Quantity', 'Unit',
    'Ratio', 'Method Used', 'Target Parts Application', 'Manpower Count', 'Remarks',
    'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude', 'Server Timestamp', 'Sync Status', 'CLAIF Number', 'Record ID', 'Validation Status'
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
  ],
  JOB_ORDERS: [
    'JO Code', 'Temp Code', 'Title', 'Description', 'Farm Block Code', 'Farm & Block', 'Record ID', 'Land Owner',
    'CLAIF Number', 'Parcel Number', 'Priority', 'Due Date', 'Status', 'Created By', 'Created By Name', 'Created At',
    'Assigned To', 'Assigned To Name', 'Claimed By', 'Claimed By Name', 'Claimed At', 'Claimed Device',
    'Closed By', 'Closed By Name', 'Closed At', 'Last Updated'
  ],
  JO_RESPONSES: [
    'Response ID', 'JO Code', 'Type', 'Response Text', 'User ID', 'User Name', 'Device ID', 'Timestamp', 'Sync ID',
    'Attachment Link', 'Attachment Name'
  ],
  JO_AUDIT: [
    'Audit ID', 'JO Code', 'Action', 'Old Status', 'New Status', 'User ID', 'User Name', 'Device ID', 'Timestamp',
    'Sync ID', 'Remarks', 'Attachment Link'
  ],
  NOTIFICATIONS: [
    'Notification ID', 'User ID', 'JO Code', 'Type', 'Message', 'Created At', 'Read At'
  ],
  VALIDATION_RULES: [
    'Rule ID', 'Activity Label', 'Activity Type', 'Report Field', 'Target Basis', 'Decimals', 'Period', 'Target Scope', 'Status', 'Notes'
  ],
  DATA_VALIDATOR: [
    'Report ID', 'Unique UUID', 'Status', 'Activity Type', 'Report Date', 'Cycle', 'Period', 'User ID', 'Supervisor', 'Record ID',
    'Land Owner', 'CLAIF Number', 'Farm Block Code', 'Farm & Block', 'Parcel Number', 'Sequence', 'Checks JSON', 'Reason',
    'Report JSON', 'Original JSON', 'History JSON', 'First Submitted', 'Last Validated', 'Reviewed By', 'Review Note', 'Reviewed At'
  ],
  REPORT_PHOTOS: [
    'Report ID', 'Unique UUID', 'Activity Type', 'Report Date', 'Farm Block Code', 'Farm & Block', 'Land Owner', 'Parcel Number',
    'User ID', 'Uploaded By', 'Source', 'Photo Date', 'Taken At', 'GPS', 'File ID', 'Photo Link', 'Size KB', 'Thumb', 'Uploaded At'
  ]
};

// Columns every custom activity sheet has (custom fields go between Manpower and Remarks)
var CUSTOM_PREFIX_HEADERS = [
  'Report ID', 'Unique UUID', 'User ID', 'Employee Name', 'Supervisor ID', 'Date',
  'Land Owners Name', 'Parcel Number', 'Farm & Block', 'Manpower'
];
var CUSTOM_SUFFIX_HEADERS = [
  'Remarks', 'Device ID', 'Device Name', 'Browser OS', 'GPS Latitude', 'GPS Longitude',
  'Server Timestamp', 'Sync Status', 'CLAIF Number', 'Record ID', 'Validation Status'
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
  'CLAIF Number': ['landOwnerNo', 's'],   // tells apart land owners with the same name
  'Record ID': ['recordId', 's'],          // exact registered row the report belongs to (v4.2)
  'Validation Status': ['validationStatus', 's'],
  'Foliar Palms': ['foliarPalms', 'n'],
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

// Actions that change land owner / parcel / block records: the app must be the same version as this server
var MASTER_EDIT_ACTIONS = { ENROLL_LANDOWNER: true, UPDATE_LANDOWNER: true, UPDATE_BLOCK: true, DELETE_BLOCK: true };

// Actions that change data (need the script lock)
var WRITE_ACTIONS = {
  LOGIN: true, SETUP_DB: true, SYNC_REPORTS_BATCH: true, SAVE_DROPDOWN: true, DELETE_DROPDOWN: true,
  SAVE_KPI: true, DELETE_KPI: true, SAVE_USER: true, TOGGLE_USER_STATUS: true, RESET_PASSWORD: true,
  CHANGE_PASSWORD: true, SAVE_MAP: true, DELETE_MAP: true, REGISTER_DEVICE: true,
  ENROLL_LANDOWNER: true, SET_BLOCK_STATUS: true, PING: true,
  SAVE_ACTIVITY_TYPE: true, SET_ACTIVITY_TYPE_STATUS: true,
  UPDATE_LANDOWNER: true, UPDATE_BLOCK: true, DELETE_BLOCK: true, JO_SYNC: true, DV_REVIEW: true, UPLOAD_REPORT_PHOTO: true, SET_PROFILE_PHOTO: true, SET_THEME: true
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

    // Land owner master data can only be changed by the CURRENT app version.
    // An old copy of the app (browser / service-worker cache) is refused instead of changing the wrong rows.
    if (MASTER_EDIT_ACTIONS[action] && String(payload.clientVersion || '') !== APP_VERSION) {
      return respondJSON({
        success: false, code: 'APP_OUTDATED',
        error: 'This copy of the app is out of date (' + (payload.clientVersion || 'old version') + '; server is v' + APP_VERSION +
          '). Nothing was changed. Close the app and open it again (or press Ctrl+Shift+R), then try again.'
      });
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

      case 'SAVE_KPI':             requireRole(ctx, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.FARM_OFFICER]); return handleSaveKPI(ctx, payload);
      case 'DELETE_KPI':           requireRole(ctx, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.FARM_OFFICER]); return handleDeleteKPI(ctx, payload);

      case 'SAVE_USER':            requireRole(ctx, [ROLES.ADMIN]); return handleSaveUser(ctx, payload);
      case 'TOGGLE_USER_STATUS':   requireRole(ctx, [ROLES.ADMIN]); return handleToggleUserStatus(ctx, payload);
      case 'RESET_PASSWORD':       requireRole(ctx, [ROLES.ADMIN]); return handleResetPassword(ctx, payload);

      case 'ENROLL_LANDOWNER':     requireRole(ctx, [ROLES.ADMIN]); return handleEnrollLandowner(ctx, payload);
      case 'SET_BLOCK_STATUS':     requireRole(ctx, [ROLES.ADMIN]); return handleSetBlockStatus(ctx, payload);
      case 'UPDATE_LANDOWNER':     requireRole(ctx, [ROLES.ADMIN]); return handleUpdateLandowner(ctx, payload);
      case 'UPDATE_BLOCK':         requireRole(ctx, [ROLES.ADMIN]); return handleUpdateBlock(ctx, payload);
      case 'DELETE_BLOCK':         requireRole(ctx, [ROLES.ADMIN]); return handleDeleteBlock(ctx, payload);
      case 'JO_SYNC':              return handleJoSync(ctx, payload);
      case 'JO_ATTACHMENT':        return handleJoAttachment(ctx, payload);
      case 'UPLOAD_REPORT_PHOTO':  return handleUploadReportPhoto(ctx, payload);
      case 'SET_PROFILE_PHOTO':    return handleSetProfilePhoto(ctx, payload);
      case 'SET_THEME':            return handleSetTheme(ctx, payload);
      case 'REPORT_PHOTO':         return handleReportPhoto(ctx, payload);
      case 'REPORT_PHOTO_THUMBS':  return handleReportPhotoThumbs(ctx, payload);
      case 'GET_WEATHER':          return handleGetWeather(ctx, payload);
      case 'GET_VALIDATOR':        return handleGetValidator(ctx, payload);
      case 'DV_REVIEW':            return handleDvReview(ctx, payload);

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
  fillLandownerDefaults(ss);
  ensureUniqueRecordIds(ss);   // every parcel/block entry gets its own permanent Record ID (Block ID)
  syncEntryColumns(ss);        // per-entry Category (copied once from the land owner), CLAIF Number, Farm Block Code
  migrateUserAssignmentsToFarmBlocks(ss);
  seedValidationRules(ss);
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

/* --------------------------------------------------------------------------
   FARM & BLOCK CODES (v3.6)
   Users are assigned to a Farm & Block, e.g. "Farm 04 Block 1" -> code "F04-B01".
   One code covers EVERY land owner / parcel enrolled under that Farm & Block,
   including land owners enrolled later. Codes are stored in Users >
   "Assigned Farm and Blocks" (e.g. "F04-B01, F05-B03" or "ALL").
   -------------------------------------------------------------------------- */

/** "Farm 04 Block 1", "Farm 4-Block 01", "farm04 blk1" -> "F04-B01". Other names -> "N:<name>". */
function farmBlockCode(name) {
  var s = String(name === undefined || name === null ? '' : name).trim();
  var m = s.match(/farm\s*[-#:.]?\s*0*(\d+)[\s\-–,\/_.]*(?:block|blk)\s*[-#:.]?\s*0*(\d+)/i);
  if (m) return 'F' + pad(parseInt(m[1], 10), 2) + '-B' + pad(parseInt(m[2], 10), 2);
  return 'N:' + norm(s);
}

/** "F04-B01" -> "F04"; "N:..." -> the part before "block", or the whole name. */
function farmCodeOf(code, name) {
  var m = String(code).match(/^(F\d+)-B\d+$/);
  if (m) return m[1];
  var n = String(name || '').match(/^(.*?)[\s\-–,\/]*\b(?:block|blk)\b/i);
  return 'N:' + norm(n && n[1].trim() ? n[1] : (name || String(code).substring(2)));
}

/** Farm key of a Farm & Block name: FARM:F04 for "Farm 4 Block 1"; FARM:N:<farm> for other names. */
function farmKeyOf(name) {
  var code = farmBlockCode(name);
  var m = String(code).match(/^(F\d+)-B\d+$/);
  if (m) return 'FARM:' + m[1];
  return 'FARM:N:' + norm(farmBlockLabels(code, name).farm);
}

/** Farm keys a user is assigned to (Farm Officers only). */
function assignedFarmKeys(u) {
  return parseList(u['Assigned Farm and Blocks']).filter(function (x) { return /^FARM:/.test(x); });
}

/** Names of active Farm Officers per farm key, and of Supervisors per Farm & Block code (for the dashboard). */
function responsibleNames(users, blocks) {
  var farms = {}, sups = {};
  var push = function (map, k, n) { map[k] = map[k] || []; if (map[k].indexOf(n) === -1) map[k].push(n); };
  users.forEach(function (u) {
    if (norm(u['Account Status']) !== 'active') return;
    var name = String(u['Full Name']);
    if (String(u['Role']) === ROLES.FARM_OFFICER) assignedFarmKeys(u).forEach(function (k) { push(farms, k, name); });
    if (String(u['Role']) === ROLES.SUPERVISOR) {
      var c = resolveAssignedCodes(u['Assigned Farm and Blocks'], blocks);
      if (c !== 'ALL') c.forEach(function (code) { push(sups, code, name); });
    }
  });
  return { farmOfficers: farms, blockSupervisors: sups };
}

function farmBlockLabels(code, name) {
  var m = String(code).match(/^F(\d+)-B(\d+)$/);
  if (m) return { farm: 'Farm ' + m[1], block: 'Block ' + parseInt(m[2], 10), full: 'Farm ' + m[1] + ' – Block ' + parseInt(m[2], 10) };
  var nm = String(name || '').trim();
  var f = nm.match(/^(.*?)[\s\-–,\/]*\b((?:block|blk)\b.*)$/i);
  if (f && f[1].trim()) return { farm: f[1].trim(), block: f[2].trim(), full: nm };
  return { farm: nm || 'Other', block: nm || 'Other', full: nm };
}

function isFarmBlockCode(item) {
  return /^F\d+-B\d+$/.test(String(item)) || /^N:/.test(String(item));
}

/**
 * Assigned Farm & Block codes of a user. Older values (Block IDs "BLK-001" or block names)
 * are converted to the code of that Farm & Block, so nothing is lost.
 */
function resolveAssignedCodes(raw, blocks) {
  var list = parseList(raw);
  if (list.indexOf('ALL') !== -1) return 'ALL';
  var codes = [];
  var add = function (c) { if (c && codes.indexOf(c) === -1) codes.push(c); };
  list.forEach(function (item) {
    if (/^FARM:/.test(item)) {   // Farm Officer: a whole farm, including blocks enrolled later
      blocks.forEach(function (b) { if (farmKeyOf(b['Farm and Block Name']) === item) add(farmBlockCode(b['Farm and Block Name'])); });
      return;
    }
    if (isFarmBlockCode(item)) { add(item); return; }
    var byId = blocks.filter(function (b) { return String(b['Block ID']) === item; })[0];
    add(farmBlockCode(byId ? byId['Farm and Block Name'] : item));
  });
  return codes;
}

/** Block IDs (one per land owner / parcel row) covered by the user's Farm & Block codes. */
function resolveAssignedBlockIds(raw, blocks) {
  var codes = resolveAssignedCodes(raw, blocks);
  if (codes === 'ALL') return 'ALL';
  var ids = [];
  blocks.forEach(function (b) {
    if (codes.indexOf(farmBlockCode(b['Farm and Block Name'])) !== -1) ids.push(String(b['Block ID']));
  });
  return ids;
}

/** One-time: rewrite stored Block IDs / names as Farm & Block codes (accounts are kept as they are). */
function migrateUserAssignmentsToFarmBlocks(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.USERS);
  var blocks = readObjects(ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS));
  readObjects(sheet).forEach(function (u) {
    var raw = String(u['Assigned Farm and Blocks'] || '');
    if (!raw.trim() || /FARM:/.test(raw)) return;   // Farm Officers keep whole farms
    var codes = resolveAssignedCodes(raw, blocks);
    var value = codes === 'ALL' ? 'ALL' : codes.join(', ');
    if (value !== raw) updateObjectById(sheet, 'User ID', u['User ID'], { 'Assigned Farm and Blocks': value });
  });
}

/**
 * Another land owner's active block with exactly the same Land Owner Name + Parcel + Farm & Block?
 * Reports are stored with those three values, so that combination must stay unique.
 */
function keyClash(blocks, ownerId, name, parcel, blockName, ignoreBlockId) {
  var k = blockKey(name, parcel, blockName);
  return blocks.filter(function (b) {
    return String(b['Land Owner ID']) !== String(ownerId) && String(b['Block ID']) !== String(ignoreBlockId || '') &&
      norm(b['Status']) !== 'deactivated' && blockKey(b['Land Owner Name'], b['Parcel Number'], b['Farm and Block Name']) === k;
  })[0] || null;
}

function claifOfOwner(landowners, ownerId) {
  var l = landowners.filter(function (x) { return String(x['Land Owner ID']) === String(ownerId); })[0];
  return l ? String(l['CLAIF Number'] || '') : '';
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
    sequenceNo: parseInt(b['Sequence No.'], 10) || 0,   // typed by the admin per parcel/block (never automatic)
    farmBlockCode: farmBlockCode(b['Farm and Block Name']),   // e.g. F04-B01 (what users are assigned to)
    recordId: String(b['Record ID'] || ''),                     // permanent unique ID of this parcel/block entry (REC-0001)
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
    assignedFarmAndBlocks: ids === 'ALL' ? ['ALL'] : ids,   // Block IDs covered (used for scope on the device)
    assignedFarmBlockCodes: (function () { var c = resolveAssignedCodes(u['Assigned Farm and Blocks'], blocks); return c === 'ALL' ? ['ALL'] : c; })(),
    photo: /^data:image\/jpeg;base64,/.test(String(u['Profile Photo'] || '')) ? String(u['Profile Photo']) : '',   // small square (≈192 px)
    theme: String(u['Theme'] || ''),                            // e.g. "ocean|dark" (colour | light / dark / auto)
    assignedFarms: assignedFarmKeys(u),                        // Farm Officer: whole farms (FARM:F04)
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

  // Land owners are matched by Land Owner ID (several land owners may share a name)
  var landownerById = {};
  readObjects(ss.getSheetByName(SHEET_NAMES.LANDOWNERS)).forEach(function (l) { landownerById[String(l['Land Owner ID'])] = l; });

  var sourceBlocks = ctx.isAdmin ? ctx.blocks : ctx.scopeBlocks;
  var blocks = sourceBlocks.map(function (b) {
    var pb = publicBlock(b);
    var sups = supMap[pb.blockId] || [];
    pb.supervisorIds = sups.map(function (s) { return s.userId; });
    pb.supervisorNames = sups.map(function (s) { return s.fullName; });
    pb.supervisorName = pb.supervisorNames.join(', ') || 'Unassigned';
    var lo = landownerById[String(pb.landOwnerId)];
    pb.landOwnerNo = lo ? String(lo['CLAIF Number'] || '') : '';   // CLAIF Number, e.g. CLAIF-686
    // Category of THIS sequence entry (older rows without one: the land owner's old category)
    pb.category = String(b['Category'] || '').trim() ? normalizeCategory(b['Category']) : (lo ? normalizeCategory(lo['Category']) : 'Not Priority');
    return pb;
  });

  var landOwnerNames = {};
  var landOwnerIds = {};
  var parcelIds = {};
  sourceBlocks.forEach(function (b) {
    landOwnerNames[norm(b['Land Owner Name'])] = true;
    landOwnerIds[String(b['Land Owner ID'])] = true;
    parcelIds[String(b['Parcel ID'])] = true;
  });

  var landowners = readObjects(ss.getSheetByName(SHEET_NAMES.LANDOWNERS))
    .filter(function (l) { return ctx.isAdmin || landOwnerIds[String(l['Land Owner ID'])]; })
    .map(function (l) {
      return {
        landOwnerId: String(l['Land Owner ID']),
        landOwnerName: String(l['Land Owner Name']),
        contactPerson: String(l['Contact Person'] || ''),
        phone: String(l['Phone'] || ''),
        totalHectares: parseFloat(l['Total Hectares']) || 0,
        status: String(l['Status'] || 'Active'),
        dateEnrolled: String(l['Date Enrolled'] || ''),
        landOwnerNo: String(l['CLAIF Number'] || ''),   // CLAIF Number, e.g. CLAIF-686
        category: normalizeCategory(l['Category']),
        sequenceNo: parseInt(l['Sequence No.'], 10) || 0   // shown as P-1 / NP-1
      };
    });

  var parcels = readObjects(ss.getSheetByName(SHEET_NAMES.PARCELS))
    .filter(function (p) { return ctx.isAdmin || parcelIds[String(p['Parcel ID'])]; })
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
    .filter(function (m) {
      if (ctx.isAdmin || !m['Land Owner']) return true;
      if (m['Farm & Block']) return !!ctx.scopeKeys[blockKey(m['Land Owner'], m['Parcel Number'], m['Farm & Block'])];
      return !!landOwnerNames[norm(m['Land Owner'])];
    })
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
    serverVersion: APP_VERSION,
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
    validationRules: readValidationRules(ss),
    serverToday: dvToday(),
    responsible: responsibleNames(ctx.users, ctx.blocks),
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
  var validation = [];
  var claifCache = {};
  var loRows = null;
  var landownerRows = function () { return loRows || (loRows = readObjects(ss.getSheetByName(SHEET_NAMES.LANDOWNERS))); };

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
        if (!block && !ctx.allowAll) {
          var dvOut = dvInvalidOutOfScope(ctx, rec);   // validated activities: recorded in the Data Validator as INVALID
          if (dvOut) { validation.push(dvOut); syncedIds.push(reportId); continue; }
          throw permanent('Farm & Block "' + rec.farmBlock + '" is not assigned to you.');
        }
      } else if (!ctx.allowAll && actType !== 'Seednut Collection') {
        var dvMiss = dvInvalidOutOfScope(ctx, rec);
        if (dvMiss) { validation.push(dvMiss); syncedIds.push(reportId); continue; }
        throw permanent('Farm & Block is required.');
      }

      // Server-controlled fields
      var owner = ctx.isAdmin && rec.userId ? findUser(ctx.users, rec.userId) : ctx.user;
      rec.userId = owner ? String(owner['User ID']) : ctx.userId;
      rec.employeeName = owner ? String(owner['Full Name']) : String(rec.employeeName || '');
      var sups = block ? (supMap[String(block['Block ID'])] || []) : [];
      if (block) {
        rec.landOwnerNo = claifCache[String(block['Land Owner ID'])];
        if (rec.landOwnerNo === undefined) {
          rec.landOwnerNo = claifCache[String(block['Land Owner ID'])] = claifOfOwner(landownerRows(), block['Land Owner ID']);
        }
      }
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

      // DATA VALIDATOR: only VALID reports become official accomplishments
      var dv = dvCheckForSync(ctx, rec);
      if (dv) {
        validation.push(dv.result);
        if (!dv.official) { syncedIds.push(reportId); continue; }   // kept in the DataValidator sheet, not counted
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
    validation: validation,
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

  records = records.slice(0, limit);
  var photos = rpPhotoIndex(ctx.ss);
  records.forEach(function (r) {
    var ph = photos[String(r.reportId)];
    if (ph) r.photo = { source: String(ph['Source'] || ''), uploadedAt: String(ph['Uploaded At'] || '') };
  });
  return respondJSON({ success: true, count: records.length, records: records });
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
  if (t.indexOf('foliar') !== -1) return a === 'Regular Activity' ? rec.foliarPalms : null;
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
  if (Array.isArray(data.entries)) return handleEnrollEntries(ctx, data);
  var landOwnerName = cleanName(data.landOwnerName);
  var parcelNumber = cleanName(data.parcelNumber);
  var blockNames = (Array.isArray(data.farmBlocks) ? data.farmBlocks : String(data.farmBlock || '').split(','))
    .map(cleanName)
    .filter(function (b) { return b; });

  if (!landOwnerName) return respondJSON({ success: false, error: 'Land Owner Name is required.' });
  if (!parcelNumber) return respondJSON({ success: false, error: 'Parcel Number is required.' });

  var requestedNo = data.landOwnerNo === undefined || String(data.landOwnerNo).trim() === '' ? null : normalizeClaif(data.landOwnerNo);
  if (requestedNo === '') {
    return respondJSON({ success: false, error: 'CLAIF Number must be a word and a number, e.g. CLAIF-686.' });
  }
  var requestedCategory = data.category ? normalizeCategory(data.category) : null;
  var requestedSeq = data.sequenceNo === undefined || String(data.sequenceNo).trim() === '' ? null : parseInt(data.sequenceNo, 10);
  if (requestedSeq !== null && (isNaN(requestedSeq) || requestedSeq < 1)) {
    return respondJSON({ success: false, error: 'Sequence No. must be a whole number (1, 2, 3...).' });
  }
  if (!blockNames.length) return respondJSON({ success: false, error: 'At least one Farm & Block is required.' });

  var ss = ctx.ss;
  var now = new Date().toISOString();
  var landSheet = ss.getSheetByName(SHEET_NAMES.LANDOWNERS);
  var parcelSheet = ss.getSheetByName(SHEET_NAMES.PARCELS);
  var blockSheet = ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);

  // 1) Land owner: reuse if the name already exists
  var landowners = readObjects(landSheet);
  // The land owner is found by CLAIF Number (or Land Owner ID) — never by name
  var land = null;
  if (requestedNo !== null) {
    land = landowners.filter(function (l) { return String(l['CLAIF Number'] || '').toUpperCase() === requestedNo; })[0] || null;
  } else if (data.landOwnerId) {
    land = landowners.filter(function (l) { return String(l['Land Owner ID']) === String(data.landOwnerId); })[0] || null;
  }
  if (!land && requestedNo === null) {
    return respondJSON({ success: false, error: 'CLAIF Number is required (e.g. CLAIF-686).' });
  }
  if (land && norm(land['Land Owner Name']) !== norm(landOwnerName)) {
    return respondJSON({ success: false, error: 'CLAIF Number ' + land['CLAIF Number'] + ' is already used by ' + land['Land Owner Name'] + '.' });
  }
  var seqResult = resolveSequence(landowners, land, requestedCategory || (land ? normalizeCategory(land['Category']) : 'Not Priority'), requestedSeq);
  if (seqResult.error) return respondJSON({ success: false, error: seqResult.error });
  var createdLand = false;
  if (!land) {
    land = {
      'Land Owner ID': nextId(landowners, 'Land Owner ID', 'LND-', 3),
      'Land Owner Name': landOwnerName,
      'Contact Person': '', 'Phone': '', 'Total Hectares': '',
      'Status': 'Active',
      'Date Enrolled': now,
      'CLAIF Number': requestedNo,
      'Category': requestedCategory || 'Not Priority',
      'Sequence No.': seqResult.seq
    };
    appendObject(landSheet, land);
    createdLand = true;
  } else {
    var landUpdates = {};
    if (norm(land['Status']) === 'deactivated') landUpdates['Status'] = 'Active';
    if (requestedNo !== null && requestedNo !== String(land['CLAIF Number'] || '')) landUpdates['CLAIF Number'] = requestedNo;
    if (requestedCategory && requestedCategory !== normalizeCategory(land['Category'])) landUpdates['Category'] = requestedCategory;
  if (seqResult.seq && seqResult.seq !== (parseInt(land['Sequence No.'], 10) || 0)) landUpdates['Sequence No.'] = seqResult.seq;
    if (Object.keys(landUpdates).length) updateObjectById(landSheet, 'Land Owner ID', land['Land Owner ID'], landUpdates);
  }
  landOwnerName = String(land['Land Owner Name']); // keep the original spelling

  // 2) Parcel: reuse if this land owner already has the parcel number
  var parcels = readObjects(parcelSheet);
  var parcel = parcels.filter(function (p) {
    return String(p['Land Owner ID']) === String(land['Land Owner ID']) && norm(p['Parcel Number']) === norm(parcelNumber);
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
    if (keyClash(blocks, land['Land Owner ID'], landOwnerName, parcelNumber, name)) { duplicates.push(name); return; }
    var existing = blocks.filter(function (b) {
      return String(b['Land Owner ID']) === String(land['Land Owner ID']) &&
        blockKey(b['Land Owner Name'], b['Parcel Number'], b['Farm and Block Name']) === blockKey(landOwnerName, parcelNumber, name);
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
      'Area Ha': blockNames.length === 1 && toNumber(data.areaHa) > 0 ? toNumber(data.areaHa) : '',
      'Palm Count': blockNames.length === 1 && toNumber(data.palmCount) > 0 ? Math.round(toNumber(data.palmCount)) : '',
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
  syncEntryColumns(ss);   // CLAIF Number / Farm Block Code (and Category only where empty)
  ensureUniqueRecordIds(ss);   // every new row has its own Record ID
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

/**
 * MANUAL SEQUENTIAL ENROLLMENT (v3.5)
 * enrollment = {
 *   landOwnerNo: 'CLAIF-686', landOwnerName, category,
 *   entries: [{ sequenceNo, parcelNumber, farmBlock, areaHa, palmCount }, ...]
 * }
 * - Sequence No. is typed per entry and saved exactly as typed (never generated or renumbered).
 * - An existing CLAIF Number adds the entries to that land owner; its saved info is NOT overwritten.
 * - A parcel number can be used only once per land owner.
 * - Everything is checked first; nothing is saved if one entry is wrong.
 */
function handleEnrollEntries(ctx, data) {
  var ss = ctx.ss;
  var now = new Date().toISOString();
  var landSheet = ss.getSheetByName(SHEET_NAMES.LANDOWNERS);
  var parcelSheet = ss.getSheetByName(SHEET_NAMES.PARCELS);
  var blockSheet = ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);
  var fail = function (msg) { return respondJSON({ success: false, error: msg }); };

  var claif = normalizeClaif(data.landOwnerNo);
  if (!claif) return fail('CLAIF Number must be a word and a number, e.g. CLAIF-686.');
  var entries = data.entries.filter(function (en) {
    return en && [en.sequenceNo, en.parcelNumber, en.farmBlock, en.areaHa, en.palmCount]
      .some(function (v) { return String(v === undefined || v === null ? '' : v).trim() !== ''; });
  });
  if (!entries.length) return fail('Add at least one parcel / block entry.');
  if (entries.length > 200) return fail('Too many entries at once (max 200).');

  // 1) Land owner: found by CLAIF Number first
  // CLAIF Number identifies the land owner. The same name may be used by several CLAIF Numbers
  // (each is a separate land owner); records are never merged by name.
  var landowners = readObjects(landSheet);
  var land = landowners.filter(function (l) { return String(l['CLAIF Number'] || '').toUpperCase() === claif; })[0] || null;
  var landOwnerName = cleanName(data.landOwnerName);
  if (!land && !landOwnerName) return fail('Land Owner Name is required for a new CLAIF Number.');

  // 2) Check every entry before saving anything
  var parcels = readObjects(parcelSheet);
  var blocks = readObjects(blockSheet);
  // A deactivated land owner with no active entries frees its CLAIF Number: it is reactivated
  // under the name typed now (old reports keep the old name as history).
  var reuse = !!land && norm(land['Status']) === 'deactivated' && !blocks.some(function (b) {
    return String(b['Land Owner ID']) === String(land['Land Owner ID']) && norm(b['Status']) !== 'deactivated';
  });
  if (reuse && !landOwnerName) return fail('Land Owner Name is required.');
  var ownerName = land && !reuse ? String(land['Land Owner Name']) : landOwnerName;
  var ownerId = land ? String(land['Land Owner ID']) : '';
  var ownerParcels = {};
  parcels.forEach(function (p) {
    if (ownerId && String(p['Land Owner ID']) === ownerId) ownerParcels[norm(p['Parcel Number'])] = p;
  });
  var activeParcel = {};
  blocks.forEach(function (b) {
    if (ownerId && String(b['Land Owner ID']) === ownerId && norm(b['Status']) !== 'deactivated') activeParcel[norm(b['Parcel Number'])] = true;
  });
  var numberOk = function (v) { var t = String(v === undefined || v === null ? '' : v).trim(); return t === '' || /^\d+(\.\d+)?$/.test(t); };
  var seen = {};
  var clean = [];
  for (var i = 0; i < entries.length; i++) {
    var en = entries[i], row = 'Entry ' + (i + 1) + ': ';
    var seqTxt = String(en.sequenceNo === undefined || en.sequenceNo === null ? '' : en.sequenceNo).trim();
    if (!seqTxt) return fail(row + 'Sequence Number is required (type it manually).');
    if (!/^\d+$/.test(seqTxt) || parseInt(seqTxt, 10) < 1) return fail(row + 'Sequence Number must be a whole number (1, 2, 3...).');
    var parcelNumber = cleanName(en.parcelNumber);
    var blockName = cleanName(en.farmBlock);
    if (!parcelNumber) return fail(row + 'Parcel Number is required.');
    if (!blockName) return fail(row + 'Farm & Block is required.');
    if (!numberOk(en.areaHa)) return fail(row + 'Area (Ha) must be a number.');
    if (!numberOk(en.palmCount) || (String(en.palmCount || '').indexOf('.') >= 0)) return fail(row + 'Palm Count must be a whole number.');
    var catTxt = String(en.category === undefined || en.category === null ? '' : en.category).trim();
    if (catTxt === '' && data.category) catTxt = String(data.category);   // older clients sent one category for all
    if (['priority', 'not priority'].indexOf(norm(catTxt)) === -1) return fail(row + 'Choose Priority or Not Priority.');
    var pk = norm(parcelNumber);
    if (seen[pk]) return fail(row + 'Parcel ' + parcelNumber + ' is entered twice. A parcel number can be used only once per land owner.');
    if (activeParcel[pk]) return fail(row + 'Parcel ' + parcelNumber + ' is already enrolled under ' + ownerName + ' (' + claif + ').');
    var clash = keyClash(blocks, ownerId || '__new__', ownerName, parcelNumber, blockName);
    if (clash) {
      return fail(row + 'Another land owner named ' + ownerName + ' (' + (claifOfOwner(landowners, clash['Land Owner ID']) || clash['Land Owner ID']) +
        ') already has ' + parcelNumber + ' › ' + blockName + '. Use a different parcel number so their reports stay separate.');
    }
    seen[pk] = true;
    clean.push({
      seq: parseInt(seqTxt, 10), category: normalizeCategory(catTxt), parcelNumber: parcelNumber, blockName: blockName,
      area: toNumber(en.areaHa), palms: Math.round(toNumber(en.palmCount))
    });
  }

  // 3) Save: land owner (new, or existing kept as it is)
  var createdLand = false;
  if (!land) {
    land = {
      'Land Owner ID': nextId(landowners, 'Land Owner ID', 'LND-', 3),
      'Land Owner Name': safeText(landOwnerName),
      'Contact Person': '', 'Phone': '', 'Total Hectares': '',
      'Status': 'Active',
      'Date Enrolled': now,
      'CLAIF Number': claif,
      'Category': data.category ? normalizeCategory(data.category) : '',   // legacy only; v3.8 uses each entry's own category
      'Sequence No.': ''
    };
    appendObject(landSheet, land);
    createdLand = true;
  } else {
    var lu = {};
    if (norm(land['Status']) === 'deactivated') lu['Status'] = 'Active';
    if (reuse && String(land['Land Owner Name']) !== landOwnerName) {
      lu['Land Owner Name'] = safeText(landOwnerName);
      lu['Date Enrolled'] = now;
      land['Land Owner Name'] = landOwnerName;
    }
    if (Object.keys(lu).length) updateObjectById(landSheet, 'Land Owner ID', land['Land Owner ID'], lu);
  }
  ownerName = String(land['Land Owner Name']);

  // 4) Parcels and blocks, exactly as typed
  var saved = [];
  clean.forEach(function (c) {
    var parcel = ownerParcels[norm(c.parcelNumber)];
    if (!parcel) {
      parcel = {
        'Parcel ID': nextId(parcels, 'Parcel ID', 'PRC-', 3),
        'Parcel Number': safeText(c.parcelNumber),
        'Land Owner ID': land['Land Owner ID'],
        'Land Owner Name': ownerName,
        'Total Area Ha': '', 'Total Palms': '',
        'Status': 'Active',
        'Date Enrolled': now
      };
      appendObject(parcelSheet, parcel);
      parcels.push(parcel);
      ownerParcels[norm(c.parcelNumber)] = parcel;
    } else if (norm(parcel['Status']) === 'deactivated') {
      updateObjectById(parcelSheet, 'Parcel ID', parcel['Parcel ID'], { 'Status': 'Active', 'Land Owner Name': safeText(ownerName) });
    }
    var parcelNumber = String(parcel['Parcel Number']);

    // A deactivated block with the same name in that parcel is reactivated instead of copied
    var old = blocks.filter(function (b) {
      return String(b['Land Owner ID']) === String(land['Land Owner ID']) &&
        blockKey(b['Land Owner Name'], b['Parcel Number'], b['Farm and Block Name']) === blockKey(ownerName, parcelNumber, c.blockName);
    })[0];
    var values = {
      'Sequence No.': c.seq,
      'Category': c.category,
      'Area Ha': c.area > 0 ? c.area : '',
      'Palm Count': c.palms > 0 ? c.palms : ''
    };
    if (old) {
      values['Status'] = 'Active';
      if (!(c.area > 0)) delete values['Area Ha'];
      if (!(c.palms > 0)) delete values['Palm Count'];
      updateObjectById(blockSheet, 'Block ID', old['Block ID'], values);
    } else {
      var nb = {
        'Block ID': nextId(blocks, 'Block ID', 'BLK-', 3),
        'Farm and Block Name': safeText(c.blockName),
        'Parcel ID': parcel['Parcel ID'],
        'Parcel Number': parcelNumber,
        'Land Owner ID': land['Land Owner ID'],
        'Land Owner Name': ownerName,
        'Area Ha': values['Area Ha'],
        'Palm Count': values['Palm Count'],
        'Status': 'Active',
        'Supervisor ID': '', 'Supervisor Name': 'Unassigned',
        'Date Enrolled': now,
        'Sequence No.': c.seq,
        'Category': c.category,
        'CLAIF Number': claif,
        'Farm Block Code': farmBlockCode(c.blockName),
        'Record ID': nextRecordId(blocks)
      };
      appendObject(blockSheet, nb);
      blocks.push(nb);
    }
    saved.push((c.category === 'Priority' ? 'P-' : 'NP-') + c.seq + ' ' + parcelNumber + ' › ' + c.blockName);
  });

  refreshDerivedSupervisors(ss);
  syncEntryColumns(ss);   // CLAIF Number / Farm Block Code (and Category only where empty)
  ensureUniqueRecordIds(ss);   // every new row has its own Record ID
  logAudit(ctx.userId, ctx.role, 'ENROLL_LANDOWNER', land['Land Owner ID'], 'LandOwners',
    claif + ' ' + ownerName + ' | ' + saved.join('; '));

  return respondJSON({
    success: true,
    message: (createdLand ? 'Enrolled ' : 'Added to ') + ownerName + ' (' + claif + '): ' + saved.length + ' parcel/block entr' + (saved.length === 1 ? 'y' : 'ies') + '.',
    createdLandOwner: createdLand,
    landOwnerId: String(land['Land Owner ID']),
    saved: saved
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
   LAND OWNER CLAIF NUMBER, CATEGORY (Priority / Not Priority) & BLOCK SIZE
   CLAIF Number = word + number, e.g. CLAIF-686 (unique per land owner).
   Area (Ha) and Palm Count are the base for Cycle Monitoring percentages.
   ========================================================================== */

function normalizeCategory(v) {
  return norm(v) === 'priority' ? 'Priority' : 'Not Priority';
}

/** "claif 686", "CLAIF686", "Claif-686" -> "CLAIF-686". Returns '' when the format is wrong. */
function normalizeClaif(v) {
  var s = String(v === undefined || v === null ? '' : v).toUpperCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').trim();
  var m = s.match(/^([A-Z]+)-?(\d+)$/);
  return m ? m[1] + '-' + m[2] : '';
}

function landownerWithNumber(landowners, claif) {
  return landowners.filter(function (l) {
    return String(l['CLAIF Number'] || '').toUpperCase() === String(claif).toUpperCase();   // unique across all records
  })[0] || null;
}

/**
 * Fills a missing category (runs once after an update).
 * CLAIF Numbers and Sequence Numbers are entered by the admin.
 */
function fillLandownerDefaults(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.LANDOWNERS);
  var rows = readObjects(sheet);
  // v3.8: Category belongs to each sequence entry (FarmsAndBlocks), not to the land owner.
  // The land owner's old Category is only used once, to fill entries that have none (syncEntryColumns).
  // Sequence numbers are NEVER filled in automatically (they are typed by the admin).
  return rows.length;
}

/**
 * Keeps the per-entry columns of FarmsAndBlocks complete:
 *  - Category: filled ONLY when empty, from the land owner's old category (one-time migration).
 *    An entry's own category is never overwritten.
 *  - CLAIF Number / Farm Block Code: copies of the land owner's CLAIF and the Farm & Block code.
 */
function syncEntryColumns(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);
  if (!sheet || sheet.getLastRow() <= 1) return;
  var idx = getHeaderIndex(sheet);
  if (idx['Category'] === undefined || idx['CLAIF Number'] === undefined || idx['Farm Block Code'] === undefined) return;
  var owners = {};
  readObjects(ss.getSheetByName(SHEET_NAMES.LANDOWNERS)).forEach(function (l) { owners[String(l['Land Owner ID'])] = l; });
  var rows = readObjects(sheet);
  var cat = [], claif = [], code = [], changed = false;
  rows.forEach(function (b) {
    var lo = owners[String(b['Land Owner ID'])];
    var c = String(b['Category'] || '').trim() ? normalizeCategory(b['Category']) : normalizeCategory(lo ? lo['Category'] : '');
    var n = lo ? String(lo['CLAIF Number'] || '') : String(b['CLAIF Number'] || '');
    var f = farmBlockCode(b['Farm and Block Name']);
    if (c !== String(b['Category'] || '') || n !== String(b['CLAIF Number'] || '') || f !== String(b['Farm Block Code'] || '')) changed = true;
    cat.push([c]); claif.push([n]); code.push([f]);
  });
  if (!changed) return;
  sheet.getRange(2, idx['Category'] + 1, rows.length, 1).setValues(cat);
  sheet.getRange(2, idx['CLAIF Number'] + 1, rows.length, 1).setValues(claif);
  sheet.getRange(2, idx['Farm Block Code'] + 1, rows.length, 1).setValues(code);
}

/**
 * Decides the Sequence No. for a land owner (land = null for a new one).
 * A typed number must be free in that category; otherwise the current number is kept,
 * or the next free number is given (new land owner, or the category changed).
 */
function resolveSequence(landowners, land, category, requested) {
  var landId = land ? String(land['Land Owner ID']) : '';
  if (requested !== null && requested !== undefined) {
    var taken = landowners.filter(function (l) {
      return String(l['Land Owner ID']) !== landId && norm(l['Status']) !== 'deactivated' &&
        normalizeCategory(l['Category']) === category && (parseInt(l['Sequence No.'], 10) || 0) === requested;
    })[0];
    if (taken) {
      return { error: 'Sequence ' + (category === 'Priority' ? 'P-' : 'NP-') + requested + ' is already used by ' + taken['Land Owner Name'] + '.' };
    }
    return { seq: requested };
  }
  // Nothing typed: keep whatever is stored (no automatic numbering or renumbering)
  return { seq: land ? (parseInt(land['Sequence No.'], 10) || 0) : '' };
}

function handleUpdateLandowner(ctx, payload) {
  var ss = ctx.ss;
  var sheet = ss.getSheetByName(SHEET_NAMES.LANDOWNERS);
  var rows = readObjects(sheet);
  var land = rows.filter(function (l) { return String(l['Land Owner ID']) === String(payload.landOwnerId); })[0];
  if (!land) return respondJSON({ success: false, error: 'Land owner not found.' });

  var updates = {};
  if (payload.landOwnerNo !== undefined && String(payload.landOwnerNo).trim() !== '') {
    var claif = normalizeClaif(payload.landOwnerNo);
    if (!claif) return respondJSON({ success: false, error: 'CLAIF Number must be a word and a number, e.g. CLAIF-686.' });
    var owner = landownerWithNumber(rows, claif);
    if (owner && String(owner['Land Owner ID']) !== String(land['Land Owner ID'])) {
      return respondJSON({ success: false, error: 'CLAIF Number ' + claif + ' is already used by ' + owner['Land Owner Name'] + '.' });
    }
    if (claif !== String(land['CLAIF Number'] || '').toUpperCase()) updates['CLAIF Number'] = claif;
  }
  if (payload.category) updates['Category'] = normalizeCategory(payload.category);
  if (payload.contactPerson !== undefined) updates['Contact Person'] = safeText(cleanName(payload.contactPerson));
  if (payload.phone !== undefined) updates['Phone'] = safeText(cleanName(payload.phone));

  // Land owner Sequence No. (only changed when typed; never given automatically)
  var reqSeq = payload.sequenceNo === undefined || String(payload.sequenceNo).trim() === '' ? null : parseInt(payload.sequenceNo, 10);
  if (reqSeq !== null && (isNaN(reqSeq) || reqSeq < 1)) {
    return respondJSON({ success: false, error: 'Sequence No. must be a whole number (1, 2, 3...).' });
  }
  var seqRes = resolveSequence(rows, land, updates['Category'] || normalizeCategory(land['Category']), reqSeq);
  if (seqRes.error) return respondJSON({ success: false, error: seqRes.error });
  if (seqRes.seq && seqRes.seq !== (parseInt(land['Sequence No.'], 10) || 0)) updates['Sequence No.'] = seqRes.seq;

  // Rename the land owner: also updates its parcels, blocks, reports, KPIs and maps
  var oldName = String(land['Land Owner Name']);
  var newName = payload.landOwnerName !== undefined ? cleanName(payload.landOwnerName) : oldName;
  if (!newName) return respondJSON({ success: false, error: 'Land Owner Name cannot be empty.' });
  var renamed = newName !== oldName;
  var landId = String(land['Land Owner ID']);
  var allBlocks = readObjects(ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS));
  // This land owner's own blocks (by Land Owner ID). Other land owners with the same name are never touched.
  var ownBlocks = allBlocks.filter(function (b) { return String(b['Land Owner ID']) === landId; });
  var ownKeys = {};
  ownBlocks.forEach(function (b) { ownKeys[blockKey(oldName, b['Parcel Number'], b['Farm and Block Name'])] = true; });
  if (renamed) {
    // The same name is allowed, but Name + Parcel + Farm & Block must stay unique (reports use it)
    for (var i = 0; i < ownBlocks.length; i++) {
      var ob = ownBlocks[i];
      if (norm(ob['Status']) === 'deactivated') continue;
      var c = keyClash(allBlocks, landId, newName, ob['Parcel Number'], ob['Farm and Block Name']);
      if (c) {
        return respondJSON({ success: false, error: 'Cannot rename: another "' + newName + '" (' + (claifOfOwner(rows, c['Land Owner ID']) || c['Land Owner ID']) +
          ') already has ' + ob['Parcel Number'] + ' › ' + ob['Farm and Block Name'] + '.' });
      }
    }
    updates['Land Owner Name'] = safeText(newName);
  }

  updateObjectById(sheet, 'Land Owner ID', landId, updates);
  if (updates['CLAIF Number']) syncEntryColumns(ss);   // the entries keep a copy of the CLAIF Number (category is NOT copied)

  // Reports / KPIs / maps of THIS land owner = rows whose Name + Parcel + Farm & Block is one of its blocks
  var ownRow = function (name, parcel, blockName) { return !!ownKeys[blockKey(name, parcel, blockName)]; };
  var ownMap = function (r) {
    if (String(r['Farm & Block'] || '') || String(r['Parcel Number'] || '')) return ownRow(r['Land Owner'], r['Parcel Number'], r['Farm & Block']);
    // map registered for the land owner only: changed only when no other land owner has that name
    return norm(r['Land Owner']) === norm(oldName) && !rows.some(function (l) {
      return String(l['Land Owner ID']) !== landId && norm(l['Land Owner Name']) === norm(oldName);
    });
  };
  var changedReports = 0;
  if (renamed) {
    rewriteRows(ss.getSheetByName(SHEET_NAMES.PARCELS), function (r) { return String(r['Land Owner ID']) === landId; }, { 'Land Owner Name': newName });
    rewriteRows(ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS), function (r) { return String(r['Land Owner ID']) === landId; }, { 'Land Owner Name': newName });
    rewriteRows(ss.getSheetByName(SHEET_NAMES.KPIS), function (r) { return ownRow(r['Land Owner'], r['Parcel Number'], r['Farm & Block']); }, { 'Land Owner': newName });
    rewriteRows(ss.getSheetByName(SHEET_NAMES.MAPS), ownMap, { 'Land Owner': newName });
    reportSheets(ss).forEach(function (sh) {
      changedReports += rewriteRows(sh, function (r) { return ownRow(r['Land Owners Name'], r['Parcel Number'], r['Farm & Block']); },
        { 'Land Owners Name': newName, 'CLAIF Number': updates['CLAIF Number'] || String(land['CLAIF Number'] || '') });
    });
  } else if (updates['CLAIF Number']) {
    reportSheets(ss).forEach(function (sh) {
      rewriteRows(sh, function (r) { return ownRow(r['Land Owners Name'], r['Parcel Number'], r['Farm & Block']); }, { 'CLAIF Number': updates['CLAIF Number'] });
    });
  }

  logAudit(ctx.userId, ctx.role, 'UPDATE_LANDOWNER', land['Land Owner ID'], 'LandOwners',
    JSON.stringify(updates) + (renamed ? ' | renamed from "' + oldName + '", ' + changedReports + ' report(s) updated' : ''));
  return respondJSON({ success: true, message: 'Land owner ' + newName + ' updated.' + (renamed ? ' ' + changedReports + ' report(s) moved to the new name.' : '') });
}

function handleUpdateBlock(ctx, payload) {
  var ss = ctx.ss;
  var sheet = ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);
  ensureUniqueRecordIds(ss);
  // Exactly ONE row is changed: the row with this Record ID (REC-xxxx). Name / CLAIF are never used to find it.
  var found = findRecordRow(sheet, payload.recordId);
  if (found.error) return respondJSON({ success: false, error: found.error });
  var block = found.record;
  var blocks = found.rows;
  if (payload.blockId && String(payload.blockId) !== String(block['Block ID'])) {
    return respondJSON({ success: false, error: 'Record ' + payload.recordId + ' does not match the row you opened. Nothing was changed — please refresh.' });
  }

  var updates = {};
  if (payload.areaHa !== undefined) {
    var area = toNumber(payload.areaHa);
    if (area < 0) return respondJSON({ success: false, error: 'Area cannot be negative.' });
    updates['Area Ha'] = area || '';
  }
  if (payload.palmCount !== undefined) {
    var palms = Math.round(toNumber(payload.palmCount));
    if (palms < 0) return respondJSON({ success: false, error: 'Palm count cannot be negative.' });
    updates['Palm Count'] = palms || '';
  }
  if (payload.category !== undefined && String(payload.category).trim() !== '') {
    if (['priority', 'not priority'].indexOf(norm(payload.category)) === -1) {
      return respondJSON({ success: false, error: 'Category must be Priority or Not Priority.' });
    }
    updates['Category'] = normalizeCategory(payload.category);   // this entry only
  }
  if (payload.sequenceNo !== undefined) {
    var seqTxt = String(payload.sequenceNo).trim();
    if (seqTxt === '') {
      updates['Sequence No.'] = '';
    } else if (!/^\d+$/.test(seqTxt) || parseInt(seqTxt, 10) < 1) {
      return respondJSON({ success: false, error: 'Sequence No. must be a whole number (1, 2, 3...).' });
    } else {
      updates['Sequence No.'] = parseInt(seqTxt, 10);
    }
  }

  // ---- Land owner name / CLAIF / parcel / Farm & Block of THIS row only (v4.0.1)
  // Other rows with the same name or CLAIF Number are never changed.
  var now = new Date().toISOString();
  var landSheet = ss.getSheetByName(SHEET_NAMES.LANDOWNERS);
  var landowners = readObjects(landSheet);
  var oldOwnerId = String(block['Land Owner ID']);
  var oldOwner = landowners.filter(function (l) { return String(l['Land Owner ID']) === oldOwnerId; })[0] || null;
  var oldClaif = oldOwner ? String(oldOwner['CLAIF Number'] || '') : String(block['CLAIF Number'] || '');
  var oldName = String(block['Land Owner Name']);
  var oldParcel = String(block['Parcel Number']);
  var blockName = String(block['Farm and Block Name']);

  var newName = payload.landOwnerName !== undefined ? cleanName(payload.landOwnerName) : oldName;
  if (!newName) return respondJSON({ success: false, error: 'Land Owner Name cannot be empty.' });
  var newClaif = oldClaif;
  if (payload.landOwnerNo !== undefined && String(payload.landOwnerNo).trim() !== '' && String(payload.landOwnerNo).trim().toUpperCase() !== 'CLAIF-') {
    newClaif = normalizeClaif(payload.landOwnerNo);
    if (!newClaif) return respondJSON({ success: false, error: 'CLAIF Number must be a word and a number, e.g. CLAIF-686.' });
  }
  var newParcel = payload.parcelNumber !== undefined ? cleanName(payload.parcelNumber) : oldParcel;
  var newBlockName = payload.farmBlock !== undefined ? cleanName(payload.farmBlock) : blockName;
  if (!newParcel) return respondJSON({ success: false, error: 'Parcel Number cannot be empty.' });
  if (!newBlockName) return respondJSON({ success: false, error: 'Farm & Block cannot be empty.' });

  // A different CLAIF Number moves ONLY this row to that land owner (or to a new land owner record)
  var targetOwner = oldOwner, createOwner = false;
  if (String(newClaif).toUpperCase() !== String(oldClaif).toUpperCase()) {
    targetOwner = landownerWithNumber(landowners, newClaif);
    if (!targetOwner) createOwner = true;
  }
  var ownerChanged = createOwner || (targetOwner && String(targetOwner['Land Owner ID']) !== oldOwnerId);
  var renamed = newName !== oldName;
  var moved = norm(newParcel) !== norm(oldParcel);
  var renamedBlock = newBlockName !== blockName;
  var keyChanged = renamed || moved || renamedBlock;
  var needParcel = moved || ownerChanged;
  var changedReports = 0;

  if (keyChanged) {
    var clash = blocks.filter(function (b) {
      return String(b['Block ID']) !== String(block['Block ID']) && norm(b['Status']) !== 'deactivated' &&
        blockKey(b['Land Owner Name'], b['Parcel Number'], b['Farm and Block Name']) === blockKey(newName, newParcel, newBlockName);
    })[0];
    if (clash) {
      return respondJSON({ success: false, error: 'Another row (' + (clash['Record ID'] || clash['Block ID']) + ') already has ' + newName + ' › ' + newParcel + ' › ' + newBlockName + '.' });
    }
  }

  if (createOwner) {
    targetOwner = {
      'Land Owner ID': nextId(landowners, 'Land Owner ID', 'LND-', 3),
      'Land Owner Name': safeText(newName), 'Contact Person': '', 'Phone': '', 'Total Hectares': '',
      'Status': 'Active', 'Date Enrolled': now, 'CLAIF Number': newClaif, 'Category': '', 'Sequence No.': ''
    };
    appendObject(landSheet, targetOwner);
  } else if (ownerChanged && norm(targetOwner['Status']) === 'deactivated') {
    updateObjectById(landSheet, 'Land Owner ID', targetOwner['Land Owner ID'], { 'Status': 'Active' });
  }
  var targetId = targetOwner ? String(targetOwner['Land Owner ID']) : oldOwnerId;

  var parcelSheet = ss.getSheetByName(SHEET_NAMES.PARCELS);
  if (needParcel) {
    // Find or create the parcel under the (new) land owner of this row
    var parcels = readObjects(parcelSheet);
    var parcel = parcels.filter(function (p) {
      return String(p['Land Owner ID']) === targetId && norm(p['Parcel Number']) === norm(newParcel);
    })[0];
    if (!parcel) {
      parcel = {
        'Parcel ID': nextId(parcels, 'Parcel ID', 'PRC-', 3), 'Parcel Number': safeText(newParcel),
        'Land Owner ID': targetId, 'Land Owner Name': safeText(newName), 'Total Area Ha': '', 'Total Palms': '',
        'Status': 'Active', 'Date Enrolled': now
      };
      appendObject(parcelSheet, parcel);
    } else if (norm(parcel['Status']) === 'deactivated') {
      updateObjectById(parcelSheet, 'Parcel ID', parcel['Parcel ID'], { 'Status': 'Active' });
    }
    newParcel = String(parcel['Parcel Number']);
    updates['Parcel Number'] = newParcel;
    updates['Parcel ID'] = parcel['Parcel ID'];
  } else if (renamed) {
    // the parcel record shows the name too: change it only if no other row uses that parcel
    var shared = blocks.some(function (b) { return String(b['Block ID']) !== String(block['Block ID']) && String(b['Parcel ID']) === String(block['Parcel ID']); });
    if (!shared) updateObjectById(parcelSheet, 'Parcel ID', block['Parcel ID'], { 'Land Owner Name': safeText(newName) });
  }
  if (renamed) updates['Land Owner Name'] = safeText(newName);
  if (renamedBlock) updates['Farm and Block Name'] = safeText(newBlockName);
  if (ownerChanged) {
    updates['Land Owner ID'] = targetId;
    updates['CLAIF Number'] = String(targetOwner['CLAIF Number'] || newClaif);
  }

  if (keyChanged || ownerChanged) {
    // Move THIS row's reports and KPIs (Name + Parcel + Farm & Block is unique per row)
    var thisBlock = function (lo, p, b) { return blockKey(lo, p, b) === blockKey(oldName, oldParcel, blockName); };
    var newClaifValue = ownerChanged ? String(targetOwner['CLAIF Number'] || newClaif) : oldClaif;
    reportSheets(ss).forEach(function (sh) {
      changedReports += rewriteRows(sh, function (r) { return thisBlock(r['Land Owners Name'], r['Parcel Number'], r['Farm & Block']); },
        { 'Land Owners Name': newName, 'Parcel Number': newParcel, 'Farm & Block': newBlockName, 'CLAIF Number': newClaifValue });
    });
    rewriteRows(ss.getSheetByName(SHEET_NAMES.KPIS), function (r) { return thisBlock(r['Land Owner'], r['Parcel Number'], r['Farm & Block']); },
      { 'Land Owner': newName, 'Parcel Number': newParcel, 'Farm & Block': newBlockName });
  }

  if (renamedBlock) updates['Farm Block Code'] = farmBlockCode(newBlockName);
  updateRowByRecordId(sheet, found.row, String(block['Record ID']), updates);   // ONE row only
  if (renamedBlock) refreshDerivedSupervisors(ss);   // the entry may now belong to another supervisor's Farm & Block

  if (needParcel || ownerChanged) {
    var after = readObjects(sheet);
    // the old parcel with no rows left is deactivated (it can be reused later)
    var parcelUsed = after.some(function (b) {
      return norm(b['Status']) !== 'deactivated' && String(b['Land Owner ID']) === oldOwnerId && norm(b['Parcel Number']) === norm(oldParcel);
    });
    if (!parcelUsed) {
      rewriteRows(parcelSheet, function (p) {
        return String(p['Land Owner ID']) === oldOwnerId && norm(p['Parcel Number']) === norm(oldParcel);
      }, { 'Status': 'Deactivated' });
    }
    // a land owner record left without any rows is deactivated (never deleted)
    if (ownerChanged && !after.some(function (b) { return String(b['Land Owner ID']) === oldOwnerId && norm(b['Status']) !== 'deactivated'; })) {
      updateObjectById(landSheet, 'Land Owner ID', oldOwnerId, { 'Status': 'Deactivated' });
    }
  }
  var moved2 = moved || renamedBlock || renamed || ownerChanged;
  var blockNameNow = newBlockName;
  logAudit(ctx.userId, ctx.role, 'UPDATE_BLOCK', block['Record ID'] + ' / ' + block['Block ID'], 'FarmsAndBlocks',
    JSON.stringify(updates) + (moved2 ? ' | ' + oldClaif + ' ' + oldName + ' › ' + oldParcel + ' › ' + blockName + ' → ' + newClaif + ' ' + newName + ' › ' + newParcel + ' › ' + blockNameNow + ', ' + changedReports + ' report(s) updated' : ''));
  return respondJSON({
    success: true,
    recordId: String(block['Record ID']),
    message: 'Entry ' + block['Record ID'] + ' updated (only this row).' + (moved2 ? ' ' + changedReports + ' report(s) of this row updated.' : '')
  });
}

/**
 * Deletes ONE parcel / farm & block entry (by its Record ID = Block ID).
 * The land owner profile and the land owner's other entries are kept.
 * Reports already submitted are kept as history. KPIs of this entry are deactivated.
 */
function handleDeleteBlock(ctx, payload) {
  var ss = ctx.ss;
  var sheet = ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);
  ensureUniqueRecordIds(ss);
  var found = findRecordRow(sheet, payload.recordId);
  if (found.error) return respondJSON({ success: false, error: found.error });
  var block = found.record;
  var recordId = String(block['Record ID']);
  if (payload.blockId && String(payload.blockId) !== String(block['Block ID'])) {
    return respondJSON({ success: false, error: 'Record ' + recordId + ' does not match the row you opened. Nothing was deleted — please refresh.' });
  }

  // Delete exactly that sheet row (its Record ID is checked again right before deleting)
  var idx = getHeaderIndex(sheet);
  if (String(sheet.getRange(found.row, idx['Record ID'] + 1).getValue()).trim() !== recordId) {
    return respondJSON({ success: false, error: 'Record ' + recordId + ' moved while deleting. Nothing was deleted — please try again.' });
  }
  sheet.deleteRow(found.row);

  // KPIs of this entry are switched off (not deleted)
  var key = blockKey(block['Land Owner Name'], block['Parcel Number'], block['Farm and Block Name']);
  rewriteRows(ss.getSheetByName(SHEET_NAMES.KPIS), function (r) {
    return blockKey(r['Land Owner'], r['Parcel Number'], r['Farm & Block']) === key;
  }, { 'Status': 'Deactivated' });

  // A parcel with no entries left is deactivated (kept, can be reused). The land owner is never removed.
  var stillUsed = readObjects(sheet).some(function (b) {
    return String(b['Land Owner ID']) === String(block['Land Owner ID']) && norm(b['Parcel Number']) === norm(block['Parcel Number']) &&
      norm(b['Status']) !== 'deactivated';
  });
  if (!stillUsed) {
    rewriteRows(ss.getSheetByName(SHEET_NAMES.PARCELS), function (p) {
      return String(p['Parcel ID']) === String(block['Parcel ID']);
    }, { 'Status': 'Deactivated' });
  }

  refreshDerivedSupervisors(ss);
  logAudit(ctx.userId, ctx.role, 'DELETE_BLOCK', recordId, 'FarmsAndBlocks', 'Deleted entry: ' + JSON.stringify(block));
  return respondJSON({
    success: true,
    recordId: recordId,
    message: 'Deleted entry ' + recordId + ' (' + block['Land Owner Name'] + ' › ' + block['Parcel Number'] + ' › ' + block['Farm and Block Name'] + '). Other entries were not changed.'
  });
}

/** The ONE entry with this Record ID (Block ID). */
function findRecord(blocks, recordId) {
  var id = String(recordId === undefined || recordId === null ? '' : recordId).trim();
  if (!id) return { error: 'Record ID is missing.' };
  var matches = blocks.filter(function (b) { return String(b['Block ID']) === id; });
  if (!matches.length) return { error: 'Record ' + id + ' was not found. It may have been deleted already — please refresh.' };
  if (matches.length > 1) return { error: 'Record ID ' + id + ' is used by ' + matches.length + ' rows. Run Setup Database once to repair the IDs.' };
  return { record: matches[0] };
}

/**
 * Migration: every row in FarmsAndBlocks gets its own Record ID (Block ID).
 * Rows with an empty or repeated ID get a new one. Nothing is merged or deleted.
 */
function ensureUniqueRecordIds(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.FARMS_BLOCKS);
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  var idx = getHeaderIndex(sheet);
  if (idx['Block ID'] === undefined) return 0;
  var range = sheet.getRange(2, idx['Block ID'] + 1, sheet.getLastRow() - 1, 1);
  var ids = range.getValues();
  var max = 0;
  ids.forEach(function (r) { var m = String(r[0]).match(/^BLK-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  var seen = {}, fixed = 0;
  ids.forEach(function (r) {
    var id = String(r[0] || '').trim();
    if (!id || seen[id]) { max++; r[0] = 'BLK-' + pad(max, 3); fixed++; }
    seen[String(r[0])] = true;
  });
  if (fixed) range.setValues(ids);

  // Record ID column (REC-0001...): one permanent, unique ID per row. Existing IDs are never changed.
  idx = getHeaderIndex(sheet);
  if (idx['Record ID'] !== undefined) {
    var rr = sheet.getRange(2, idx['Record ID'] + 1, sheet.getLastRow() - 1, 1);
    var recs = rr.getValues();
    var rmax = 0;
    recs.forEach(function (r) { var m = String(r[0]).match(/^REC-(\d+)$/); if (m) rmax = Math.max(rmax, parseInt(m[1], 10)); });
    var rseen = {}, rfixed = 0;
    recs.forEach(function (r) {
      var id = String(r[0] || '').trim();
      if (!id || rseen[id]) { rmax++; r[0] = 'REC-' + pad(rmax, 4); rfixed++; }
      rseen[String(r[0])] = true;
    });
    if (rfixed) rr.setValues(recs);
    fixed += rfixed;
  }
  return fixed;
}

function nextRecordId(rows) {
  var max = 0;
  rows.forEach(function (r) { var m = String(r['Record ID'] || '').match(/^REC-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return 'REC-' + pad(max + 1, 4);
}

/**
 * The ONE sheet row whose Record ID equals recordId.
 * Returns { record, row } (row = sheet row number) or { error }.
 */
function findRecordRow(sheet, recordId) {
  var id = String(recordId === undefined || recordId === null ? '' : recordId).trim();
  if (!id) return { error: 'Record ID is missing. Refresh the app and try again.' };
  var rows = readObjects(sheet);
  var hits = [];
  rows.forEach(function (r, i) { if (String(r['Record ID'] || '').trim() === id) hits.push({ record: r, row: i + 2 }); });
  if (!hits.length) return { error: 'Record ' + id + ' was not found. It may have been deleted already — please refresh.' };
  if (hits.length > 1) return { error: 'Record ID ' + id + ' is used by ' + hits.length + ' rows. Nothing was changed.' };
  return { record: hits[0].record, row: hits[0].row, rows: rows };
}

/** Writes the given columns into ONE sheet row, after checking that row still has this Record ID. */
function updateRowByRecordId(sheet, rowNumber, recordId, updates) {
  var idx = getHeaderIndex(sheet);
  if (String(sheet.getRange(rowNumber, idx['Record ID'] + 1).getValue()).trim() !== String(recordId)) {
    throw new Error('Record ' + recordId + ' moved while saving. Nothing was changed — please try again.');
  }
  for (var h in updates) {
    if (updates[h] === undefined || idx[h] === undefined) continue;
    sheet.getRange(rowNumber, idx[h] + 1).setValue(updates[h]);
  }
}

/** All report sheets: the 6 built-in activities + every custom activity sheet. */
function reportSheets(ss) {
  var names = [];
  for (var t in ACTIVITY_SHEETS) names.push(ACTIVITY_SHEETS[t]);
  readCustomActivities(ss).forEach(function (d) { names.push(d.sheetName); });
  return names.map(function (n) { return ss.getSheetByName(n); }).filter(function (sh) { return !!sh; });
}

/**
 * Sets the given columns on every row where match(rowObject) is true.
 * Writes each changed column back in one call. Returns the number of rows changed.
 */
function rewriteRows(sheet, match, values) {
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  var headers = getHeaders(sheet);
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  var tz = Session.getScriptTimeZone();
  var cols = {};
  for (var h in values) { var c = headers.indexOf(h); if (c !== -1) cols[h] = c; }
  var changed = 0;
  data.forEach(function (row) {
    var obj = {};
    headers.forEach(function (hd, j) {
      var v = row[j];
      if (v instanceof Date) v = (hd === 'Date' || hd === 'Effective Date') ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
      obj[hd] = v;
    });
    if (!match(obj)) return;
    for (var k in cols) row[cols[k]] = safeText(values[k]);
    changed++;
  });
  if (changed) {
    for (var k in cols) {
      // text is re-protected so nothing turns into a formula when written back
      sheet.getRange(2, cols[k] + 1, data.length, 1).setValues(data.map(function (r) {
        var v = r[cols[k]];
        return [typeof v === 'string' ? safeText(v.replace(/^'/, '')) : v];
      }));
    }
  }
  return changed;
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
  if ([ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.FARM_OFFICER, ROLES.FIELD].indexOf(role) === -1) {
    return respondJSON({ success: false, error: 'Invalid role.' });
  }
  var taken = users.some(function (u) {
    return norm(u['Username']) === username && (isNew || String(u['User ID']) !== String(data.userId));
  });
  if (taken) return respondJSON({ success: false, error: 'Username "' + username + '" is already used.' });

  if (isNew && !isValidClientHash(data.passwordHash)) {
    return respondJSON({ success: false, error: 'A password is required for a new user.' });
  }

  // Farm & Block assignment (Farm & Block codes, e.g. F04-B01). Administrators always get ALL.
  var codes, blockIds;
  if (role === ROLES.ADMIN) {
    codes = 'ALL';
    blockIds = 'ALL';
  } else if (role === ROLES.FARM_OFFICER) {
    // Farm Officer: whole farms (FARM:F04 ...), so blocks enrolled later are included automatically
    var reqFarms = (Array.isArray(data.assignedFarmAndBlocks) ? data.assignedFarmAndBlocks : parseList(data.assignedFarmAndBlocks))
      .map(function (x) { return String(x).trim(); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var knownFarms = {};
    blocks.forEach(function (b) { if (norm(b['Status']) !== 'deactivated') knownFarms[farmKeyOf(b['Farm and Block Name'])] = true; });
    var badFarms = reqFarms.filter(function (k) { return !knownFarms[k]; });
    if (badFarms.length) return respondJSON({ success: false, error: 'Unknown farm: ' + badFarms.map(function (k) { return k.replace(/^FARM:(N:)?/, ''); }).join(', ') + '.' });
    if (!reqFarms.length) return respondJSON({ success: false, error: 'Please assign at least one Farm to the Farm Officer.' });
    codes = reqFarms;
    blockIds = resolveAssignedBlockIds(codes.join(','), blocks);
  } else {
    var requested = Array.isArray(data.assignedFarmAndBlocks) ? data.assignedFarmAndBlocks : parseList(data.assignedFarmAndBlocks);
    codes = resolveAssignedCodes(requested.join(','), blocks);   // duplicates are removed here
    if (codes === 'ALL') {
      var allCodes = [];
      blocks.forEach(function (b) {
        var c = farmBlockCode(b['Farm and Block Name']);
        if (norm(b['Status']) !== 'deactivated' && allCodes.indexOf(c) === -1) allCodes.push(c);
      });
      codes = allCodes;   // "Select All" for non-admins = every Farm & Block that exists now
    }
    var known = {};
    blocks.forEach(function (b) { known[farmBlockCode(b['Farm and Block Name'])] = true; });
    var unknown = codes.filter(function (c) { return !known[c]; });
    if (unknown.length) return respondJSON({ success: false, error: 'Unknown Farm & Block: ' + unknown.join(', ') + '.' });
    if (!codes.length) {
      return respondJSON({ success: false, error: 'Please assign at least one Farm & Block.' });
    }
    blockIds = resolveAssignedBlockIds(codes.join(','), blocks);
  }

  // One supervisor per Farm & Block, so the supervisor can be found automatically
  if (role === ROLES.SUPERVISOR) {
    var supMap = computeBlockSupervisors(users, blocks);
    var conflicts = [];
    var seenConflict = {};
    blockIds.forEach(function (id) {
      (supMap[id] || []).forEach(function (s) {
        if (s.userId !== String(data.userId || '')) {
          var b = blocks.filter(function (x) { return String(x['Block ID']) === id; })[0];
          var label = b ? farmBlockLabels(farmBlockCode(b['Farm and Block Name']), b['Farm and Block Name']).full : id;
          if (seenConflict[label + s.userId]) return;
          seenConflict[label + s.userId] = true;
          conflicts.push(label + ' (already supervised by ' + s.fullName + ')');
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
    'Assigned Farm and Blocks': codes === 'ALL' ? 'ALL' : codes.join(', '),
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

/* ==========================================================================
   JOB ORDERS (v4.0)
   Job orders belong to ONE Farm & Block (code e.g. F04-B01). Who can see them
   follows the same Farm & Block rule as the rest of FarmOps:
     Administrator -> all; Supervisor / Field Personnel -> their Farm & Blocks only.
   Every block has a supervisor; that supervisor is notified automatically.
   The app works offline: actions are queued on the phone and sent in one
   JO_SYNC call (push queued actions + pull job orders and notifications).
   ========================================================================== */

var JO_STATUSES = ['PENDING', 'RECEIVED', 'IN PROGRESS', 'CLOSED', 'CANCELLED'];
var JO_PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];
var JO_ATTACHMENT_FOLDER = 'FarmOps Job Order Attachments';
var JO_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Farm & Block codes this user may see (null = all). */
function joVisibleCodes(ctx) {
  if (ctx.isAdmin || ctx.allowAll) return null;
  var set = {};
  ctx.scopeBlocks.forEach(function (b) { set[farmBlockCode(b['Farm and Block Name'])] = true; });
  return set;
}

function joCanSee(ctx, codes, jo) {
  return !codes || !!codes[String(jo['Farm Block Code'])];
}

/** Active supervisors of a Farm & Block code. */
function joSupervisorsOf(ctx, code) {
  return ctx.users.filter(function (u) {
    if (String(u['Role']) !== ROLES.SUPERVISOR || norm(u['Account Status']) !== 'active') return false;
    var c = resolveAssignedCodes(u['Assigned Farm and Blocks'], ctx.blocks);
    return c === 'ALL' || c.indexOf(code) !== -1;
  });
}

/** Is userId an active user who can see this code? */
function joUserCovers(ctx, userId, code) {
  var u = findUser(ctx.users, userId);
  if (!u || norm(u['Account Status']) !== 'active') return null;
  if (String(u['Role']) === ROLES.ADMIN) return u;
  var c = resolveAssignedCodes(u['Assigned Farm and Blocks'], ctx.blocks);
  return c === 'ALL' || c.indexOf(code) !== -1 ? u : null;
}

function joIsBoss(ctx, code) {
  if (ctx.isAdmin) return true;
  if (ctx.role === ROLES.FARM_OFFICER) return ctx.scopeBlocks.some(function (b) { return farmBlockCode(b['Farm and Block Name']) === code; });
  return ctx.role === ROLES.SUPERVISOR && joSupervisorsOf(ctx, code).some(function (s) { return String(s['User ID']) === ctx.userId; });
}

function joNameOf(ctx, userId) {
  var u = userId ? findUser(ctx.users, userId) : null;
  return u ? String(u['Full Name']) : '';
}

function joPublic(jo) {
  var out = {};
  var map = {
    'JO Code': 'joCode', 'Temp Code': 'tempCode', 'Title': 'title', 'Description': 'description',
    'Farm Block Code': 'farmBlockCode', 'Farm & Block': 'farmBlock', 'Record ID': 'recordId',
    'Land Owner': 'landOwner', 'CLAIF Number': 'landOwnerNo', 'Parcel Number': 'parcelNumber',
    'Priority': 'priority', 'Due Date': 'dueDate', 'Status': 'status',
    'Created By': 'createdBy', 'Created By Name': 'createdByName', 'Created At': 'createdAt',
    'Assigned To': 'assignedTo', 'Assigned To Name': 'assignedToName',
    'Claimed By': 'claimedBy', 'Claimed By Name': 'claimedByName', 'Claimed At': 'claimedAt', 'Claimed Device': 'claimedDevice',
    'Closed By': 'closedBy', 'Closed By Name': 'closedByName', 'Closed At': 'closedAt', 'Last Updated': 'lastUpdated'
  };
  for (var h in map) {
    var v = jo[h];
    if (v instanceof Date) v = h === 'Due Date' ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : v.toISOString();
    out[map[h]] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

/**
 * JO_SYNC: { actions: [ {syncId, type, joCode, deviceId, clientTime, data} ... ] }
 * Returns { results: [{syncId, ok, duplicate?, conflict?, message, joCode}], codeMap: {TMP-x: JO-...},
 *           jobOrders, responses, notifications, assignees, serverTime }
 */
function handleJoSync(ctx, payload) {
  var ss = ctx.ss;
  var actions = Array.isArray(payload.actions) ? payload.actions.slice(0, 100) : [];
  var joSheet = ss.getSheetByName(SHEET_NAMES.JOB_ORDERS);
  var respSheet = ss.getSheetByName(SHEET_NAMES.JO_RESPONSES);
  var auditSheet = ss.getSheetByName(SHEET_NAMES.JO_AUDIT);
  var codes = joVisibleCodes(ctx);

  var done = {};
  readObjects(auditSheet).forEach(function (a) { if (a['Sync ID']) done[String(a['Sync ID'])] = true; });
  var jos = readObjects(joSheet);
  var st = { ss: ss, joSheet: joSheet, respSheet: respSheet, auditSheet: auditSheet, jos: jos, codes: codes, codeMap: {} };

  var results = actions.map(function (tx) {
    var syncId = String(tx && tx.syncId || '');
    try {
      if (!syncId) throw joFail('Missing sync ID.');
      if (done[syncId]) {
        return { syncId: syncId, ok: true, duplicate: true, joCode: joResolve(st, tx.joCode), message: 'Already saved.' };
      }
      var r = joApply(ctx, st, tx);
      done[syncId] = true;
      r.syncId = syncId;
      r.ok = true;
      return r;
    } catch (err) {
      return { syncId: syncId, ok: false, conflict: !!err.conflict, message: String(err.message || err) };
    }
  });

  // ---- pull: what this user may see
  var visible = st.jos.filter(function (j) { return joCanSee(ctx, codes, j); })
    .sort(function (a, b) { return String(b['Last Updated']).localeCompare(String(a['Last Updated'])); })
    .slice(0, 1500);
  var visibleSet = {};
  visible.forEach(function (j) { visibleSet[String(j['JO Code'])] = true; });
  var responses = readObjects(respSheet).filter(function (r) { return visibleSet[String(r['JO Code'])]; }).map(function (r) {
    var t = r['Timestamp'];
    return {
      responseId: String(r['Response ID']), joCode: String(r['JO Code']), type: String(r['Type'] || 'RESPONSE'),
      text: String(r['Response Text'] || ''), userId: String(r['User ID'] || ''), userName: String(r['User Name'] || ''),
      deviceId: String(r['Device ID'] || ''), timestamp: t instanceof Date ? t.toISOString() : String(t || ''),
      syncId: String(r['Sync ID'] || ''), attachment: String(r['Attachment Link'] || ''), attachmentName: String(r['Attachment Name'] || '')
    };
  });
  var notifications = readObjects(ss.getSheetByName(SHEET_NAMES.NOTIFICATIONS))
    .filter(function (n) { return String(n['User ID']) === ctx.userId; })
    .map(function (n) {
      var c = n['Created At'], rd = n['Read At'];
      return {
        notificationId: String(n['Notification ID']), joCode: String(n['JO Code'] || ''), type: String(n['Type'] || ''),
        message: String(n['Message'] || ''), createdAt: c instanceof Date ? c.toISOString() : String(c || ''),
        readAt: rd instanceof Date ? rd.toISOString() : String(rd || '')
      };
    })
    .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); })
    .slice(0, 200);

  // people who can be assigned (admin / supervisor only)
  var assignees = [];
  if (ctx.isAdmin || SUP_ROLES.indexOf(ctx.role) !== -1) {
    ctx.users.forEach(function (u) {
      if (norm(u['Account Status']) !== 'active' || String(u['Role']) === ROLES.ADMIN) return;
      var c = resolveAssignedCodes(u['Assigned Farm and Blocks'], ctx.blocks);
      if (c !== 'ALL' && codes) c = c.filter(function (x) { return codes[x]; });
      if (c !== 'ALL' && !c.length) return;
      assignees.push({ userId: String(u['User ID']), fullName: String(u['Full Name']), role: String(u['Role']), codes: c === 'ALL' ? ['ALL'] : c });
    });
  }

  return respondJSON({
    success: true,
    results: results,
    codeMap: st.codeMap,
    jobOrders: visible.map(joPublic),
    responses: responses,
    notifications: notifications,
    assignees: assignees,
    serverTime: new Date().toISOString()
  });
}

function joFail(msg, conflict) { var e = new Error(msg); e.conflict = !!conflict; return e; }

/** TMP-... code -> real JO code (also for creates sent earlier). */
function joResolve(st, code) {
  code = String(code || '');
  if (code.indexOf('TMP-') !== 0) return code;
  if (st.codeMap[code]) return st.codeMap[code];
  var j = st.jos.filter(function (x) { return String(x['Temp Code']) === code; })[0];
  return j ? String(j['JO Code']) : code;
}

function joFind(st, code) {
  return st.jos.filter(function (x) { return String(x['JO Code']) === code; })[0] || null;
}

function joSet(st, jo, updates) {
  updateObjectById(st.joSheet, 'JO Code', jo['JO Code'], updates);
  for (var k in updates) jo[k] = updates[k];
}

function joAudit(ctx, st, tx, joCode, action, oldStatus, newStatus, remarks, attachment) {
  appendObject(st.auditSheet, {
    'Audit ID': 'JOA-' + Utilities.getUuid(), 'JO Code': joCode, 'Action': action,
    'Old Status': oldStatus || '-', 'New Status': newStatus || '-',
    'User ID': ctx.userId, 'User Name': String(ctx.user['Full Name']), 'Device ID': safeText(String(tx.deviceId || '')),
    'Timestamp': new Date().toISOString(), 'Sync ID': String(tx.syncId), 'Remarks': safeText(remarks || ''), 'Attachment Link': attachment || ''
  });
}

function joRespond(ctx, st, tx, joCode, type, text, attachment, attachmentName) {
  appendObject(st.respSheet, {
    'Response ID': 'JOR-' + Utilities.getUuid(), 'JO Code': joCode, 'Type': type, 'Response Text': safeText(text),
    'User ID': ctx.userId, 'User Name': String(ctx.user['Full Name']), 'Device ID': safeText(String(tx.deviceId || '')),
    'Timestamp': new Date().toISOString(), 'Sync ID': String(tx.syncId), 'Attachment Link': attachment || '',
    'Attachment Name': safeText(attachmentName || '')
  });
}

/** In-app notifications (no e-mail): one row per person, never to the person who did the action. */
function joNotify(ctx, st, jo, type, message, userIds) {
  var sheet = st.ss.getSheetByName(SHEET_NAMES.NOTIFICATIONS);
  var seen = {};
  userIds.forEach(function (id) {
    id = String(id || '');
    if (!id || id === ctx.userId || seen[id]) return;
    if (!joUserCovers(ctx, id, String(jo['Farm Block Code']))) return;   // only people who can open it
    seen[id] = true;
    appendObject(sheet, {
      'Notification ID': 'NTF-' + Utilities.getUuid(), 'User ID': id, 'JO Code': String(jo['JO Code']),
      'Type': type, 'Message': safeText(message), 'Created At': new Date().toISOString(), 'Read At': ''
    });
  });
}

function joSupIds(ctx, jo) {
  return joSupervisorsOf(ctx, String(jo['Farm Block Code'])).map(function (u) { return String(u['User ID']); });
}

function joLabel(jo) {
  return jo['JO Code'] + ' (' + (jo['Farm & Block'] || jo['Farm Block Code']) + ')';
}

function joCleanText(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/\r/g, '').trim().substring(0, max || 2000);
}

function joApply(ctx, st, tx) {
  var type = String(tx.type || '');
  var data = tx.data || {};
  var me = ctx.userId, myName = String(ctx.user['Full Name']);
  var now = new Date().toISOString();

  if (type === 'NOTIF_READ') {
    var ids = Array.isArray(data.ids) ? data.ids.map(String) : [];
    var all = !!data.all;
    rewriteRows(st.ss.getSheetByName(SHEET_NAMES.NOTIFICATIONS), function (n) {
      return String(n['User ID']) === me && !n['Read At'] && (all || ids.indexOf(String(n['Notification ID'])) !== -1);
    }, { 'Read At': now });
    appendObject(st.auditSheet, { 'Audit ID': 'JOA-' + Utilities.getUuid(), 'JO Code': '-', 'Action': 'NOTIF_READ', 'User ID': me,
      'User Name': myName, 'Timestamp': now, 'Sync ID': String(tx.syncId), 'Remarks': all ? 'all' : ids.length + ' notification(s)' });
    return { message: 'Marked as read.' };
  }

  if (type === 'CREATE') {
    if (!(ctx.isAdmin || SUP_ROLES.indexOf(ctx.role) !== -1)) throw joFail('Only Administrators, Farm Officers and Supervisors can create job orders.');
    var code = String(data.farmBlockCode || '');
    var blocksOfCode = ctx.blocks.filter(function (b) { return norm(b['Status']) !== 'deactivated' && farmBlockCode(b['Farm and Block Name']) === code; });
    if (!blocksOfCode.length) throw joFail('Farm & Block ' + code + ' was not found.');
    if (!joCanSee(ctx, st.codes, { 'Farm Block Code': code })) throw joFail('That Farm & Block is not assigned to you.');
    var title = joCleanText(data.title, 150);
    if (!title) throw joFail('Title is required.');
    var entry = null;
    if (data.recordId) {
      entry = blocksOfCode.filter(function (b) { return String(b['Record ID']) === String(data.recordId); })[0];
      if (!entry) throw joFail('The selected land owner / parcel is not in that Farm & Block.');
    }
    var priority = JO_PRIORITIES.indexOf(String(data.priority)) !== -1 ? String(data.priority) : 'Normal';
    var due = /^\d{4}-\d{2}-\d{2}$/.test(String(data.dueDate || '')) ? String(data.dueDate) : '';
    var assignee = null;
    if (data.assignedTo) {
      assignee = joUserCovers(ctx, data.assignedTo, code);
      if (!assignee) throw joFail('The assigned person does not have access to this Farm & Block.');
    }
    var year = new Date().getFullYear(), prefix = 'JO-' + year + '-', max = 0;
    st.jos.forEach(function (j) {
      var m = String(j['JO Code']).match(/^JO-(\d{4})-(\d+)$/);
      if (m && m[1] === String(year)) max = Math.max(max, parseInt(m[2], 10));
    });
    var joCode = prefix + pad(max + 1, 4);
    var lo = entry ? readObjects(st.ss.getSheetByName(SHEET_NAMES.LANDOWNERS)).filter(function (l) { return String(l['Land Owner ID']) === String(entry['Land Owner ID']); })[0] : null;
    var jo = {
      'JO Code': joCode, 'Temp Code': String(tx.joCode || '').indexOf('TMP-') === 0 ? String(tx.joCode) : '',
      'Title': safeText(title), 'Description': safeText(joCleanText(data.description, 4000)),
      'Farm Block Code': code, 'Farm & Block': safeText(farmBlockLabels(code, blocksOfCode[0]['Farm and Block Name']).full),
      'Record ID': entry ? String(entry['Record ID']) : '', 'Land Owner': entry ? String(entry['Land Owner Name']) : '',
      'CLAIF Number': lo ? String(lo['CLAIF Number'] || '') : '', 'Parcel Number': entry ? String(entry['Parcel Number']) : '',
      'Priority': priority, 'Due Date': due, 'Status': 'PENDING',
      'Created By': me, 'Created By Name': myName, 'Created At': now,
      'Assigned To': assignee ? String(assignee['User ID']) : '', 'Assigned To Name': assignee ? String(assignee['Full Name']) : '',
      'Claimed By': '', 'Claimed By Name': '', 'Claimed At': '', 'Claimed Device': '',
      'Closed By': '', 'Closed By Name': '', 'Closed At': '', 'Last Updated': now
    };
    appendObject(st.joSheet, jo);
    st.jos.push(jo);
    if (jo['Temp Code']) st.codeMap[jo['Temp Code']] = joCode;
    joAudit(ctx, st, tx, joCode, 'CREATE', '', 'PENDING', 'Created: ' + title);
    joNotify(ctx, st, jo, 'NEW', 'New ' + priority + ' job order ' + joLabel(jo) + ': ' + title, joSupIds(ctx, jo));
    if (assignee) joNotify(ctx, st, jo, 'ASSIGNED', 'Assigned to you: ' + joLabel(jo) + ' — ' + title, [assignee['User ID']]);
    return { joCode: joCode, message: 'Job order ' + joCode + ' created.' };
  }

  // ---- everything else works on an existing, visible job order
  var joCode2 = joResolve(st, tx.joCode);
  var j = joFind(st, joCode2);
  if (!j) throw joFail('Job order ' + tx.joCode + ' was not found.');
  if (!joCanSee(ctx, st.codes, j)) throw joFail('Job order ' + joCode2 + ' is not in your Farm & Blocks.');
  var status = String(j['Status']).toUpperCase();
  var boss = joIsBoss(ctx, String(j['Farm Block Code']));
  var mine = String(j['Claimed By']) === me || String(j['Assigned To']) === me;
  var res = { joCode: joCode2 };

  switch (type) {
    case 'EDIT': {
      if (!boss) throw joFail('Only the block supervisor or an Administrator can edit this job order.');
      if (status === 'CLOSED' || status === 'CANCELLED') throw joFail('Job order ' + joCode2 + ' is ' + status + '.', true);
      var up = {}, notes = [];
      if (data.title !== undefined) { var t = joCleanText(data.title, 150); if (!t) throw joFail('Title is required.'); up['Title'] = safeText(t); }
      if (data.description !== undefined) up['Description'] = safeText(joCleanText(data.description, 4000));
      if (data.priority !== undefined && JO_PRIORITIES.indexOf(String(data.priority)) !== -1) up['Priority'] = String(data.priority);
      if (data.dueDate !== undefined) up['Due Date'] = /^\d{4}-\d{2}-\d{2}$/.test(String(data.dueDate)) ? String(data.dueDate) : '';
      var newAssignee = null, assignChanged = false;
      if (data.assignedTo !== undefined && String(data.assignedTo || '') !== String(j['Assigned To'] || '')) {
        if (data.assignedTo) {
          newAssignee = joUserCovers(ctx, data.assignedTo, String(j['Farm Block Code']));
          if (!newAssignee) throw joFail('The assigned person does not have access to this Farm & Block.');
        }
        if (status !== 'PENDING' && data.assignedTo && String(j['Claimed By']) && String(j['Claimed By']) !== String(data.assignedTo)) {
          throw joFail('Job order is already claimed by ' + j['Claimed By Name'] + '. Reassign is only possible while PENDING.', true);
        }
        up['Assigned To'] = newAssignee ? String(newAssignee['User ID']) : '';
        up['Assigned To Name'] = newAssignee ? String(newAssignee['Full Name']) : '';
        assignChanged = true;
        notes.push('assigned to ' + (newAssignee ? newAssignee['Full Name'] : 'nobody'));
      }
      up['Last Updated'] = now;
      joSet(st, j, up);
      joAudit(ctx, st, tx, joCode2, assignChanged ? 'ASSIGN' : 'EDIT', status, status, 'Edited' + (notes.length ? ': ' + notes.join(', ') : ''));
      if (newAssignee) joNotify(ctx, st, j, 'ASSIGNED', 'Assigned to you: ' + joLabel(j) + ' — ' + j['Title'], [newAssignee['User ID']]);
      res.message = 'Job order ' + joCode2 + ' updated.';
      return res;
    }
    case 'CLAIM': {
      if (status !== 'PENDING') throw joFail('Job order ' + joCode2 + ' is already ' + status + (j['Claimed By Name'] ? ' by ' + j['Claimed By Name'] : '') + '.', true);
      if (j['Assigned To'] && String(j['Assigned To']) !== me && !boss) {
        throw joFail('Job order ' + joCode2 + ' is assigned to ' + j['Assigned To Name'] + '.', true);
      }
      joSet(st, j, { 'Status': 'RECEIVED', 'Claimed By': me, 'Claimed By Name': myName, 'Claimed At': now,
        'Claimed Device': safeText(String(tx.deviceId || '')), 'Assigned To': j['Assigned To'] || me,
        'Assigned To Name': j['Assigned To Name'] || myName, 'Last Updated': now });
      joAudit(ctx, st, tx, joCode2, 'CLAIM', status, 'RECEIVED', 'Claimed');
      joNotify(ctx, st, j, 'CLAIMED', myName + ' received ' + joLabel(j), joSupIds(ctx, j).concat([j['Created By']]));
      res.message = 'Job order ' + joCode2 + ' received.';
      return res;
    }
    case 'START': {
      if (status !== 'RECEIVED') throw joFail('Cannot start: job order ' + joCode2 + ' is ' + status + '.', true);
      if (!mine && !boss) throw joFail('Only ' + (j['Claimed By Name'] || 'the person who received it') + ' or the supervisor can start it.');
      joSet(st, j, { 'Status': 'IN PROGRESS', 'Last Updated': now });
      joAudit(ctx, st, tx, joCode2, 'START', status, 'IN PROGRESS', 'Started work');
      joNotify(ctx, st, j, 'STARTED', myName + ' started work on ' + joLabel(j), joSupIds(ctx, j).concat([j['Created By']]));
      res.message = 'Work started on ' + joCode2 + '.';
      return res;
    }
    case 'RESPOND': {
      if (status === 'CLOSED' || status === 'CANCELLED') throw joFail('Cannot add a response: job order ' + joCode2 + ' is ' + status + '.', true);
      var text = joCleanText(data.text, 2000);
      if (!text) throw joFail('Response text is required.');
      joRespond(ctx, st, tx, joCode2, 'RESPONSE', text);
      joSet(st, j, { 'Last Updated': now });
      joAudit(ctx, st, tx, joCode2, 'RESPOND', status, status, text.substring(0, 80));
      joNotify(ctx, st, j, 'RESPONSE', myName + ' on ' + joLabel(j) + ': ' + text.substring(0, 80),
        joSupIds(ctx, j).concat([j['Created By'], j['Assigned To'], j['Claimed By']]));
      res.message = 'Response added.';
      return res;
    }
    case 'CLOSE': {
      if (status === 'CLOSED') throw joFail('Job order ' + joCode2 + ' was already closed by ' + (j['Closed By Name'] || 'another user') + '.', true);
      if (status !== 'RECEIVED' && status !== 'IN PROGRESS') throw joFail('Cannot close: job order ' + joCode2 + ' is ' + status + '.', true);
      if (!mine && !boss) throw joFail('Only ' + (j['Claimed By Name'] || 'the assigned person') + ' or the supervisor can close it.');
      var remarks = joCleanText(data.remarks, 2000);
      if (!remarks) throw joFail('Completion remarks are required.');
      var link = '', attName = '';
      if (data.attachment && data.attachment.data) {
        link = joSaveAttachment(data.attachment, joCode2);
        attName = String(data.attachment.name || 'attachment');
      }
      joRespond(ctx, st, tx, joCode2, 'CLOSE', 'Job closed: ' + remarks, link, attName);
      joSet(st, j, { 'Status': 'CLOSED', 'Closed By': me, 'Closed By Name': myName, 'Closed At': now, 'Last Updated': now });
      joAudit(ctx, st, tx, joCode2, 'CLOSE', status, 'CLOSED', remarks.substring(0, 200), link);
      joNotify(ctx, st, j, 'CLOSED', myName + ' closed ' + joLabel(j), joSupIds(ctx, j).concat([j['Created By'], j['Assigned To']]));
      res.message = 'Job order ' + joCode2 + ' closed.';
      return res;
    }
    case 'REOPEN': {
      if (!boss) throw joFail('Only the block supervisor or an Administrator can reopen a job order.');
      if (status !== 'CLOSED') throw joFail('Only CLOSED job orders can be reopened (now ' + status + ').', true);
      var why = joCleanText(data.remarks, 2000);
      if (!why) throw joFail('A reason is required to reopen.');
      joRespond(ctx, st, tx, joCode2, 'REOPEN', 'Job reopened: ' + why);
      joSet(st, j, { 'Status': 'IN PROGRESS', 'Closed By': '', 'Closed By Name': '', 'Closed At': '', 'Last Updated': now });
      joAudit(ctx, st, tx, joCode2, 'REOPEN', status, 'IN PROGRESS', why.substring(0, 200));
      joNotify(ctx, st, j, 'REOPENED', myName + ' reopened ' + joLabel(j) + ': ' + why.substring(0, 80), [j['Assigned To'], j['Claimed By'], j['Closed By']]);
      res.message = 'Job order ' + joCode2 + ' reopened.';
      return res;
    }
    case 'CANCEL': {
      if (!boss) throw joFail('Only the block supervisor or an Administrator can cancel a job order.');
      if (status === 'CLOSED' || status === 'CANCELLED') throw joFail('Job order ' + joCode2 + ' is already ' + status + '.', true);
      var reason = joCleanText(data.remarks, 2000);
      if (!reason) throw joFail('A reason is required to cancel.');
      joRespond(ctx, st, tx, joCode2, 'CANCEL', 'Job cancelled: ' + reason);
      joSet(st, j, { 'Status': 'CANCELLED', 'Last Updated': now });
      joAudit(ctx, st, tx, joCode2, 'CANCEL', status, 'CANCELLED', reason.substring(0, 200));
      joNotify(ctx, st, j, 'CANCELLED', myName + ' cancelled ' + joLabel(j), [j['Assigned To'], j['Claimed By'], j['Created By']]);
      res.message = 'Job order ' + joCode2 + ' cancelled.';
      return res;
    }
    default:
      throw joFail('Unknown job order action: ' + type);
  }
}

/** Saves a closing photo / PDF to a PRIVATE Drive folder. Returns "drive:<fileId>". */
function joSaveAttachment(att, joCode) {
  var mime = String(att.mimeType || '');
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime) && mime !== 'application/pdf') throw joFail('Only photos (JPG, PNG, WEBP) or PDF files can be attached.');
  var bytes = Utilities.base64Decode(String(att.data));
  if (bytes.length > JO_MAX_ATTACHMENT_BYTES) throw joFail('Attachment is larger than 5 MB.');
  var it = DriveApp.getFoldersByName(JO_ATTACHMENT_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(JO_ATTACHMENT_FOLDER);
  var name = joCode + '_' + String(att.name || 'attachment').replace(/[^\w.\-]+/g, '_').substring(0, 80);
  var file = folder.createFile(Utilities.newBlob(bytes, mime, name));   // NOT shared publicly
  return 'drive:' + file.getId();
}

/** JO_ATTACHMENT: { fileId } -> the file (base64) if the user can see its job order. */
function handleJoAttachment(ctx, payload) {
  var id = String(payload.fileId || '');
  if (!/^[\w-]{10,}$/.test(id)) return respondJSON({ success: false, error: 'Invalid attachment.' });
  var ss = ctx.ss;
  var resp = readObjects(ss.getSheetByName(SHEET_NAMES.JO_RESPONSES)).filter(function (r) { return String(r['Attachment Link']) === 'drive:' + id; })[0];
  if (!resp) return respondJSON({ success: false, error: 'Attachment not found.' });
  var jo = readObjects(ss.getSheetByName(SHEET_NAMES.JOB_ORDERS)).filter(function (j) { return String(j['JO Code']) === String(resp['JO Code']); })[0];
  if (!jo || !joCanSee(ctx, joVisibleCodes(ctx), jo)) return respondJSON({ success: false, error: 'You cannot open this attachment.' });
  var blob = DriveApp.getFileById(id).getBlob();
  return respondJSON({ success: true, mimeType: blob.getContentType(), name: String(resp['Attachment Name'] || blob.getName()), data: Utilities.base64Encode(blob.getBytes()) });
}

/* ==========================================================================
   WEATHER (v4.1) — Rizal, Palawan: Ransang, Candawaga, Culasian
   Data: Open-Meteo (https://open-meteo.com, CC BY 4.0).
     - Days 1–16 : Open-Meteo forecast (daily rain mm, rain chance, temp, wind)
     - Days 17–30: ECMWF EC46 extended outlook (ensemble mean rain mm)
     - Last 30 days: rain that actually fell (model analysis)
   The server downloads it (cached 3 hours) so phones get it with one call and
   keep the last copy for offline viewing.
   For business use, Open-Meteo asks for a paid API key: put it in the
   SystemSettings sheet as  Key = openMeteoApiKey   Value = <your key>.
   ========================================================================== */

var WEATHER_LOCATIONS = [
  { id: 'ransang', name: 'Ransang', lat: 8.9088, lon: 117.5507 },
  { id: 'candawaga', name: 'Candawaga', lat: 8.8735, lon: 117.5013 },
  { id: 'culasian', name: 'Culasian', lat: 8.7713, lon: 117.5265 }
];
var WEATHER_MUNICIPALITY = 'Rizal, Palawan';
var WEATHER_CACHE_SECONDS = 3 * 60 * 60;

function handleGetWeather(ctx, payload) {
  requireRole(ctx, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.FARM_OFFICER]);
  var cache = CacheService.getScriptCache();
  if (!payload.force) {
    var hit = cache.get('weather:v1');
    if (hit) return respondJSON({ success: true, weather: JSON.parse(hit), cached: true });
  }
  try {
    var data = weatherDownload(ctx.ss);
    var text = JSON.stringify(data);
    cache.put('weather:v1', text, WEATHER_CACHE_SECONDS);
    cache.put('weather:last', text, 21600);
    return respondJSON({ success: true, weather: data, cached: false });
  } catch (err) {
    var last = cache.get('weather:last');
    if (last) return respondJSON({ success: true, weather: JSON.parse(last), cached: true, warning: 'Weather service not reachable: showing the last copy.' });
    return respondJSON({ success: false, error: 'Weather service not reachable: ' + err.message });
  }
}

function weatherApiKey(ss) {
  var key = '';
  readObjects(ss.getSheetByName(SHEET_NAMES.SETTINGS)).forEach(function (s) {
    if (String(s['Key']) === 'openMeteoApiKey') key = String(s['Value'] || '').trim();
  });
  return key;
}

function weatherDownload(ss) {
  var key = weatherApiKey(ss);
  var base = key ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';
  var seasonal = key ? 'https://customer-seasonal-api.open-meteo.com/v1/seasonal' : 'https://seasonal-api.open-meteo.com/v1/seasonal';
  var k = key ? '&apikey=' + encodeURIComponent(key) : '';
  var requests = [];
  WEATHER_LOCATIONS.forEach(function (loc) {
    var ll = 'latitude=' + loc.lat + '&longitude=' + loc.lon + '&timezone=Asia%2FManila';
    requests.push({ url: base + '?' + ll + '&forecast_days=16&past_days=30&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,weather_code' + k, muteHttpExceptions: true });
    requests.push({ url: seasonal + '?' + ll + '&forecast_days=35&models=ecmwf_ec46_ensemble_mean&daily=precipitation_sum' + k, muteHttpExceptions: true });
  });
  var responses = UrlFetchApp.fetchAll(requests);
  var today = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');
  var round1 = function (v) { return v === null || v === undefined || isNaN(v) ? null : Math.round(Number(v) * 10) / 10; };

  var locations = WEATHER_LOCATIONS.map(function (loc, i) {
    var f = weatherParse(responses[i * 2], 'forecast');
    var s = null;
    try { s = weatherParse(responses[i * 2 + 1], 'outlook'); } catch (e) { s = null; }   // the outlook is a bonus
    var d = f.daily, past = [], days = [];
    for (var j = 0; j < d.time.length; j++) {
      var row = {
        date: d.time[j], rain: round1(d.precipitation_sum[j]), chance: d.precipitation_probability_max ? d.precipitation_probability_max[j] : null,
        tMax: round1(d.temperature_2m_max[j]), tMin: round1(d.temperature_2m_min[j]), wind: round1(d.wind_speed_10m_max[j]),
        code: d.weather_code ? d.weather_code[j] : null, source: 'forecast'
      };
      if (row.date < today) past.push(row); else days.push(row);
    }
    // days 17-30: extended outlook (ensemble mean)
    if (s && s.daily && s.daily.time) {
      var have = {};
      days.forEach(function (x) { have[x.date] = true; });
      for (var m = 0; m < s.daily.time.length && days.length < 30; m++) {
        var dt = s.daily.time[m];
        if (dt < today || have[dt]) continue;
        days.push({ date: dt, rain: round1(s.daily.precipitation_sum[m]), chance: null, tMax: null, tMin: null, wind: null, code: null, source: 'outlook' });
      }
    }
    days = days.slice(0, 30);
    var sum = function (arr) { return round1(arr.reduce(function (t, x) { return t + (x.rain || 0); }, 0)); };
    return {
      id: loc.id, name: loc.name, lat: loc.lat, lon: loc.lon,
      days: days, past30: past.slice(-30),
      totals: { week: sum(days.slice(0, 7)), month: sum(days.slice(0, 30)), past30: sum(past.slice(-30)) }
    };
  });
  return {
    municipality: WEATHER_MUNICIPALITY, updatedAt: new Date().toISOString(), today: today,
    source: 'Open-Meteo.com (CC BY 4.0) — days 1–16 forecast, days 17–30 ECMWF extended outlook',
    licensed: !!key, locations: locations
  };
}

function weatherParse(resp, what) {
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code !== 200) throw new Error(what + ' HTTP ' + code + ': ' + body.substring(0, 200));
  var json = JSON.parse(body);
  if (json.error) throw new Error(what + ': ' + json.reason);
  return json;
}
/* ---------- DATA VALIDATOR ENGINE (identical copy in Code.gs and js/validator.js) ---------- */
/**
 * dvValidateReport(rec, data) -> { applies, status, reason, messages, checks, entry, period }
 *   rec   : the activity report (frontend field names: landOwnersName, parcelNumber, farmBlock, date, cycle, ...)
 *   data  : { rules, entries, accepted, today }
 *     rules    : [{ id, label, activityType, field, basis: 'Hectare'|'Palm Count', decimals, scope: 'Cycle'|'Year'|'Month'|'All', targetScope: 'Row'|'Land Owner Farm & Block', active }]
 *     entries  : registered rows [{ recordId, landOwnerId, landOwnerName, landOwnerNo, parcelNumber, farmBlockName, farmBlockCode, areaHa, palmCount, sequenceNo, category, status }]
 *     accepted : accepted reports (official accomplishments) — the report itself is skipped by reportId / uniqueUuid
 *     today    : 'yyyy-MM-dd'
 * Numbers are compared as whole units (Ha x 1000, palms x 1), so 0.246 > 0.245 is always detected.
 */
function dvNorm(v) { return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); }
function dvKey(lo, parcel, block) { return dvNorm(lo) + '|' + dvNorm(parcel) + '|' + dvNorm(block); }
function dvDecimalsOf(x) {
  var s = String(x);
  if (/e/i.test(s)) s = Number(x).toFixed(12).replace(/0+$/, '');
  var i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
function dvScale(rule) { return Math.pow(10, Math.max(0, parseInt(rule.decimals, 10) || 0)); }
function dvFmt(units, rule) {
  var d = Math.max(0, parseInt(rule.decimals, 10) || 0);
  var v = units / dvScale(rule);
  return (d ? v.toFixed(d) : String(Math.round(v))) + (rule.basis === 'Hectare' ? ' Ha' : ' palms');
}
function dvPeriod(rule, rec) {
  var date = String(rec.date || '');
  var year = date.substring(0, 4);
  var scope = String(rule.scope || 'Cycle');
  if (scope === 'All') return { key: 'ALL', label: 'all time' };
  if (scope === 'Month') return { key: 'M|' + date.substring(0, 7), label: date.substring(0, 7) };
  if (scope === 'Year') return { key: 'Y|' + year, label: 'year ' + year };
  var cycle = String(rec.cycle || '').trim();
  return cycle ? { key: 'C|' + dvNorm(cycle) + '|' + year, label: cycle + ' ' + year } : { key: 'Y|' + year, label: 'year ' + year + ' (no cycle)' };
}
function dvNumber(v) {
  if (v === undefined || v === null || v === '') return 0;
  var n = Number(v);
  return isNaN(n) ? NaN : n;
}

function dvValidateReport(rec, data) {
  var rules = (data.rules || []).filter(function (r) { return r.active && r.activityType === rec.activityType; });
  var out = { applies: rules.length > 0, status: 'VALID', reason: '', messages: [], checks: [], entry: null, period: '' };
  if (!out.applies) return out;
  var invalid = [], review = [];

  // 1) required information
  var missing = [];
  if (!rec.date) missing.push('Date');
  if (!rec.landOwnersName) missing.push('Land Owner');
  if (!rec.parcelNumber) missing.push('Parcel Number');
  if (!rec.farmBlock) missing.push('Farm & Block');
  if (missing.length) invalid.push('Submission Failed: required information is missing (' + missing.join(', ') + ').');

  // 2) the exact registered row (Record ID first, then Land Owner + Parcel + Farm & Block)
  var key = dvKey(rec.landOwnersName, rec.parcelNumber, rec.farmBlock);
  var active = (data.entries || []).filter(function (e) { return dvNorm(e.status) !== 'deactivated'; });
  var entry = null;
  if (rec.recordId) {
    entry = active.filter(function (e) { return String(e.recordId) === String(rec.recordId); })[0] || null;
    if (entry && dvKey(entry.landOwnerName, entry.parcelNumber, entry.farmBlockName) !== key) entry = null;
  }
  if (!entry) {
    var hits = active.filter(function (e) { return dvKey(e.landOwnerName, e.parcelNumber, e.farmBlockName) === key; });
    if (hits.length === 1) entry = hits[0];
    else if (hits.length > 1) review.push('For Review: more than one registered row matches ' + rec.landOwnersName + ' › ' + rec.parcelNumber + ' › ' + rec.farmBlock + '; the correct target cannot be determined.');
  }
  if (!entry && !missing.length && !review.length) {
    invalid.push('Submission Failed: no registered land owner row was found for ' + rec.landOwnersName + ' › ' + rec.parcelNumber + ' › ' + rec.farmBlock + '.');
  }
  out.entry = entry;

  // 3) each validated activity in the report
  rules.forEach(function (rule) {
    var raw = rec[rule.field];
    var v = dvNumber(raw);
    if (isNaN(v)) { invalid.push('Submission Failed: ' + rule.label + ' quantity "' + raw + '" is not a number.'); return; }
    if (v < 0) { invalid.push('Submission Failed: ' + rule.label + ' cannot be negative (' + raw + ').'); return; }
    if (v === 0) return;
    var dec = Math.max(0, parseInt(rule.decimals, 10) || 0);
    if (dvDecimalsOf(v) > dec) {
      invalid.push('Submission Failed: ' + rule.label + ' allows ' + (dec ? 'at most ' + dec + ' decimal places' : 'whole numbers only') + ' (submitted ' + raw + ').');
      return;
    }
    var period = dvPeriod(rule, rec);
    out.period = period.label;
    var check = { ruleId: rule.id, label: rule.label, basis: rule.basis, field: rule.field, decimals: dec, period: period.label,
      target: null, previous: null, remaining: null, submitted: v, difference: 0, status: 'VALID', message: '' };
    out.checks.push(check);
    if (!entry) { check.status = invalid.length ? 'INVALID' : 'FOR REVIEW'; return; }

    // target rows: this row only, or all rows of the land owner in the same Farm & Block (configurable)
    var targetRows = [entry];
    if (rule.targetScope === 'Land Owner Farm & Block') {
      targetRows = active.filter(function (e) { return String(e.landOwnerId) === String(entry.landOwnerId) && String(e.farmBlockCode) === String(entry.farmBlockCode); });
    }
    var scale = dvScale(rule);
    var targetUnits = 0, haveTarget = true;
    targetRows.forEach(function (e) {
      var t = Number(rule.basis === 'Hectare' ? e.areaHa : e.palmCount) || 0;
      if (t <= 0) haveTarget = false;
      targetUnits += Math.round(t * scale);
    });
    if (!haveTarget || targetUnits <= 0) {
      check.status = 'FOR REVIEW';
      check.message = 'For Review: ' + (rule.basis === 'Hectare' ? 'no registered hectarage' : 'no registered palm count') + ' for ' + entry.landOwnerName + ' › ' + entry.parcelNumber + ' › ' + entry.farmBlockName + ' (Record ' + entry.recordId + '), so ' + rule.label + ' cannot be checked.';
      review.push(check.message);
      return;
    }
    var keys = {};
    targetRows.forEach(function (e) { keys[dvKey(e.landOwnerName, e.parcelNumber, e.farmBlockName)] = true; if (e.recordId) keys['#' + e.recordId] = true; });
    var prevUnits = 0;
    (data.accepted || []).forEach(function (a) {
      if (a.activityType !== rec.activityType) return;
      if ((rec.reportId && a.reportId === rec.reportId) || (rec.uniqueUuid && a.uniqueUuid === rec.uniqueUuid)) return;   // never count itself
      if (!(keys['#' + a.recordId] || keys[dvKey(a.landOwnersName, a.parcelNumber, a.farmBlock)])) return;
      if (dvPeriod(rule, a).key !== period.key) return;
      var q = dvNumber(a[rule.field]);
      if (!isNaN(q) && q > 0) prevUnits += Math.round(q * scale);
    });
    var subUnits = Math.round(v * scale);
    var remUnits = Math.max(0, targetUnits - prevUnits);
    check.target = targetUnits / scale; check.previous = prevUnits / scale; check.remaining = remUnits / scale;
    check.difference = Math.max(0, subUnits - remUnits) / scale;
    if (subUnits > remUnits) {
      check.status = 'INVALID';
      check.message = 'Submission Failed: The remaining ' + (rule.basis === 'Hectare' ? 'hectarage' : 'palm count') + ' for ' + rule.label +
        (remUnits === 0 ? ' is 0 (' + dvFmt(prevUnits, rule) + ' of ' + dvFmt(targetUnits, rule) + ' already reported in ' + period.label + ')' : (rule.basis === 'Hectare' ? ' is only ' : ' is ') + dvFmt(remUnits, rule)) +
        ', but the submitted report is ' + dvFmt(subUnits, rule) + '. The report exceeds the remaining target by ' + dvFmt(subUnits - remUnits, rule) + '.';
      invalid.push(check.message);
    }
  });

  // 4) things a person should look at
  if (entry && rec.dvSnapshot && String(rec.dvSnapshot.recordId || '') === String(entry.recordId)) {
    var s = rec.dvSnapshot;
    rules.forEach(function (rule) {
      if (!(dvNumber(rec[rule.field]) > 0)) return;
      var was = Number(rule.basis === 'Hectare' ? s.areaHa : s.palmCount) || 0;
      var now = Number(rule.basis === 'Hectare' ? entry.areaHa : entry.palmCount) || 0;
      if (Math.round(was * 1000) !== Math.round(now * 1000)) {
        review.push('For Review: the registered ' + (rule.basis === 'Hectare' ? 'hectarage' : 'palm count') + ' of this row changed from ' + was + ' to ' + now + ' after the report was made.');
      }
    });
  }
  if (rec.date && data.today && String(rec.date) > String(data.today)) review.push('For Review: the report date ' + rec.date + ' is in the future.');
  if (entry) {
    var dup = (data.accepted || []).filter(function (a) {
      if (a.activityType !== rec.activityType || a.reportId === rec.reportId || (rec.uniqueUuid && a.uniqueUuid === rec.uniqueUuid)) return false;
      if (String(a.userId) !== String(rec.userId) || String(a.date) !== String(rec.date)) return false;
      if (dvKey(a.landOwnersName, a.parcelNumber, a.farmBlock) !== key) return false;
      return rules.every(function (r) { return Math.round((dvNumber(a[r.field]) || 0) * 1000) === Math.round((dvNumber(rec[r.field]) || 0) * 1000); }) &&
        rules.some(function (r) { return dvNumber(rec[r.field]) > 0; });
    })[0];
    if (dup) review.push('For Review: possible duplicate of report ' + dup.reportId + ' (same person, date, row and quantities).');
  }

  // keep each message once
  var seen = {};
  var uniq = function (arr) { return arr.filter(function (m) { if (seen[m]) return false; seen[m] = true; return true; }); };
  invalid = uniq(invalid); review = uniq(review);
  out.status = invalid.length ? 'INVALID' : (review.length ? 'FOR REVIEW' : 'VALID');
  out.messages = invalid.concat(review);
  out.reason = out.messages.join(' ');
  return out;
}
/* ---------- end of DATA VALIDATOR ENGINE ---------- */

/* ==========================================================================
   DATA VALIDATOR (v4.2)
   Every activity report covered by a rule in the "ValidationRules" sheet is checked
   against the exact registered row (Record ID) before it becomes an official
   accomplishment:
     Hectare rules    -> row Area (Ha)     (e.g. Slashing)
     Palm Count rules -> row Palm Count    (Compost, Pruning, Foliar, Soil Drenching)
   Remaining = Registered target - accepted reports of the same row, activity and period (Cycle).
   VALID reports go to the activity sheet as before. INVALID / FOR REVIEW reports are kept in
   the "DataValidator" sheet (never counted, never deleted) until corrected, approved or rejected.
   The same engine runs on the phone, so validation also works offline.
   ========================================================================== */

var DV_DEFAULT_RULES = [
  ['SLASHING', 'Slashing', 'Regular Activity', 'weedingSlashingHa', 'Hectare', 3, 'Cycle', 'Row', 'Active', 'Weeding Rolling / Slashing (Ha) vs row Area (Ha)'],
  ['COMPOST', 'Compost Application', 'Regular Activity', 'compostPalms', 'Palm Count', 0, 'Cycle', 'Row', 'Active', 'Compost palms vs row Palm Count'],
  ['PRUNING', 'Pruning', 'Regular Activity', 'pruningPalms', 'Palm Count', 0, 'Cycle', 'Row', 'Active', 'Pruning palms vs row Palm Count'],
  ['FOLIAR', 'Foliar Application', 'Regular Activity', 'foliarPalms', 'Palm Count', 0, 'Cycle', 'Row', 'Active', 'Foliar palms vs row Palm Count'],
  ['SOILDRENCH', 'Soil Drenching', 'Regular Activity', 'soilDrenchingPalms', 'Palm Count', 0, 'Cycle', 'Row', 'Active', 'Soil drenching palms vs row Palm Count'],
  ['ROUNDWEED', 'Round Weeding', 'Regular Activity', 'roundWeedingPalms', 'Palm Count', 0, 'Cycle', 'Row', 'Inactive', 'Switch to Active to also check Round Weeding']
];
var DV_OPEN = { 'INVALID': true, 'FOR REVIEW': true };

function seedValidationRules(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.VALIDATION_RULES);
  if (!sheet || readObjects(sheet).length) return;
  DV_DEFAULT_RULES.forEach(function (r) {
    appendObject(sheet, { 'Rule ID': r[0], 'Activity Label': r[1], 'Activity Type': r[2], 'Report Field': r[3], 'Target Basis': r[4],
      'Decimals': r[5], 'Period': r[6], 'Target Scope': r[7], 'Status': r[8], 'Notes': r[9] });
  });
}

/** Rules from the ValidationRules sheet (edit the sheet to add activities — no code change). */
function readValidationRules(ss) {
  return readObjects(ss.getSheetByName(SHEET_NAMES.VALIDATION_RULES)).map(function (r) {
    var basis = norm(r['Target Basis']).indexOf('hect') !== -1 ? 'Hectare' : 'Palm Count';
    var dec = String(r['Decimals']) === '' ? (basis === 'Hectare' ? 3 : 0) : parseInt(r['Decimals'], 10) || 0;
    var period = ['Cycle', 'Year', 'Month', 'All'].filter(function (p) { return norm(p) === norm(r['Period']); })[0] || 'Cycle';
    return {
      id: String(r['Rule ID']), label: String(r['Activity Label']), activityType: String(r['Activity Type']),
      field: String(r['Report Field']).trim(), basis: basis, decimals: dec, scope: period,
      targetScope: norm(r['Target Scope']).indexOf('land owner') !== -1 ? 'Land Owner Farm & Block' : 'Row',
      active: norm(r['Status']) === 'active'
    };
  }).filter(function (r) { return r.id && r.field && r.activityType; });
}

/** Registered rows in the shape the engine expects. */
function dvEntries(ctx) {
  var claif = {};
  readObjects(ctx.ss.getSheetByName(SHEET_NAMES.LANDOWNERS)).forEach(function (l) { claif[String(l['Land Owner ID'])] = String(l['CLAIF Number'] || ''); });
  return ctx.blocks.map(function (b) {
    return {
      recordId: String(b['Record ID'] || ''), blockId: String(b['Block ID']), landOwnerId: String(b['Land Owner ID']),
      landOwnerName: String(b['Land Owner Name']), landOwnerNo: claif[String(b['Land Owner ID'])] || String(b['CLAIF Number'] || ''),
      parcelNumber: String(b['Parcel Number']), farmBlockName: String(b['Farm and Block Name']), farmBlockCode: farmBlockCode(b['Farm and Block Name']),
      areaHa: parseFloat(b['Area Ha']) || 0, palmCount: parseInt(b['Palm Count'], 10) || 0,
      sequenceNo: parseInt(b['Sequence No.'], 10) || 0, category: normalizeCategory(b['Category']), status: String(b['Status'] || 'Active')
    };
  });
}

function dvToday() { return Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd'); }

function dvState(ctx) {
  if (ctx._dv) return ctx._dv;
  var sheet = ctx.ss.getSheetByName(SHEET_NAMES.DATA_VALIDATOR);
  var rows = {};
  readObjects(sheet).forEach(function (r) { rows[String(r['Report ID'])] = r; });
  ctx._dv = { rules: readValidationRules(ctx.ss), entries: null, accepted: {}, sheet: sheet, rows: rows, today: dvToday() };
  return ctx._dv;
}

/** Accepted (official) reports of one activity type: activity sheet rows except non-valid statuses. */
function dvAccepted(ctx, st, actType) {
  if (!st.accepted[actType]) {
    st.accepted[actType] = readReports(ctx, actType).filter(function (r) {
      var s = String(r.validationStatus || '').toUpperCase();
      return !(s === 'INVALID' || s === 'FOR REVIEW' || s === 'REJECTED');
    });
  }
  return st.accepted[actType];
}

function dvParse(text, fallback) { try { return text ? JSON.parse(text) : fallback; } catch (e) { return fallback; } }

function dvSeqLabel(entry) {
  if (!entry || !entry.sequenceNo) return '';
  return (entry.category === 'Priority' ? 'P-' : 'NP-') + entry.sequenceNo;
}

/** Writes / updates the DataValidator row of a report (history is appended, never replaced). */
function dvLog(ctx, st, rec, res, event) {
  var now = new Date().toISOString();
  var id = String(rec.reportId);
  var old = st.rows[id] || null;
  var clean = {};
  for (var k in rec) { if (k !== 'dvCorrection' && k !== 'token') clean[k] = rec[k]; }
  var history = old ? dvParse(old['History JSON'], []) : [];
  var e = event || {};
  e.at = now; e.by = String(ctx.user['Full Name']); e.status = res.status;
  if (rec.dvCorrection) {
    e.event = 'CORRECTED';
    e.note = String(rec.dvCorrection.note || '').substring(0, 500);
    e.before = rec.dvCorrection.before || null; e.after = rec.dvCorrection.after || null;
    e.correctedAt = rec.dvCorrection.at || '';
  } else if (!e.event) {
    e.event = old ? 'RE-SENT' : 'SUBMITTED';
  }
  e.previousStatus = old ? String(old['Status']) : '';
  history.push(e);
  var entry = res.entry;
  var obj = {
    'Report ID': id, 'Unique UUID': String(rec.uniqueUuid || ''), 'Status': res.status, 'Activity Type': String(rec.activityType || ''),
    'Report Date': String(rec.date || ''), 'Cycle': safeText(String(rec.cycle || '')), 'Period': res.period || '',
    'User ID': String(rec.userId || ''), 'Supervisor': safeText(String(rec.employeeName || '')),
    'Record ID': entry ? entry.recordId : String(rec.recordId || ''), 'Land Owner': safeText(String(rec.landOwnersName || '')),
    'CLAIF Number': entry ? entry.landOwnerNo : String(rec.landOwnerNo || ''), 'Farm Block Code': entry ? entry.farmBlockCode : farmBlockCode(rec.farmBlock),
    'Farm & Block': safeText(String(rec.farmBlock || '')), 'Parcel Number': safeText(String(rec.parcelNumber || '')), 'Sequence': dvSeqLabel(entry),
    'Checks JSON': JSON.stringify(res.checks || []), 'Reason': safeText(res.reason || ''), 'Report JSON': JSON.stringify(clean),
    'Original JSON': old ? String(old['Original JSON'] || old['Report JSON']) : JSON.stringify(clean),
    'History JSON': JSON.stringify(history.slice(-50)), 'First Submitted': old ? String(old['First Submitted']) : String(rec.createdTimestamp || now),
    'Last Validated': now
  };
  if (old) updateObjectById(st.sheet, 'Report ID', id, obj); else appendObject(st.sheet, obj);
  obj.History = history;
  st.rows[id] = obj;
  return obj;
}

/**
 * Called by SYNC_REPORTS_BATCH for every report. Returns null when no rule applies (report is saved as before),
 * otherwise { official: true/false, result }.
 */
function dvCheckForSync(ctx, rec) {
  var st = dvState(ctx);
  var rules = st.rules.filter(function (r) { return r.active && r.activityType === rec.activityType; });
  if (!rules.length) return null;
  var old = st.rows[String(rec.reportId)];
  var oldStatus = old ? String(old['Status']) : '';
  if (oldStatus === 'REJECTED' || oldStatus === 'APPROVED') {
    // already decided by an administrator: nothing changes, nothing is counted twice
    return { official: false, result: { reportId: rec.reportId, status: oldStatus, reason: String(old['Reason'] || ''), checks: dvParse(old['Checks JSON'], []), final: true } };
  }
  if (!st.entries) st.entries = dvEntries(ctx);
  var accepted = dvAccepted(ctx, st, rec.activityType);
  var res = dvValidateReport(rec, { rules: st.rules, entries: st.entries, accepted: accepted, today: st.today });
  if (res.entry) { rec.recordId = res.entry.recordId; rec.landOwnerNo = res.entry.landOwnerNo || rec.landOwnerNo; }
  rec.validationStatus = res.status;
  dvLog(ctx, st, rec, res);
  var official = res.status === 'VALID';
  if (official) {
    // count it for the next reports of this batch (replace an older copy of the same report)
    st.accepted[rec.activityType] = accepted.filter(function (a) { return a.reportId !== rec.reportId && a.uniqueUuid !== rec.uniqueUuid; }).concat([rec]);
  }
  return {
    official: official,
    result: {
      reportId: rec.reportId, status: res.status, reason: res.reason, messages: res.messages, checks: res.checks,
      recordId: res.entry ? res.entry.recordId : '', landOwnerNo: res.entry ? res.entry.landOwnerNo : '',
      farmBlockCode: res.entry ? res.entry.farmBlockCode : '', sequence: dvSeqLabel(res.entry), period: res.period
    }
  };
}

/** A validated report whose row is missing or not in the user's Farm & Blocks: kept in the Data Validator as INVALID (never counted). */
function dvInvalidOutOfScope(ctx, rec) {
  var st = dvState(ctx);
  if (!st.rules.some(function (r) { return r.active && r.activityType === rec.activityType; })) return null;
  var old = st.rows[String(rec.reportId)];
  if (old && (String(old['Status']) === 'REJECTED' || String(old['Status']) === 'APPROVED')) {
    return { reportId: rec.reportId, status: String(old['Status']), reason: String(old['Reason'] || ''), checks: dvParse(old['Checks JSON'], []), final: true };
  }
  rec.userId = ctx.userId;
  rec.employeeName = String(ctx.user['Full Name']);
  var res = dvValidateReport(rec, { rules: st.rules, entries: [], accepted: [], today: st.today });
  if (rec.farmBlock && res.status !== 'INVALID') res.status = 'INVALID';
  if (rec.farmBlock && !/Submission Failed/.test(res.reason)) {
    res.messages = ['Submission Failed: ' + rec.landOwnersName + ' › ' + rec.parcelNumber + ' › ' + rec.farmBlock + ' is not a registered row of your Farm & Blocks.'].concat(res.messages);
    res.reason = res.messages.join(' ');
  }
  res.checks.forEach(function (c) { c.status = 'INVALID'; });
  rec.validationStatus = 'INVALID';
  dvLog(ctx, st, rec, res);
  return { reportId: rec.reportId, status: 'INVALID', reason: res.reason, messages: res.messages, checks: res.checks, recordId: '', landOwnerNo: '', farmBlockCode: farmBlockCode(rec.farmBlock), sequence: '', period: res.period };
}

function dvPublic(r) {
  return {
    reportId: String(r['Report ID']), uniqueUuid: String(r['Unique UUID'] || ''), status: String(r['Status']), activityType: String(r['Activity Type']),
    date: String(r['Report Date'] || ''), cycle: String(r['Cycle'] || ''), period: String(r['Period'] || ''), userId: String(r['User ID'] || ''),
    supervisor: String(r['Supervisor'] || ''), recordId: String(r['Record ID'] || ''), landOwner: String(r['Land Owner'] || ''),
    landOwnerNo: String(r['CLAIF Number'] || ''), farmBlockCode: String(r['Farm Block Code'] || ''), farmBlock: String(r['Farm & Block'] || ''),
    parcelNumber: String(r['Parcel Number'] || ''), sequence: String(r['Sequence'] || ''), checks: dvParse(r['Checks JSON'], []),
    reason: String(r['Reason'] || ''), report: dvParse(r['Report JSON'], {}), original: dvParse(r['Original JSON'], {}),
    history: r.History || dvParse(r['History JSON'], []), firstSubmitted: String(r['First Submitted'] || ''), lastValidated: String(r['Last Validated'] || ''),
    reviewedBy: String(r['Reviewed By'] || ''), reviewNote: String(r['Review Note'] || ''), reviewedAt: String(r['Reviewed At'] || '')
  };
}

/** GET_VALIDATOR: validation records the user may see (admin: all; others: own reports + their Farm & Blocks). */
function handleGetValidator(ctx, payload) {
  var codes = joVisibleCodes(ctx);
  var rows = readObjects(ctx.ss.getSheetByName(SHEET_NAMES.DATA_VALIDATOR)).filter(function (r) {
    return !codes || String(r['User ID']) === ctx.userId || codes[String(r['Farm Block Code'])];
  }).sort(function (a, b) { return String(b['Last Validated']).localeCompare(String(a['Last Validated'])); }).slice(0, 3000);
  return respondJSON({ success: true, records: rows.map(dvPublic), rules: readValidationRules(ctx.ss), today: dvToday() });
}

/**
 * DV_REVIEW (Administrator): { reportId, decision: 'APPROVE' | 'REJECT', note }
 *  APPROVE: only FOR REVIEW reports; the submitted quantities are saved unchanged as an official accomplishment.
 *  REJECT : INVALID or FOR REVIEW reports; stays in the Data Validator, never counted.
 */
function handleDvReview(ctx, payload) {
  requireRole(ctx, [ROLES.ADMIN]);
  var st = dvState(ctx);
  var id = String(payload.reportId || '');
  var row = st.rows[id];
  if (!row) return respondJSON({ success: false, error: 'Report ' + id + ' is not in the Data Validator.' });
  var status = String(row['Status']);
  var decision = String(payload.decision || '').toUpperCase();
  var note = joCleanText(payload.note, 500);
  var now = new Date().toISOString();
  var history = dvParse(row['History JSON'], []);
  if (decision === 'APPROVE') {
    if (status !== 'FOR REVIEW') return respondJSON({ success: false, error: 'Only FOR REVIEW reports can be approved (this one is ' + status + '). INVALID reports must be corrected.' });
    var rec = dvParse(row['Report JSON'], null);
    if (!rec) return respondJSON({ success: false, error: 'The report data could not be read.' });
    rec.validationStatus = 'APPROVED';
    var sheetName = ACTIVITY_SHEETS[rec.activityType], customDef = null;
    if (!sheetName) {
      customDef = findCustomDef(readCustomActivities(ctx.ss), rec.customActivityId, rec.activityType);
      if (!customDef) return respondJSON({ success: false, error: 'Unknown activity type: ' + rec.activityType });
      sheetName = customDef.sheetName;
    }
    var supMap = computeBlockSupervisors(ctx.users, ctx.blocks);
    var blk = ctx.blocks.filter(function (b) { return String(b['Record ID']) === String(rec.recordId); })[0];
    rec.supervisorId = blk ? (supMap[String(blk['Block ID'])] || []).map(function (s) { return s.userId; }).join(', ') : String(rec.supervisorId || '');
    rec.serverTimestamp = now;
    rec.syncStatus = 'SENT';
    upsertReport(ctx, customDef ? ensureCustomActivitySheet(ctx.ss, customDef) : ctx.ss.getSheetByName(sheetName), rec, customDef);
    history.push({ at: now, by: String(ctx.user['Full Name']), event: 'APPROVED', note: note, previousStatus: status, status: 'APPROVED' });
    updateObjectById(st.sheet, 'Report ID', id, { 'Status': 'APPROVED', 'Reviewed By': String(ctx.user['Full Name']), 'Review Note': safeText(note), 'Reviewed At': now, 'History JSON': JSON.stringify(history.slice(-50)), 'Report JSON': JSON.stringify(rec) });
    logAudit(ctx.userId, ctx.role, 'DV_APPROVE', id, 'DataValidator', note);
    return respondJSON({ success: true, message: 'Report ' + id + ' approved and counted as an accomplishment.' });
  }
  if (decision === 'REJECT') {
    if (!DV_OPEN[status]) return respondJSON({ success: false, error: 'Report ' + id + ' is ' + status + ' and cannot be rejected.' });
    if (!note) return respondJSON({ success: false, error: 'Please write the reason for rejecting.' });
    history.push({ at: now, by: String(ctx.user['Full Name']), event: 'REJECTED', note: note, previousStatus: status, status: 'REJECTED' });
    updateObjectById(st.sheet, 'Report ID', id, { 'Status': 'REJECTED', 'Reviewed By': String(ctx.user['Full Name']), 'Review Note': safeText(note), 'Reviewed At': now, 'History JSON': JSON.stringify(history.slice(-50)) });
    logAudit(ctx.userId, ctx.role, 'DV_REJECT', id, 'DataValidator', note);
    return respondJSON({ success: true, message: 'Report ' + id + ' rejected. It is kept in the Data Validator and not counted.' });
  }
  return respondJSON({ success: false, error: 'Unknown decision.' });
}


/* ==========================================================================
   REPORT PHOTOS (v4.4) — one photo per report, stamped on the phone
   (date, time, GPS, Farm & Block, land owner, activity, supervisor, Report ID).
   Saved in a PRIVATE Drive folder: FarmOps Report Photos / yyyy / MM-Month.
   The ReportPhotos sheet keeps the link, a small thumbnail and who uploaded it.
   ========================================================================== */
var RP_FOLDER = 'FarmOps Report Photos';
var RP_MAX_BYTES = 3 * 1024 * 1024;

function rpPhotoIndex(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.REPORT_PHOTOS);
  var map = {};
  if (sheet) readObjects(sheet).forEach(function (r) { map[String(r['Report ID'])] = r; });
  return map;
}

function rpFolder(dateText) {
  var it = DriveApp.getFoldersByName(RP_FOLDER);
  var root = it.hasNext() ? it.next() : DriveApp.createFolder(RP_FOLDER);
  var d = /^\d{4}-\d{2}/.test(String(dateText)) ? String(dateText) : Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var sub = function (parent, name) { var f = parent.getFoldersByName(name); return f.hasNext() ? f.next() : parent.createFolder(name); };
  var m = parseInt(d.substring(5, 7), 10);
  return sub(sub(root, d.substring(0, 4)), d.substring(5, 7) + '-' + months[m - 1]);
}

/** The report the photo belongs to (activity sheet or Data Validator), or null. */
function rpFindReport(ctx, payload) {
  var id = String(payload.reportId || '');
  var uuid = String(payload.uniqueUuid || '');
  var act = String(payload.activityType || '');
  var hit = readReports(ctx, act || 'All').filter(function (r) { return String(r.reportId) === id || (uuid && String(r.uniqueUuid) === uuid); })[0];
  if (hit) return hit;
  var dvSheet = ctx.ss.getSheetByName(SHEET_NAMES.DATA_VALIDATOR);
  var dv = dvSheet ? readObjects(dvSheet).filter(function (r) { return String(r['Report ID']) === id; })[0] : null;
  return dv ? dvParse(dv['Report JSON'], null) : null;
}

/** UPLOAD_REPORT_PHOTO: { reportId, uniqueUuid, activityType, data (base64 jpeg), thumb (data URL), source, photoDate, takenAt, gps } */
function handleUploadReportPhoto(ctx, payload) {
  var rec = rpFindReport(ctx, payload);
  if (!rec) return respondJSON({ success: false, code: 'NOT_FOUND', error: 'The report is not on the server yet. The photo will be sent after the report.' });
  if (!ctx.isAdmin && String(rec.userId) !== ctx.userId) return respondJSON({ success: false, code: 'FORBIDDEN', error: 'Only the person who made the report can add its photo.' });
  var bytes;
  try { bytes = Utilities.base64Decode(String(payload.data || '')); } catch (e) { bytes = null; }
  if (!bytes || !bytes.length) return respondJSON({ success: false, error: 'The photo could not be read.' });
  if (bytes.length > RP_MAX_BYTES) return respondJSON({ success: false, error: 'The photo is larger than 3 MB.' });
  var thumb = String(payload.thumb || '');
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(thumb) || thumb.length > 45000) thumb = '';

  var sheet = ctx.ss.getSheetByName(SHEET_NAMES.REPORT_PHOTOS);
  var id = String(rec.reportId);
  var old = readObjects(sheet).filter(function (r) { return String(r['Report ID']) === id; })[0] || null;
  var file = rpFolder(rec.date).createFile(Utilities.newBlob(bytes, 'image/jpeg', id + '.jpg'));   // NOT shared publicly
  if (old && old['File ID']) { try { DriveApp.getFileById(String(old['File ID'])).setTrashed(true); } catch (e) { /* already gone */ } }
  var obj = {
    'Report ID': id, 'Unique UUID': String(rec.uniqueUuid || ''), 'Activity Type': String(rec.activityType || ''), 'Report Date': String(rec.date || ''),
    'Farm Block Code': farmBlockCode(rec.farmBlock), 'Farm & Block': safeText(String(rec.farmBlock || '')), 'Land Owner': safeText(String(rec.landOwnersName || '')),
    'Parcel Number': safeText(String(rec.parcelNumber || '')), 'User ID': String(rec.userId || ''), 'Uploaded By': String(ctx.user['Full Name']),
    'Source': String(payload.source) === 'gallery' ? 'Gallery' : 'Camera', 'Photo Date': safeText(String(payload.photoDate || '').substring(0, 30)),
    'Taken At': safeText(String(payload.takenAt || '').substring(0, 40)), 'GPS': safeText(String(payload.gps || '').substring(0, 60)),
    'File ID': file.getId(), 'Photo Link': file.getUrl(), 'Size KB': Math.round(bytes.length / 1024), 'Thumb': thumb, 'Uploaded At': new Date().toISOString()
  };
  if (old) updateObjectById(sheet, 'Report ID', id, obj); else appendObject(sheet, obj);
  logAudit(ctx.userId, ctx.role, 'UPLOAD_REPORT_PHOTO', id, 'ReportPhotos', obj['Source'] + ' ' + obj['Size KB'] + ' KB');
  return respondJSON({ success: true, reportId: id, message: 'Photo saved.' });
}

function rpCanSee(ctx, row, codes) {
  return !codes || String(row['User ID']) === ctx.userId || !!codes[String(row['Farm Block Code'])];
}

/** REPORT_PHOTO: { reportId } -> the stamped photo (base64) if the user can see that report. */
function handleReportPhoto(ctx, payload) {
  var row = rpPhotoIndex(ctx.ss)[String(payload.reportId || '')];
  if (!row) return respondJSON({ success: false, code: 'NOT_FOUND', error: 'This report has no photo.' });
  if (!rpCanSee(ctx, row, joVisibleCodes(ctx))) return respondJSON({ success: false, error: 'You cannot open this photo.' });
  var blob = DriveApp.getFileById(String(row['File ID'])).getBlob();
  return respondJSON({ success: true, mimeType: 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()), source: String(row['Source']),
    photoDate: String(row['Photo Date'] || ''), uploadedBy: String(row['Uploaded By'] || ''), uploadedAt: String(row['Uploaded At'] || '') });
}

/** REPORT_PHOTO_THUMBS: { reportIds: [...] (max 100) } -> { thumbs: { reportId: dataUrl } } */
function handleReportPhotoThumbs(ctx, payload) {
  var ids = (Array.isArray(payload.reportIds) ? payload.reportIds : []).slice(0, 100).map(String);
  var index = rpPhotoIndex(ctx.ss), codes = joVisibleCodes(ctx), out = {};
  ids.forEach(function (id) {
    var row = index[id];
    if (row && rpCanSee(ctx, row, codes)) out[id] = { thumb: String(row['Thumb'] || ''), source: String(row['Source'] || '') };
  });
  return respondJSON({ success: true, thumbs: out });
}


/* ==========================================================================
   PROFILE PHOTO (v4.5) — small square JPEG (≈192 px, < 40 KB) kept in the Users sheet.
   Each user changes his own; an Administrator can set or remove anyone's.
   ========================================================================== */
function handleSetProfilePhoto(ctx, payload) {
  var userId = String(payload.userId || ctx.userId);
  if (userId !== ctx.userId && !ctx.isAdmin) return respondJSON({ success: false, code: 'FORBIDDEN', error: 'You can only change your own photo.' });
  var target = findUser(ctx.users, userId);
  if (!target) return respondJSON({ success: false, error: 'User not found.' });
  var photo = String(payload.photo || '');
  if (photo && (!/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(photo) || photo.length > 40000)) {
    return respondJSON({ success: false, error: 'The photo is not valid or too big. Please choose it again.' });
  }
  updateObjectById(ctx.ss.getSheetByName(SHEET_NAMES.USERS), 'User ID', userId, { 'Profile Photo': photo });
  logAudit(ctx.userId, ctx.role, 'SET_PROFILE_PHOTO', userId, 'Users', photo ? 'Photo updated' : 'Photo removed');
  return respondJSON({ success: true, userId: userId, photo: photo, message: photo ? 'Profile photo saved.' : 'Profile photo removed.' });
}


/* ==========================================================================
   THEME (v4.6) — each user's colour theme and light / dark mode, saved in the Users sheet ("Theme").
   ========================================================================== */
var THEME_COLOURS = ['palm', 'ocean', 'sunset', 'purple', 'coconut', 'slate'];
var THEME_MODES = ['light', 'dark', 'auto'];

function handleSetTheme(ctx, payload) {
  var colour = String(payload.colour || 'palm');
  var mode = String(payload.mode || 'light');
  if (THEME_COLOURS.indexOf(colour) === -1 || THEME_MODES.indexOf(mode) === -1) return respondJSON({ success: false, error: 'Unknown theme.' });
  var value = colour + '|' + mode;
  updateObjectById(ctx.ss.getSheetByName(SHEET_NAMES.USERS), 'User ID', ctx.userId, { 'Theme': value });
  return respondJSON({ success: true, theme: value, message: 'Theme saved.' });
}
