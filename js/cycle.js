/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Cycle Monitoring — per Land Owner, per Farm & Block, per Activity, per Month (or Cycle)
 *
 * Percent = work reported in the period ÷ size of the Farm & Block
 *   - Slashing            → hectares slashed ÷ block Area (Ha)
 *   - Round Weeding,
 *     Compost Application,
 *     Soil Drenching      → palms done ÷ block Palm Count
 * 100% = one full round of the block. Above 100% = more than one round.
 *
 * Administrators see every Farm & Block. Supervisors and Field Personnel only see
 * the Farm & Blocks assigned to them (same rule as the rest of the system).
 *
 * Load this file AFTER app.js in index.html:  <script src="js/cycle.js"></script>
 */

const CYCLE_ACTIVITIES = [
  { key: 'slashing', label: 'Slashing', field: 'weedingSlashingHa', base: 'area', unit: 'Ha' },
  { key: 'roundWeeding', label: 'Round Weeding', field: 'roundWeedingPalms', base: 'palms', unit: 'palms' },
  { key: 'compost', label: 'Compost Application', field: 'compostPalms', base: 'palms', unit: 'palms' },
  { key: 'soilDrench', label: 'Soil Drenching', field: 'soilDrenchingPalms', base: 'palms', unit: 'palms' }
  // To add Pruning, add:  { key: 'pruning', label: 'Pruning', field: 'pruningPalms', base: 'palms', unit: 'palms' }
];

const CYCLE_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

