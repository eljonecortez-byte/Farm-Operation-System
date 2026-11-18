/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Report Photo (v4.4.0) — one photo per accomplishment report, on every activity form.
 *
 *  - Camera or gallery. The photo is made smaller on the phone (max 1280 px, JPEG) and a stamp
 *    is drawn INTO the photo: date & time, GPS, Farm & Block, land owner / CLAIF / parcel,
 *    activity, supervisor and Report ID. Gallery photos are marked "From gallery".
 *  - Works offline: the photo waits on the phone and is uploaded AFTER its report has synced.
 *  - Saved in a private Google Drive folder; the ReportPhotos sheet keeps the link and a thumbnail.
 *
 * Load AFTER app.js and sync.js in index.html:  <script src="js/photo.js"></script>
 */

const PH_FORMS = {
  'form-regular-activity': 'Regular Activity', 'form-irregular-activity': 'Irregular Activity', 'form-other-activity': 'Other Farm Activity',
  'form-palm-category': 'Palm Category Activity', 'form-seednut': 'Seednut Collection', 'form-pest-disease': 'Pest and Disease Activity', 'form-custom': ''
};
const PH_MAX_SIDE = 1280;
const PH_QUALITY = 0.72;
const PH_THUMB_SIDE = 240;
const PH_THUMB_LIMIT = 800;

