# Farm Operations, Activity Monitoring & KPI Management System
### Mobile-First, Offline-Ready Progressive Web App (PWA) with Google Sheets Central Database & Google Apps Script API

A complete, professional, mobile-responsive **Farm Operations Monitoring & KPI Management System** built with HTML5, CSS3, JavaScript, IndexedDB, and Google Apps Script, using Google Sheets as the central database. Designed specifically for tropical coconut plantations with an animated coconut palm tree theme, offline map rendering, device hardware identification, and automatic background synchronization.

---

## 🌟 Key Capabilities & Architectural Highlights

1. **Role-Based Access Control & User Management**:
   - **Administrator**: Full organization control, user provisioning, supervisor assignments, landowner & parcel management, dynamic dropdown options, KPI target configuration, offline farm map publishing, device registry, and global analytics.
   - **Supervisor**: Restricted oversight. Supervisors can monitor their assigned employees, designated landowners, parcels, farm blocks, review activity reports, and view productivity forecasts.
   - **Field Personnel**: Streamlined mobile experience. Access only assigned activities and farm areas, submit daily reports, capture GPS coordinates, view offline maps, and synchronize reports seamlessly.

2. **6 Standardized Farm Activity Modules**:
   - **A. Regular Activity**: Weeding rolling / slashing (Ha), round weeding (palms), compost application (palms, sacks, kg, BOF request code), pruning, soil drenching premix (palms, liters, foliar request code).
   - **B. Irregular Activity**: Pest and disease soil drenching, crown cleaning, drainage clearing, and special non-cyclic operations.
   - **C. Other Farm Activity**: Cover crop planting, farm road grading, boundary fencing, nursery maintenance, and husk mulching.
   - **D. Palm Category Activity**: Comprehensive stage census (Seedling, Juvenile, Pre-trunk Reproductive, Semi-Mature, Mature, Fruiting, and Problem palms).
   - **E. Seednut Collection**: Daily seednut harvest, rejected nut count, next cycle forecasting, area codes (with QR scanner), and automatic GPS location stamping.
   - **F. Pest and Disease Activity**: Target pest diagnosis (Rhinoceros Beetle, Red Palm Weevil, etc.), chemicals/bio-inputs used, ratios, application methods, and target tree canopy parts.

3. **Offline-First Architecture (100% Offline Capable)**:
   - **IndexedDB (`FarmOpsDB`)**: Stores reports, master dropdowns, landowners, parcels, blocks, KPIs, offline maps, and cached user credentials locally on device.
   - **Service Worker (`sw.js`)**: Pre-caches application shell and static assets for instant offline loading anywhere.
   - **Offline Authentication**: Field workers and supervisors who have logged in once can log in offline using cryptographically hashed credentials (SHA-256 via Web Crypto API).
   - **Offline Farm Maps**: Interactive GeoJSON parcel boundary viewer with live GPS pin overlay, zoom, pan, and parcel inspector that functions without cellular reception.

4. **Automatic Synchronization & Duplicate Prevention**:
   - Every submitted report is saved locally in IndexedDB first, assigning a persistent unique UUID and installation **Device ID**.
   - Network connectivity is detected automatically (`online` / `offline` events & Service Worker background sync).
   - Idempotent batch upload sends reports to Google Apps Script, upserting by UUID to guarantee zero duplicate records in Google Sheets.
   - Local records are never deleted on synchronization; their status simply changes to `SENT` with server timestamp confirmation.

5. **KPI Engine & Completion Forecasting**:
   - **KPI Achievement %**: `(Actual Accomplishment / Target Accomplishment) * 100`
   - **Daily Productivity**: `Actual Accomplishment / Manpower Deployed`
   - **Remaining Target**: `Total Target - Actual Accomplishment`
   - **Expected Daily Rate**: `Manpower * Registered Productivity per Person per Day`
   - **Estimated Days to Complete**: `Remaining Target / Expected Daily Rate`
   - **Forecast Completion Date**: Calculated day-by-day, automatically skipping scheduled rest days (Sundays) and custom holidays.

---

## 📁 Project File Structure

