/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Hours Worked & Productivity (v4.8.0)
 *
 *  - Every activity form gets "⏱️ Hours Worked" (filled with the Settings working hours, default 8).
 *    Seednut Collection also gets Manpower.
 *  - Regular Activity: each job (Slashing, Round Weeding, Compost, Pruning, Foliar, Soil Drenching) has its own
 *    "Hours" box. One job → it gets all the hours; several jobs → the supervisor types how the day was split.
 *  - Productivity = accomplishment ÷ (Manpower × Hours)   e.g. 255 palms ÷ (4 × 8) = 8.0 palms per worker-hour = 7.5 min / palm
 *  - New ⏱️ Productivity page, and productivity columns in the Palm Category Summary.
 *
 * Load AFTER app.js, progress.js and palmsum.js:  <script src="js/productivity.js"></script>
 */

const PD_REG_JOBS = [
  { key: 'sl', label: 'Slashing', field: 'weedingSlashingHa', hours: 'slashingHours', input: 'reg-weeding-ha', unit: 'Ha' },
  { key: 'rw', label: 'Round Weeding', field: 'roundWeedingPalms', hours: 'roundWeedingHours', input: 'reg-round-weeding-palms', unit: 'palms' },
  { key: 'co', label: 'Compost', field: 'compostPalms', hours: 'compostHours', input: 'reg-compost-palms', unit: 'palms' },
  { key: 'pr', label: 'Pruning', field: 'pruningPalms', hours: 'pruningHours', input: 'reg-pruning-palms', unit: 'palms' },
  { key: 'fo', label: 'Foliar', field: 'foliarPalms', hours: 'foliarHours', input: 'reg-foliar-palms', unit: 'palms' },
  { key: 'sd', label: 'Soil Drench', field: 'soilDrenchingPalms', hours: 'soilDrenchingHours', input: 'reg-drench-palms', unit: 'palms' }
];
const PD_ACTS = PD_REG_JOBS.map((j) => ({ ...j, type: 'Regular Activity' })).concat([
  { key: 'pc', label: 'Palm Census', type: 'Palm Category Activity', unit: 'palms',
    qty: (r) => ['seedlingStage', 'juvenileStage', 'preTrunkReproductiveStage', 'preTrunkFruitingStage', 'matureStage', 'fruitingStage'].reduce((s, k) => s + (parseFloat(r[k]) || 0), 0) },
  { key: 'sn', label: 'Seednut', type: 'Seednut Collection', unit: 'nuts', field: 'nutCountCollected' },
  { key: 'pd', label: 'Pest & Disease', type: 'Pest and Disease Activity', unit: 'palms', field: 'totalPalmsAffected' }
]);
const PD_FORMS = ['form-regular-activity', 'form-irregular-activity', 'form-other-activity', 'form-palm-category', 'form-seednut', 'form-pest-disease', 'form-custom'];

