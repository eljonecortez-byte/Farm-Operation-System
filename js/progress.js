/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Dashboard — Progress per Farm & Block (v4.3.0)
 *
 * % = valid accomplishment in the period ÷ registered target of the block
 *   Slashing → Area (Ha);  Round Weeding / Compost / Pruning / Foliar / Soil Drenching → Palm Count.
 * Each parcel/block row counts at most 100% of its own target (over-reports never inflate the block).
 * Only official reports count (not INVALID / FOR REVIEW / REJECTED).
 * Farm line shows the Farm Officer; each block shows its Supervisor.
 * Admin: all farms • Farm Officer: his farms • Supervisor / Field: his blocks.
 *
 * Load AFTER app.js in index.html:  <script src="js/progress.js"></script>
 */

const PG_ACTIVITIES = [
  { key: 'sl', label: 'Slashing', field: 'weedingSlashingHa', unit: 'Ha' },
  { key: 'rw', label: 'Round Weeding', field: 'roundWeedingPalms', unit: 'palms' },
  { key: 'co', label: 'Compost', field: 'compostPalms', unit: 'palms' },
  { key: 'pr', label: 'Pruning', field: 'pruningPalms', unit: 'palms' },
  { key: 'fo', label: 'Foliar', field: 'foliarPalms', unit: 'palms' },
  { key: 'sd', label: 'Soil Drench', field: 'soilDrenchingPalms', unit: 'palms' }
];
const PG_STATUS = {
  'Completed': 'background:#dcfce7;color:#166534;',
  'On Track': 'background:#dbeafe;color:#1e40af;',
  'Behind': 'background:#fee2e2;color:#b91c1c;',
  'Not Started': 'background:#f1f5f9;color:#475569;',
  'No Target': 'background:#fef3c7;color:#92400e;'
};