Object.assign(FarmOpsApp.prototype, {

  /** Sort CLAIF Numbers by their number part: CLAIF-9 before CLAIF-686. Empty ones go last. */
  compareClaif(a, b) {
    const sa = String(a || ''), sb = String(b || '');
    if (!sa || !sb) return sa ? -1 : (sb ? 1 : 0);
    const na = parseInt((sa.match(/(\d+)$/) || [])[1], 10), nb = parseInt((sb.match(/(\d+)$/) || [])[1], 10);
    return (isNaN(na) || isNaN(nb) ? 0 : na - nb) || sa.localeCompare(sb);
  },

  /** "Farm 1 Block 1" -> "Farm 1".  A name without the word "Block" is its own farm. */
  farmNameOf(blockName) {
    const name = String(blockName || '').trim();
    const m = name.match(/^(.*?)[\s\-–,/]*\bblock\b/i);
    return m && m[1].trim() ? m[1].trim() : name;
  },

  /** Default filter state for the Cycle Monitoring page. */
  getCycleState() {
    if (!this._cycleState || this._cycleState.userId !== auth.getUserId()) {
      const now = new Date();
      this._cycleState = {
        year: String(now.getFullYear()),
        groupBy: 'month',
        period: 'ALL',            // whole year: January to December
        category: 'ALL',
        landOwner: 'ALL',
        search: '',
        userId: auth.getUserId()
      };
    }
    return this._cycleState;
  },

  /**
   * Collects the rows (one per Farm & Block) and the reported quantities per period.
   * Only Regular Activity reports are used (that is where these 4 activities are recorded).
   */
  async buildCycleData(year, groupBy) {
    await auth.refreshScope();
    const allBlocks = (await db.getAll('farmsAndBlocks')).filter((b) => b.status !== 'Deactivated');
    const blocks = auth.hasAllBlocks() ? allBlocks : auth.getAuthorizedBlocks();
    const landowners = await db.getAll('landowners');
    // Land owners are identified by their ID / CLAIF Number (two owners may share a name)
    const loById = new Map(landowners.map((l) => [String(l.landOwnerId), l]));
    const key = (lo, p, b) => [lo, p, b].map((v) => String(v == null ? '' : v).trim().toLowerCase()).join('|');

    const rows = blocks.map((b) => {
      const lo = loById.get(String(b.landOwnerId)) || {};
      return {
        key: key(b.landOwnerName, b.parcelNumber, b.farmBlockName),
        blockId: b.blockId,
        landOwnerId: String(b.landOwnerId || ''),
        landOwnerName: b.landOwnerName,
        landOwnerNo: String(lo.landOwnerNo || b.landOwnerNo || ''),   // CLAIF Number, e.g. CLAIF-686
        category: b.category || lo.category || 'Not Priority',   // v3.8: each sequence entry has its own category
        parcelNumber: b.parcelNumber,
        farmBlockName: b.farmBlockName,
        farmName: this.farmNameOf(b.farmBlockName),
        areaHa: parseFloat(b.areaHa) || 0,
        palmCount: parseInt(b.palmCount, 10) || 0,
        cells: {}   // period -> { activityKey: quantity }
      };
    });
    const rowByKey = new Map(rows.map((r) => [r.key, r]));

    const reports = auth.filterAuthorizedRecords(await db.getAll('reports'))
      .filter((r) => r.activityType === 'Regular Activity' && String(r.date || '').startsWith(year));

    const cyclesSeen = new Set();
    reports.forEach((r) => {
      const row = rowByKey.get(key(r.landOwnersName, r.parcelNumber, r.farmBlock));
      if (!row) return;
      let period;
      if (groupBy === 'cycle') {
        period = String(r.cycle || '').trim() || 'No Cycle';
        cyclesSeen.add(period);
      } else {
        period = String(r.date).substring(5, 7);
      }
      const cell = row.cells[period] || (row.cells[period] = {});
      CYCLE_ACTIVITIES.forEach((a) => {
        const v = parseFloat(r[a.field]) || 0;
        if (v) cell[a.key] = (cell[a.key] || 0) + v;
      });
    });

    let periods;
    if (groupBy === 'cycle') {
      const options = (await db.getAll('dropdownOptions'))
        .filter((d) => d.activityType === 'Regular Activity' && d.dropdownCategory === 'Cycle' && d.status !== 'Deactivated')
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((d) => d.optionValue);
      const extra = [...cyclesSeen].filter((c) => !options.includes(c)).sort();
      periods = options.concat(extra).map((c) => ({ key: c, label: c }));
    } else {
      periods = CYCLE_MONTHS.map((m, i) => ({ key: String(i + 1).padStart(2, '0'), label: m }));
    }

    rows.sort((a, b) =>
      this.compareClaif(a.landOwnerNo, b.landOwnerNo) ||
      String(a.landOwnerName).localeCompare(String(b.landOwnerName)) ||
      String(a.parcelNumber).localeCompare(String(b.parcelNumber), undefined, { numeric: true }) ||
      String(a.farmBlockName).localeCompare(String(b.farmBlockName), undefined, { numeric: true }));

    const thisYear = new Date().getFullYear();
    let firstYear = thisYear - 2;
    (await db.getAll('reports')).forEach((r) => {
      const y = parseInt(String(r.date || '').slice(0, 4), 10);
      if (y > 2000 && y < firstYear) firstYear = y;
    });
    const years = [];
    for (let y = Math.max(thisYear + 1, parseInt(year, 10) || thisYear); y >= Math.min(firstYear, parseInt(year, 10) || thisYear); y--) years.push(String(y));

    return { rows, periods, years };
  },

  cycleBase(row, activity) {
    return activity.base === 'area' ? row.areaHa : row.palmCount;
  },

  /** Sum the quantities of one activity over the chosen periods. */
  cycleQty(row, activity, periodKeys) {
    return periodKeys.reduce((sum, p) => sum + ((row.cells[p] || {})[activity.key] || 0), 0);
  },

  /** Percent for a group of rows (weighted: total done ÷ total size). null = size not set. */
  cyclePercent(rows, activity, periodKeys) {
    let done = 0, base = 0;
    rows.forEach((r) => {
      const b = this.cycleBase(r, activity);
      if (b > 0) { base += b; done += this.cycleQty(r, activity, periodKeys); }
    });
    return base > 0 ? (done / base) * 100 : null;
  },

  /** Coloured table cell. */
  cycleCellHtml(percent, qty, unit) {
    if (percent === null) {
      return qty
        ? `<td style="text-align:center;color:#92400e;" title="Set the block's Area / Palm Count in Land Owner Enrollment">${Math.round(qty * 100) / 100} ${unit}*</td>`
        : `<td style="text-align:center;color:#cbd5e1;">—</td>`;
    }
    const p = Math.round(percent);
    let bg = 'transparent', color = '#94a3b8';
    if (p >= 100) { bg = '#dcfce7'; color = '#166534'; }
    else if (p >= 50) { bg = '#fef9c3'; color = '#854d0e'; }
    else if (p > 0) { bg = '#fee2e2'; color = '#991b1b'; }
    return `<td style="text-align:center;font-weight:700;background:${bg};color:${color};" title="${Math.round(qty * 100) / 100} ${unit}">${p}%</td>`;
  },

  categoryBadge(category) {
    return category === 'Priority'
      ? '<span class="badge badge-behind">Priority</span>'
      : '<span class="badge badge-ontrack">Not Priority</span>';
  },

  /* ==========================================================================
     CYCLE MONITORING PAGE
     ========================================================================== */

  async renderCycleMonitoringView(container) {
    const st = this.getCycleState();
    const data = await this.buildCycleData(st.year, st.groupBy);
    const e = (v) => this.esc(v);

    if (st.period !== 'ALL' && !data.periods.some((p) => p.key === st.period)) st.period = 'ALL';
    const shownPeriods = st.period === 'ALL' ? data.periods : data.periods.filter((p) => p.key === st.period);
    const periodKeys = shownPeriods.map((p) => p.key);
    // Grid column groups: each month (or cycle) + a whole-year total when all are shown
    const gridCols = shownPeriods.map((p) => ({ label: p.label, keys: [p.key], total: false }));
    if (st.period === 'ALL') gridCols.push({ label: `Total ${st.year}`, keys: periodKeys, total: true });

    const periodLabel = st.period === 'ALL'
      ? (st.groupBy === 'cycle' ? `All cycles ${st.year}` : `January – December ${st.year}`)
      : `${shownPeriods[0].label} ${st.year}`;

    // Land owner filter: one entry per land owner (same names are told apart by CLAIF Number)
    const ownerOptions = [...new Map(data.rows.map((r) => [r.landOwnerId, r])).values()]
      .sort((a, b) => String(a.landOwnerName).localeCompare(String(b.landOwnerName)) || this.compareClaif(a.landOwnerNo, b.landOwnerNo));
    const rows = data.rows.filter((r) =>
      (st.category === 'ALL' || r.category === st.category) &&
      (st.landOwner === 'ALL' || r.landOwnerId === st.landOwner));
    const missingSize = rows.filter((r) => !r.areaHa || !r.palmCount).length;

    // ---- Summary per Farm (Land Owner + Farm)
    const farms = new Map();
    rows.forEach((r) => {
      const k = `${r.landOwnerId}|${r.farmName}|${r.category}`;   // a land owner can have Priority and Not Priority sequences
      if (!farms.has(k)) farms.set(k, { landOwnerNo: r.landOwnerNo, landOwnerName: r.landOwnerName, farmName: r.farmName, category: r.category, rows: [] });
      farms.get(k).rows.push(r);
    });

    const overall = (cat) => CYCLE_ACTIVITIES.map((a) => this.cyclePercent(rows.filter((r) => !cat || r.category === cat), a, periodKeys));
    const fmt = (p) => (p === null ? '—' : `${Math.round(p)}%`);
    const totalAll = overall(), totalPri = overall('Priority'), totalNot = overall('Not Priority');
    const searchText = (r) => e([r.landOwnerNo, r.landOwnerName, r.parcelNumber, r.farmBlockName, r.farmName, r.category].join(' ').toLowerCase());

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text-main);">Cycle Monitoring</h2>
          <p style="font-size:13.5px;color:var(--text-muted);">
            Progress per land owner, farm &amp; block and activity. 100% = the whole block done once
            (Slashing by hectares, the others by palms).${auth.isAdmin() ? '' : ' Showing only your assigned Farm &amp; Blocks.'}
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="app.refreshReportsFromServer()">⬇️ Refresh Data</button>
          <button class="btn btn-primary" onclick="app.exportCycleMonitoringExcel()">📊 Export to Excel</button>
        </div>
      </div>

      <div class="filter-toolbar" style="flex-wrap:wrap;">
        <select class="form-control" style="max-width:130px;" title="Year" onchange="app.setCycleFilter('year', this.value)">
          ${data.years.map((y) => `<option value="${y}" ${y === st.year ? 'selected' : ''}>Year ${y}</option>`).join('')}
        </select>
        <select class="form-control" style="max-width:150px;" onchange="app.setCycleFilter('groupBy', this.value)">
          <option value="month" ${st.groupBy === 'month' ? 'selected' : ''}>By Month</option>
          <option value="cycle" ${st.groupBy === 'cycle' ? 'selected' : ''}>By Cycle</option>
        </select>
        <select class="form-control" style="max-width:180px;" onchange="app.setCycleFilter('period', this.value)">
          <option value="ALL" ${st.period === 'ALL' ? 'selected' : ''}>${st.groupBy === 'cycle' ? 'All cycles' : 'Whole year (Jan–Dec)'}</option>
          ${data.periods.map((p) => `<option value="${e(p.key)}" ${p.key === st.period ? 'selected' : ''}>${e(p.label)}</option>`).join('')}
        </select>
        <select class="form-control" style="max-width:160px;" onchange="app.setCycleFilter('category', this.value)">
          <option value="ALL" ${st.category === 'ALL' ? 'selected' : ''}>All categories</option>
          <option value="Priority" ${st.category === 'Priority' ? 'selected' : ''}>Priority</option>
          <option value="Not Priority" ${st.category === 'Not Priority' ? 'selected' : ''}>Not Priority</option>
        </select>
        <select class="form-control" style="max-width:200px;" onchange="app.setCycleFilter('landOwner', this.value)">
          <option value="ALL">All land owners</option>
          ${ownerOptions.map((o) => `<option value="${e(o.landOwnerId)}" ${o.landOwnerId === st.landOwner ? 'selected' : ''}>${e(o.landOwnerName)}${o.landOwnerNo ? ` – ${e(o.landOwnerNo)}` : ''}</option>`).join('')}
        </select>
        <input type="text" id="cycle-search" class="form-control" placeholder="🔍 Search land owner, farm, block..." value="${e(st.search)}" oninput="app.filterCycleTables(this.value)" />
      </div>

      <div class="stats-grid">
        ${CYCLE_ACTIVITIES.map((a, i) => `
          <div class="stat-card">
            <div class="stat-icon ${totalAll[i] !== null && totalAll[i] >= 100 ? 'green' : 'amber'}">${['🌿', '⭕', '🧺', '💧', '✂️'][i] || '📊'}</div>
            <div class="stat-info">
              <div class="stat-label">${e(a.label)}</div>
              <div class="stat-value">${fmt(totalAll[i])}</div>
              <div class="stat-sub">Priority ${fmt(totalPri[i])} &bull; Not Priority ${fmt(totalNot[i])}</div>
            </div>
          </div>`).join('')}
      </div>
      <div class="form-helper" style="margin:-6px 0 14px;">Period: <strong>${e(periodLabel)}</strong>${missingSize ? ` &bull; <span style="color:#92400e;">${missingSize} Farm &amp; Block(s) have no Area / Palm Count yet — shown as quantity with *${auth.isAdmin() ? ' (set it in Land Owner Enrollment ✏️)' : ''}</span>` : ''}</div>

      ${rows.length === 0 ? `<div class="card" style="text-align:center;color:var(--text-muted);padding:30px;">No Farm &amp; Blocks to show. ${auth.isAdmin() ? 'Enroll land owners first.' : 'Ask your administrator to assign Farm &amp; Blocks to you.'}</div>` : `

      <!-- 1) Cycle grid (like the spreadsheet): January to December + year total -->
      <style>
        /* let the wide year table scroll inside its box instead of stretching the page */
        #main-content, #view-content-root { min-width: 0; }
        #view-content-root { width: 100%; }
        .cycle-table th.grp { text-align:center; border-left:2px solid var(--border); }
        .cycle-table th.grp-total, .cycle-table td.col-total { background-color:#ecfdf5; }
        .cycle-table th.grp-total { color:var(--palm-primary, #14532d); }
        @media (min-width: 1200px) {
          /* keep the land owner columns visible while scrolling through the months */
          .cycle-table .sc { position:sticky; z-index:2; background:var(--bg-surface, #fff); white-space:normal; padding-left:10px; padding-right:10px; }
          .cycle-table thead .sc { background:#f8fafc; z-index:3; }
          .cycle-table tbody tr:hover .sc { background:var(--bg-hover, #f1f5f9); }
          .cycle-table .sc1 { left:0; min-width:96px; max-width:96px; }
          .cycle-table .sc2 { left:96px; min-width:140px; max-width:140px; }
          .cycle-table .sc3 { left:236px; min-width:72px; max-width:72px; }
          .cycle-table .sc4 { left:308px; min-width:140px; max-width:140px; }
          .cycle-table .sc5 { left:448px; min-width:112px; max-width:112px; box-shadow:2px 0 0 var(--border); }
        }
      </style>
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px;">
        <div class="card-header" style="padding:14px 18px;">
          <div>
            <div class="card-title">📅 Cycle Monitoring per Land Owner &amp; Farm &amp; Block — ${e(st.year)}</div>
            <div class="card-subtitle">${st.period === 'ALL' ? 'January to December. Scroll sideways to see all months and the year total.' : e(periodLabel)}</div>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table cycle-table" style="font-size:12.5px;">
            <thead>
              <tr>
                <th rowspan="2" class="sc sc1">CLAIF No.</th>
                <th rowspan="2" class="sc sc2">Land Owner Name</th>
                <th rowspan="2" class="sc sc3">Parcel</th>
                <th rowspan="2" class="sc sc4">Farm &amp; Block</th>
                <th rowspan="2" class="sc sc5">Category</th>
                ${gridCols.map((c) => `<th colspan="${CYCLE_ACTIVITIES.length}" class="grp ${c.total ? 'grp-total' : ''}">${e(c.label)}</th>`).join('')}
              </tr>
              <tr>
                ${gridCols.map((c) => CYCLE_ACTIVITIES.map((a, i) => `<th class="${c.total ? 'grp-total' : ''}" style="text-align:center;white-space:normal;min-width:84px;${i === 0 ? 'border-left:2px solid var(--border);' : ''}">${e(a.label)}</th>`).join('')).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr class="cycle-row" data-search="${searchText(r)}">
                  <td class="sc sc1">${e(r.landOwnerNo || '—')}</td>
                  <td class="sc sc2"><strong>${e(r.landOwnerName)}</strong></td>
                  <td class="sc sc3">${e(r.parcelNumber)}</td>
                  <td class="sc sc4">${e(r.farmBlockName)}</td>
                  <td class="sc sc5">${this.categoryBadge(r.category)}</td>
                  ${gridCols.map((c) => CYCLE_ACTIVITIES.map((a, i) => {
                    const qty = this.cycleQty(r, a, c.keys);
                    const base = this.cycleBase(r, a);
                    let td = this.cycleCellHtml(base > 0 ? (qty / base) * 100 : null, qty, a.unit);
                    if (i === 0) td = td.replace('<td style="', '<td style="border-left:2px solid var(--border);');
                    if (c.total) td = td.replace('<td ', '<td class="col-total" ');
                    return td;
                  }).join('')).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 2) Summary per Farm -->
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px;">
        <div class="card-header" style="padding:14px 18px;">
          <div>
            <div class="card-title">🏡 Summary per Farm</div>
            <div class="card-subtitle">${e(periodLabel)} &bull; all blocks of the farm combined</div>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table" style="font-size:12.5px;">
            <thead>
              <tr>
                <th>CLAIF No.</th><th>Land Owner</th><th>Farm</th><th>Category</th><th>Blocks</th><th>Area (Ha)</th><th>Palms</th>
                ${CYCLE_ACTIVITIES.map((a) => `<th style="text-align:center;">${e(a.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${[...farms.values()].map((f) => `
                <tr class="cycle-row" data-search="${e([f.landOwnerNo, f.landOwnerName, f.farmName, f.category, f.rows.map((r) => r.farmBlockName).join(' ')].join(' ').toLowerCase())}">
                  <td>${e(f.landOwnerNo || '—')}</td>
                  <td><strong>${e(f.landOwnerName)}</strong></td>
                  <td>${e(f.farmName)}</td>
                  <td>${this.categoryBadge(f.category)}</td>
                  <td>${f.rows.length}</td>
                  <td>${Math.round(f.rows.reduce((s, r) => s + r.areaHa, 0) * 100) / 100}</td>
                  <td>${f.rows.reduce((s, r) => s + r.palmCount, 0)}</td>
                  ${CYCLE_ACTIVITIES.map((a) => this.cycleCellHtml(
                    this.cyclePercent(f.rows, a, periodKeys),
                    f.rows.reduce((s, r) => s + this.cycleQty(r, a, periodKeys), 0), a.unit)).join('')}
                </tr>`).join('')}
              <tr style="background:#f1f5f9;font-weight:800;">
                <td></td><td colspan="3">TOTAL</td>
                <td>${rows.length}</td>
                <td>${Math.round(rows.reduce((s, r) => s + r.areaHa, 0) * 100) / 100}</td>
                <td>${rows.reduce((s, r) => s + r.palmCount, 0)}</td>
                ${CYCLE_ACTIVITIES.map((a, i) => this.cycleCellHtml(totalAll[i], rows.reduce((s, r) => s + this.cycleQty(r, a, periodKeys), 0), a.unit)).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 3) Summary per Farm & Block -->
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="card-header" style="padding:14px 18px;">
          <div>
            <div class="card-title">🌴 Summary per Farm &amp; Block</div>
            <div class="card-subtitle">${e(periodLabel)} &bull; percent and quantity done</div>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table" style="font-size:12.5px;">
            <thead>
              <tr>
                <th>CLAIF No.</th><th>Land Owner</th><th>Parcel</th><th>Farm &amp; Block</th><th>Category</th><th>Area (Ha)</th><th>Palms</th>
                ${CYCLE_ACTIVITIES.map((a) => `<th style="text-align:center;">${e(a.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr class="cycle-row" data-search="${searchText(r)}">
                  <td>${e(r.landOwnerNo || '—')}</td>
                  <td><strong>${e(r.landOwnerName)}</strong></td>
                  <td>${e(r.parcelNumber)}</td>
                  <td>${e(r.farmBlockName)}</td>
                  <td>${this.categoryBadge(r.category)}</td>
                  <td>${r.areaHa || '<span style="color:#92400e;">not set</span>'}</td>
                  <td>${r.palmCount || '<span style="color:#92400e;">not set</span>'}</td>
                  ${CYCLE_ACTIVITIES.map((a) => {
                    const qty = this.cycleQty(r, a, periodKeys);
                    const base = this.cycleBase(r, a);
                    const pct = base > 0 ? (qty / base) * 100 : null;
                    const cell = this.cycleCellHtml(pct, qty, a.unit);
                    return pct === null ? cell : cell.replace(/%<\/td>$/, `%<div style="font-size:10.5px;font-weight:500;">${Math.round(qty * 100) / 100} / ${base} ${a.unit}</div></td>`);
                  }).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`}

      <div class="form-helper" style="margin-top:12px;">
        Colours: <span style="background:#dcfce7;color:#166534;padding:1px 6px;border-radius:4px;">100%+ done</span>
        <span style="background:#fef9c3;color:#854d0e;padding:1px 6px;border-radius:4px;">50–99%</span>
        <span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:4px;">1–49%</span>
        <span style="color:#94a3b8;">0% not started</span>. Data comes from Regular Activity reports.
      </div>
    `;

    if (st.search) this.filterCycleTables(st.search);
  },

  setCycleFilter(name, value) {
    const st = this.getCycleState();
    st[name] = value;
    if (name === 'groupBy') st.period = 'ALL';
    this.renderCycleMonitoringView(document.getElementById('view-content-root'));
  },

  filterCycleTables(text) {
    const q = String(text || '').trim().toLowerCase();
    this.getCycleState().search = text;
    document.querySelectorAll('.cycle-row').forEach((row) => {
      row.style.display = !q || row.dataset.search.includes(q) ? '' : 'none';
    });
  },

  /** Excel file with the same three tables (cycle grid, farm summary, block summary). */
  async exportCycleMonitoringExcel() {
    const st = this.getCycleState();
    const data = await this.buildCycleData(st.year, st.groupBy);
    const e = (v) => this.esc(v);
    const shown = st.period === 'ALL' ? data.periods : data.periods.filter((p) => p.key === st.period);
    const keys = shown.map((p) => p.key);
    const cols = shown.map((p) => ({ label: p.label, keys: [p.key] }));
    if (st.period === 'ALL') cols.push({ label: `Total ${st.year}`, keys });
    const rows = data.rows.filter((r) =>
      (st.category === 'ALL' || r.category === st.category) && (st.landOwner === 'ALL' || r.landOwnerId === st.landOwner));
    if (!rows.length) { this.showToast('Nothing to export.', 'warning'); return; }

    const pctText = (p) => (p === null ? '' : `${Math.round(p)}%`);
    const cell = (r, a, ks) => {
      const base = this.cycleBase(r, a);
      const qty = this.cycleQty(r, a, ks);
      return base > 0 ? pctText((qty / base) * 100) : (qty ? `${qty} ${a.unit}` : '');
    };
    const head = 'style="background:#14532d;color:#ffffff;font-weight:bold;text-align:center;"';

    const farms = new Map();
    rows.forEach((r) => {
      const k = `${r.landOwnerId}|${r.farmName}|${r.category}`;
      if (!farms.has(k)) farms.set(k, { r, rows: [] });
      farms.get(k).rows.push(r);
    });

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8"></head><body>
      <h3>Cycle Monitoring ${e(st.year)} (January to December)</h3>
      <table border="1">
        <tr>
          <th rowspan="2" ${head}>CLAIF No.</th><th rowspan="2" ${head}>Landowner Name</th><th rowspan="2" ${head}>Parcel</th>
          <th rowspan="2" ${head}>Farm &amp; Block</th><th rowspan="2" ${head}>Category</th>
          ${cols.map((c) => `<th colspan="${CYCLE_ACTIVITIES.length}" ${head}>${e(c.label)}</th>`).join('')}
        </tr>
        <tr>${cols.map(() => CYCLE_ACTIVITIES.map((a) => `<th ${head}>${e(a.label)}</th>`).join('')).join('')}</tr>
        ${rows.map((r) => `<tr>
          <td>${e(r.landOwnerNo || '')}</td><td>${e(r.landOwnerName)}</td><td>${e(r.parcelNumber)}</td><td>${e(r.farmBlockName)}</td><td>${e(r.category)}</td>
          ${cols.map((c) => CYCLE_ACTIVITIES.map((a) => `<td style="text-align:center;">${cell(r, a, c.keys)}</td>`).join('')).join('')}
        </tr>`).join('')}
      </table>
      <br/>
      <h3>Summary per Farm</h3>
      <table border="1">
        <tr><th ${head}>CLAIF No.</th><th ${head}>Land Owner</th><th ${head}>Farm</th><th ${head}>Category</th><th ${head}>Blocks</th><th ${head}>Area (Ha)</th><th ${head}>Palms</th>
          ${CYCLE_ACTIVITIES.map((a) => `<th ${head}>${e(a.label)}</th>`).join('')}</tr>
        ${[...farms.values()].map((f) => `<tr>
          <td>${e(f.r.landOwnerNo || '')}</td><td>${e(f.r.landOwnerName)}</td><td>${e(f.r.farmName)}</td><td>${e(f.r.category)}</td><td>${f.rows.length}</td>
          <td>${f.rows.reduce((s, r) => s + r.areaHa, 0)}</td><td>${f.rows.reduce((s, r) => s + r.palmCount, 0)}</td>
          ${CYCLE_ACTIVITIES.map((a) => `<td style="text-align:center;">${pctText(this.cyclePercent(f.rows, a, keys))}</td>`).join('')}
        </tr>`).join('')}
      </table>
      <br/>
      <h3>Summary per Farm &amp; Block</h3>
      <table border="1">
        <tr><th ${head}>CLAIF No.</th><th ${head}>Land Owner</th><th ${head}>Parcel</th><th ${head}>Farm &amp; Block</th><th ${head}>Category</th><th ${head}>Area (Ha)</th><th ${head}>Palms</th>
          ${CYCLE_ACTIVITIES.map((a) => `<th ${head}>${e(a.label)}</th>`).join('')}</tr>
        ${rows.map((r) => `<tr>
          <td>${e(r.landOwnerNo || '')}</td><td>${e(r.landOwnerName)}</td><td>${e(r.parcelNumber)}</td><td>${e(r.farmBlockName)}</td><td>${e(r.category)}</td>
          <td>${r.areaHa || ''}</td><td>${r.palmCount || ''}</td>
          ${CYCLE_ACTIVITIES.map((a) => `<td style="text-align:center;">${cell(r, a, keys)}</td>`).join('')}
        </tr>`).join('')}
      </table>
      </body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Cycle_Monitoring_${st.year}${st.period === 'ALL' ? '' : '_' + shown[0].label.replace(/\W+/g, '_')}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast('Cycle monitoring exported.', 'success');
  },

  /** Small card on the dashboard: this month's progress for the user's Farm & Blocks. */
  async renderCycleDashboardCard(container) {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const data = await this.buildCycleData(String(now.getFullYear()), 'month');
    if (!data.rows.length) return;
    const e = (v) => this.esc(v);

    const html = `
      <div class="card" style="margin-bottom:22px;cursor:pointer;" onclick="app.navigateTo('cycle-monitoring')">
        <div class="card-header">
          <div>
            <div class="card-title">📅 Cycle Progress — ${CYCLE_MONTHS[now.getMonth()]} ${now.getFullYear()}</div>
            <div class="card-subtitle">${data.rows.length} Farm &amp; Block(s)${auth.isAdmin() ? '' : ' assigned to you'} &bull; tap to open Cycle Monitoring</div>
          </div>
          <span style="font-size:20px;">&rarr;</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;">
          ${CYCLE_ACTIVITIES.map((a) => {
            const p = this.cyclePercent(data.rows, a, [month]);
            const w = p === null ? 0 : Math.min(100, Math.round(p));
            return `
              <div>
                <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;margin-bottom:4px;">
                  <span>${e(a.label)}</span><span>${p === null ? '—' : Math.round(p) + '%'}</span>
                </div>
                <div style="height:8px;background:#e2e8f0;border-radius:6px;overflow:hidden;">
                  <div style="height:100%;width:${w}%;background:${w >= 100 ? '#16a34a' : (w >= 50 ? '#eab308' : '#ef4444')};"></div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;

    const anchor = container.querySelector('.stats-grid');
    if (anchor) anchor.insertAdjacentHTML('afterend', html);
    else container.insertAdjacentHTML('beforeend', html);
  },

  /** Dashboard: Priority / Not Priority / total sequences per Farm & Block (only the user's Farm & Blocks). */
  async renderSequenceDashboardCard(container) {
    await auth.refreshScope();
    const all = (await db.getAll('farmsAndBlocks')).filter((b) => b.status !== 'Deactivated');
    const entries = auth.hasAllBlocks() ? all : auth.getAuthorizedBlocks();
    const html = this.sequenceSummaryHtml(entries, false);
    if (!html) return;
    const cycleCard = [...container.querySelectorAll('.card')].find((c) => c.textContent.includes('Cycle Progress'));
    const anchor = cycleCard || container.querySelector('.stats-grid');
    if (anchor) anchor.insertAdjacentHTML('afterend', html);
    else container.insertAdjacentHTML('beforeend', html);
  }
});