Object.assign(FarmOpsApp.prototype, {

  phStyle() {
    if (document.getElementById('ph-style')) return;
    document.head.insertAdjacentHTML('beforeend', `<style id="ph-style">
      .ph-box { border:1.5px dashed var(--palm-border, #bbf7d0); background:var(--palm-subtle, #f0fdf4); border-radius:var(--radius-md, 12px); padding:14px 16px; margin:18px 0; }
      .ph-title { font-weight:700; color:var(--palm-dark, #14532d); font-size:14px; margin-bottom:10px; }
      .ph-btns { display:flex; gap:8px; flex-wrap:wrap; }
      .ph-btns label { margin:0; cursor:pointer; }
      .ph-prev { display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap; margin-top:12px; }
      .ph-prev img { width:100%; max-width:360px; border-radius:10px; border:1px solid var(--border); }
      .ph-meta { font-size:12.5px; line-height:1.7; flex:1; min-width:180px; }
      .ph-chip { display:inline-block; font-size:11.5px; font-weight:700; border-radius:999px; padding:2px 9px; white-space:nowrap; }
      .ph-cam { background:#dcfce7; color:#166534; } .ph-gal { background:#fef3c7; color:#92400e; } .ph-wait { background:#ede9fe; color:#5b21b6; } .ph-err { background:#fee2e2; color:#b91c1c; }
      .ph-thumb { width:56px; height:42px; object-fit:cover; border-radius:6px; border:1px solid var(--border); cursor:pointer; display:block; }
      .ph-none { font-size:11.5px; color:var(--text-muted); }
      .ph-view { position:fixed; inset:0; background:rgba(15,23,42,.78); z-index:3000; display:flex; align-items:center; justify-content:center; padding:14px; }
      .ph-view-box { background:#fff; border-radius:14px; overflow:hidden; max-width:820px; width:100%; }
      .ph-view-box img { display:block; width:100%; max-height:72vh; object-fit:contain; background:#000; }
      .ph-view-bar { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; padding:10px 14px; font-size:13px; }
    </style>`);
  },

  /* ===== stored photos (IndexedDB settings) ===== */

  async phQueue() { const q = await db.getSetting('photo:queue'); return Array.isArray(q) ? q : []; },
  async phSetQueue(q) { await db.setSetting('photo:queue', [...new Set(q)]); },

  async phThumbs() {
    if (!this._phThumbs) {
      const t = await db.getSetting('photo:thumbs');
      this._phThumbs = t && typeof t === 'object' ? t : {};
    }
    return this._phThumbs;
  },

  async phSaveThumbs() {
    const t = await this.phThumbs();
    const keys = Object.keys(t);
    if (keys.length > PH_THUMB_LIMIT) keys.sort((a, b) => String(t[a].at || '').localeCompare(String(t[b].at || ''))).slice(0, keys.length - PH_THUMB_LIMIT).forEach((k) => delete t[k]);
    await db.setSetting('photo:thumbs', t);
  },

  /* ===== form ===== */

  /** Adds the photo box to the activity form that is on screen (called after every navigation). */
  phAttachToForm() {
    const root = document.getElementById('view-content-root');
    const form = root && [...root.querySelectorAll('form')].find((f) => f.id in PH_FORMS);
    if (!form) { this._photo = null; return; }
    if (form.querySelector('.ph-box')) return;
    this.phStyle();
    this._photo = { formId: form.id, base: null, source: '', photoDate: '', takenAt: '', gps: '' };
    const submit = form.querySelector('button[type="submit"]');
    const anchor = submit ? submit.closest('div') : null;
    const html = `
      <div class="ph-box" id="ph-box">
        <div class="ph-title">📷 Photo of the accomplishment <span class="ph-none">(1 photo &bull; optional)</span></div>
        <div class="ph-btns">
          <label class="btn btn-primary">📷 Take Photo<input type="file" accept="image/*" capture="environment" hidden onchange="app.phPick(this, 'camera')" /></label>
          <label class="btn btn-outline">🖼️ Choose from Gallery<input type="file" accept="image/*" hidden onchange="app.phPick(this, 'gallery')" /></label>
        </div>
        <div class="ph-prev" id="ph-prev" style="display:none;"></div>
      </div>`;
    if (anchor && anchor.parentNode === form) anchor.insertAdjacentHTML('beforebegin', html);
    else form.insertAdjacentHTML('beforeend', html);
    // keep the stamp up to date when the form changes
    form.addEventListener('change', (ev) => { if (!ev.target.closest('.ph-box')) this.phPreview(); });
  },

  async phPick(input, source) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { this.showToast('Please choose a photo.', 'warning'); return; }
    try {
      const img = await this.phLoadImage(file);
      const sc = Math.min(1, PH_MAX_SIDE / Math.max(img.width, img.height));
      const base = document.createElement('canvas');
      base.width = Math.round(img.width * sc); base.height = Math.round(img.height * sc);
      base.getContext('2d').drawImage(img, 0, 0, base.width, base.height);
      if (img.close) img.close();
      const now = new Date();
      const g = this.gpsCoordinates;
      Object.assign(this._photo, {
        base, source,
        takenAt: now.toISOString(),
        photoDate: source === 'gallery' && file.lastModified ? new Date(file.lastModified).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        gps: g && g.latitude ? `${Number(g.latitude).toFixed(5)}, ${Number(g.longitude).toFixed(5)}${g.accuracy ? ` (±${Math.round(g.accuracy)} m)` : ''}` : ''
      });
      this.phPreview();
    } catch (err) {
      this.showToast('Could not open the photo: ' + err.message, 'error');
    }
  },

  phLoadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('unsupported photo'));
      img.src = URL.createObjectURL(file);
    });
  },

  /** Values for the stamp, from the report (on submit) or from the form (preview). */
  phStampInfo(data) {
    const form = document.getElementById(this._photo.formId);
    const val = (suffix) => { const el = form && form.querySelector(`[id$="-${suffix}"]`); return el ? el.value : ''; };
    const lo = form && form.querySelector('select[id$="-landowner"]');
    const opt = lo && lo.selectedOptions ? lo.selectedOptions[0] : null;
    const title = document.querySelector('#view-content-root .card-title');
    return {
      date: (data && data.date) || val('date') || new Date().toISOString().slice(0, 10),
      farmBlock: (data && data.farmBlock) || val('block'),
      landOwner: (data && data.landOwnersName) || (opt && opt.value ? (opt.dataset.name || opt.textContent.trim()) : ''),
      claif: (data && data.landOwnerNo) || (opt && opt.dataset ? opt.dataset.claif || '' : ''),
      parcel: (data && data.parcelNumber) || val('parcel'),
      activity: (data && data.activityType) || PH_FORMS[this._photo.formId] || (title ? title.textContent.replace(/^[^\w]+/, '').replace(/Registration$/i, '').trim() : ''),
      supervisor: (data && data.employeeName) || auth.getEmployeeName(),
      reportId: (data && data.reportId) || '(Report ID on save)'
    };
  },

  /** Draws the stamp into a copy of the photo. Returns { full, thumb } data URLs. */
  phRender(info) {
    const p = this._photo;
    const cv = document.createElement('canvas');
    cv.width = p.base.width; cv.height = p.base.height;
    const c = cv.getContext('2d');
    c.drawImage(p.base, 0, 0);
    const taken = new Date(p.takenAt);
    const d = new Date(info.date + 'T00:00:00');
    const lines = [
      `📅 ${isNaN(d) ? info.date : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}   🕒 ${taken.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`,
      `📍 ${p.gps ? 'GPS ' + p.gps : 'GPS not available'}`,
      `🌴 ${info.farmBlock || '—'} • ${info.parcel || '—'} • ${info.landOwner || '—'}${info.claif ? ` (${info.claif})` : ''}`,
      `🌿 ${info.activity} • ${info.supervisor} • ${info.reportId}`
    ];
    if (p.source === 'gallery') lines.push(`🖼️ From gallery${p.photoDate ? ' • photo date ' + p.photoDate : ''}`);
    const fs = Math.max(13, Math.round(cv.width / 34));
    const pad = Math.round(fs * 0.6), lh = Math.round(fs * 1.35);
    const h = lines.length * lh + pad * 2;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(0, cv.height - h, cv.width, h);
    c.fillStyle = '#ffffff';
    c.textBaseline = 'top';
    c.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const maxW = cv.width - pad * 2;
    lines.forEach((l, i) => {
      let t = l;
      while (c.measureText(t).width > maxW && t.length > 8) t = t.slice(0, -2);
      if (t !== l) t = t.slice(0, -1) + '…';
      c.fillText(t, pad, cv.height - h + pad + i * lh);
    });
    c.font = `800 ${fs}px system-ui, sans-serif`;
    c.textAlign = 'right';
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(cv.width - pad * 2 - c.measureText('FarmOps KPI').width, 0, cv.width, lh + pad);
    c.fillStyle = '#ffffff'; c.fillText('FarmOps KPI', cv.width - pad, pad / 2);
    const full = cv.toDataURL('image/jpeg', PH_QUALITY);
    const ts = Math.min(1, PH_THUMB_SIDE / Math.max(cv.width, cv.height));
    const tc = document.createElement('canvas');
    tc.width = Math.round(cv.width * ts); tc.height = Math.round(cv.height * ts);
    tc.getContext('2d').drawImage(cv, 0, 0, tc.width, tc.height);
    return { full, thumb: tc.toDataURL('image/jpeg', 0.6) };
  },

  phPreview() {
    const p = this._photo;
    const box = document.getElementById('ph-prev');
    if (!p || !box) return;
    if (!p.base) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const out = this.phRender(this.phStampInfo(null));
    const kb = Math.round(out.full.length * 0.75 / 1024);
    box.style.display = 'flex';
    box.innerHTML = `
      <img src="${out.full}" alt="Photo preview" />
      <div class="ph-meta">
        <span class="ph-chip ${p.source === 'gallery' ? 'ph-gal' : 'ph-cam'}">${p.source === 'gallery' ? '🖼️ From gallery' : '📷 Camera'}</span><br />
        Size: <strong>${kb} KB</strong> (${p.base.width}×${p.base.height})<br />
        The stamp is part of the photo.<br />
        <span class="ph-chip ph-wait">⏳ Uploads after the report is synced</span>
        <div class="ph-btns" style="margin-top:10px;">
          <label class="btn btn-outline">🔁 Retake<input type="file" accept="image/*" capture="environment" hidden onchange="app.phPick(this, 'camera')" /></label>
          <button type="button" class="btn btn-outline" style="color:#b91c1c;" onclick="app.phRemove()">🗑️ Remove</button>
        </div>
      </div>`;
  },

  phRemove() {
    if (this._photo) Object.assign(this._photo, { base: null, source: '' });
    this.phPreview();
  },

  /** Called by syncService.submitReportLocally (wrapped below): stamps and stores the photo with the report. */
  async phBeforeSubmit(data) {
    const p = this._photo;
    if (!p || !p.base || !document.getElementById(p.formId)) return false;
    if (!data.reportId) data.reportId = 'REP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const out = this.phRender(this.phStampInfo(data));
    const entry = {
      reportId: data.reportId, activityType: data.activityType, data: out.full.split(',')[1], thumb: out.thumb,
      source: p.source, photoDate: p.photoDate, takenAt: p.takenAt, gps: p.gps, userId: data.userId,
      status: 'WAITING', error: '', savedAt: new Date().toISOString()
    };
    await db.setSetting('photo:data:' + data.reportId, entry);
    await this.phSetQueue((await this.phQueue()).concat([data.reportId]));
    const t = await this.phThumbs();
    t[data.reportId] = { thumb: out.thumb, source: p.source === 'gallery' ? 'Gallery' : 'Camera', at: entry.savedAt, local: true };
    await this.phSaveThumbs();
    data.photo = { source: p.source === 'gallery' ? 'Gallery' : 'Camera', pending: true };
    return true;
  },

  phAfterSubmit(saved) {
    if (!saved || !saved.photo) return;
    this._photo = null;
    db.getSetting('photo:data:' + saved.reportId).then((e) => {
      if (e && !e.uniqueUuid) { e.uniqueUuid = saved.uniqueUuid; return db.setSetting('photo:data:' + saved.reportId, e); }
      return null;
    }).catch(() => {});
  },

  /* ===== upload ===== */

  /** Sends photos whose report is already on the server. Never deletes a photo that was not saved. */
  async phUploadAll() {
    if (this._phUploading || !navigator.onLine || !auth.getToken()) return { sent: 0 };
    this._phUploading = true;
    let sent = 0;
    try {
      const queue = await this.phQueue();
      if (!queue.length) return { sent: 0 };
      const pending = new Set((await db.getAll('pendingQueue')).map((r) => r.reportId));
      for (const id of queue) {
        if (pending.has(id)) continue;   // the report is not on the server yet
        const e = await db.getSetting('photo:data:' + id);
        if (!e) { await this.phSetQueue((await this.phQueue()).filter((x) => x !== id)); continue; }
        if (!auth.isAdmin() && e.userId && e.userId !== auth.getUserId()) continue;
        try {
          await syncService.apiCall('UPLOAD_REPORT_PHOTO', {
            reportId: id, uniqueUuid: e.uniqueUuid || '', activityType: e.activityType, data: e.data, thumb: e.thumb,
            source: e.source, photoDate: e.photoDate, takenAt: e.takenAt, gps: e.gps
          });
          await db.setSetting('photo:data:' + id, null);
          await this.phSetQueue((await this.phQueue()).filter((x) => x !== id));
          const t = await this.phThumbs();
          if (t[id]) { t[id].local = false; await this.phSaveThumbs(); }
          const rep = await db.get('reports', id);
          if (rep && rep.photo) { rep.photo.pending = false; await db.put('reports', rep); }
          sent++;
        } catch (err) {
          if (err.code === 'OFFLINE' || err.code === 'NETWORK') break;
          const rep = await db.get('reports', id);
          e.status = err.code === 'NOT_FOUND' && !(rep && rep.syncStatus === 'REJECTED') ? 'WAITING' : 'ERROR';
          e.error = err.message;
          await db.setSetting('photo:data:' + id, e);
        }
      }
    } finally { this._phUploading = false; }
    if (sent) this.phHydrate();
    return { sent };
  },

  /* ===== showing photos in lists ===== */

  /** Table cell for a report: thumbnail, "waiting", or "—". Synchronous (uses the thumbnails in memory). */
  photoCell(r) {
    const id = String(r.reportId || '');
    const t = this._phThumbs && this._phThumbs[id];
    if (t && t.thumb) return `<img class="ph-thumb" src="${t.thumb}" alt="Photo" title="${t.local ? 'Photo waiting to sync' : 'Open photo'}" onclick="event.stopPropagation(); app.phOpen('${this.esc(id)}')" />`;
    if (r.photo) return `<span class="ph-lazy ph-chip ${r.photo.pending ? 'ph-wait' : 'ph-cam'}" data-rid="${this.esc(id)}" style="cursor:pointer;" onclick="event.stopPropagation(); app.phOpen('${this.esc(id)}')">${r.photo.pending ? '⏳ waiting' : '📷 photo'}</span>`;
    return '<span class="ph-none">—</span>';
  },

  /** Replaces "📷 photo" chips with thumbnails (downloaded once and kept on the phone). */
  async phHydrate() {
    const t = await this.phThumbs();
    const els = [...document.querySelectorAll('.ph-lazy[data-rid]')];
    if (!els.length) return;
    const missing = [...new Set(els.map((el) => el.dataset.rid).filter((id) => !t[id]))];
    if (missing.length && navigator.onLine && auth.getToken()) {
      for (let i = 0; i < missing.length; i += 100) {
        try {
          const res = await syncService.apiCall('REPORT_PHOTO_THUMBS', { reportIds: missing.slice(i, i + 100) });
          Object.entries(res.thumbs || {}).forEach(([id, v]) => { if (v.thumb) t[id] = { thumb: v.thumb, source: v.source, at: new Date().toISOString() }; });
        } catch (err) { break; }
      }
      await this.phSaveThumbs();
    }
    els.forEach((el) => {
      const v = t[el.dataset.rid];
      if (v && v.thumb && el.isConnected) el.outerHTML = this.photoCell({ reportId: el.dataset.rid });
    });
  },

  /** Full photo viewer. Uses the copy on this phone while it waits to sync, otherwise downloads it. */
  async phOpen(reportId) {
    this.phStyle();
    const id = String(reportId);
    const t = (await this.phThumbs())[id];
    const local = await db.getSetting('photo:data:' + id);
    let src = local ? 'data:image/jpeg;base64,' + local.data : '';
    let info = local ? (local.status === 'ERROR' ? `<span class="ph-chip ph-err">⚠️ Not sent: ${this.esc(local.error)}</span>` : '<span class="ph-chip ph-wait">⏳ Waiting to sync</span>') : '';
    const source = local ? (local.source === 'gallery' ? 'Gallery' : 'Camera') : (t ? t.source : '');
    const overlay = document.createElement('div');
    overlay.className = 'ph-view';
    overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };
    const draw = () => {
      overlay.innerHTML = `<div class="ph-view-box">
        ${src ? `<img src="${src}" alt="Report photo" />` : (t && t.thumb ? `<img src="${t.thumb}" alt="Report photo (small)" />` : '<div style="padding:40px;text-align:center;color:var(--text-muted);">Loading photo…</div>')}
        <div class="ph-view-bar">
          <span><strong>${this.esc(id)}</strong> ${source ? `<span class="ph-chip ${source === 'Gallery' ? 'ph-gal' : 'ph-cam'}">${source === 'Gallery' ? '🖼️ From gallery' : '📷 Camera'}</span>` : ''} ${info}</span>
          <span style="display:flex;gap:8px;">
            ${src ? `<a class="btn btn-outline" href="${src}" download="${this.esc(id)}.jpg">⬇️ Download</a>` : ''}
            <button type="button" class="btn btn-primary">Close</button>
          </span>
        </div></div>`;
      overlay.querySelector('.btn-primary').onclick = () => overlay.remove();
    };
    draw();
    document.body.appendChild(overlay);
    if (src) return;
    if (!navigator.onLine) { info = '<span class="ph-chip ph-wait">Connect to the internet to see the full photo</span>'; draw(); return; }
    try {
      const res = await syncService.apiCall('REPORT_PHOTO', { reportId: id });
      src = 'data:image/jpeg;base64,' + res.data;
      info = res.uploadedBy ? `<span class="ph-none">by ${this.esc(res.uploadedBy)}</span>` : '';
    } catch (err) {
      info = `<span class="ph-chip ph-err">${this.esc(err.message)}</span>`;
    }
    if (overlay.isConnected) draw();
  },

  /** Photo section inside the Data Validator details. */
  async phDvSection(reportId) {
    const box = document.getElementById('dv-detail');
    if (!box || box.querySelector('.ph-dv')) return;
    const t = (await this.phThumbs())[reportId];
    const local = await db.getSetting('photo:data:' + reportId);
    const rec = (this._dvRecords || []).find((r) => r.reportId === reportId);
    const has = t || local || (rec && rec.report && rec.report.photo);
    const anchor = box.querySelector('details');
    const html = `<div class="ph-dv" style="margin:10px 0;"><div style="font-weight:700;margin-bottom:4px;">📷 Photo</div>${has
      ? `<span class="ph-lazy ph-chip ph-cam" data-rid="${this.esc(reportId)}" style="cursor:pointer;" onclick="app.phOpen('${this.esc(reportId)}')">📷 Open photo</span>`
      : '<span class="ph-none">No photo for this report.</span>'}</div>`;
    if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else box.insertAdjacentHTML('beforeend', html);
    if (t && t.thumb) box.querySelector('.ph-dv .ph-lazy').outerHTML = `<img class="ph-thumb" style="width:120px;height:90px;" src="${t.thumb}" onclick="app.phOpen('${this.esc(reportId)}')" />`;
    else if (has) this.phHydrate();
  }
});