Object.assign(FarmOpsApp.prototype, {

  pgStyle() {
    if (document.getElementById('pg-style')) return;
    document.head.insertAdjacentHTML('beforeend', `<style id="pg-style">
      .pg-card { margin-bottom: 22px; padding: 0; overflow: hidden; }
      .pg-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; padding:18px 20px 10px; }
      .pg-ctrls { display:flex; gap:8px; flex-wrap:wrap; }
      .pg-ctrls .form-control { width:auto; min-width:150px; padding:8px 12px; font-size:13px; }
      .pg-card { max-width:100%; min-width:0; }
      .pg-tabs { display:flex; flex-wrap:wrap; gap:6px; padding:2px 20px 12px; }
      .pg-tab { border:1px solid var(--border); border-radius:999px; padding:6px 12px; font-size:12.5px; cursor:pointer; background:#fff; white-space:nowrap; }
      .pg-tab.on { background:var(--palm-dark, #14532d); color:#fff; border-color:var(--palm-dark, #14532d); }
      .pg-sum { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; padding:0 20px 14px; }
      .pg-mini { background:var(--palm-subtle, #f0fdf4); border:1px solid var(--palm-border, #bbf7d0); border-radius:12px; padding:10px 12px; }
      .pg-mini b { display:block; font-size:18px; } .pg-mini span { font-size:12px; color:var(--text-muted); }
      .pg-farm { border-top:1px solid var(--border); }
      .pg-fh { display:grid; grid-template-columns:22px minmax(170px,230px) 1fr 190px 105px 56px; gap:12px; align-items:center; padding:13px 20px; cursor:pointer; }
      .pg-fh:hover { background:var(--bg-hover, #f8fafc); }
      .pg-chev { color:var(--text-muted); transition:transform .15s; } .pg-farm.open .pg-chev { transform:rotate(90deg); }
      .pg-sub { font-size:12px; color:var(--text-muted); }
      .pg-bar { height:10px; background:#e5e7eb; border-radius:99px; overflow:hidden; } .pg-bar i { display:block; height:100%; border-radius:99px; }
      .pg-pct { font-weight:800; text-align:right; } .pg-qty { font-size:12.5px; text-align:right; color:var(--text-main); }
      .pg-chip { display:inline-block; font-size:11.5px; font-weight:700; border-radius:999px; padding:3px 9px; white-space:nowrap; }
      .pg-blocks { display:none; background:#fafafa; padding:4px 16px 14px 40px; } .pg-farm.open .pg-blocks { display:block; }
      .pg-acts { display:flex; gap:4px; } .pg-acts span { width:22px; height:8px; border-radius:3px; background:#e5e7eb; position:relative; overflow:hidden; }
      .pg-acts span i { position:absolute; left:0; top:0; bottom:0; }
      .pg-bcards { display:none; } .pg-mob-pct { display:none; }
      .pg-bc { background:#fff; border:1px solid var(--border); border-radius:12px; padding:10px; margin-top:8px; }
      .pg-bc .top { display:flex; justify-content:space-between; gap:8px; font-size:13px; margin-bottom:6px; }
      .pg-legend { font-size:11.5px; color:var(--text-muted); padding:10px 20px 14px; }
      .pg-foot { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; padding:12px 20px; border-top:1px solid var(--border); font-size:13px; color:var(--palm-dark, #166534); }
      @media (max-width: 760px) {
        .pg-head, .pg-tabs, .pg-sum, .pg-legend, .pg-foot { padding-left:14px; padding-right:14px; }
        .pg-ctrls .form-control { flex:1 1 140px; min-width:0; }
        .pg-sum { grid-template-columns:1fr 1fr; }
        .pg-fh { grid-template-columns:18px 1fr auto; padding:12px 14px; gap:8px; row-gap:6px; }
        .pg-fh .pg-bar { grid-column:2 / 4; grid-row:2; } .pg-fh .pg-qty { display:none; }
        .pg-fh .pg-st { grid-column:3; grid-row:1; justify-self:end; } .pg-fh .pg-pct { display:none; }
        .pg-blocks { padding:0 14px 12px; } .pg-btable { display:none; } .pg-bcards { display:block; } .pg-mob-pct { display:inline; }
      }
    </style>`);
  },

  /* ----- periods ----- */

  pgYmd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },

  async pgPeriods(reports) {
    const today = new Date();
    const year = today.getFullYear();
    const cycles = (await db.getAll('dropdownOptions'))
      .filter((d) => d.activityType === 'Regular Activity' && d.dropdownCategory === 'Cycle' && d.status === 'Active')
      .sort((a, b) => (parseFloat(a.sortOrder) || 0) - (parseFloat(b.sortOrder) || 0))
      .map((d) => String(d.optionValue));
    reports.forEach((r) => { const c = String(r.cycle || '').trim(); if (c && !cycles.some((x) => x.toLowerCase() === c.toLowerCase())) cycles.push(c); });
    const years = [...new Set([year].concat(reports.map((r) => parseInt(String(r.date || '').substring(0, 4), 10)).filter((y) => y > 2000)))].sort((a, b) => b - a);
    const list = [];
    years.forEach((y) => cycles.forEach((c) => list.push({ id: `C|${c}|${y}`, label: `${c} ${y}`, kind: 'Cycle', cycle: c, year: y })));
    for (let i = 0; i < 12; i++) {
      const d = new Date(year, today.getMonth() - i, 1);
      const ym = this.pgYmd(d).substring(0, 7);
      list.push({ id: `M|${ym}`, label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }), kind: 'Month', ym });
    }
    const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    list.push({ id: 'W|this', label: `This week (${this.pgYmd(mon).substring(5)} – ${this.pgYmd(sun).substring(5)})`, kind: 'Week', from: this.pgYmd(mon), to: this.pgYmd(sun) });
    return list;
  },

  /** Start / end dates of a period (a cycle uses its quarter when the name has Q1–Q4, else the whole year). */
  pgRange(p) {
    if (p.kind === 'Week') return [p.from, p.to];
    if (p.kind === 'Month') {
      const [y, m] = p.ym.split('-').map(Number);
      return [`${p.ym}-01`, this.pgYmd(new Date(y, m, 0))];
    }
    const q = String(p.cycle).match(/Q\s*([1-4])/i);
    if (!q) return [`${p.year}-01-01`, `${p.year}-12-31`];
    const qi = parseInt(q[1], 10);
    return [this.pgYmd(new Date(p.year, (qi - 1) * 3, 1)), this.pgYmd(new Date(p.year, qi * 3, 0))];
  },

  pgInPeriod(r, p) {
    const d = String(r.date || '');
    if (p.kind === 'Cycle') return d.substring(0, 4) === String(p.year) && String(r.cycle || '').trim().toLowerCase() === p.cycle.trim().toLowerCase();
    if (p.kind === 'Month') return d.substring(0, 7) === p.ym;
    return d >= p.from && d <= p.to;
  },

  /** Share of the period already passed (0..1), used to judge On Track / Behind. */
  pgElapsed(p) {
    const [a, b] = this.pgRange(p);
    const t = this.pgYmd(new Date());
    if (t < a) return 0;
    if (t >= b) return 1;
    const day = (s) => new Date(s + 'T00:00:00').getTime();
    return (day(t) - day(a) + 86400000) / (day(b) - day(a) + 86400000);
  },

  pgStatus(pct, expected) {
    if (pct === null) return 'No Target';
    if (pct >= 1) return 'Completed';
    if (pct <= 0) return 'Not Started';
    if (expected <= 0) return 'On Track';
    return pct >= expected * 0.9 ? 'On Track' : 'Behind';
  },

  pgColor(pct) {
    if (pct === null) return '#e5e7eb';
    return pct >= 1 ? '#16a34a' : pct >= 0.55 ? '#22c55e' : pct > 0 ? '#f59e0b' : '#cbd5e1';
  },

  /* ----- data ----- */

  async pgCompute() {
    await auth.refreshScope();
    const f = this._pg;
    const rows = auth.getAuthorizedBlocks().filter((b) => (b.status || 'Active') !== 'Deactivated');
    const reports = auth.filterAuthorizedRecords(await db.getAll('reports')).filter((r) =>
      r.activityType === 'Regular Activity' && r.syncStatus !== 'REJECTED' &&
      !['INVALID', 'FOR REVIEW', 'REJECTED'].includes(String(r.validationStatus || '').toUpperCase()));
    const periods = await this.pgPeriods(reports);
    if (!f.chosen || !periods.some((p) => p.id === f.period)) {
      // default: the cycle of the latest report, else the current month
      const latest = reports.filter((r) => r.cycle).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      const pick = latest && periods.find((p) => p.kind === 'Cycle' && p.year === parseInt(String(latest.date).substring(0, 4), 10) && p.cycle.toLowerCase() === String(latest.cycle).trim().toLowerCase());
      f.period = (pick || periods.find((p) => p.kind === 'Month')).id;
    }
    const period = periods.find((p) => p.id === f.period);
    const expected = this.pgElapsed(period);
    const responsible = (await db.getSetting('responsible')) || {};
    const fo = responsible.farmOfficers || {};
    const sv = responsible.blockSupervisors || {};

    const key = (lo, pa, bl) => AuthService.key(lo, pa, bl);
    const byRec = new Map(), byKey = new Map();
    const rowState = rows.map((b) => {
      const info = { ...this.farmBlockInfo(b) };
      info.farm = info.farm.replace(/^Farm 0+(\d)/, 'Farm $1');
      info.full = info.blockNo ? `${info.farm} ${info.block}` : info.full;
      const st = { b, info, done: {}, last: '' };
      PG_ACTIVITIES.forEach((a) => { st.done[a.key] = 0; });
      if (b.recordId) byRec.set(String(b.recordId), st);
      byKey.set(key(b.landOwnerName, b.parcelNumber, b.farmBlockName), st);
      return st;
    });
    reports.forEach((r) => {
      if (!this.pgInPeriod(r, period)) return;
      const st = (r.recordId && byRec.get(String(r.recordId))) || byKey.get(key(r.landOwnersName, r.parcelNumber, r.farmBlock));
      if (!st) return;
      PG_ACTIVITIES.forEach((a) => { const v = parseFloat(r[a.field]); if (v > 0) st.done[a.key] += v; });
      if (String(r.date) > st.last) st.last = String(r.date);
    });

    const target = (b, a) => (a.unit === 'Ha' ? (parseFloat(b.areaHa) || 0) : (parseInt(b.palmCount, 10) || 0));
    const blocks = new Map();
    rowState.forEach((st) => {
      if (f.cat !== 'ALL' && this.entryCategory(st.b) !== f.cat) return;
      const c = st.info.code;
      if (!blocks.has(c)) {
        blocks.set(c, { code: c, info: st.info, rows: 0, area: 0, palms: 0, cats: new Set(), noTarget: 0, last: '', done: {}, tgt: {} });
        PG_ACTIVITIES.forEach((a) => { blocks.get(c).done[a.key] = 0; blocks.get(c).tgt[a.key] = 0; });
      }
      const B = blocks.get(c);
      B.rows++; B.area += parseFloat(st.b.areaHa) || 0; B.palms += parseInt(st.b.palmCount, 10) || 0;
      B.cats.add(this.entryCategory(st.b));
      if (!(parseFloat(st.b.areaHa) > 0) && !(parseInt(st.b.palmCount, 10) > 0)) B.noTarget++;
      if (st.last > B.last) B.last = st.last;
      PG_ACTIVITIES.forEach((a) => {
        const t = target(st.b, a);
        if (t > 0) { B.tgt[a.key] += t; B.done[a.key] += Math.min(st.done[a.key], t); }
      });
    });
    const pctOf = (done, tgt, act) => {
      if (act !== 'ALL') { const a = PG_ACTIVITIES.find((x) => x.key === act); return tgt[a.key] > 0 ? done[a.key] / tgt[a.key] : null; }
      const ps = PG_ACTIVITIES.filter((a) => tgt[a.key] > 0).map((a) => done[a.key] / tgt[a.key]);
      return ps.length ? ps.reduce((s, x) => s + x, 0) / ps.length : null;
    };
    const farms = new Map();
    [...blocks.values()].forEach((B) => {
      B.pct = pctOf(B.done, B.tgt, f.act);
      B.status = this.pgStatus(B.pct, expected);
      B.sup = (sv[B.code] || []).join(', ');
      const fk = B.info.farmCode;
      if (!farms.has(fk)) {
        farms.set(fk, { key: fk, farm: B.info.farm, blocks: [], done: {}, tgt: {}, last: '' });
        PG_ACTIVITIES.forEach((a) => { farms.get(fk).done[a.key] = 0; farms.get(fk).tgt[a.key] = 0; });
      }
      const F = farms.get(fk);
      F.blocks.push(B);
      PG_ACTIVITIES.forEach((a) => { F.done[a.key] += B.done[a.key]; F.tgt[a.key] += B.tgt[a.key]; });
      if (B.last > F.last) F.last = B.last;
    });
    const list = [...farms.values()].filter((F) => f.farm === 'ALL' || F.key === f.farm)
      .sort((a, b) => a.farm.localeCompare(b.farm, undefined, { numeric: true }));
    list.forEach((F) => {
      F.blocks.sort((a, b) => (a.info.blockNo - b.info.blockNo) || a.info.block.localeCompare(b.info.block, undefined, { numeric: true }));
      F.pct = pctOf(F.done, F.tgt, f.act);
      F.status = this.pgStatus(F.pct, expected);
      F.officer = (fo['FARM:' + F.key] || []).join(', ');
    });
    const tot = { done: {}, tgt: {} };
    PG_ACTIVITIES.forEach((a) => { tot.done[a.key] = list.reduce((s, F) => s + F.done[a.key], 0); tot.tgt[a.key] = list.reduce((s, F) => s + F.tgt[a.key], 0); });
    const allBlocks = list.flatMap((F) => F.blocks);
    const lastAll = allBlocks.reduce((m, B) => (B.last > m ? B.last : m), '');
    return { periods, period, expected, farms: list, allFarms: [...farms.values()], overall: pctOf(tot.done, tot.tgt, f.act), blocks: allBlocks, last: lastAll };
  },

  /* ----- view ----- */

  async renderProgressDashboardCard(container) {
    if (!this._pg) this._pg = { period: '', act: 'ALL', farm: 'ALL', cat: 'ALL', open: new Set() };
    this.pgStyle();
    let box = container.querySelector('#pg-card');
    if (!box) {
      const anchor = container.querySelector('.stats-grid');
      const html = '<div class="card pg-card" id="pg-card"></div>';
      if (anchor) anchor.insertAdjacentHTML('afterend', html); else container.insertAdjacentHTML('beforeend', html);
      box = container.querySelector('#pg-card');
    }
    await this.pgRender();
  },

  async pgRender() {
    const box = document.getElementById('pg-card');
    if (!box) return;
    const f = this._pg;
    const d = await this.pgCompute();
    const e = (v) => this.esc(v);
    const act = f.act === 'ALL' ? null : PG_ACTIVITIES.find((a) => a.key === f.act);
    const pctTxt = (p) => (p === null ? '—' : Math.round(p * 100) + '%');
    const num = (v, unit) => (unit === 'Ha' ? (Math.round(v * 1000) / 1000).toFixed(2) + ' Ha' : Math.round(v).toLocaleString() + ' palms');
    const doneTxt = (X) => (act ? (X.tgt[act.key] > 0 ? `${num(X.done[act.key], act.unit)} / ${num(X.tgt[act.key], act.unit)}` : 'no target') : 'avg of 6 activities');
    const chip = (s) => `<span class="pg-chip" style="${PG_STATUS[s]}">${e(s)}</span>`;
    const bar = (p) => `<div class="pg-bar"><i style="width:${p === null ? 0 : Math.min(100, p * 100)}%;background:${this.pgColor(p)}"></i></div>`;
    const mini = (B) => `<div class="pg-acts">${PG_ACTIVITIES.map((a) => {
      const p = B.tgt[a.key] > 0 ? B.done[a.key] / B.tgt[a.key] : null;
      return `<span title="${e(a.label)} ${pctTxt(p)}"><i style="width:${p === null ? 0 : Math.min(100, p * 100)}%;background:${this.pgColor(p)}"></i></span>`;
    }).join('')}</div>`;
    const count = (s) => d.blocks.filter((B) => B.status === s).length;
    const opt = (v, l, cur) => `<option value="${e(v)}" ${v === cur ? 'selected' : ''}>${e(l)}</option>`;
    const short = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');

    box.innerHTML = `
      <div class="pg-head">
        <div>
          <div class="card-title">🌴 Progress per Farm &amp; Block</div>
          <div class="card-subtitle">Accomplished vs registered target (Area Ha / Palm Count) &bull; only valid reports count</div>
        </div>
        <div class="pg-ctrls">
          <select class="form-control" onchange="app._pg.period=this.value; app._pg.chosen=true; app.pgRender()">
            ${['Cycle', 'Month', 'Week'].map((k) => `<optgroup label="${k}">${d.periods.filter((p) => p.kind === k).map((p) => opt(p.id, p.label, f.period)).join('')}</optgroup>`).join('')}
          </select>
          <select class="form-control" onchange="app._pg.farm=this.value; app.pgRender()">
            ${opt('ALL', 'All Farms', f.farm)}${d.allFarms.slice().sort((a, b) => a.farm.localeCompare(b.farm, undefined, { numeric: true })).map((F) => opt(F.key, F.farm, f.farm)).join('')}
          </select>
          <select class="form-control" onchange="app._pg.cat=this.value; app.pgRender()">
            ${opt('ALL', 'All categories', f.cat)}${opt('Priority', 'Priority', f.cat)}${opt('Not Priority', 'Not Priority', f.cat)}
          </select>
        </div>
      </div>
      <div class="pg-tabs">${[['ALL', 'All activities']].concat(PG_ACTIVITIES.map((a) => [a.key, a.label])).map(([k, l]) =>
        `<span class="pg-tab ${f.act === k ? 'on' : ''}" onclick="app._pg.act='${k}'; app.pgRender()">${e(l)}</span>`).join('')}</div>
      <div class="pg-sum">
        <div class="pg-mini"><b>${pctTxt(d.overall)}</b><span>Overall</span></div>
        <div class="pg-mini"><b>${count('Completed')}</b><span>Completed blocks</span></div>
        <div class="pg-mini"><b>${count('On Track')}</b><span>On Track</span></div>
        <div class="pg-mini"><b>${count('Behind')} / ${count('Not Started')}</b><span>Behind / Not Started</span></div>
      </div>
      ${d.farms.length ? d.farms.map((F) => `
        <div class="pg-farm ${f.open.has(F.key) ? 'open' : ''}" data-farm="${e(F.key)}">
          <div class="pg-fh" onclick="app.pgToggle(this.parentNode)">
            <span class="pg-chev">▶</span>
            <div><div style="font-weight:700;">${e(F.farm)}</div>
              <div class="pg-sub">${F.blocks.length} block(s) &bull; Farm Officer: ${F.officer ? `<strong>${e(F.officer)}</strong>` : '<em>not assigned</em>'}</div></div>
            ${bar(F.pct)}
            <div class="pg-qty">${doneTxt(F)}</div>
            <div class="pg-st">${chip(F.status)} <span class="pg-mob-pct" style="font-weight:800;margin-left:4px;">${pctTxt(F.pct)}</span></div>
            <div class="pg-pct">${pctTxt(F.pct)}</div>
          </div>
          <div class="pg-blocks">
            <div class="table-responsive pg-btable"><table class="table" style="font-size:12.5px;">
              <thead><tr><th>Farm &amp; Block</th><th>Supervisor</th><th>Category</th><th style="text-align:right;">Area / Palms</th>
                <th>${act ? 'Progress' : 'Activities'}</th><th style="text-align:right;">Done / Target</th><th style="text-align:right;">%</th><th>Status</th><th>Last report</th></tr></thead>
              <tbody>${F.blocks.map((B) => `<tr>
                <td><strong>${e(B.info.full)}</strong><div class="pg-sub">${e(String(B.code).replace(/^N:/, ''))} &bull; ${B.rows} parcel(s)</div></td>
                <td>${B.sup ? e(B.sup) : '<em class="pg-sub">none</em>'}</td>
                <td>${e([...B.cats].join(', '))}</td>
                <td style="text-align:right;white-space:nowrap;">${(Math.round(B.area * 100) / 100)} Ha &bull; ${B.palms.toLocaleString()}${B.noTarget ? `<div class="pg-sub" style="color:#92400e;">${B.noTarget} without size</div>` : ''}</td>
                <td style="min-width:160px;">${act ? bar(B.pct) : mini(B)}</td>
                <td style="text-align:right;white-space:nowrap;">${act ? doneTxt(B) : '—'}</td>
                <td style="text-align:right;"><strong>${pctTxt(B.pct)}</strong></td>
                <td>${chip(B.status)}</td>
                <td style="white-space:nowrap;">${short(B.last)}</td>
              </tr>`).join('')}</tbody>
            </table></div>
            <div class="pg-bcards">${F.blocks.map((B) => `
              <div class="pg-bc">
                <div class="top"><span><strong>${e(B.info.block)}</strong> <span class="pg-sub">&bull; Sup. ${B.sup ? e(B.sup) : 'none'}</span></span>
                  <span style="white-space:nowrap;">${chip(B.status)} <strong>${pctTxt(B.pct)}</strong></span></div>
                ${act ? bar(B.pct) : mini(B)}
                <div class="pg-sub" style="margin-top:6px;">${act ? doneTxt(B) : `${Math.round(B.area * 100) / 100} Ha &bull; ${B.palms.toLocaleString()} palms`} &bull; last ${short(B.last)}</div>
              </div>`).join('')}</div>
          </div>
        </div>`).join('') : `<div class="pg-legend" style="text-align:center;padding:24px;">No Farm &amp; Blocks to show. ${auth.isAdmin() ? 'Enroll land owners first.' : 'Ask your administrator to assign Farm &amp; Blocks to you.'}</div>`}
      <div class="pg-legend">Status compares progress with the time passed in the period (${Math.round(d.expected * 100)}% so far):
        ${chip('Completed')} ${chip('On Track')} ${chip('Behind')} ${chip('Not Started')} ${chip('No Target')}
        ${act ? '' : '&bull; small bars = Slashing · Round Weeding · Compost · Pruning · Foliar · Soil Drench'}</div>
      <div class="pg-foot"><span>${e(d.period.label)} &bull; ${d.blocks.length} Farm &amp; Block(s) &bull; last report ${short(d.last)}</span>
        <a href="#" style="color:inherit;" onclick="event.preventDefault(); app.navigateTo('cycle-monitoring')">Open Cycle Monitoring →</a></div>`;
  },

  pgToggle(el) {
    const k = el.dataset.farm;
    if (this._pg.open.has(k)) this._pg.open.delete(k); else this._pg.open.add(k);
    el.classList.toggle('open', this._pg.open.has(k));
  }
});
