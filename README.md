# Farm Operations, Activity Monitoring & KPI Management System
### Mobile-First, Offline-Ready Progressive Web App (PWA) with Google Sheets Central Database & Google Apps Script API

A complete, professional, mobile-responsive **Farm Operations Monitoring & KPI Management System** built with HTML5, CSS3, JavaScript, IndexedDB, and Google Apps Script, using Google Sheets as the central database. Designed specifically for tropical coconut plantations with an animated coconut palm tree theme, offline map rendering, device hardware identification, and automatic background synchronization.

---

## 🆕 What's new in v3.1.0

- **Add New Activity** – Administrators can create new activity modules from *Register Activity › + Add New Activity*: name, icon, description and your own fields (Number, Text, Dropdown, Date, with units). Each new activity gets its own Google Sheet tab (`ACT_<name>`), appears in the hub, in User Management (assign it to users), in KPI targets (choose a *KPI Measure* number field), in Reports and in Excel/CSV exports. Edit ✏️ or deactivate 🚫 it from its card; old reports are always kept.
- **Map upload fixed** – upload **KML, KMZ (Google Earth) or GeoJSON**. The file is checked before upload (number of shapes, size). Large maps (up to ~3 MB) are stored across several rows of the new `MapChunks` sheet, so the 50,000-character cell limit no longer blocks uploads. Lines (roads) and points (wells) are drawn too. Name each shape after its Farm & Block so assigned blocks are highlighted.
- **KPI Registration & Targets** – the form uses a single **Farm & Block** selector, and the table column is now **Farm & Block** (land owner › parcel shown underneath).

## What's new in v3.0.0

