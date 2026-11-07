/**
 * FarmOps KPI — DATA VALIDATOR (v4.2.0)
 * Checks every validated activity report against the registered target of its row
 * (Slashing → Area Ha, Compost / Pruning / Foliar / Soil Drenching → Palm Count).
 * Works offline with the data on this device; the server checks again when the report is synced.
 * The rules come from the ValidationRules sheet (downloaded with the farm data).
 */
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

/* ---------- FRONTEND ---------- */
const DV_DEFAULT_RULES = [
  ['SLASHING', 'Slashing', 'weedingSlashingHa', 'Hectare', 3, true],
  ['COMPOST', 'Compost Application', 'compostPalms', 'Palm Count', 0, true],
  ['PRUNING', 'Pruning', 'pruningPalms', 'Palm Count', 0, true],
  ['FOLIAR', 'Foliar Application', 'foliarPalms', 'Palm Count', 0, true],
  ['SOILDRENCH', 'Soil Drenching', 'soilDrenchingPalms', 'Palm Count', 0, true],
  ['ROUNDWEED', 'Round Weeding', 'roundWeedingPalms', 'Palm Count', 0, false]
].map(([id, label, field, basis, decimals, active]) => ({ id, label, activityType: 'Regular Activity', field, basis, decimals, scope: 'Cycle', targetScope: 'Row', active }));

const DV_STATUS_STYLE = {
  'INVALID': { bg: '#fef2f2', fg: '#991b1b', bd: '#fecaca', icon: '⛔' },
  'FOR REVIEW': { bg: '#fffbeb', fg: '#92400e', bd: '#fde68a', icon: '🔎' },
  'VALID': { bg: '#f0fdf4', fg: '#166534', bd: '#bbf7d0', icon: '✅' },
  'APPROVED': { bg: '#eff6ff', fg: '#1e40af', bd: '#bfdbfe', icon: '👍' },
  'REJECTED': { bg: '#f3f4f6', fg: '#374151', bd: '#d1d5db', icon: '🚫' },
  'PENDING': { bg: '#f5f3ff', fg: '#5b21b6', bd: '#ddd6fe', icon: '⏳' }
};
const DV_NOT_OFFICIAL = ['INVALID', 'FOR REVIEW', 'REJECTED'];