/* ===== hooks into the existing app (no change to the forms themselves) ===== */
(function () {
  const origNavigate = FarmOpsApp.prototype.navigateTo;
  FarmOpsApp.prototype.navigateTo = async function (...args) {
    await this.phThumbs().catch(() => {});
    const res = await origNavigate.apply(this, args);
    try { this.phAttachToForm(); this.phStyle(); this.phHydrate(); } catch (err) { console.warn('[Photo]', err); }
    return res;
  };

  if (FarmOpsApp.prototype.dvOpenDetail) {
    const origDv = FarmOpsApp.prototype.dvOpenDetail;
    FarmOpsApp.prototype.dvOpenDetail = async function (reportId) {
      const res = await origDv.call(this, reportId);
      try { await this.phDvSection(reportId); } catch (err) { console.warn('[Photo] DV', err); }
      return res;
    };
  }

  const origSubmit = syncService.submitReportLocally.bind(syncService);
  syncService.submitReportLocally = async function (reportData) {
    let withPhoto = false;
    try { withPhoto = await app.phBeforeSubmit(reportData); } catch (err) { console.warn('[Photo] could not save the photo', err); app.showToast('The photo could not be saved: ' + err.message, 'error'); }
    const saved = await origSubmit(reportData);
    if (withPhoto) app.phAfterSubmit(saved);
    return saved;
  };

  const origSync = syncService.syncPendingRecords.bind(syncService);
  syncService.syncPendingRecords = async function () {
    const res = await origSync();
    app.phUploadAll().catch((err) => console.warn('[Photo] upload', err));
    return res;
  };
})();