- **Secure API** – every request (except `PING` and `LOGIN`) needs a signed session token (30-day validity, revoked on password change / deactivation). Roles are enforced in `Code.gs`, not only in the browser.
- **No password hashes leave the server** – stored hashes are salted and stretched. Old v2 hashes are upgraded automatically at the next sign-in.
- **Forced password change** – the default `admin / admin123` account (and any account still on `admin123`) must set a new password at first sign-in. Demo users and demo farm data are no longer created.
- **Farm & Block based access** – users are assigned to **Farm & Blocks only** (no land owner assignment). Supervisors and Field Personnel only download and see data for their assigned blocks.
- **Land Owner Enrollment** – enroll a land owner with just *Land Owner Name, Parcel Number, Farm & Block*. Each block shows its **supervisor automatically**, found from the Supervisor assigned to that block in User Management (one supervisor per block).
- **Auto supervisor for field personnel** – a Field Personnel's supervisor is detected from the blocks they share; reports get the correct `Supervisor ID` on the server.
- **Real server sync for admin actions** – users, KPIs, dropdowns, maps and enrollments are saved to Google Sheets (before, they were only saved on the admin's phone).
- **Supervisors see their team's reports** – reports are downloaded from Google Sheets for the user's blocks.
- **Real offline GeoJSON map** with live GPS, tap-to-inspect, pinch/drag; admins upload `.geojson` files.
- Seednut Collection now records Land Owner / Parcel / Farm & Block.
- KPI monitoring respects the **cycle**, and status (Ahead / On Track / Behind) compares progress against the elapsed days.

---

## 🌟 Key Capabilities & Architectural Highlights

1. **Role-Based Access Control & User Management**:
   - **Administrator**: Full control — Land Owner Enrollment, user accounts, Farm & Block assignment, dropdown options, KPI targets, map publishing, device registry.
   - **Supervisor**: Assigned to Farm & Blocks. Sees reports, KPIs and field personnel of those blocks only, and can set KPIs for them.
   - **Field Personnel**: Assigned to Farm & Blocks and activities. Can only record reports for those blocks/activities; sees reports of those blocks.

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

> **Upgrading from v2?** Paste the new `Code.gs` over the old one, then **Deploy › Manage deployments › ✏️ Edit › Version: New version › Deploy**. This keeps the same `/exec` URL. Your existing sheets and data are kept; missing columns are added automatically on the first request.

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
5. On the login screen open **⚙️ Server connection**, paste the URL and click **Test & Save Server URL** (or set `DEFAULT_API_URL` at the top of `js/sync.js` so every phone is connected automatically).
6. Sign in as `admin` / `admin123`. You will be asked to set a new password immediately.

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

### 9. Enrolling Land Owners (Land Owner Enrollment)

1. Sign in as Administrator and open **Land Owner Enrollment**.
2. Enter **Land Owner Name**, **Parcel Number** and **Farm & Block** (several blocks can be separated with commas), then click **Enroll**.
   - An existing land owner or parcel with the same name is reused, so you can add more parcels/blocks later.
3. The table shows every Farm & Block with its **Supervisor (auto)**. Blocks without a supervisor are flagged *Unassigned* until a Supervisor is assigned to them in User Management.
4. Deactivate a block instead of deleting it, so old reports stay valid.

### 10. Instructions for Creating Administrator & User Accounts

1. Log in with the default Administrator account:
   - **Username**: `admin`
   - **Password**: `admin123`
2. Navigate to **User Management** in the sidebar.
3. Click **+ Add New User**.
4. Fill in user fields:
   - **Employee ID**, **Full Name**, **Username**, **Temporary Password** (min. 8 characters)
   - **Role**: `Field Personnel`, `Supervisor`, or `Administrator`
   - **Assigned Farm & Blocks**: tick the blocks (grouped by Land Owner › Parcel). A block can have only **one Supervisor**; blocks already taken are greyed out for supervisors.
   - **Assigned Activities**: tick the activity modules the user may record.
   - For Field Personnel the form shows the **auto supervisor** for the selected blocks.
5. Click **Save**. The account is saved in the Google Sheets `Users` tab (salted password hash). The user must change the temporary password at first sign-in.
6. Use 🔑 to set a new temporary password and 🚫 to deactivate an account (this signs the user out on all devices).
7. After the first online sign-in, the user can sign in offline on that same phone.

---

## 🧪 12-Step Complete System Verification Procedure

Follow this test script to verify end-to-end functionality:

| Step | Action | Expected Result |
|:---:|:---|:---|
| **1** | Admin creates a user in User Management | New user `field2` is enrolled with role `Field Personnel`. |
| **2** | Admin enrolls a land owner and assigns the user's Farm & Blocks | The user only sees the assigned blocks; the block shows its auto supervisor. |
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

- **Signed Session Tokens**: HMAC-signed tokens (secret kept in Script Properties). Tokens are revoked when the password, role or status changes.
- **Server-Side Authorization**: Every action checks the user's role, assigned Farm & Blocks and activities. A user can never submit or overwrite another user's report.
- **Password Storage**: The browser sends SHA-256(password); the server stores a salted, 200-round stretched hash. Hashes are never sent back to the browser. 5 wrong attempts lock the username for 15 minutes.
- **Formula-injection protection**: text starting with `= + - @` is stored as plain text in Google Sheets.
- **Idempotency Guarantee**: Every submitted report carries an immutable UUID. If network drops occur mid-sync, resending the batch safely updates existing rows rather than creating duplicate entries.
- **Zero Local Data Loss**: Local records are retained in IndexedDB with audit trails and are never cleared until confirmed by server timestamps.

---

## 🌴 Theme & Visual Experience

- **Tropical Coconut Plantation Theme**: Featuring deep palm greens (`#14532d`, `#166534`), golden sun accents (`#f59e0b`), coconut husk bronze (`#78350f`), and clean white card surfaces.
- **Animated Coconut Palm Tree**: Gentle wind-swaying fronds, moving branches, healthy green coconuts, mature brown coconuts, and floating sunlight particles on Login and Dashboard views.
- **Responsive Navigation**: Mobile bottom navigation bar for one-thumb field use, paired with a collapsible desktop sidebar for farm managers and executives.