Object.assign(FarmOpsApp.prototype, {

  /* ===== data on this device ===== */

  async dvRules() {
    const r = await db.getSetting('validationRules');
    return Array.isArray(r) && r.length ? r : DV_DEFAULT_RULES;
  },

  async dvRulesFor(activityType) {
    return (await this.dvRules()).filter((r) => r.active && r.activityType === activityType);
  },

  dvLocalToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /** Official accomplishments on this device (never INVALID / FOR REVIEW / REJECTED). */
  async dvAcceptedLocal(activityType) {
    const reports = await db.getAll('reports');
    return reports.filter((r) => r.activityType === activityType && r.syncStatus !== 'REJECTED' &&
      !DV_NOT_OFFICIAL.includes(String(r.validationStatus || '').toUpperCase()));
  },

  /** Record ID of the selected row (land owner ID + parcel + Farm & Block), when exactly one row matches. */
  dvResolveRecordId(landOwnerKey, parcelNumber, farmBlock) {
    const hits = auth.getAuthorizedBlocks().filter((b) => String(b.landOwnerId || b.landOwnerName) === String(landOwnerKey) &&
      b.parcelNumber === parcelNumber && b.farmBlockName === farmBlock && String(b.status || 'Active').toLowerCase() !== 'deactivated');
    return hits.length === 1 ? String(hits[0].recordId || '') : '';
  },

  /**
   * Validate a report with the data on this device. Sets recordId / landOwnerNo / dvSnapshot / validationStatus on rec.
   * Returns the engine result ({ applies:false } when the activity is not validated).
   */
  async dvValidateLocal(rec) {
    const rules = await this.dvRules();
    if (!rules.some((r) => r.active && r.activityType === rec.activityType)) return { applies: false, status: 'VALID', checks: [], messages: [] };
    const entries = await db.getAll('farmsAndBlocks');
    const accepted = await this.dvAcceptedLocal(rec.activityType);
    const res = dvValidateReport(rec, { rules, entries, accepted, today: this.dvLocalToday() });
    if (res.entry) {
      rec.recordId = res.entry.recordId;
      if (res.entry.landOwnerNo) rec.landOwnerNo = res.entry.landOwnerNo;
      if (!rec.dvSnapshot || String(rec.dvSnapshot.recordId) !== String(res.entry.recordId)) {
        rec.dvSnapshot = { recordId: res.entry.recordId, areaHa: res.entry.areaHa, palmCount: res.entry.palmCount };
      }
    }
    rec.validationStatus = res.status;
    return res;
  },

  /** Changes to the validation records on this device run one after another (no lost updates). */
  dvWithLock(fn) {
    const run = (this._dvLock || Promise.resolve()).then(fn, fn);
    this._dvLock = run.catch(() => {});
    return run;
  },

  async dvLocalMap() {
    const m = await db.getSetting('dv:local');
    return m && typeof m === 'object' ? m : {};
  },

  async dvServerCache() {
    const c = await db.getSetting('dv:server:' + auth.getUserId());
    return Array.isArray(c) ? c : [];
  },

  dvSeq(entry) {
    if (!entry || !entry.sequenceNo) return '';
    return (String(entry.category) === 'Priority' ? 'P-' : 'NP-') + entry.sequenceNo;
  },

  /** Save / update the validation record of a report on this device (status, reason, history). */
  dvSaveLocal(rec, res, event = {}) { return this.dvWithLock(() => this._dvSaveLocal(rec, res, event)); },

  async _dvSaveLocal(rec, res, event = {}) {
    const map = await this.dvLocalMap();
    const id = String(rec.reportId);
    let old = map[id];
    if (!old) old = (await this.dvServerCache()).find((r) => r.reportId === id) || null;
    const clean = { ...rec };
    delete clean.dvCorrection; delete clean.dv;
    const now = new Date().toISOString();
    const entry = res.entry;
    const history = (old && Array.isArray(old.history) ? old.history.slice() : []);
    history.push({
      at: now, by: auth.getEmployeeName(), status: res.status, local: true,
      event: event.event || (old ? 'RE-SAVED' : 'SUBMITTED'),
      note: event.note || '', before: event.before || null, after: event.after || null
    });
    map[id] = {
      reportId: id, uniqueUuid: rec.uniqueUuid || '', status: res.status, activityType: rec.activityType || '',
      date: rec.date || '', cycle: rec.cycle || '', period: res.period || '', userId: rec.userId || '', supervisor: rec.employeeName || '',
      recordId: entry ? entry.recordId : (rec.recordId || ''), landOwner: rec.landOwnersName || '',
      landOwnerNo: entry ? (entry.landOwnerNo || '') : (rec.landOwnerNo || ''), farmBlockCode: entry ? entry.farmBlockCode : '',
      farmBlock: rec.farmBlock || '', parcelNumber: rec.parcelNumber || '', sequence: this.dvSeq(entry),
      checks: res.checks || [], reason: res.reason || '', report: clean,
      original: old ? (old.original || old.report) : clean, history: history.slice(-50),
      firstSubmitted: old ? (old.firstSubmitted || rec.createdTimestamp || now) : (rec.createdTimestamp || now),
      lastValidated: now, reviewedBy: old ? old.reviewedBy || '' : '', reviewNote: old ? old.reviewNote || '' : '',
      syncState: 'NOT_SYNCED', local: true
    };
    await db.setSetting('dv:local', map);
    return map[id];
  },

  /** Result of the server check for one report (called by syncService after SYNC_REPORTS_BATCH). */
  dvApplyServerResults(results, sentRecords) { return this.dvWithLock(() => this._dvApplyServerResults(results, sentRecords)); },

  async _dvApplyServerResults(results, sentRecords) {
    if (!results || !results.length) return;
    const map = await this.dvLocalMap();
    const byId = new Map((sentRecords || []).map((r) => [String(r.reportId), r]));
    for (const v of results) {
      const id = String(v.reportId);
      const sent = byId.get(id);
      const official = v.status === 'VALID' || v.status === 'APPROVED';
      if (official && !v.final && sent) {
        const rep = { ...sent, validationStatus: v.status, recordId: v.recordId || sent.recordId, syncStatus: 'SENT' };
        delete rep.dvCorrection;
        if (v.landOwnerNo) rep.landOwnerNo = v.landOwnerNo;
        await db.put('reports', rep);
      } else if (!official) {
        await db.delete('reports', id);   // never counted as an accomplishment
      }
      const rec = map[id] || (sent ? {
        reportId: id, uniqueUuid: sent.uniqueUuid, activityType: sent.activityType, date: sent.date, cycle: sent.cycle,
        userId: sent.userId, supervisor: sent.employeeName, landOwner: sent.landOwnersName, farmBlock: sent.farmBlock,
        parcelNumber: sent.parcelNumber, report: sent, original: sent, history: [], firstSubmitted: sent.createdTimestamp
      } : null);
      if (!rec) continue;
      rec.status = v.status;
      if (!v.final) {
        rec.checks = v.checks || rec.checks || [];
        rec.reason = v.reason || '';
        rec.period = v.period || rec.period;
        if (v.recordId) rec.recordId = v.recordId;
        if (v.landOwnerNo) rec.landOwnerNo = v.landOwnerNo;
        if (v.farmBlockCode) rec.farmBlockCode = v.farmBlockCode;
        if (v.sequence) rec.sequence = v.sequence;
      }
      rec.history = (rec.history || []).concat([{ at: new Date().toISOString(), by: 'Server', event: v.final ? 'ALREADY ' + v.status : 'SERVER CHECK', status: v.status }]).slice(-50);
      rec.syncState = 'SYNCED';
      rec.lastValidated = new Date().toISOString();
      map[id] = rec;
    }
    await db.setSetting('dv:local', map);
  },

  /** The server refused a validated report for good (e.g. block not assigned): keep it visible, never counted. */
  dvMarkRejected(rejected) { return this.dvWithLock(() => this._dvMarkRejected(rejected)); },

  async _dvMarkRejected(rejected) {
    const map = await this.dvLocalMap();
    let changed = false;
    for (const rej of rejected || []) {
      const rec = map[String(rej.reportId)];
      if (!rec) continue;
      rec.status = 'INVALID';
      rec.reason = 'Submission Failed: ' + rej.error;
      rec.syncState = 'SYNCED';
      rec.history = (rec.history || []).concat([{ at: new Date().toISOString(), by: 'Server', event: 'REFUSED', status: 'INVALID', note: rej.error }]);
      changed = true;
    }
    if (changed) await db.setSetting('dv:local', map);
  },

  /** Server records (cached per user) + reports on this device that the server has not checked yet. */
  async dvAllRecords() {
    const server = await this.dvServerCache();
    const local = await this.dvLocalMap();
    const me = auth.getUserId();
    const out = new Map(server.map((r) => [r.reportId, r]));
    Object.values(local).forEach((r) => {
      if (!auth.isAdmin() && r.userId !== me) return;
      const srv = out.get(r.reportId);
      if (r.syncState === 'NOT_SYNCED' || !srv || String(r.lastValidated || '') > String(srv.lastValidated || '')) out.set(r.reportId, r);
    });
    return [...out.values()].sort((a, b) => String(b.lastValidated || b.firstSubmitted).localeCompare(String(a.lastValidated || a.firstSubmitted)));
  },

  async dvFetch(silent = true) {
    if (!navigator.onLine || !auth.getToken() || this._dvFetching) return false;
    this._dvFetching = true;
    try {
      const res = await syncService.apiCall('GET_VALIDATOR', {});
      await db.setSetting('dv:server:' + auth.getUserId(), res.records || []);
      if (Array.isArray(res.rules) && res.rules.length) await db.setSetting('validationRules', res.rules);
      // forget local copies the server already has
      const ids = new Set((res.records || []).map((r) => r.reportId));
      await this.dvWithLock(async () => {
        const map = await this.dvLocalMap();
        let changed = false;
        Object.keys(map).forEach((id) => { if (map[id].syncState === 'SYNCED' && ids.has(id)) { delete map[id]; changed = true; } });
        if (changed) await db.setSetting('dv:local', map);
      });
      return true;
    } catch (err) {
      if (!silent) this.showToast('Could not load the Data Validator: ' + err.message, 'error');
      return false;
    } finally { this._dvFetching = false; }
  },

  /* ===== display helpers ===== */

  dvDisplay(r) {
    if (r.syncState === 'NOT_SYNCED') {
      if (r.status === 'INVALID') return { key: 'INVALID', label: 'Invalid – Not Synced' };
      if (r.status === 'FOR REVIEW') return { key: 'FOR REVIEW', label: 'For Review – Not Synced' };
      return { key: 'PENDING', label: 'Pending Validation' };
    }
    const label = { 'INVALID': 'Invalid', 'FOR REVIEW': 'For Review', 'VALID': 'Valid', 'APPROVED': 'Approved', 'REJECTED': 'Rejected' }[r.status] || r.status;
    return { key: r.status, label };
  },

  dvBadge(r) {
    const d = this.dvDisplay(r);
    const s = DV_STATUS_STYLE[d.key] || DV_STATUS_STYLE.PENDING;
    return `<span style="display:inline-block;white-space:nowrap;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:700;background:${s.bg};color:${s.fg};border:1px solid ${s.bd};">${s.icon} ${this.esc(d.label)}</span>`;
  },

  /** The check shown in the table: the worst one (INVALID, then FOR REVIEW, then the first). */
  dvMainCheck(r) {
    const c = r.checks || [];
    return c.find((x) => x.status === 'INVALID') || c.find((x) => x.status === 'FOR REVIEW') || c[0] || null;
  },

  dvNum(v, basis, decimals) {
    if (v === null || v === undefined || v === '') return '—';
    const d = basis === 'Hectare' ? (decimals || 3) : 0;
    return Number(v).toFixed(d) + (basis === 'Hectare' ? ' Ha' : '');
  },

  /* ===== DATA VALIDATOR PAGE ===== */

  async renderDataValidatorView(container) {
    if (!this._dv) this._dv = { from: '', to: '', owner: 'ALL', claif: '', fb: 'ALL', act: 'ALL', status: 'OPEN', sup: 'ALL', q: '' };
    container.innerHTML = '<div class="card" style="text-align:center;padding:30px;color:var(--text-muted);">Loading Data Validator…</div>';
    const fresh = navigator.onLine && auth.getToken() ? this.dvFetch(true) : Promise.resolve(false);
    await this.dvRenderPage(container);
    if (await fresh && this.currentView === 'data-validator') await this.dvRenderPage(container);
  },

  async dvRenderPage(container) {
    const e = (v) => this.esc(v);
    const all = await this.dvAllRecords();
    this._dvRecords = all;
    const f = this._dv;
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const rules = await this.dvRules();
    const labels = uniq(all.map((r) => r.activityType).concat(rules.filter((x) => x.active).map((x) => x.activityType)));
    const admin = auth.isAdmin();
    const opt = (v, l, cur) => `<option value="${e(v)}" ${cur === v ? 'selected' : ''}>${e(l)}</option>`;
    const pendingCount = (await db.getAll('pendingQueue')).filter((p) => admin || p.userId === auth.getUserId()).length;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text-main);">Data Validator</h2>
          <p style="font-size:13px;color:var(--text-muted);">Every validated report is checked against the registered target of its row. ${admin ? 'All supervisors.' : 'Your reports and your Farm &amp; Blocks.'} Works offline — reports are checked again by the server when synced.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${pendingCount ? `<button class="btn btn-primary" onclick="app.dvSyncNow()">⬆️ Sync ${pendingCount} report(s)</button>` : ''}
          <button class="btn btn-outline" onclick="app.dvRefresh()">🔄 Refresh</button>
        </div>
      </div>
      <div id="dv-summary"></div>
      <div class="filter-toolbar" style="flex-wrap:wrap;">
        <input type="date" class="form-control" title="From date" value="${e(f.from)}" onchange="app._dv.from=this.value; app.dvRenderList()" style="max-width:160px;" />
        <input type="date" class="form-control" title="To date" value="${e(f.to)}" onchange="app._dv.to=this.value; app.dvRenderList()" style="max-width:160px;" />
        <select class="form-control" onchange="app._dv.status=this.value; app.dvRenderList()">
          ${[['OPEN', 'Needs action (Invalid + For Review)'], ['ALL', 'All statuses'], ['INVALID', 'Invalid'], ['FOR REVIEW', 'For Review'], ['VALID', 'Valid'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['NOT_SYNCED', 'Pending offline sync']].map(([v, l]) => opt(v, l, f.status)).join('')}
        </select>
        <select class="form-control" onchange="app._dv.act=this.value; app.dvRenderList()">
          <option value="ALL">All activities</option>
          ${rules.filter((x) => x.active).map((x) => opt('rule:' + x.id, x.label, f.act)).join('')}
          ${labels.length > 1 ? labels.map((l) => opt('type:' + l, l + ' (all)', f.act)).join('') : ''}
        </select>
        <select class="form-control" onchange="app._dv.fb=this.value; app.dvRenderList()">
          <option value="ALL">All Farm &amp; Blocks</option>
          ${uniq(all.map((r) => r.farmBlock)).map((b) => opt(b, b, f.fb)).join('')}
        </select>
        <select class="form-control" onchange="app._dv.owner=this.value; app.dvRenderList()">
          <option value="ALL">All land owners</option>
          ${uniq(all.map((r) => r.landOwner)).map((b) => opt(b, b, f.owner)).join('')}
        </select>
        <input type="text" class="form-control" placeholder="CLAIF Number" value="${e(f.claif)}" oninput="app._dv.claif=this.value; app.dvRenderList()" style="max-width:150px;" />
        ${admin ? `<select class="form-control" onchange="app._dv.sup=this.value; app.dvRenderList()">
          <option value="ALL">All supervisors</option>
          ${uniq(all.map((r) => r.supervisor)).map((b) => opt(b, b, f.sup)).join('')}
        </select>` : ''}
        <input type="text" class="form-control" placeholder="🔍 Report ID, parcel, reason..." value="${e(f.q)}" oninput="app._dv.q=this.value; app.dvRenderList()" />
      </div>
      ${admin ? '<div id="dv-repeat"></div>' : ''}
      <div id="dv-list"></div>`;
    this.dvRenderList();
  },

  dvFiltered() {
    const f = this._dv;
    const q = (f.q || '').trim().toLowerCase();
    const claif = (f.claif || '').trim().toLowerCase();
    return (this._dvRecords || []).filter((r) => {
      const st = r.syncState === 'NOT_SYNCED' ? 'NOT_SYNCED' : r.status;
      if (f.status === 'OPEN' && !['INVALID', 'FOR REVIEW'].includes(r.status)) return false;
      if (f.status === 'NOT_SYNCED' && st !== 'NOT_SYNCED') return false;
      if (!['ALL', 'OPEN', 'NOT_SYNCED'].includes(f.status) && r.status !== f.status) return false;
      if (f.act.startsWith('rule:') && !(r.checks || []).some((c) => c.ruleId === f.act.slice(5))) return false;
      if (f.act.startsWith('type:') && r.activityType !== f.act.slice(5)) return false;
      if (f.fb !== 'ALL' && r.farmBlock !== f.fb) return false;
      if (f.owner !== 'ALL' && r.landOwner !== f.owner) return false;
      if (f.sup !== 'ALL' && r.supervisor !== f.sup) return false;
      if (claif && !String(r.landOwnerNo || '').toLowerCase().includes(claif)) return false;
      if (f.from && String(r.date) < f.from) return false;
      if (f.to && String(r.date) > f.to) return false;
      if (q && ![r.reportId, r.parcelNumber, r.reason, r.recordId, r.landOwner, r.supervisor].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  },

  dvRenderList() {
    const box = document.getElementById('dv-list');
    if (!box) return;
    const e = (v) => this.esc(v);
    const all = this._dvRecords || [];
    const list = this.dvFiltered();

    const sum = document.getElementById('dv-summary');
    if (sum) {
      const n = (fn) => all.filter(fn).length;
      const cards = [
        ['ALL', '📋', 'Total Reports', all.length],
        ['INVALID', '⛔', 'Invalid', n((r) => r.status === 'INVALID')],
        ['FOR REVIEW', '🔎', 'For Review', n((r) => r.status === 'FOR REVIEW')],
        ['VALID', '✅', 'Valid', n((r) => r.status === 'VALID' || r.status === 'APPROVED')],
        ['NOT_SYNCED', '⏳', 'Pending Offline Sync', n((r) => r.syncState === 'NOT_SYNCED')]
      ];
      sum.innerHTML = `<div class="stats-grid">${cards.map(([st, ic, label, val]) => `
        <div class="stat-card" style="cursor:pointer;${this._dv.status === st ? 'outline:2px solid var(--palm-primary, #16a34a);' : ''}" onclick="app._dv.status='${st}'; app.dvRenderPage(document.getElementById('view-content-root'))">
          <div class="stat-icon ${st === 'FOR REVIEW' || st === 'NOT_SYNCED' ? 'amber' : 'green'}" ${st === 'INVALID' ? 'style="background:#fee2e2;color:#b91c1c;"' : ''}>${ic}</div>
          <div class="stat-info"><div class="stat-label">${label}</div><div class="stat-value">${val}</div></div></div>`).join('')}</div>`;
    }

    const rep = document.getElementById('dv-repeat');
    if (rep) {
      const bad = all.filter((r) => ['INVALID', 'FOR REVIEW', 'REJECTED'].includes(r.status));
      const by = {};
      bad.forEach((r) => { const k = r.supervisor || r.userId || '—'; by[k] = by[k] || { n: 0, inv: 0, acts: {} }; by[k].n++; if (r.status === 'INVALID') by[k].inv++; (r.checks || []).filter((c) => c.status !== 'VALID').forEach((c) => { by[k].acts[c.label] = (by[k].acts[c.label] || 0) + 1; }); });
      const top = Object.entries(by).filter(([, v]) => v.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
      rep.innerHTML = top.length ? `<div class="card" style="margin-bottom:14px;padding:12px 16px;">
        <div style="font-weight:700;font-size:13.5px;margin-bottom:6px;">🔁 Repeated errors (2 or more Invalid / For Review / Rejected reports)</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">${top.map(([name, v]) => `
          <span style="cursor:pointer;font-size:12.5px;padding:4px 10px;border-radius:999px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;" onclick="app._dv.sup=${e(JSON.stringify(name))}; app._dv.status='ALL'; app.dvRenderPage(document.getElementById('view-content-root'))">
            <strong>${e(name)}</strong>: ${v.n} (${v.inv} invalid) · ${e(Object.entries(v.acts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a, c]) => a + ' ' + c).join(', '))}</span>`).join('')}</div></div>` : '';
    }

    if (!list.length) {
      box.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:30px;">${all.length ? 'No reports match the filters.' : 'No validated reports yet. Regular Activity reports appear here when they are submitted.'}</div>`;
      return;
    }
    const shown = list.slice(0, 500);
    box.innerHTML = `
      <div class="card" style="padding:0;">
        <div class="table-responsive">
          <table class="table" style="font-size:12.5px;">
            <thead><tr>
              <th>Report ID</th><th>Submission Date</th><th>Supervisor</th><th>Land Owner</th><th>CLAIF</th><th>Farm &amp; Block</th><th>Parcel / Sequence</th>
              <th>Activity</th><th>Target Basis</th><th style="text-align:right;">Registered Target</th><th style="text-align:right;">Previous</th><th style="text-align:right;">Remaining</th>
              <th style="text-align:right;">Submitted</th><th style="text-align:right;">Difference</th><th>Status</th><th style="min-width:260px;">Reason</th>
            </tr></thead>
            <tbody>
              ${shown.map((r) => {
                const c = this.dvMainCheck(r) || {};
                const more = (r.checks || []).length > 1 ? ` <span style="color:var(--text-muted);">+${r.checks.length - 1}</span>` : '';
                return `<tr style="cursor:pointer;" onclick="app.dvOpenDetail(${e(JSON.stringify(r.reportId))})">
                  <td style="font-family:monospace;white-space:nowrap;">${e(r.reportId)}</td>
                  <td style="white-space:nowrap;">${e(r.date)}<div style="font-size:11px;color:var(--text-muted);">sent ${e(String(r.firstSubmitted || '').substring(0, 10))}</div></td>
                  <td>${e(r.supervisor)}</td>
                  <td>${e(r.landOwner)}</td>
                  <td style="white-space:nowrap;">${e(r.landOwnerNo || "—")}</td>
                  <td>${e(r.farmBlock)}</td>
                  <td style="white-space:nowrap;">${e(r.parcelNumber)}${r.sequence ? ` / ${e(r.sequence)}` : ''}${r.recordId ? `<div style="font-size:11px;color:var(--text-muted);">${e(r.recordId)}</div>` : ''}</td>
                  <td>${e(c.label || r.activityType)}${more}</td>
                  <td>${e(c.basis || '—')}</td>
                  <td style="text-align:right;">${this.dvNum(c.target, c.basis, c.decimals)}</td>
                  <td style="text-align:right;">${this.dvNum(c.previous, c.basis, c.decimals)}</td>
                  <td style="text-align:right;">${this.dvNum(c.remaining, c.basis, c.decimals)}</td>
                  <td style="text-align:right;font-weight:700;">${this.dvNum(c.submitted, c.basis, c.decimals)}</td>
                  <td style="text-align:right;${c.difference > 0 ? 'color:#b91c1c;font-weight:700;' : ''}">${c.difference > 0 ? this.dvNum(c.difference, c.basis, c.decimals) : '—'}</td>
                  <td>${this.dvBadge(r)}</td>
                  <td style="font-size:12px;">${e(r.reason || (r.status === 'VALID' ? 'Within the remaining target.' : ''))}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ${list.length > shown.length ? `<div class="form-helper">Showing the first ${shown.length} of ${list.length}. Use the filters to narrow the list.</div>` : ''}`;
  },

  async dvRefresh() {
    if (!navigator.onLine) { this.showToast('You are offline. Showing the reports saved on this device.', 'warning'); }
    else await this.dvFetch(false);
    await this.dvRenderPage(document.getElementById('view-content-root'));
  },

  async dvSyncNow() {
    if (!navigator.onLine) { this.showToast('You are offline. The reports will be sent when you are online.', 'warning'); return; }
    const res = await syncService.syncPendingRecords();
    this.showToast(res.message || res.error || 'Done.', res.success ? 'success' : 'error');
    await this.dvRefresh();
  },

  /* ===== detail / correction / review ===== */

  async dvOpenDetail(reportId) {
    const r = (this._dvRecords || (await this.dvAllRecords())).find((x) => x.reportId === reportId);
    if (!r) { this.showToast('Report not found.', 'error'); return; }
    const e = (v) => this.esc(v);
    const admin = auth.isAdmin();
    const rules = await this.dvRulesFor(r.activityType);
    const fieldsOf = (rep) => rules.map((x) => [x.label, x.field, rep && rep[x.field], x.basis]);
    const cur = r.report || {};
    const orig = r.original || cur;
    const changed = ['date', 'cycle', 'landOwnersName', 'parcelNumber', 'farmBlock'].concat(rules.map((x) => x.field)).some((k) => String(orig[k] ?? '') !== String(cur[k] ?? ''));
    const canCorrect = ['INVALID', 'FOR REVIEW'].includes(r.status) && (admin || r.userId === auth.getUserId());
    const synced = r.syncState !== 'NOT_SYNCED';

    document.getElementById('form-modal-title').textContent = `Data Validator — ${r.reportId}`;
    document.getElementById('form-modal-body').innerHTML = `
      <div id="dv-detail" style="font-size:13.5px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <div>${this.dvBadge(r)} <span style="color:var(--text-muted);font-size:12.5px;">${e(r.activityType)} · ${e(r.period || '')}</span></div>
          <div style="font-size:12px;color:var(--text-muted);">Last checked ${e(String(r.lastValidated || '').replace('T', ' ').substring(0, 16))}</div>
        </div>
        ${r.reason ? `<div style="padding:10px 12px;border-radius:8px;margin-bottom:12px;background:${(DV_STATUS_STYLE[r.status] || DV_STATUS_STYLE.PENDING).bg};border:1px solid ${(DV_STATUS_STYLE[r.status] || DV_STATUS_STYLE.PENDING).bd};color:${(DV_STATUS_STYLE[r.status] || DV_STATUS_STYLE.PENDING).fg};">
          ${(r.reason.match(/(Submission Failed:|For Review:)[^]*?(?=(Submission Failed:|For Review:)|$)/g) || [r.reason]).map((m) => `<div style="margin:2px 0;">${e(m.trim())}</div>`).join('')}</div>` : ''}
        <div class="form-grid-2" style="gap:4px 16px;margin-bottom:12px;">
          <div><span style="color:var(--text-muted);">Supervisor:</span> ${e(r.supervisor)}</div>
          <div><span style="color:var(--text-muted);">Report date:</span> ${e(r.date)} · ${e(r.cycle || 'no cycle')}</div>
          <div><span style="color:var(--text-muted);">Land Owner:</span> ${e(r.landOwner)} ${r.landOwnerNo ? `(${e(r.landOwnerNo)})` : ''}</div>
          <div><span style="color:var(--text-muted);">Farm &amp; Block:</span> ${e(r.farmBlock)}</div>
          <div><span style="color:var(--text-muted);">Parcel / Sequence:</span> ${e(r.parcelNumber)} ${r.sequence ? '/ ' + e(r.sequence) : ''}</div>
          <div><span style="color:var(--text-muted);">Record ID:</span> ${e(r.recordId || '—')}</div>
        </div>
        <div class="table-responsive"><table class="table" style="font-size:12.5px;">
          <thead><tr><th>Activity</th><th>Basis</th><th style="text-align:right;">Target</th><th style="text-align:right;">Previous</th><th style="text-align:right;">Remaining</th><th style="text-align:right;">Submitted</th><th style="text-align:right;">Difference</th><th>Result</th></tr></thead>
          <tbody>${(r.checks || []).map((c) => `<tr>
            <td>${e(c.label)}</td><td>${e(c.basis)}</td>
            <td style="text-align:right;">${this.dvNum(c.target, c.basis, c.decimals)}</td><td style="text-align:right;">${this.dvNum(c.previous, c.basis, c.decimals)}</td>
            <td style="text-align:right;">${this.dvNum(c.remaining, c.basis, c.decimals)}</td><td style="text-align:right;font-weight:700;">${this.dvNum(c.submitted, c.basis, c.decimals)}</td>
            <td style="text-align:right;${c.difference > 0 ? 'color:#b91c1c;font-weight:700;' : ''}">${c.difference > 0 ? this.dvNum(c.difference, c.basis, c.decimals) : '—'}</td>
            <td>${e(c.status)}</td></tr>`).join('') || '<tr><td colspan="8" style="color:var(--text-muted);">No quantity could be checked.</td></tr>'}</tbody>
        </table></div>
        ${changed ? `<div style="margin:10px 0;"><div style="font-weight:700;margin-bottom:4px;">Original vs. current values</div>
          <div class="table-responsive"><table class="table" style="font-size:12.5px;"><thead><tr><th>Field</th><th>Original</th><th>Current</th></tr></thead><tbody>
          ${[['Date', 'date', orig.date, ''], ['Cycle', 'cycle', orig.cycle, ''], ['Land Owner', 'landOwnersName', orig.landOwnersName, ''], ['Parcel', 'parcelNumber', orig.parcelNumber, ''], ['Farm & Block', 'farmBlock', orig.farmBlock, '']].concat(fieldsOf(orig))
            .map(([l, k]) => `<tr ${String(orig[k] ?? '') !== String(cur[k] ?? '') ? 'style="background:#fffbeb;"' : ''}><td>${e(l)}</td><td>${e(orig[k] ?? '')}</td><td>${e(cur[k] ?? '')}</td></tr>`).join('')}
          </tbody></table></div></div>` : ''}
        ${r.reviewedBy ? `<div style="margin:8px 0;font-size:12.5px;"><strong>Reviewed by ${e(r.reviewedBy)}</strong> ${e(String(r.reviewedAt || '').substring(0, 16).replace('T', ' '))}${r.reviewNote ? ` — ${e(r.reviewNote)}` : ''}</div>` : ''}
        <details style="margin:10px 0;" ${(r.history || []).length <= 4 ? 'open' : ''}><summary style="cursor:pointer;font-weight:700;">History (${(r.history || []).length})</summary>
          <div style="margin-top:6px;">${(r.history || []).slice().reverse().map((h) => `
            <div style="border-left:3px solid #d1d5db;padding:4px 10px;margin:6px 0;font-size:12.5px;">
              <strong>${e(h.event)}</strong> → ${e(h.status || '')} · ${e(h.by || '')} · ${e(String(h.at || '').replace('T', ' ').substring(0, 16))}${h.local ? ' <em>(this device)</em>' : ''}
              ${h.note ? `<div>${e(h.note)}</div>` : ''}
              ${h.before && h.after ? `<div style="color:var(--text-muted);">${e(Object.keys(h.after).filter((k) => String(h.before[k] ?? '') !== String(h.after[k] ?? '')).map((k) => `${k}: ${h.before[k] ?? ''} → ${h.after[k] ?? ''}`).join(' · '))}</div>` : ''}
            </div>`).join('') || '<div style="color:var(--text-muted);">No history.</div>'}</div>
        </details>
        <div id="dv-action-panel"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;">
          ${canCorrect ? `<button type="button" class="btn btn-primary" onclick="app.dvOpenCorrection(${e(JSON.stringify(r.reportId))})">✏️ Correct &amp; Resubmit</button>` : ''}
          ${admin && synced && r.status === 'FOR REVIEW' ? `<button type="button" class="btn btn-secondary" onclick="app.dvReviewPanel('APPROVE')">👍 Approve</button>` : ''}
          ${admin && synced && ['INVALID', 'FOR REVIEW'].includes(r.status) ? `<button type="button" class="btn btn-outline" style="color:#b91c1c;" onclick="app.dvReviewPanel('REJECT')">🚫 Reject</button>` : ''}
        </div>
        ${!synced ? '<div class="form-helper" style="text-align:right;">Not sent yet — the server checks it again when it is synced.</div>' : ''}
      </div>`;
    this._dvOpen = r.reportId;
    document.getElementById('form-modal-submit-btn').style.display = 'none';
    this.openModal('form-modal');
  },

  dvReviewPanel(decision) {
    const panel = document.getElementById('dv-action-panel');
    if (!panel) return;
    const approve = decision === 'APPROVE';
    panel.innerHTML = `<div class="card" style="background:var(--bg-hover);margin:8px 0;padding:12px;">
      <div style="font-weight:700;margin-bottom:6px;">${approve ? 'Approve this report' : 'Reject this report'}</div>
      <div class="form-helper" style="margin-bottom:6px;">${approve ? 'The submitted quantities are saved unchanged and counted as an accomplishment.' : 'The report stays in the Data Validator and is never counted. The supervisor can see your reason.'}</div>
      <textarea id="dv-review-note" class="form-control" rows="2" maxlength="500" placeholder="${approve ? 'Note (optional)' : 'Reason (required)'}"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
        <button type="button" class="btn btn-outline" onclick="document.getElementById('dv-action-panel').innerHTML=''">Cancel</button>
        <button type="button" id="dv-review-btn" class="btn ${approve ? 'btn-primary' : 'btn-danger'}" onclick="app.dvSubmitReview('${decision}')">${approve ? '👍 Approve' : '🚫 Reject'}</button>
      </div></div>`;
  },

  async dvSubmitReview(decision) {
    if (!navigator.onLine) { this.showToast('Approving and rejecting needs internet.', 'warning'); return; }
    const note = document.getElementById('dv-review-note').value.trim();
    if (decision === 'REJECT' && !note) { this.showToast('Please write the reason for rejecting.', 'warning'); return; }
    const btn = document.getElementById('dv-review-btn');
    btn.disabled = true;
    try {
      const res = await syncService.apiCall('DV_REVIEW', { reportId: this._dvOpen, decision, note });
      this.showToast(res.message || 'Saved.', 'success');
      this.closeModal('form-modal');
      await this.dvFetch(false);
      await this.dvRenderPage(document.getElementById('view-content-root'));
    } catch (err) {
      this.showToast(err.message, 'error');
      btn.disabled = false;
    }
  },

  /** Editable copy of the report: same Report ID, quantities only change when the supervisor types them. */
  async dvOpenCorrection(reportId) {
    const r = (this._dvRecords || []).find((x) => x.reportId === reportId);
    if (!r) return;
    const e = (v) => this.esc(v);
    const rep = r.report || {};
    const rules = await this.dvRulesFor(r.activityType);
    const block = (await db.getAll('farmsAndBlocks')).find((b) => String(b.recordId) === String(r.recordId || rep.recordId));
    const panel = document.getElementById('dv-action-panel');
    panel.innerHTML = `<div class="card" style="background:var(--bg-hover);margin:8px 0;padding:12px;">
      <div style="font-weight:700;margin-bottom:8px;">✏️ Correct &amp; Resubmit — ${e(r.reportId)}</div>
      <div class="form-grid-3">
        <div class="form-group"><label class="form-label required">Date</label><input type="date" id="dvc-date" class="form-control" value="${e(rep.date || '')}" /></div>
        <div class="form-group"><label class="form-label">Cycle</label><select id="dvc-cycle" class="form-control"></select></div>
        <div class="form-group"><label class="form-label required">Land Owner</label><select id="dvc-landowner" class="form-control"></select></div>
        <div class="form-group"><label class="form-label required">Parcel Number</label><select id="dvc-parcel" class="form-control"></select></div>
        <div class="form-group"><label class="form-label required">Farm &amp; Block</label><select id="dvc-block" class="form-control"></select></div>
      </div>
      <div class="form-grid-3">
        ${rules.map((x) => `<div class="form-group"><label class="form-label">${e(x.label)} (${x.basis === 'Hectare' ? 'Ha' : 'palms'})</label>
          <input type="number" min="0" step="${x.basis === 'Hectare' ? '0.001' : '1'}" id="dvc-f-${e(x.id)}" data-field="${e(x.field)}" class="form-control dvc-qty" value="${e(rep[x.field] ?? '')}" /></div>`).join('')}
      </div>
      <div class="form-group"><label class="form-label">Remarks</label><textarea id="dvc-remarks" class="form-control" rows="2">${e(rep.remarks || '')}</textarea></div>
      <div class="form-group"><label class="form-label required">What did you correct, and why?</label><textarea id="dvc-note" class="form-control" rows="2" maxlength="500" placeholder="e.g. typed 0.246 instead of 0.024"></textarea></div>
      <div id="dvc-check" style="margin:6px 0;font-size:13px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-outline" onclick="document.getElementById('dv-action-panel').innerHTML=''">Cancel</button>
        <button type="button" id="dvc-save" class="btn btn-primary" onclick="app.dvSaveCorrection()">💾 Save &amp; Resubmit</button>
      </div></div>`;
    await this.populateActivityDropdown('dvc-cycle', r.activityType, 'Cycle');
    const cyc = document.getElementById('dvc-cycle');
    if (rep.cycle && ![...cyc.options].some((o) => o.value === rep.cycle)) cyc.insertAdjacentHTML('beforeend', `<option value="${e(rep.cycle)}">${e(rep.cycle)}</option>`);
    cyc.value = rep.cycle || '';
    await this.populateCascadingDropdowns('dvc-landowner', 'dvc-parcel', 'dvc-block', {
      landOwnerId: block ? block.landOwnerId : '', landOwner: rep.landOwnersName, parcelNumber: rep.parcelNumber, farmBlock: rep.farmBlock
    });
    const recheck = () => this.dvCorrectionPreview();
    panel.querySelectorAll('input,select').forEach((el) => el.addEventListener('change', recheck));
    panel.querySelectorAll('.dvc-qty').forEach((el) => el.addEventListener('input', recheck));
    ['dvc-landowner', 'dvc-parcel'].forEach((id) => { const el = document.getElementById(id); const h = el.onchange; el.onchange = (ev) => { if (h) h(ev); recheck(); }; });
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    recheck();
  },

  dvCorrectionRecord() {
    const r = (this._dvRecords || []).find((x) => x.reportId === this._dvOpen);
    if (!r) return null;
    const before = { ...(r.report || {}) };
    const rec = { ...before };
    delete rec.validationStatus; delete rec.serverTimestamp; delete rec.fromServer; delete rec.syncError; delete rec.dvSnapshot;
    rec.date = document.getElementById('dvc-date').value;
    rec.cycle = document.getElementById('dvc-cycle').value;
    Object.assign(rec, this.selectedLandownerFields('dvc-landowner'));
    rec.parcelNumber = document.getElementById('dvc-parcel').value;
    rec.farmBlock = document.getElementById('dvc-block').value;
    rec.recordId = this.dvResolveRecordId(document.getElementById('dvc-landowner').value, rec.parcelNumber, rec.farmBlock);
    document.querySelectorAll('.dvc-qty').forEach((el) => { const v = el.value.trim(); rec[el.dataset.field] = v === '' ? 0 : Number(v); });
    rec.remarks = document.getElementById('dvc-remarks').value.trim();
    rec.syncStatus = 'PENDING';
    return { r, before, rec };
  },

  async dvCorrectionPreview() {
    const box = document.getElementById('dvc-check');
    const c = this.dvCorrectionRecord();
    if (!box || !c) return;
    const res = await this.dvValidateLocal(c.rec);
    const s = DV_STATUS_STYLE[res.status] || DV_STATUS_STYLE.PENDING;
    box.innerHTML = `<div style="padding:8px 10px;border-radius:8px;background:${s.bg};border:1px solid ${s.bd};color:${s.fg};">
      <strong>${s.icon} Check on this device: ${this.esc(res.status)}</strong>
      ${res.messages.map((m) => `<div>${this.esc(m)}</div>`).join('')}
      ${res.checks.filter((x) => x.target !== null).map((x) => `<div style="font-size:12px;">${this.esc(x.label)}: remaining ${this.dvNum(x.remaining, x.basis, x.decimals)} of ${this.dvNum(x.target, x.basis, x.decimals)}</div>`).join('')}
    </div>`;
  },

  async dvSaveCorrection() {
    const c = this.dvCorrectionRecord();
    if (!c) return;
    const note = document.getElementById('dvc-note').value.trim();
    if (!note) { this.showToast('Please write what you corrected and why.', 'warning'); return; }
    if (!c.rec.date || !c.rec.farmBlock) { this.showToast('Date and Farm & Block are required.', 'warning'); return; }
    const keys = ['date', 'cycle', 'landOwnersName', 'parcelNumber', 'farmBlock', 'remarks'].concat((await this.dvRulesFor(c.rec.activityType)).map((x) => x.field));
    const pick = (o) => Object.fromEntries(keys.map((k) => [k, o[k] ?? '']));
    const before = pick(c.before), after = pick(c.rec);
    if (JSON.stringify(before) === JSON.stringify(after)) { this.showToast('Nothing was changed.', 'warning'); return; }
    const btn = document.getElementById('dvc-save');
    btn.disabled = true;
    try {
      const res = await this.dvValidateLocal(c.rec);
      c.rec.dvCorrection = { at: new Date().toISOString(), by: auth.getEmployeeName(), note, before, after };
      await db.put('pendingQueue', c.rec);
      if (res.status === 'VALID') await db.put('reports', { ...c.rec, dvCorrection: undefined });
      else await db.delete('reports', c.rec.reportId);
      await this.dvSaveLocal(c.rec, res, { event: 'CORRECTED', note, before, after });
      await syncService.updateSyncStatus();
      this.closeModal('form-modal');
      this.showToast(res.status === 'VALID' ? 'Correction saved. It will be checked again by the server.' : `Correction saved, but it is still ${res.status}. See the reason.`, res.status === 'VALID' ? 'success' : 'warning');
      if (navigator.onLine) { await syncService.syncPendingRecords(); await this.dvFetch(true); }
      await this.dvRenderPage(document.getElementById('view-content-root'));
    } catch (err) {
      this.showToast('Could not save the correction: ' + err.message, 'error');
    } finally { btn.disabled = false; }
  },

  /* ===== hints on the report form ===== */

  /**
   * Shows "Remaining: …" under each validated quantity of a form and turns red when the typed value is too high.
   * cfg: { activityType, land, parcel, block, date, cycle, fields: { reportField: inputId } }
   */
  async dvAttachHints(cfg) {
    const rules = await this.dvRulesFor(cfg.activityType);
    if (!rules.length) return;
    const inputs = rules.map((r) => [r, document.getElementById(cfg.fields[r.field])]).filter(([, el]) => el);
    inputs.forEach(([r, el]) => {
      if (r.basis === 'Hectare') el.step = '0.001';
      if (!document.getElementById('dvh-' + el.id)) el.insertAdjacentHTML('afterend', `<div class="dv-hint form-helper" id="dvh-${el.id}" style="min-height:16px;"></div>`);
    });
    const update = async () => {
      const g = (id) => (document.getElementById(id) || {}).value || '';
      const landKey = g(cfg.land);
      const rec = {
        activityType: cfg.activityType, date: g(cfg.date), cycle: g(cfg.cycle), parcelNumber: g(cfg.parcel), farmBlock: g(cfg.block),
        ...this.selectedLandownerFields(cfg.land), userId: auth.getUserId(), reportId: '__hint__'
      };
      rec.recordId = this.dvResolveRecordId(landKey, rec.parcelNumber, rec.farmBlock);
      inputs.forEach(([r, el]) => { rec[r.field] = el.value === '' ? 0 : Number(el.value); });
      const probe = { ...rec };
      inputs.forEach(([r]) => { probe[r.field] = 1 / dvScale(r); });   // smallest amount, to read the remaining target
      const res = rec.farmBlock ? dvValidateReport(probe, { rules, entries: await db.getAll('farmsAndBlocks'), accepted: await this.dvAcceptedLocal(cfg.activityType), today: '9999-12-31' }) : null;
      inputs.forEach(([r, el]) => {
        const hint = document.getElementById('dvh-' + el.id);
        if (!hint) return;
        const c = res && res.checks.find((x) => x.ruleId === r.id);
        if (!c || c.remaining === null) { hint.innerHTML = rec.farmBlock && res && res.entry ? '<span style="color:#92400e;">No registered target for this row — will be For Review.</span>' : ''; el.style.borderColor = ''; return; }
        const val = rec[r.field];
        const over = Math.round(val * dvScale(r)) > Math.round(c.remaining * dvScale(r));
        const bad = isNaN(val) || val < 0 || dvDecimalsOf(val) > (parseInt(r.decimals, 10) || 0);
        hint.innerHTML = `<span style="color:${over || bad ? '#b91c1c' : 'var(--text-muted)'};">Remaining ${this.dvNum(c.remaining, r.basis, r.decimals)} of ${this.dvNum(c.target, r.basis, r.decimals)} (${this.esc(c.period)})${over ? ' — too high' : ''}${bad && !over ? ' — check the number' : ''}</span>`;
        el.style.borderColor = over || bad ? '#dc2626' : '';
      });
    };
    this._dvHintUpdate = update;
    [cfg.date, cfg.cycle, cfg.block].forEach((id) => { const el = document.getElementById(id); if (el) el.addEventListener('change', update); });
    [cfg.land, cfg.parcel].forEach((id) => { const el = document.getElementById(id); if (el) { const h = el.onchange; el.onchange = (ev) => { if (h) h(ev); update(); }; } });
    inputs.forEach(([, el]) => el.addEventListener('input', update));
    update();
  },

  /** After submit: tell the supervisor what the check found (the report is never thrown away). */
  dvAfterSubmit(saved, okMessage, nextView) {
    const dv = saved && saved.dv;
    if (!dv || !dv.applies || dv.status === 'VALID') {
      this.showToast(okMessage, 'success');
      this.navigateTo(nextView);
      return;
    }
    this.showToast((dv.status === 'INVALID' ? '⛔ ' : '🔎 ') + (dv.messages[0] || dv.status) + ' The report was saved in the Data Validator.', dv.status === 'INVALID' ? 'error' : 'warning');
    this.navigateTo('data-validator').then(() => setTimeout(() => this.dvOpenDetail(saved.reportId), 150));
  }
});