Object.assign(FarmOpsApp.prototype, {

  async pdDefaultHours() {
    const h = parseFloat(await db.getSetting('dailyWorkingHours'));
    this._pdHours = h > 0 && h <= 24 ? h : 8;
    return this._pdHours;
  },

  pdNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; },

  /* ===== forms ===== */

  async pdAttach() {
    const root = document.getElementById('view-content-root');
    const form = root && [...root.querySelectorAll('form')].find((f) => PD_FORMS.includes(f.id));
    if (!form || form.querySelector('#pd-hours')) return;
    const def = await this.pdDefaultHours();
    const box = (extra = '') => `
      <div class="form-group" id="pd-hours-group">
        <label class="form-label required">⏱️ Hours Worked</label>
        <input type="number" id="pd-hours" class="form-control" min="0.5" max="24" step="0.5" value="${def}" required />
        <div class="form-helper" id="pd-hours-help">Filled with ${def} hours. Change it only on a short day.${extra}</div>
      </div>`;
    if (form.id === 'form-seednut') {
      const target = form.querySelector('#seed-nuts-collected');
      const grp = target && target.closest('.form-group');
      const html = `<div class="form-grid-2">
        <div class="form-group"><label class="form-label required">Manpower (Count)</label><input type="number" id="pd-manpower" class="form-control" min="1" value="2" required /></div>
        ${box()}</div>`;
      const row = grp && grp.parentElement && grp.parentElement.classList.contains('form-grid-3') ? grp.parentElement : grp;
      if (row) row.insertAdjacentHTML('beforebegin', html); else form.insertAdjacentHTML('afterbegin', html);
    } else {
      const mp = form.querySelector('[id$="-manpower"]:not([id$="-manpower-2"])');
      const grp = mp && mp.closest('.form-group');
      if (grp) grp.insertAdjacentHTML('afterend', box(form.id === 'form-regular-activity' ? ' For more than one job, type the hours of each job below.' : ''));
      else form.insertAdjacentHTML('afterbegin', box());
    }
    if (form.id === 'form-regular-activity') {
      PD_REG_JOBS.forEach((j) => {
        const inp = form.querySelector('#' + j.input);
        if (!inp) return;
        const g = inp.closest('.form-group');
        g.insertAdjacentHTML('beforeend', `<div class="pd-job-h" id="pd-jh-wrap-${j.key}" style="display:none;align-items:center;gap:6px;margin-top:6px;font-size:12.5px;">
          ⏱️ Hours <input type="number" id="pd-jh-${j.key}" class="form-control" min="0.5" max="24" step="0.5" style="width:90px;padding:6px 8px;" /></div>`);
        inp.addEventListener('input', () => this.pdRefreshJobs());
        form.querySelector('#pd-jh-' + j.key).addEventListener('input', () => this.pdRefreshJobs(true));
      });
      form.querySelector('#pd-hours').addEventListener('input', () => this.pdRefreshJobs());
      this.pdRefreshJobs();
    }
    // checks before the form's own submit handler runs
    form.parentNode.addEventListener('submit', (ev) => {
      if (ev.target !== form) return;
      const err = this.pdCheck(form);
      if (err) { ev.preventDefault(); ev.stopPropagation(); this.showToast(err, 'warning'); }
    }, true);
  },

  /** Regular Activity: show the Hours box of each job that has a quantity; one job gets all the hours. */
  pdRefreshJobs(typed = false) {
    const total = this.pdNum((document.getElementById('pd-hours') || {}).value);
    const active = PD_REG_JOBS.filter((j) => this.pdNum((document.getElementById(j.input) || {}).value) > 0);
    PD_REG_JOBS.forEach((j) => {
      const wrap = document.getElementById('pd-jh-wrap-' + j.key);
      if (!wrap) return;
      const on = active.includes(j);
      wrap.style.display = on && active.length > 1 ? 'flex' : 'none';
      const h = document.getElementById('pd-jh-' + j.key);
      if (!on) h.value = '';
    });
    const help = document.getElementById('pd-hours-help');
    if (!help) return;
    if (active.length > 1) {
      const used = active.reduce((s, j) => s + this.pdNum(document.getElementById('pd-jh-' + j.key).value), 0);
      const left = Math.round((total - used) * 100) / 100;
      help.innerHTML = `${active.length} jobs today — type the hours of each job. <strong style="color:${left < 0 ? '#b91c1c' : 'inherit'};">${used} of ${total} hours used${left > 0 ? `, ${left} left` : left < 0 ? ` (${-left} too many)` : ''}</strong>.`;
    } else {
      help.textContent = active.length === 1 ? `All ${total} hours count for ${active[0].label}.` : `Filled with ${this._pdHours || 8} hours. Change it only on a short day.`;
    }
  },

  pdCheck(form) {
    const total = this.pdNum((form.querySelector('#pd-hours') || {}).value);
    if (!(total > 0) || total > 24) return 'Hours Worked must be between 0.5 and 24.';
    if (form.id === 'form-seednut' && !(this.pdNum(form.querySelector('#pd-manpower').value) >= 1)) return 'Manpower must be at least 1.';
    if (form.id !== 'form-regular-activity') return '';
    const active = PD_REG_JOBS.filter((j) => this.pdNum(form.querySelector('#' + j.input).value) > 0);
    if (active.length < 2) return '';
    const missing = active.filter((j) => !(this.pdNum(form.querySelector('#pd-jh-' + j.key).value) > 0));
    if (missing.length) return `Type the hours for ${missing.map((j) => j.label).join(', ')} (how the ${total} hours were split).`;
    const used = active.reduce((s, j) => s + this.pdNum(form.querySelector('#pd-jh-' + j.key).value), 0);
    if (used > total + 0.01) return `The job hours (${used}) are more than the Hours Worked (${total}).`;
    return '';
  },

  /** Adds the hours to the report that the form is saving. */
  pdFill(data) {
    const form = document.getElementById('view-content-root') && [...document.querySelectorAll('#view-content-root form')].find((f) => PD_FORMS.includes(f.id));
    if (!form || !form.querySelector('#pd-hours')) return;
    data.hoursWorked = this.pdNum(form.querySelector('#pd-hours').value) || this._pdHours || 8;
    if (form.id === 'form-seednut') data.manpower = this.pdNum(form.querySelector('#pd-manpower').value) || 1;
    if (form.id === 'form-regular-activity') {
      const active = PD_REG_JOBS.filter((j) => this.pdNum(data[j.field]) > 0);
      active.forEach((j) => { data[j.hours] = active.length === 1 ? data.hoursWorked : this.pdNum(form.querySelector('#pd-jh-' + j.key).value); });
    }
  },

  /* ===== calculations ===== */

  pdValid(r) {
    return r.syncStatus !== 'REJECTED' && !['INVALID', 'FOR REVIEW', 'REJECTED'].includes(String(r.validationStatus || '').toUpperCase());
  },

  /** { qty, workerHours } of one report for one activity, or null when it does not count / cannot be split. */
  pdMeasure(r, act, defHours) {
    if (r.activityType !== act.type) return null;
    const qty = act.qty ? act.qty(r) : this.pdNum(r[act.field]);
    if (!(qty > 0)) return null;
    const manpower = this.pdNum(r.manpower) || this.pdNum(r.manpowerCount) || 1;
    let hours = 0;
    if (act.hours) {
      hours = this.pdNum(r[act.hours]);
      if (!(hours > 0)) {
        const jobs = PD_REG_JOBS.filter((j) => this.pdNum(r[j.field]) > 0).length;
        if (jobs > 1) return { qty, workerHours: 0, unsplit: true };
        hours = this.pdNum(r.hoursWorked) || defHours;
      }
    } else {
      hours = this.pdNum(r.hoursWorked) || defHours;
    }
    return { qty, workerHours: manpower * hours, defaulted: !(this.pdNum(r.hoursWorked) > 0) };
  },

  pdRateText(rate, unit) {
    if (!(rate > 0)) return '—';
    if (unit === 'Ha') return `${Math.round(rate * 10000).toLocaleString()} m²`;
    return `${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)} ${unit}`;
  },

  pdTimeText(rate, unit) {
    if (!(rate > 0)) return '—';
    if (unit === 'Ha') return `${(1 / rate).toFixed(1)} worker-hrs / Ha`;
    if (unit === 'nuts') return `${(6000 / rate).toFixed(0)} min / 100 nuts`;
    const min = 60 / rate;
    return min < 1 ? `${Math.round(min * 60)} sec / palm` : `${min.toFixed(1)} min / palm`;
  },

  /* ===== Productivity page ===== */

  async renderProductivityView(container) {
    if (!this._pd) this._pd = { act: 'co', by: 'owner', period: '', chosen: false };
    await auth.refreshScope();
    const def = await this.pdDefaultHours();
    const reports = auth.filterAuthorizedRecords(await db.getAll('reports')).filter((r) => this.pdValid(r));
    const periods = this.pgPeriods ? await this.pgPeriods(reports) : [];
    const f = this._pd;
    if (!f.chosen || !periods.some((p) => p.id === f.period)) {
      const m = periods.find((p) => p.kind === 'Month');
      f.period = m ? m.id : '';
    }
    const e = (v) => this.esc(v);
    const opt = (v, l, cur) => `<option value="${e(v)}" ${v === cur ? 'selected' : ''}>${e(l)}</option>`;
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text-main);">⏱️ Productivity</h2>
          <p style="font-size:13px;color:var(--text-muted);">Accomplishment ÷ (Manpower × Hours Worked) &bull; only valid reports &bull; ${auth.isAdmin() ? 'all Farm &amp; Blocks' : 'your Farm &amp; Blocks'}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <select class="form-control" style="width:auto;" onchange="app._pd.period=this.value; app._pd.chosen=true; app.navigateTo('productivity')">
            <option value="ALL" ${f.period === 'ALL' ? 'selected' : ''}>All time</option>
            ${['Month', 'Cycle', 'Week'].map((k) => `<optgroup label="${k}">${periods.filter((p) => p.kind === k).map((p) => opt(p.id, p.label, f.period)).join('')}</optgroup>`).join('')}
          </select>
          <select class="form-control" style="width:auto;" onchange="app._pd.by=this.value; app.pdRender()">
            ${opt('owner', 'By Land Owner', f.by)}${opt('block', 'By Farm & Block', f.by)}${opt('sup', 'By Supervisor', f.by)}
          </select>
        </div>
      </div>
      <div class="pg-tabs" style="padding:0 0 12px;display:flex;gap:6px;flex-wrap:wrap;">${PD_ACTS.map((a) => `<span class="pg-tab ${a.key === f.act ? 'on' : ''}" style="border:1px solid var(--border);border-radius:999px;padding:6px 12px;font-size:12.5px;cursor:pointer;" onclick="app._pd.act='${a.key}'; app.navigateTo('productivity')">${e(a.label)}</span>`).join('')}</div>
      <div id="pd-body"></div>`;
    this._pdData = { reports, periods, def };
    this.pdRender();
  },

  pdRender() {
    const body = document.getElementById('pd-body');
    if (!body || !this._pdData) return;
    const f = this._pd;
    const { reports, periods, def } = this._pdData;
    const act = PD_ACTS.find((a) => a.key === f.act);
    const period = periods.find((p) => p.id === f.period);
    const e = (v) => this.esc(v);
    const groups = new Map();
    let unsplit = 0, defaulted = 0;
    reports.forEach((r) => {
      if (period && f.period !== 'ALL' && !this.pgInPeriod(r, period)) return;
      const m = this.pdMeasure(r, act, def);
      if (!m) return;
      if (m.unsplit) { unsplit++; return; }
      if (m.defaulted) defaulted++;
      let key, name, sub;
      if (f.by === 'owner') { key = (r.landOwnerNo || '') + '|' + r.landOwnersName; name = r.landOwnersName || '—'; sub = r.landOwnerNo || ''; }
      else if (f.by === 'block') { const info = this.farmBlockInfo({ farmBlockName: r.farmBlock }); key = info.code; name = String(info.full).replace(/^Farm 0+(\d)/, 'Farm $1').replace(' – ', ' '); sub = info.code.replace(/^N:/, ''); }
      else { key = r.userId || r.employeeName; name = r.employeeName || '—'; sub = ''; }
      if (!groups.has(key)) groups.set(key, { name, sub, reports: 0, qty: 0, wh: 0 });
      const g = groups.get(key);
      g.reports++; g.qty += m.qty; g.wh += m.workerHours;
    });
    const list = [...groups.values()].map((g) => ({ ...g, rate: g.wh > 0 ? g.qty / g.wh : 0 })).sort((a, b) => b.rate - a.rate);
    const tq = list.reduce((s, g) => s + g.qty, 0), tw = list.reduce((s, g) => s + g.wh, 0), avg = tw > 0 ? tq / tw : 0;
    const qtyText = (q) => (act.unit === 'Ha' ? `${(Math.round(q * 1000) / 1000).toFixed(2)} Ha` : `${Math.round(q).toLocaleString()} ${act.unit}`);
    const mx = Math.max(0, ...list.map((g) => g.rate));
    const label = { owner: 'Land Owner', block: 'Farm & Block', sup: 'Supervisor' }[f.by];
    body.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon green">✅</div><div class="stat-info"><div class="stat-label">${e(act.label)} done</div><div class="stat-value">${qtyText(tq)}</div><div class="stat-sub">${list.reduce((s, g) => s + g.reports, 0)} report(s)</div></div></div>
        <div class="stat-card"><div class="stat-icon amber">👥</div><div class="stat-info"><div class="stat-label">Worker-hours</div><div class="stat-value">${Math.round(tw).toLocaleString()}</div><div class="stat-sub">manpower × hours</div></div></div>
        <div class="stat-card"><div class="stat-icon blue">⚡</div><div class="stat-info"><div class="stat-label">Per worker-hour</div><div class="stat-value" style="font-size:20px;">${this.pdRateText(avg, act.unit)}</div><div class="stat-sub">average</div></div></div>
        <div class="stat-card"><div class="stat-icon emerald">⏱️</div><div class="stat-info"><div class="stat-label">Average time</div><div class="stat-value" style="font-size:20px;">${this.pdTimeText(avg, act.unit)}</div><div class="stat-sub">one worker</div></div></div>
      </div>
      ${list.length ? `<div class="card" style="padding:0;overflow:auto;"><table class="table" style="font-size:13px;">
        <thead><tr><th>${e(label)}</th><th style="text-align:right;">Reports</th><th style="text-align:right;">${e(act.label)} done</th><th style="text-align:right;">Worker-hours</th><th>Per worker-hour</th><th style="text-align:right;">⏱️ Time</th><th>Speed</th></tr></thead>
        <tbody>${list.map((g) => {
          const d = avg > 0 ? g.rate / avg : 1;
          const chip = d >= 1.1 ? ['#dcfce7', '#166534', 'Faster'] : d <= 0.9 ? ['#fee2e2', '#b91c1c', 'Slower'] : ['#f1f5f9', '#475569', 'Average'];
          return `<tr><td><strong>${e(g.name)}</strong> <span style="font-size:11.5px;color:var(--text-muted);">${e(g.sub)}</span></td>
            <td style="text-align:right;">${g.reports}</td><td style="text-align:right;">${qtyText(g.qty)}</td><td style="text-align:right;">${Math.round(g.wh * 10) / 10}</td>
            <td style="white-space:nowrap;"><span style="display:inline-block;width:110px;height:8px;background:#e5e7eb;border-radius:99px;overflow:hidden;vertical-align:middle;"><i style="display:block;height:100%;width:${mx ? g.rate / mx * 100 : 0}%;background:var(--palm-emerald, #22c55e);"></i></span> ${this.pdRateText(g.rate, act.unit)}</td>
            <td style="text-align:right;font-weight:700;">${this.pdTimeText(g.rate, act.unit)}</td>
            <td><span style="font-size:11.5px;font-weight:700;border-radius:999px;padding:2px 9px;background:${chip[0]};color:${chip[1]};">${chip[2]}</span></td></tr>`;
        }).join('')}</tbody></table></div>` : `<div class="card" style="text-align:center;color:var(--text-muted);padding:30px;">No ${e(act.label)} reports in this period.</div>`}
      <div class="form-helper" style="margin-top:8px;">
        Speed compares with the average of everyone shown: Faster = 10% or more above, Slower = 10% or more below.
        ${defaulted ? `<br>${defaulted} report(s) were made before “Hours Worked” existed — counted as ${def} hours.` : ''}
        ${unsplit ? `<br>⚠️ ${unsplit} older report(s) had several jobs without the hours of each job, so they are not counted here.` : ''}
      </div>`;
  }
});

/* ===== hooks ===== */
(function () {
  const origNavigate = FarmOpsApp.prototype.navigateTo;
  FarmOpsApp.prototype.navigateTo = async function (...args) {
    const res = await origNavigate.apply(this, args);
    try { await this.pdAttach(); } catch (err) { console.warn('[Productivity]', err); }
    return res;
  };

  const origSubmit = syncService.submitReportLocally.bind(syncService);
  syncService.submitReportLocally = async function (reportData) {
    try { app.pdFill(reportData); } catch (err) { console.warn('[Productivity] hours', err); }
    return origSubmit(reportData);
  };
})();
