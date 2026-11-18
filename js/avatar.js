/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Profile Photo (v4.5.0)
 *  - Camera or gallery, move & zoom inside the circle, saved as a small square JPEG (192 px, ~15–25 KB).
 *  - Kept in the Users sheet ("Profile Photo"), downloaded with the normal sync.
 *  - Each user changes his own photo (offline too: sent at the next sync); an Administrator can change anyone's.
 *
 * Load AFTER app.js and sync.js in index.html:  <script src="js/avatar.js"></script>
 */

const AV_SIZE = 192;
const AV_VIEW = 280;

Object.assign(FarmOpsApp.prototype, {

  /** Photo to show for a user: a photo waiting to sync on this phone wins, then the saved one. */
  avatarSrc(u) {
    if (!u) return '';
    const p = this._avPending;
    if (p && p.userId === u.userId) return p.photo || '';
    return u.photo || '';
  },

  avatarHtml(u, px = 38) {
    const src = this.avatarSrc(u);
    const name = (u && (u.fullName || u.username)) || '?';
    const size = `width:${px}px;height:${px}px;min-width:${px}px;font-size:${Math.round(px * 0.4)}px;`;
    return src
      ? `<img src="${src}" alt="${this.esc(name)}" class="av-img" style="${size}border-radius:50%;object-fit:cover;display:block;border:2px solid #fff;box-shadow:0 0 0 1px var(--border);" />`
      : `<div class="user-avatar" style="${size}">${this.esc(name.charAt(0).toUpperCase())}</div>`;
  },

  async avatarLoadPending() {
    const p = await db.getSetting('avatar:pending');
    this._avPending = p && p.userId ? p : null;
    return this._avPending;
  },

  /* ===== editor (move & zoom) ===== */

  avatarOpenEditor(userId) {
    const ov = document.createElement('div');
    ov.className = 'av-editor';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.75);z-index:3100;display:flex;align-items:center;justify-content:center;padding:14px;';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:360px;width:100%;padding:18px;">
        <div style="font-weight:800;font-size:16px;margin-bottom:4px;">📷 Profile Photo</div>
        <div class="form-helper" style="margin-bottom:12px;">Take or choose a photo, then drag it and zoom so the face fits the circle.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <label class="btn btn-primary" style="margin:0;cursor:pointer;">📷 Take Photo<input type="file" accept="image/*" capture="user" hidden /></label>
          <label class="btn btn-outline" style="margin:0;cursor:pointer;">🖼️ Gallery<input type="file" accept="image/*" hidden /></label>
        </div>
        <div style="position:relative;width:${AV_VIEW}px;height:${AV_VIEW}px;max-width:100%;margin:0 auto;border-radius:12px;overflow:hidden;background:#f1f5f9;touch-action:none;">
          <canvas width="${AV_VIEW}" height="${AV_VIEW}" style="width:100%;height:100%;display:block;cursor:grab;"></canvas>
          <div style="position:absolute;inset:0;pointer-events:none;box-shadow:0 0 0 999px rgba(15,23,42,.45) inset;-webkit-mask:radial-gradient(circle at center, transparent 49.5%, #000 50%);mask:radial-gradient(circle at center, transparent 49.5%, #000 50%);"></div>
          <div class="av-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:13px;pointer-events:none;">No photo chosen</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin:12px 0;font-size:13px;">🔍<input type="range" class="av-zoom" min="1" max="4" step="0.01" value="1" style="flex:1;" disabled /></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn btn-outline av-cancel">Cancel</button>
          <button type="button" class="btn btn-primary av-save" disabled>💾 Save Photo</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas');
    const ctx = cv.getContext('2d');
    const zoomEl = ov.querySelector('.av-zoom');
    const st = { img: null, zoom: 1, x: 0, y: 0, base: 1 };
    const draw = () => {
      ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, 0, AV_VIEW, AV_VIEW);
      if (!st.img) return;
      const s = st.base * st.zoom;
      const w = st.img.width * s, h = st.img.height * s;
      // keep the circle covered
      st.x = Math.min(0, Math.max(AV_VIEW - w, st.x));
      st.y = Math.min(0, Math.max(AV_VIEW - h, st.y));
      ctx.drawImage(st.img, st.x, st.y, w, h);
    };
    const load = async (file) => {
      if (!file || !/^image\//.test(file.type)) return;
      try {
        st.img = this.phLoadImage ? await this.phLoadImage(file) : await createImageBitmap(file);
      } catch (err) { this.showToast('Could not open the photo.', 'error'); return; }
      st.base = AV_VIEW / Math.min(st.img.width, st.img.height);
      st.zoom = 1; zoomEl.value = 1; zoomEl.disabled = false;
      st.x = (AV_VIEW - st.img.width * st.base) / 2; st.y = (AV_VIEW - st.img.height * st.base) / 2;
      ov.querySelector('.av-empty').style.display = 'none';
      ov.querySelector('.av-save').disabled = false;
      draw();
    };
    ov.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', () => { load(inp.files[0]); inp.value = ''; }));
    zoomEl.addEventListener('input', () => {
      const old = st.base * st.zoom;
      st.zoom = parseFloat(zoomEl.value);
      const now = st.base * st.zoom, c = AV_VIEW / 2;
      st.x = c - (c - st.x) * now / old; st.y = c - (c - st.y) * now / old;
      draw();
    });
    let drag = null;
    const scaleOf = () => AV_VIEW / cv.getBoundingClientRect().width;
    cv.addEventListener('pointerdown', (ev) => { if (!st.img) return; drag = { x: ev.clientX, y: ev.clientY }; cv.setPointerCapture(ev.pointerId); });
    cv.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const k = scaleOf();
      st.x += (ev.clientX - drag.x) * k; st.y += (ev.clientY - drag.y) * k;
      drag = { x: ev.clientX, y: ev.clientY };
      draw();
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', (ev) => { if (!st.img) return; ev.preventDefault(); zoomEl.value = Math.min(4, Math.max(1, st.zoom - ev.deltaY / 500)); zoomEl.dispatchEvent(new Event('input')); }, { passive: false });
    ov.querySelector('.av-cancel').onclick = () => ov.remove();
    ov.addEventListener('click', (ev) => { if (ev.target === ov) ov.remove(); });
    ov.querySelector('.av-save').onclick = async () => {
      const out = document.createElement('canvas');
      out.width = AV_SIZE; out.height = AV_SIZE;
      const k = AV_SIZE / AV_VIEW, s = st.base * st.zoom;
      out.getContext('2d').drawImage(st.img, st.x * k, st.y * k, st.img.width * s * k, st.img.height * s * k);
      let photo = out.toDataURL('image/jpeg', 0.8);
      if (photo.length > 38000) photo = out.toDataURL('image/jpeg', 0.6);
      const btn = ov.querySelector('.av-save');
      btn.disabled = true;
      if (await this.avatarSave(userId, photo)) ov.remove(); else btn.disabled = false;
    };
  },

  async avatarRemove(userId) {
    if (!confirm('Remove the profile photo?')) return;
    await this.avatarSave(userId, '');
  },

  /** Saves on the server (or on this phone until the next sync, for your own photo). */
  async avatarSave(userId, photo) {
    const mine = userId === auth.getUserId();
    if (!navigator.onLine) {
      if (!mine) { this.showToast('Changing another user\'s photo needs internet.', 'warning'); return false; }
      this._avPending = { userId, photo, at: new Date().toISOString() };
      await db.setSetting('avatar:pending', this._avPending);
      this.showToast('Photo saved on this phone. It will be sent at the next sync.', 'info');
      this.avatarRefresh(userId);
      return true;
    }
    try {
      const res = await syncService.apiCall('SET_PROFILE_PHOTO', { userId, photo });
      if (mine) {
        await auth.updateProfile({ ...auth.getCurrentUser(), photo: res.photo });
        if (this._avPending && this._avPending.userId === userId) { this._avPending = null; await db.setSetting('avatar:pending', null); }
      }
      const dirUser = await db.get('userDirectory', userId).catch(() => null);
      if (dirUser) await db.put('userDirectory', { ...dirUser, photo: res.photo });
      if (this._userModal && this._userModal.user && this._userModal.user.userId === userId) this._userModal.user.photo = res.photo;
      this.showToast(res.message || 'Saved.', 'success');
      this.avatarRefresh(userId);
      return true;
    } catch (err) {
      this.showToast(err.message, 'error');
      return false;
    }
  },

  /** Redraws what shows the photo. */
  avatarRefresh(userId) {
    this.renderUserMetaHeader();
    const modalBox = document.getElementById('av-modal-box');
    if (modalBox && this._userModal && this._userModal.user && this._userModal.user.userId === userId) modalBox.outerHTML = this.avatarModalBox(this._userModal.user);
    if (this.currentView === 'profile' || this.currentView === 'user-management') this.navigateTo(this.currentView);
  },

  /** Sends a photo changed offline. */
  async avatarSyncPending() {
    const p = this._avPending || await this.avatarLoadPending();
    if (!p || !navigator.onLine || !auth.getToken() || p.userId !== auth.getUserId()) return;
    try {
      const res = await syncService.apiCall('SET_PROFILE_PHOTO', { userId: p.userId, photo: p.photo });
      await auth.updateProfile({ ...auth.getCurrentUser(), photo: res.photo });
      this._avPending = null;
      await db.setSetting('avatar:pending', null);
      this.renderUserMetaHeader();
    } catch (err) { console.warn('[Avatar] not sent yet:', err.message); }
  },

  avatarModalBox(u) {
    return `<div id="av-modal-box" style="display:flex;align-items:center;gap:14px;padding:10px 12px;margin-bottom:14px;background:var(--bg-hover, #f8fafc);border-radius:12px;">
      ${this.avatarHtml(u, 56)}
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-outline" style="padding:6px 12px;font-size:13px;" onclick="app.avatarOpenEditor('${this.esc(u.userId)}')">📷 ${this.avatarSrc(u) ? 'Change' : 'Add'} Photo</button>
        ${this.avatarSrc(u) ? `<button type="button" class="btn btn-outline" style="padding:6px 12px;font-size:13px;color:#b91c1c;" onclick="app.avatarRemove('${this.esc(u.userId)}')">🗑️ Remove</button>` : ''}
      </div></div>`;
  }
});

/* ===== hooks ===== */
(function () {
  app.avatarLoadPending().then(() => app.renderUserMetaHeader()).catch(() => {});

  const origOpenUser = FarmOpsApp.prototype.openUserModal;
  FarmOpsApp.prototype.openUserModal = async function (...args) {
    const res = await origOpenUser.apply(this, args);
    try {
      const u = this._userModal && this._userModal.user;
      const body = document.getElementById('form-modal-body');
      if (u && body && !document.getElementById('av-modal-box')) body.insertAdjacentHTML('afterbegin', this.avatarModalBox(u));
    } catch (err) { console.warn('[Avatar]', err); }
    return res;
  };

  const origSync = syncService.syncPendingRecords.bind(syncService);
  syncService.syncPendingRecords = async function () {
    const res = await origSync();
    app.avatarSyncPending().catch(() => {});
    return res;
  };
})();