```text
Attendance System/
│
├── index.html            # Main Single-Page Application (SPA) UI with all 20 views
├── manifest.json         # PWA Manifest for installability on Android, iOS, & Desktop
├── sw.js                 # Service Worker for offline asset caching & background sync
├── Code.gs               # Google Apps Script Web App Backend & Sheets API (19 Sheets)
├── README.md             # Complete Setup, Deployment, and Testing Guide
│
├── css/
│   └── styles.css        # Tropical Coconut Plantation theme, animated palm tree & responsive UI
│
├── js/
│   ├── db.js             # IndexedDB wrapper (FarmOpsDB with 12 stores & seed data)
│   ├── auth.js           # Web Crypto SHA-256 hashing, session & access control
│   ├── sync.js           # Background & manual sync engine, device telemetry & queue
│   └── app.js            # Controller, router (20 pages), cascading dropdowns, charts, maps, QR
│
└── icons/
    └── icon.svg          # Tropical coconut palm tree vector icon & PWA maskable badge
```

---

## 📊 Google Sheets Central Database (19 Required Sheets)

When Google Apps Script runs `setupDatabase()`, it automatically creates, formats, and initializes the following 19 sheets with deep-green tropical headers and column formatting:

1. **`Users`**: `[User ID, Employee ID, Full Name, Username, Password Hash, Role, Assigned Supervisor, Assigned Land Owners, Assigned Farm and Blocks, Assigned Activities, Account Status, Date Created, Last Login]`
2. **`UserPermissions`**: `[Permission ID, User ID, Can Manage Users, Can Manage Dropdowns, Can Manage KPIs, Can Manage Maps, Can View All Reports, Can Export Data, Status]`
3. **`LandOwners`**: `[Land Owner ID, Land Owner Name, Contact Person, Phone, Total Hectares, Status]`
4. **`Parcels`**: `[Parcel ID, Parcel Number, Land Owner ID, Land Owner Name, Total Area Ha, Total Palms, Status]`
5. **`FarmsAndBlocks`**: `[Block ID, Farm and Block Name, Parcel ID, Parcel Number, Land Owner ID, Land Owner Name, Area Ha, Palm Count, Status]`
6. **`DropdownOptions`**: `[Option ID, Activity Type, Dropdown Category, Option Value, Parent Value, Sort Order, Status]`
7. **`RegularActivity`**: `[Report ID, Unique UUID, User ID, Employee Name, Supervisor ID, Date, Land Owners Name, Parcel Number, Farm & Block, Manpower, Cycle, Weeding Rolling Slashing Ha, Round Weeding Palms, Compost Palms, Quantity Sacks, Quantity Kilo, BOF Request No, Pruning Palms, Soil Drenching Premix Palms, Quantity Liters, Foliar Request Code, Remarks, Device ID, Device Name, Browser OS, GPS Latitude, GPS Longitude, Server Timestamp, Sync Status]`
8. **`IrregularActivity`**: `[Report ID, Unique UUID, User ID, Employee Name, Supervisor ID, Date, Land Owners Name, Parcel Number, Farm & Block, Manpower, Pest Treatment Soil Drench, Count of Palms, Quantity Liters, Foliar Request Number, Irregular Activity, Count of Palms 2, Count of Manpower 2, Remarks, Device ID, Device Name, Browser OS, GPS Latitude, GPS Longitude, Server Timestamp, Sync Status]`
9. **`OtherFarmActivity`**: `[Report ID, Unique UUID, User ID, Employee Name, Supervisor ID, Date, Land Owners Name, Parcel Number, Farm & Block, Manpower, Other Activities, Quantity, Unit, Remarks, Device ID, Device Name, Browser OS, GPS Latitude, GPS Longitude, Server Timestamp, Sync Status]`
10. **`PalmCategoryActivity`**: `[Report ID, Unique UUID, User ID, Employee Name, Supervisor ID, Timestamp, Farm & Block, Land Owners Name, Parcel Number, Palm Number, Seedling Stage, Juvenile Stage, Pre-trunk Reproductive Stage, Pre-trunk Fruiting Stage, Mature Stage, Fruiting Stage, Problem Palms, Manpower Count, Remarks, Device ID, Device Name, Browser OS, GPS Latitude, GPS Longitude, Server Timestamp, Sync Status]`
11. **`SeednutCollection`**: `[Report ID, Unique UUID, User ID, Employee Name, Supervisor ID, Date, Area Code, Palm Number, Nut Count Collected, Count of Nuts for Next Collection, Count of Rejected Nuts, GPS Latitude, GPS Longitude, GPS Accuracy, Remarks, Device ID, Device Name, Browser OS, Server Timestamp, Sync Status]`
12. **`PestAndDiseaseActivity`**: `[Report ID, Unique UUID, User ID, Employee Name, Supervisor ID, Date, Land Owners Name, Parcel Number, Palm Numbers, Farm & Block, Target Pest, Total Palms Affected, Input Used, Quantity, Unit, Ratio, Method Used, Target Parts Application, Manpower Count, Remarks, Device ID, Device Name, Browser OS, GPS Latitude, GPS Longitude, Server Timestamp, Sync Status]`
13. **`KPIRegistration`**: `[KPI ID, Activity Type, Farm & Block, Land Owner, Parcel Number, Cycle, Target Quantity, Target Unit, Required Manpower, Target Working Days, Daily Expected Accomplishment, Effective Date, Status]`
14. **`ManpowerRecords`**: `[Record ID, Date, Activity Type, Supervisor ID, Supervisor Name, Land Owner, Parcel Number, Farm & Block, Manpower Count, Hours Worked, Productivity Per Man, Notes]`
15. **`MapRegistry`**: `[Map ID, Map Title, Version, Land Owner, Parcel Number, Farm & Block, File Type, GeoJSON Data, Upload Date, Uploaded By, Status]`
16. **`DeviceRegistry`**: `[Device ID, Device Name, User ID, Employee Name, Browser OS, First Seen, Last Seen, Total Submissions, Status]`
17. **`SyncLogs`**: `[Log ID, Batch ID, User ID, Device ID, Records Count, Status, Error Message, Timestamp]`
18. **`AuditLogs`**: `[Log ID, User ID, User Role, Action, Record ID, Module, Details, Timestamp]`
19. **`SystemSettings`**: `[Key, Value, Description, Last Updated]`

