/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Palm Category Summary (v4.7.0)
 *
 *  Land owner on the left • palm categories across the top • Overall Total on the right.
 *  - Source: Palm Category Activity reports (census) on this device (downloaded with Sync).
 *  - Latest census per parcel / Farm & Block (and per palm range, when the census covers part of a block),
 *    so a block counted twice is not doubled.
 *  - Problem Palms: own column, NOT added to the Overall Total.
 *  - Registered = Palm Count from Land Owner Enrollment (only parcels that have a census).
 *  - Admin: everything • Farm Officer / Supervisor / Field: own Farm & Blocks.
 *
 * Load AFTER app.js in index.html:  <script src="js/palmsum.js"></script>
 */

const PS_CATS = [
  { key: 'seedlingStage', label: 'Seedling', color: '#a3e635' },
  { key: 'juvenileStage', label: 'Juvenile', color: '#4ade80' },
  { key: 'preTrunkReproductiveStage', label: 'Semi Juvenile', color: '#22c55e' },
  { key: 'preTrunkFruitingStage', label: 'Semi Mature', color: '#16a34a' },
  { key: 'matureStage', label: 'Mature', color: '#15803d' },
  { key: 'fruitingStage', label: 'Fruiting', color: '#ca8a04' }
];

Object.assign(FarmOpsApp.prototype, {

  psStyle() {
    if (document.getElementById('ps-style')) return;
    document.head.insertAdjacentHTML('beforeend', `<style id="ps-style">
      .ps-tw { overflow:auto; max-height:70vh; padding:0; }
      .ps-table { border-collapse:separate; border-spacing:0; width:100%; font-size:13px; min-width:1060px; }
      .ps-table th, .ps-table td { padding:9px 8px; border-bottom:1px solid var(--border); text-align:right; white-space:nowrap; }
      .ps-table thead th { white-space:normal; line-height:1.25; }
      .ps-table th { background:var(--bg-hover); font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:var(--text-muted); position:sticky; top:0; z-index:2; vertical-align:bottom; }
      .ps-table .ps-name { text-align:left; position:sticky; left:0; background:var(--bg-surface); z-index:1; min-width:200px; border-right:1px solid var(--border); }
      .ps-table th.ps-name { background:var(--bg-hover); z-index:3; }
      .ps-table .ps-total { position:sticky; right:0; z-index:1; font-weight:800; color:var(--palm-primary); border-left:2px solid var(--palm-border);
        background:linear-gradient(var(--palm-subtle), var(--palm-subtle)), var(--bg-surface); }
      .ps-table th.ps-total { z-index:3; }
      .ps-table .ps-prob { color:#b91c1c; font-weight:700; }
      .ps-table .ps-reg { color:var(--text-muted); }
      .ps-table .ps-prod { color:#6b21a8; background:rgba(168, 85, 247, 0.06); }
      html[data-mode="dark"] .ps-table .ps-prod { color:#d8b4fe; background:rgba(168, 85, 247, 0.10); }
      .ps-dot { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:4px; vertical-align:-1px; }
      .ps-zero { color:var(--text-light, #cbd5e1); }
      .ps-sub { font-size:11.5px; color:var(--text-muted); font-weight:500; }
      .ps-lo { cursor:pointer; } .ps-lo:hover td { background-color:var(--bg-hover); }
      .ps-chev { display:inline-block; width:16px; color:var(--text-muted); transition:transform .15s; } .ps-lo.open .ps-chev { transform:rotate(90deg); }
      .ps-row td { font-size:12.5px; } .ps-row td.ps-name { padding-left:34px; }
      .ps-mix { display:flex; height:6px; border-radius:4px; overflow:hidden; margin-top:5px; width:150px; background:var(--bg-hover); }
      .ps-foot td { background:var(--brand-2, #14532d) !important; color:#fff !important; font-weight:800; border:0; }
      .ps-diff { font-size:11.5px; font-weight:700; } .ps-up { color:#b45309; } .ps-dn { color:#1d4ed8; } .ps-eq { color:#16a34a; }
      .ps-cards { display:none; }
      .ps-card { background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:10px 12px; margin-bottom:8px; }
      .ps-card-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:8px; font-size:11.5px; }
      .ps-card-grid div { background:var(--bg-hover); border-radius:8px; padding:5px 7px; } .ps-card-grid b { display:block; font-size:13px; }
      @media (max-width: 760px) { .ps-tw { display:none; } .ps-cards { display:block; } }
      html[data-mode="dark"] .ps-up { color:#fcd34d; } html[data-mode="dark"] .ps-dn { color:#93c5fd; } html[data-mode="dark"] .ps-table .ps-prob { color:#fca5a5; }
    </style>`);
  },

  /** Builds land owner → parcel rows from the census reports this user may see. */
  async psCompute() {
    await auth.refreshScope();
    const f = this._ps;
    const blocks = (await db.getAll('farmsAndBlocks')).filter((b) => (b.status || 'Active') !== 'Deactivated');
    const byRec = new Map(blocks.filter((b) => b.recordId).map((b) => [String(b.recordId), b]));
    const byKey = new Map(blocks.map((b) => [AuthService.key(b.landOwnerName, b.parcelNumber, b.farmBlockName), b]));
    const reports = auth.filterAuthorizedRecords(await db.getAll('reports'))
      .filter((r) => r.activityType === 'Palm Category Activity' && r.syncStatus !== 'REJECTED');
    const stamp = (r) => `${r.date || ''}|${r.timestamp || r.createdTimestamp || r.serverTimestamp || ''}`;
    const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const defHours = this.pdDefaultHours ? await this.pdDefaultHours() : 8;

    // latest census per row (+ palm range)
    const latest = new Map();
    reports.forEach((r) => {
      const blk = (r.recordId && byRec.get(String(r.recordId))) || byKey.get(AuthService.key(r.landOwnersName, r.parcelNumber, r.farmBlock)) || null;
      const rowKey = blk ? 'B:' + blk.blockId : 'R:' + AuthService.key(r.landOwnersName, r.parcelNumber, r.farmBlock);
      const k = f.mode === 'latest' ? rowKey + '|' + String(r.palmNumber || '').trim().toLowerCase() : r.reportId;
      const old = latest.get(k);
      if (!old || stamp(r) > stamp(old.r)) latest.set(k, { r, blk, rowKey });
    });

    // rows (parcel / Farm & Block)
    const rows = new Map();
    latest.forEach(({ r, blk, rowKey }) => {
      if (!rows.has(rowKey)) {
        const info = blk ? this.farmBlockInfo(blk) : this.farmBlockInfo({ farmBlockName: r.farmBlock });
        rows.set(rowKey, {
          blk, info, ownerKey: blk ? 'O:' + blk.landOwnerId : 'N:' + String(r.landOwnersName).toLowerCase() + '|' + (r.landOwnerNo || ''),
          ownerName: blk ? blk.landOwnerName : r.landOwnersName, claif: (blk && blk.landOwnerNo) || r.landOwnerNo || '',
          parcel: blk ? blk.parcelNumber : r.parcelNumber, farmBlock: blk ? blk.farmBlockName : r.farmBlock,
          category: blk ? this.entryCategory(blk) : '', registered: blk ? (parseInt(blk.palmCount, 10) || 0) : 0,
          v: Object.fromEntries(PS_CATS.map((c) => [c.key, 0])), problem: 0, last: '', censuses: 0, wh: 0
        });
      }
      const row = rows.get(rowKey);
      PS_CATS.forEach((c) => { row.v[c.key] += num(r[c.key]); });
      row.problem += num(r.problemPalms);
      row.wh += (num(r.manpowerCount) || num(r.manpower) || 1) * (num(r.hoursWorked) || defHours);   // worker-hours of this census
      row.censuses++;
      if (String(r.date || '') > row.last) row.last = String(r.date || '');
    });

    // filters
    const q = (f.q || '').trim().toLowerCase();
    const list = [...rows.values()].filter((row) =>
      (f.farm === 'ALL' || row.info.farmCode === f.farm) && (f.cat === 'ALL' || row.category === f.cat));

    // land owners
    const owners = new Map();
    list.forEach((row) => {
      if (!owners.has(row.ownerKey)) owners.set(row.ownerKey, { key: row.ownerKey, name: row.ownerName, claif: row.claif, rows: [], v: Object.fromEntries(PS_CATS.map((c) => [c.key, 0])), problem: 0, registered: 0, regRows: 0, diff: 0, last: '', wh: 0 });
      const o = owners.get(row.ownerKey);
      o.rows.push(row);
      PS_CATS.forEach((c) => { o.v[c.key] += row.v[c.key]; });
      o.problem += row.problem;
      o.wh += row.wh;
      row.total = PS_CATS.reduce((s, c) => s + row.v[c.key], 0);
      if (row.registered > 0) { o.registered += row.registered; o.regRows++; o.diff += row.total - row.registered; }
      if (row.last > o.last) o.last = row.last;
    });
    let ownerList = [...owners.values()].filter((o) => !q || `${o.name} ${o.claif}`.toLowerCase().includes(q));
    ownerList.forEach((o) => {
      o.total = PS_CATS.reduce((s, c) => s + o.v[c.key], 0);
      o.rows.sort((a, b) => String(a.parcel).localeCompare(String(b.parcel), undefined, { numeric: true }) || String(a.farmBlock).localeCompare(String(b.farmBlock), undefined, { numeric: true }));
    });
    ownerList.sort((a, b) => (f.sort === 'total' ? b.total - a.total : f.sort === 'problem' ? b.problem - a.problem : 0) ||
      String(a.name).localeCompare(String(b.name)) || String(a.claif).localeCompare(String(b.claif), undefined, { numeric: true }));

    const farms = [...new Map([...rows.values()].map((r) => [r.info.farmCode, r.info.farm])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
    const noPalmCount = ownerList.reduce((s, o) => s + o.rows.filter((r) => !(r.registered > 0)).length, 0);
    const inScope = auth.getAuthorizedBlocks().filter((b) => (b.status || 'Active') !== 'Deactivated');
    const censused = new Set([...rows.values()].filter((r) => r.blk).map((r) => r.blk.blockId));
    const noCensus = inScope.filter((b) => !censused.has(b.blockId)).length;
    return { owners: ownerList, farms, noPalmCount, noCensus, reportCount: reports.length };
  },

  async renderPalmSummaryView(container) {
    if (!this._ps) this._ps = { q: '', mode: 'latest', farm: 'ALL', cat: 'ALL', sort: 'name', showReg: true, open: new Set() };
    this.psStyle();
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text-main);">🌴 Palm Category Summary</h2>
          <p style="font-size:13px;color:var(--text-muted);">Palm census per land owner from Palm Category Activity reports &bull; ${auth.isAdmin() ? 'all Farm &amp; Blocks' : 'your Farm &amp; Blocks only'}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="app.psRefresh()">🔄 Refresh</button>
          <button class="btn btn-primary" onclick="app.psExport()">📊 Export to Excel</button>
        </div>
      </div>
      <div id="ps-stats"></div>
      <div class="filter-toolbar" style="flex-wrap:wrap;">
        <input type="text" class="form-control" placeholder="🔍 Search land owner or CLAIF..." value="${this.esc(this._ps.q)}" oninput="app._ps.q=this.value; app.psRender()" style="flex:1;min-width:200px;" />
        <select class="form-control" id="ps-mode" onchange="app._ps.mode=this.value; app.psRender()">
          <option value="latest">Latest census per parcel / block</option><option value="all">Sum of all census reports</option>
        </select>
        <select class="form-control" id="ps-farm" onchange="app._ps.farm=this.value; app.psRender()"></select>
        <select class="form-control" id="ps-cat" onchange="app._ps.cat=this.value; app.psRender()">
          <option value="ALL">All categories (Priority / Not)</option><option value="Priority">Priority</option><option value="Not Priority">Not Priority</option>
        </select>
        <select class="form-control" id="ps-sort" onchange="app._ps.sort=this.value; app.psRender()">
          <option value="name">Sort: Land owner A–Z</option><option value="total">Sort: Most palms</option><option value="problem">Sort: Most problem palms</option>
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap;"><input type="checkbox" id="ps-reg" onchange="app._ps.showReg=this.checked; app.psRender()" /> Compare with registered palms</label>
      </div>
      <div id="ps-body"></div>`;
    ['mode', 'cat', 'sort'].forEach((k) => { document.getElementById('ps-' + k).value = this._ps[k]; });
    document.getElementById('ps-reg').checked = this._ps.showReg;
    await this.psRender();
  },

  async psRender() {
    const body = document.getElementById('ps-body');
    if (!body) return;
    const f = this._ps;
    const d = await this.psCompute();
    this._psData = d;
    const e = (v) => this.esc(v);
    const n = (v) => (v ? Number(v).toLocaleString() : '<span class="ps-zero">0</span>');
    const farmSel = document.getElementById('ps-farm');
    farmSel.innerHTML = `<option value="ALL">All Farms</option>` + d.farms.map(([k, l]) => `<option value="${e(k)}" ${k === f.farm ? 'selected' : ''}>${e(l.replace(/^Farm 0+(\d)/, 'Farm $1'))}</option>`).join('');
    const G = Object.fromEntries(PS_CATS.map((c) => [c.key, d.owners.reduce((s, o) => s + o.v[c.key], 0)]));
    const gt = PS_CATS.reduce((s, c) => s + G[c.key], 0);
    const gp = d.owners.reduce((s, o) => s + o.problem, 0);
    const gr = d.owners.reduce((s, o) => s + o.registered, 0);
    const gd = d.owners.reduce((s, o) => s + o.diff, 0);
    const big = PS_CATS.slice().sort((a, b) => G[b.key] - G[a.key])[0];
    const diff = (row, reg, dv) => (!(reg > 0) ? '<span class="ps-zero">—</span>'
      : dv === 0 ? '<span class="ps-diff ps-eq">= same</span>' : `<span class="ps-diff ${dv > 0 ? 'ps-up' : 'ps-dn'}">${dv > 0 ? '+' : ''}${dv.toLocaleString()}</span>`);
    const mix = (o, w = '150px') => { const t = o.total || 1; return `<div class="ps-mix" style="width:${w}">${PS_CATS.map((c) => `<i style="width:${o.v[c.key] / t * 100}%;--c:${c.color};background:var(--c)"></i>`).join('')}</div>`; };

    document.getElementById('ps-stats').innerHTML = `<div class="stats-grid">
      <div class="stat-card"><div class="stat-icon green">👤</div><div class="stat-info"><div class="stat-label">Land Owners</div><div class="stat-value">${d.owners.length}</div><div class="stat-sub">with a palm census</div></div></div>
      <div class="stat-card"><div class="stat-icon emerald">🌴</div><div class="stat-info"><div class="stat-label">Total Palms Counted</div><div class="stat-value">${gt.toLocaleString()}</div><div class="stat-sub">all 6 categories</div></div></div>
      <div class="stat-card"><div class="stat-icon brown">⚠️</div><div class="stat-info"><div class="stat-label">Problem Palms</div><div class="stat-value">${gp.toLocaleString()}</div><div class="stat-sub">${gt ? (gp / gt * 100).toFixed(1) : 0}% of counted palms</div></div></div>
      <div class="stat-card"><div class="stat-icon amber">📊</div><div class="stat-info"><div class="stat-label">Biggest Category</div><div class="stat-value" style="font-size:18px;">${gt ? e(big.label) : '—'}</div><div class="stat-sub">${gt ? `${G[big.key].toLocaleString()} palms (${Math.round(G[big.key] / gt * 100)}%)` : 'no census yet'}</div></div></div>
    </div>`;

    if (!d.owners.length) {
      body.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:30px;">${d.reportCount ? 'No land owners match the filters.' : 'No Palm Category census yet. Reports from the Palm Category form appear here (press 🔄 Refresh to download the latest).'}</div>`;
      return;
    }
    const gw = d.owners.reduce((s, o) => s + o.wh, 0);
    const prodCols = (x) => { const rate = x.wh > 0 ? x.total / x.wh : 0;
      return `<td class="ps-prod">${x.wh ? Math.round(x.wh * 10) / 10 : '—'}</td><td class="ps-prod">${rate ? (rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)) : '—'}</td><td class="ps-prod"><strong>${rate ? (60 / rate < 1 ? Math.round(3600 / rate) + ' sec' : (60 / rate).toFixed(1) + ' min') : '—'}</strong></td>`; };
    const regCols = (reg, dv, star) => (f.showReg ? `<td class="ps-reg">${reg > 0 ? reg.toLocaleString() + (star ? '*' : '') : '<span class="ps-zero">—</span>'}</td><td>${diff(null, reg, dv)}</td>` : '');
    const short = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

    body.innerHTML = `
      <div class="card ps-tw"><table class="ps-table">
        <thead><tr><th class="ps-name">Land Owner</th>
          ${PS_CATS.map((c) => `<th><span class="ps-dot" style="--c:${c.color};background:var(--c)"></span>${e(c.label)}</th>`).join('')}
          <th class="ps-prob">⚠️ Problem</th>${f.showReg ? '<th class="ps-reg">Registered</th><th>Difference</th>' : ''}<th class="ps-prod">Worker-hours</th><th class="ps-prod">Palms / worker-hr</th><th class="ps-prod">⏱️ Time / palm</th><th class="ps-total">Overall Total</th></tr></thead>
        <tbody>${d.owners.map((o) => {
          const open = f.open.has(o.key);
          return `<tr class="ps-lo ${open ? 'open' : ''}" onclick="app.psToggle('${e(o.key)}')">
              <td class="ps-name"><span class="ps-chev">▶</span><strong>${e(o.name)}</strong> <span class="ps-sub">${e(o.claif)} &bull; ${o.rows.length} parcel(s)</span>${mix(o)}</td>
              ${PS_CATS.map((c) => `<td>${n(o.v[c.key])}</td>`).join('')}
              <td class="ps-prob">${n(o.problem)}</td>${regCols(o.registered, o.diff, o.regRows && o.regRows < o.rows.length)}${prodCols(o)}
              <td class="ps-total">${o.total.toLocaleString()}</td></tr>` +
            (open ? o.rows.map((r) => `<tr class="ps-row">
              <td class="ps-name">${e(r.parcel)} &bull; ${e(r.info.full.replace(/^Farm 0+(\d)/, 'Farm $1'))} <span class="ps-sub">census ${short(r.last)}${r.censuses > 1 ? ` &bull; ${r.censuses} ranges/reports` : ''}</span></td>
              ${PS_CATS.map((c) => `<td>${n(r.v[c.key])}</td>`).join('')}
              <td class="ps-prob">${n(r.problem)}</td>${regCols(r.registered, r.total - r.registered, false)}${prodCols(r)}
              <td class="ps-total">${r.total.toLocaleString()}</td></tr>`).join('') : '');
        }).join('')}</tbody>
        <tfoot><tr class="ps-foot"><td class="ps-name">TOTAL &bull; ${d.owners.length} land owner(s)</td>
          ${PS_CATS.map((c) => `<td>${G[c.key].toLocaleString()}</td>`).join('')}<td>${gp.toLocaleString()}</td>
          ${f.showReg ? `<td>${gr.toLocaleString()}</td><td>${(gd > 0 ? '+' : '') + gd.toLocaleString()}</td>` : ''}${prodCols({ total: gt, wh: gw }).replace(/ class="ps-prod"/g, '')}<td class="ps-total" style="background:var(--brand-1, #064e3b) !important;">${gt.toLocaleString()}</td></tr></tfoot>
      </table></div>
      <div class="ps-cards">${d.owners.map((o) => `
        <div class="ps-card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div><strong>${e(o.name)}</strong><div class="ps-sub">${e(o.claif)} &bull; ${o.rows.length} parcel(s)</div></div>
            <div style="text-align:right;"><div class="ps-sub">Total</div><strong style="font-size:18px;color:var(--palm-primary);">${o.total.toLocaleString()}</strong></div>
          </div>
          ${mix(o, '100%')}
          <div class="ps-card-grid">${PS_CATS.map((c) => `<div>${e(c.label)}<b>${o.v[c.key].toLocaleString()}</b></div>`).join('')}</div>
          <div class="ps-sub" style="margin-top:6px;">${o.wh ? `⏱️ <strong>${(60 / (o.total / o.wh)).toFixed(1)} min / palm</strong> &bull; ${Math.round(o.wh)} worker-hrs<br>` : ''}<span style="color:#b91c1c;">⚠️ Problem: ${o.problem.toLocaleString()}</span>${f.showReg && o.registered ? ` &bull; Registered ${o.registered.toLocaleString()} (${o.diff > 0 ? '+' : ''}${o.diff.toLocaleString()})` : ''}</div>
        </div>`).join('')}
        <div class="ps-card"><strong>TOTAL</strong> &bull; ${gt.toLocaleString()} palms &bull; <span style="color:#b91c1c;">⚠️ ${gp.toLocaleString()}</span></div>
      </div>
      <div class="form-helper" style="margin-top:8px;">
        ${f.mode === 'latest' ? 'Latest census of each parcel / Farm &amp; Block (and each palm range) — older counts of the same palms are not added again.' : 'Sum of every census report — a block counted twice is added twice.'}
        Problem Palms are not added to the Overall Total. Worker-hours = Manpower × Hours Worked of the census reports; Time / palm = minutes one worker spends per palm.
        ${f.showReg ? 'Registered = Palm Count in Land Owner Enrollment (parcels with a census).' : ''}
        ${f.showReg && d.noPalmCount ? `<br>⚠️ <strong>${d.noPalmCount}</strong> parcel(s) here have no registered Palm Count yet (shown as —${d.owners.some((o) => o.regRows && o.regRows < o.rows.length) ? '; * = only part of the land owner\'s parcels have one' : ''}). Add it in Land Owner Enrollment ✏️ or the Palm Count column of the FarmsAndBlocks sheet.` : ''}
        ${d.noCensus ? `<br>${d.noCensus} parcel / Farm &amp; Block row(s) you can see have no census yet.` : ''}
      </div>`;
  },

  psToggle(key) {
    if (this._ps.open.has(key)) this._ps.open.delete(key); else this._ps.open.add(key);
    this.psRender();
  },

  async psRefresh() {
    if (!navigator.onLine) { this.showToast('You are offline. Showing the census saved on this phone.', 'warning'); return; }
    try {
      await syncService.pullReports({ activityType: 'Palm Category Activity' });
      this.showToast('Palm census updated.', 'success');
    } catch (err) { this.showToast(err.message, 'error'); }
    await this.psRender();
  },

  psExport() {
    const d = this._psData;
    if (!d || !d.owners.length) { this.showToast('Nothing to export.', 'warning'); return; }
    const e = (v) => this.esc(v);
    const reg = this._ps.showReg;
    const head = `<tr style="background:#14532d;color:#ffffff;font-weight:bold;"><th>CLAIF Number</th><th>Land Owner</th><th>Parcel</th><th>Farm &amp; Block</th><th>Last Census</th>
      ${PS_CATS.map((c) => `<th>${e(c.label)}</th>`).join('')}<th>Problem Palms</th>${reg ? '<th>Registered</th><th>Difference</th>' : ''}<th>Worker-hours</th><th>Palms per worker-hour</th><th>Minutes per palm</th><th>Overall Total</th></tr>`;
    const line = (o, r) => `<tr${r ? '' : ' style="font-weight:bold;background:#f0fdf4;"'}><td>${e(o.claif)}</td><td>${e(o.name)}</td><td>${r ? e(r.parcel) : 'ALL'}</td><td>${r ? e(r.farmBlock) : ''}</td><td>${r ? e(r.last) : e(o.last)}</td>
      ${PS_CATS.map((c) => `<td>${(r || o).v[c.key]}</td>`).join('')}<td>${(r || o).problem}</td>
      ${reg ? `<td>${(r ? r.registered : o.registered) || ''}</td><td>${r ? (r.registered ? r.total - r.registered : '') : (o.registered ? o.diff : '')}</td>` : ''}${(() => { const x = r || o; const rate = x.wh > 0 ? x.total / x.wh : 0; return `<td>${Math.round(x.wh * 10) / 10}</td><td>${rate ? rate.toFixed(2) : ''}</td><td>${rate ? (60 / rate).toFixed(2) : ''}</td>`; })()}<td>${(r || o).total}</td></tr>`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>
      <table border="1">${head}${d.owners.map((o) => line(o, null) + o.rows.map((r) => line(o, r)).join('')).join('')}</table></body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Palm_Category_Summary_${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    this.showToast('Palm Category Summary exported.', 'success');
  },

  /** Button on the Palm Category form. */
  psAddFormButton() {
    const form = document.getElementById('form-palm-category');
    if (!form || document.getElementById('ps-form-btn')) return;
    const back = form.closest('.card') && form.closest('.card').querySelector('.card-header .btn');
    const html = `<button type="button" id="ps-form-btn" class="btn btn-outline" onclick="app.navigateTo('palm-summary')">🌴 Palm Category Summary</button>`;
    if (back) back.insertAdjacentHTML('beforebegin', html); else form.insertAdjacentHTML('afterbegin', `<div style="margin-bottom:12px;">${html}</div>`);
  }
});

(function () {
  const orig = FarmOpsApp.prototype.navigateTo;
  FarmOpsApp.prototype.navigateTo = async function (...args) {
    const res = await orig.apply(this, args);
    try { this.psAddFormButton(); } catch (err) { console.warn('[PalmSummary]', err); }
    return res;
  };
})();