---

## 🚀 Setup & Deployment Instructions

### 1. Google Sheets Central Database Setup

1. Open your web browser and navigate to [Google Sheets](https://sheets.new) to create a new spreadsheet.
2. Title the spreadsheet: `Coconut Farm Operations Central Database`.
3. In the top toolbar, click **Extensions** &gt; **Apps Script**.

---

### 2. Google Apps Script Web App Deployment

1. In the Apps Script code editor, delete any template code in `Code.gs`.
2. Copy the entire contents of `Code.gs` from this project and paste it into the editor.
3. Save the project (click the disk icon or press `Ctrl + S`).
4. In the Apps Script toolbar, click the **Run** button to execute `setupDatabase()`.
   - Grant the required Google Spreadsheet permissions when prompted.
   - Switch back to your Google Spreadsheet tab: verify that all **19 sheets** have been created, formatted with green headers, and pre-populated with initial admin credentials and default farm master data.
5. Deploy as Web App:
   - Click the blue **Deploy** button (top right) &gt; **New deployment**.
   - Click the gear icon next to *Select type* and choose **Web app**.
   - Fill in deployment parameters:
     - **Description**: `FarmOps Production API v2.0`
     - **Execute as**: `Me (your Google email)`
     - **Who has access**: `Anyone` *(crucial for allowing the frontend on GitHub Pages to communicate with the database)*.
   - Click **Deploy**.
   - Copy the generated **Web App URL** ending in `/exec`.

---

### 3. Frontend Link to Google Apps Script Backend

1. Open the application in your browser (or visit your hosted GitHub Pages site).
2. Log in using the default Administrator account:
   - **Username**: `admin`
   - **Password**: `admin123`
3. Click the gear icon in the top header or navigate to **Settings** in the sidebar.
4. Paste your Google Apps Script Web App URL into the **Google Apps Script Web App URL** input field.
5. Click **🔌 Test Connection & Initialize Google Sheets**.
   - A green success message will confirm that the frontend has established a secure link with your Google Sheets database.
6. Click **Save Settings**.

---

### 4. GitHub Repository Setup

1. In your local terminal or workspace directory (`Attendance System`):
   ```bash
   git init
   git add .
   git commit -m "Initial release: Farm Operations & KPI Management System"
   ```
2. Create a new repository on [GitHub](https://github.com/new), for example named `farm-operations-kpi`.
3. Link your local repository to GitHub:
   ```bash
   git remote add origin https://github.com/<your-username>/farm-operations-kpi.git
   git branch -M main
   git push -u origin main
   ```

---

### 5. GitHub Pages Deployment

1. On GitHub, navigate to your repository repository settings: **Settings** &gt; **Pages** (under Code and automation).
2. Under **Build and deployment**:
   - **Source**: Select `Deploy from a branch`.
   - **Branch**: Select `main`, folder: `/(root)`.
   - Click **Save**.
3. GitHub Pages will build and deploy your Progressive Web App in approximately 60 seconds.
4. Your live URL will appear: `https://<your-username>.github.io/farm-operations-kpi/`.

---

### 6. Custom Domain Configuration Instructions

To host the application under your custom farm domain (e.g. `farmops.myplantation.com`):

1. **In your Domain Registrar DNS Manager** (GoDaddy, Namecheap, Cloudflare, Route53):
   - For a subdomain (e.g. `farmops.myplantation.com`):
     - Add a **CNAME** record:
       - **Host / Name**: `farmops`
       - **Target / Value**: `<your-username>.github.io`
       - **TTL**: `Automatic` or `3600`
   - For an apex domain (e.g. `myplantation.com`):
     - Add **A** records pointing to GitHub Pages IP addresses:
       - `185.199.108.153`
       - `185.199.109.153`
       - `185.199.110.153`
       - `185.199.111.153`
2. **In GitHub Repository Settings**:
   - Go to **Settings** &gt; **Pages** &gt; **Custom domain**.
   - Enter your domain name: `farmops.myplantation.com`.
   - Click **Save**.
   - Check the box **Enforce HTTPS** (GitHub will automatically provision a free Let's Encrypt SSL certificate within 15 minutes).
3. If creating locally, create a file named `CNAME` in the repository root containing your custom domain.

---

### 7. Installation Instructions for Mobile Devices (Android & iPhone)

The application is an installable PWA that functions like a native Android or iOS app:

#### On Android (Google Chrome):
1. Open Google Chrome on your phone and browse to your deployed URL.
2. Chrome will automatically display an **"Add FarmOps KPI to Home screen"** prompt at the bottom of the screen.
3. If not shown, tap the **three dots menu** (top right) &gt; select **Install app** or **Add to Home screen**.
4. Tap **Install**. The FarmOps icon will appear on your phone's home screen and app drawer.
5. Tap the app icon: it launches full-screen without URL bars or browser chrome.

#### On iPhone / iPad (Apple Safari):
1. Open Safari on your iOS device and browse to your deployed URL.
2. Tap the **Share icon** (square with an upward arrow at the bottom of the screen).
3. Scroll down and tap **"Add to Home Screen"**.
4. Name the application `FarmOps KPI` and tap **Add** in the top right.
5. The application is now installed as an iOS home screen web app with offline caching and standalone display.

---

### 8. Instructions for Downloading Maps for Offline Use

1. Ensure your device has an active internet connection during the first download.
2. In the application sidebar or bottom navigation, tap **Farm Maps (Offline)**.
3. The interactive canvas map displays your registered farm blocks, coconut parcel boundaries, and your live GPS marker.
4. Tap the **"⬇️ Download Map for Offline"** button in the header toolbar.
5. The application downloads the complete GeoJSON parcel boundaries, tree census metadata, and spatial vectors directly into IndexedDB (`FarmOpsDB.maps`).
6. **Testing Offline View**: Turn on Airplane mode or disable Wi-Fi/Mobile data. Open the Maps module: the map pans, zooms, and highlights parcels with zero internet connection!
7. **Map Versioning**: When an administrator updates parcel boundaries and publishes a new map version (e.g. `v1.1.0`), users will receive the notification:
   > *"A NEW FARM MAP VERSION IS AVAILABLE. PLEASE DOWNLOAD THE LATEST MAP AND DELETE THE OLD VERSION."*
   The system validates the download of the replacement package before deactivating the older version.

---

### 9. Instructions for Creating Administrator & User Accounts

1. Log in with the default Administrator account:
   - **Username**: `admin`
   - **Password**: `admin123`
2. Navigate to **User Management** in the sidebar.
3. Click **+ Add New User**.
4. Fill in user fields:
   - **Employee ID**: (e.g. `EMP-004`)
   - **Full Name**: (e.g. `Elena Soriano`)
   - **Username**: (e.g. `elena`)
   - **Password**: Enter initial password
   - **Role**: Choose between `Field Personnel`, `Supervisor`, or `Administrator`
   - **Assigned Supervisor**: Assign to a registered supervisor
   - **Assigned Landowners**: Enter specific landowners or `ALL`
   - **Assigned Farm & Blocks**: Enter specific blocks or `ALL`
5. Click **Save**. The account is created both in IndexedDB and in the Google Sheets `Users` tab with a salted SHA-256 password hash.
6. When the new user logs in online for the first time, their credentials and assigned areas are automatically cached onto their phone, enabling permanent offline login thereafter!

---

## 🧪 12-Step Complete System Verification Procedure

Follow this test script to verify end-to-end functionality:

| Step | Action | Expected Result |
|:---:|:---|:---|
| **1** | Admin creates a user in User Management | New user `field2` is enrolled with role `Field Personnel`. |
| **2** | Admin assigns farms, parcels, and activities | Permissions restricted to `Hacienda San Isidro` & `Regular Activity`. |
| **3** | Admin registers activity dropdown options in Dropdown Management | New cycle or input option added to `DropdownOptions`. |
| **4** | Admin registers KPI targets in KPI Management | Target: 2.0 Ha Weeding / Slashing for Block A1 with 4 manpower. |
| **5** | User logs in on their phone | User dashboard displays assigned areas and permissions. |
| **6** | User records Regular Activity while online | Report is submitted, saved to local IndexedDB, and synced immediately to Google Sheets. |
| **7** | User toggles Airplane Mode (Offline) and submits Seednut Collection | Report is stored safely in IndexedDB `reports` and `pendingQueue`. Network badge shows **Offline / Pending Sync**. |
| **8** | User views downloaded farm maps while offline | Map renders parcels, zoom/pan controls function, and GPS location pin updates without internet. |
| **9** | Turn off Airplane Mode (Internet restored) | System detects connection, status switches to **Syncing...** then **Online**. |
| **10** | Pending reports synchronize automatically | Report is uploaded to Google Sheets `SeednutCollection` tab, marked `SENT`, and removed from pending queue. |
| **11** | Admin inspects submitted reports & device registry | Report is visible in Reports tab and Google Sheets with persistent `Device ID` and GPS coordinates. |
| **12** | Dashboard and KPI calculations update correctly | Accomplishment %, productivity per man, remaining target, and completion forecasts recompute dynamically! |

---

## 🔒 Security & Data Integrity

- **Server-Side Authorization**: All administrative mutations and synchronization batches are verified by role in Google Apps Script `Code.gs`.
- **Cryptographic Hashing**: User passwords are never transmitted in plaintext; they are hashed with SHA-256 via the Web Crypto API before transmission and comparison.
- **Idempotency Guarantee**: Every submitted report carries an immutable UUID. If network drops occur mid-sync, resending the batch safely updates existing rows rather than creating duplicate entries.
- **Zero Local Data Loss**: Local records are retained in IndexedDB with audit trails and are never cleared until confirmed by server timestamps.

---

## 🌴 Theme & Visual Experience

- **Tropical Coconut Plantation Theme**: Featuring deep palm greens (`#14532d`, `#166534`), golden sun accents (`#f59e0b`), coconut husk bronze (`#78350f`), and clean white card surfaces.
- **Animated Coconut Palm Tree**: Gentle wind-swaying fronds, moving branches, healthy green coconuts, mature brown coconuts, and floating sunlight particles on Login and Dashboard views.
- **Responsive Navigation**: Mobile bottom navigation bar for one-thumb field use, paired with a collapsible desktop sidebar for farm managers and executives.
