/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Job Orders + In-App Notifications (v4.0)
 *
 * - A job order belongs to ONE Farm & Block. People only see job orders of their own
 *   Farm & Blocks (Administrator sees all) — the same rule as the rest of FarmOps.
 * - Flow: PENDING → RECEIVED (claimed) → IN PROGRESS → CLOSED  (Reopen / Cancel by supervisor or admin)
 * - Works OFFLINE: every action is saved on the phone first and sent with JO_SYNC when online.
 * - Notifications are shown INSIDE the app (🔔 bell, Notifications page, dashboard banner);
 *   no e-mail needed. Overdue reminders are worked out on the phone, so they also appear offline.
 *
 * Load this file AFTER app.js in index.html:  <script src="js/jo.js"></script>
 */

const JO_STATUS_STYLE = {
  'PENDING': { color: '#b45309', bg: '#fef3c7', label: 'Pending' },
  'RECEIVED': { color: '#1d4ed8', bg: '#dbeafe', label: 'Received' },
  'IN PROGRESS': { color: '#6d28d9', bg: '#ede9fe', label: 'In Progress' },
  'CLOSED': { color: '#15803d', bg: '#dcfce7', label: 'Closed' },
  'CANCELLED': { color: '#64748b', bg: '#f1f5f9', label: 'Cancelled' }
};
const JO_PRIORITY_STYLE = {
  'Urgent': { color: '#991b1b', bg: '#fee2e2' },
  'High': { color: '#9a3412', bg: '#ffedd5' },
  'Normal': { color: '#166534', bg: '#dcfce7' },
  'Low': { color: '#475569', bg: '#f1f5f9' }
};
const JO_PRIORITY_ORDER = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
const JO_SYNC_EVERY_MS = 2 * 60 * 1000;

Object.assign(FarmOpsApp.prototype, {

  /* ------------------------------------------------------------------ storage (per user, on this device) */
  joKey(name) { return `jo:${auth.getUserId() || 'guest'}:${name}`; },

  async joLoad() {
    const uid = auth.getUserId();
    if (this._jo && this._jo.userId === uid) return this._jo;
    const cache = (await db.getSetting(this.joKey('cache'))) || {};
    this._jo = {
      userId: uid,
      jobOrders: cache.jobOrders || [],
      responses: cache.responses || [],
      notifications: cache.notifications || [],
      assignees: cache.assignees || [],
      serverTime: cache.serverTime || '',
      queue: (await db.getSetting(this.joKey('queue'))) || [],
      localRead: (await db.getSetting(this.joKey('localRead'))) || {},     // notification / overdue ids read on this phone
      failed: (await db.getSetting(this.joKey('failed'))) || [],           // actions the server refused (shown as notifications)
      filter: { q: '', status: 'OPEN', priority: 'ALL', fb: 'ALL', mine: false }
    };
    return this._jo;
  },

  async joSave(parts = ['cache', 'queue', 'localRead', 'failed']) {
    const s = this._jo;
    if (!s) return;
    if (parts.includes('cache')) {
      await db.setSetting(this.joKey('cache'), { jobOrders: s.jobOrders, responses: s.responses, notifications: s.notifications, assignees: s.assignees, serverTime: s.serverTime });
    }
    if (parts.includes('queue')) await db.setSetting(this.joKey('queue'), s.queue);
    if (parts.includes('localRead')) await db.setSetting(this.joKey('localRead'), s.localRead);
    if (parts.includes('failed')) await db.setSetting(this.joKey('failed'), s.failed.slice(0, 50));
  },

  /* ------------------------------------------------------------------ start (after login / app start) */
  async joStart() {
    if (!auth.isAuthenticated()) return;
    this._jo = null;
    await this.joLoad();
    this.joInjectUi();
    this.joUpdateBell();
    if (!this._joTimer) {
      this._joTimer = setInterval(() => this.joSync(true), JO_SYNC_EVERY_MS);
      window.addEventListener('online', () => setTimeout(() => this.joSync(true), 1500));
    }
    this.joSync(true);
  },

  joInjectUi() {
    if (!document.getElementById('jo-style')) {
      document.head.insertAdjacentHTML('beforeend', `<style id="jo-style">
        #jo-bell { position: relative; }
        #jo-bell .jo-bell-count { position:absolute; top:-6px; right:-6px; min-width:18px; height:18px; padding:0 5px; border-radius:9px;
          background:#dc2626; color:#fff; font-size:11px; font-weight:800; line-height:18px; text-align:center; display:none; }
        .jo-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }
        .jo-card { background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:14px 16px; cursor:pointer;
          border-top:4px solid var(--border); box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:6px; }
        .jo-card:hover { box-shadow:var(--shadow-md); }
        .jo-pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:800; letter-spacing:.3px; white-space:nowrap; }
        .jo-meta { font-size:12px; color:var(--text-muted); }
        .jo-overdue { color:#b91c1c; font-weight:800; }
        .jo-pending-sync { background:#fff7ed; color:#9a3412; border:1px dashed #fdba74; }
        .jo-timeline { display:flex; flex-direction:column; gap:10px; max-height:320px; overflow:auto; padding-right:4px; }
        .jo-ev { border-left:3px solid var(--palm-border); padding:6px 10px; background:var(--bg-hover); border-radius:6px; font-size:13px; }
        .jo-ev.pending { border-left-color:#f59e0b; background:#fffbeb; }
        .jo-ev small { color:var(--text-muted); display:block; font-size:11px; }
        .jo-info { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; margin:10px 0; }
        .jo-info div { background:var(--bg-hover); border-radius:6px; padding:6px 10px; font-size:13px; }
        .jo-info b { display:block; font-size:10.5px; text-transform:uppercase; color:var(--text-muted); letter-spacing:.4px; }
        .jo-actions { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0; }
        .jo-actions .btn { flex:1 1 140px; }
        .jo-notif { display:flex; gap:12px; align-items:flex-start; padding:12px 14px; border-bottom:1px solid var(--border); cursor:pointer; }
        .jo-notif.unread { background:#f0fdf4; }
        .jo-notif.unread .jo-dot { background:#16a34a; }
        .jo-dot { width:9px; height:9px; border-radius:50%; margin-top:6px; background:transparent; flex:0 0 9px; }
        .jo-banner { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; cursor:pointer;
          background:linear-gradient(90deg,#f0fdf4,#fefce8); border:1px solid var(--palm-border); }
        @media (max-width: 540px) { .jo-grid { grid-template-columns:1fr; } }
      </style>`);
    }
    if (!document.getElementById('jo-bell')) {
      const right = document.querySelector('.top-bar-right');
      const settings = document.getElementById('settings-btn');
      if (right) {
        const btn = document.createElement('button');
        btn.id = 'jo-bell';
        btn.className = 'btn btn-outline btn-icon';
        btn.title = 'Notifications';
        btn.setAttribute('aria-label', 'Notifications');
        btn.innerHTML = '🔔<span class="jo-bell-count"></span>';
        btn.onclick = () => this.navigateTo('notifications');
        if (settings) right.insertBefore(btn, settings); else right.appendChild(btn);
      }
    }
  },

  /* ------------------------------------------------------------------ helpers */
  joMyCodes() {
    if (auth.hasAllBlocks()) return null;   // all
    return new Set(auth.getAuthorizedBlocks().map((b) => this.farmBlockInfo(b).code));
  },

  joCanCreate() { return auth.isAdmin() || auth.isSupervisor(); },

  joIsBoss(jo) {
    if (auth.isAdmin()) return true;
    const codes = this.joMyCodes();
    return auth.isSupervisor() && (!codes || codes.has(jo.farmBlockCode));
  },

  joToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  joIsOverdue(jo) {
    return !!jo.dueDate && jo.dueDate < this.joToday() && !['CLOSED', 'CANCELLED'].includes(jo.status);
  },

  joPill(text, style) {
    return `<span class="jo-pill" style="color:${style.color};background:${style.bg};">${this.esc(text)}</span>`;
  },

  joStatusPill(status) { return this.joPill((JO_STATUS_STYLE[status] || JO_STATUS_STYLE.PENDING).label, JO_STATUS_STYLE[status] || JO_STATUS_STYLE.PENDING); },
  joPriorityPill(p) { return this.joPill(p || 'Normal', JO_PRIORITY_STYLE[p] || JO_PRIORITY_STYLE.Normal); },

  joFmt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return this.esc(iso);
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  },

  joUuid() { return syncService.generateUUID(); },

  /** Job orders as shown on this phone = server copy + actions still waiting to be sent. */
  joView() {
    const s = this._jo;
    const list = s.jobOrders.map((j) => ({ ...j, pendingActions: [] }));
    const byCode = new Map(list.map((j) => [j.joCode, j]));
    const me = auth.getCurrentUser() || {};
    s.queue.forEach((tx) => {
      if (tx.type === 'NOTIF_READ') return;
      let jo = byCode.get(tx.joCode);
      if (tx.type === 'CREATE' && !jo) {
        const d = tx.data;
        const blk = auth.getAuthorizedBlocks().find((b) => this.farmBlockInfo(b).code === d.farmBlockCode) || {};
        const ent = d.recordId ? auth.getAuthorizedBlocks().find((b) => b.recordId === d.recordId) : null;
        const asg = s.assignees.find((u) => u.userId === d.assignedTo);
        jo = {
          joCode: tx.joCode, title: d.title, description: d.description, farmBlockCode: d.farmBlockCode,
          farmBlock: blk.farmBlockName ? this.farmBlockInfo(blk).full : d.farmBlockCode, recordId: d.recordId || '',
          landOwner: ent ? ent.landOwnerName : '', landOwnerNo: ent ? ent.landOwnerNo : '', parcelNumber: ent ? ent.parcelNumber : '',
          priority: d.priority, dueDate: d.dueDate, status: 'PENDING', createdBy: me.userId, createdByName: me.fullName,
          createdAt: tx.clientTime, assignedTo: d.assignedTo || '', assignedToName: asg ? asg.fullName : '', lastUpdated: tx.clientTime,
          pendingActions: [], isLocal: true
        };
        list.push(jo); byCode.set(jo.joCode, jo);
      }
      if (!jo) return;
      jo.pendingActions.push(tx);
      // optimistic status so the screen matches what the user just did
      const next = { CLAIM: 'RECEIVED', START: 'IN PROGRESS', CLOSE: 'CLOSED', REOPEN: 'IN PROGRESS', CANCEL: 'CANCELLED' }[tx.type];
      if (next) jo.status = next;
      if (tx.type === 'CLAIM') { jo.claimedBy = me.userId; jo.claimedByName = me.fullName; if (!jo.assignedTo) { jo.assignedTo = me.userId; jo.assignedToName = me.fullName; } }
      if (tx.type === 'EDIT') {
        ['title', 'description', 'priority', 'dueDate'].forEach((k) => { if (tx.data[k] !== undefined) jo[k] = tx.data[k]; });
        if (tx.data.assignedTo !== undefined) {
          const asg = s.assignees.find((u) => u.userId === tx.data.assignedTo);
          jo.assignedTo = tx.data.assignedTo; jo.assignedToName = asg ? asg.fullName : '';
        }
      }
      jo.lastUpdated = tx.clientTime;
    });
    return list;
  },

  /* ------------------------------------------------------------------ offline queue */
  async joQueueAction(type, joCode, data = {}, message = 'Saved.') {
    await this.joLoad();
    const tx = {
      syncId: this.joUuid(), type, joCode, data,
      deviceId: syncService.getDeviceId(), clientTime: new Date().toISOString()
    };
    this._jo.queue.push(tx);
    await this.joSave(['queue']);
    const online = navigator.onLine;
    this.showToast(online ? message : `${message} Saved on this phone — it will be sent when you are online.`, online ? 'success' : 'warning');
    this.joUpdateBell();
    this.joRefreshScreens();
    if (online) this.joSync(true);
    return tx;
  },

  /** Send waiting actions and download job orders + notifications. */
  async joSync(quiet = false) {
    if (this._joSyncing || !navigator.onLine || !auth.getToken()) return;
    const user = auth.getCurrentUser();
    if (!user || user.isOfflineSession) return;
    await this.joLoad();
    this._joSyncing = true;
    const s = this._jo;
    try {
      // send in parts (photos make a request big)
      let guard = 0;
      do {
        const batch = [];
        let size = 0;
        for (const tx of s.queue) {
          const n = JSON.stringify(tx).length;
          if (batch.length && (size + n > 6 * 1024 * 1024 || batch.length >= 50)) break;
          batch.push(tx); size += n;
        }
        const before = new Set(s.notifications.filter((n) => !n.readAt).map((n) => n.notificationId));
        const res = await syncService.apiCall('JO_SYNC', { actions: batch });
        const done = new Set();
        (res.results || []).forEach((r) => {
          done.add(r.syncId);
          if (!r.ok) {
            const tx = batch.find((x) => x.syncId === r.syncId) || {};
            s.failed.unshift({ id: `FAIL-${r.syncId}`, joCode: tx.joCode, type: tx.type, message: r.message, conflict: !!r.conflict, at: new Date().toISOString() });
            this.showToast(`${r.conflict ? 'Conflict' : 'Not saved'}: ${r.message}`, 'warning');
          }
        });
        s.queue = s.queue.filter((tx) => !done.has(tx.syncId));
        // offline-created job orders got their real number: update the actions still waiting
        const map = res.codeMap || {};
        s.queue.forEach((tx) => { if (map[tx.joCode]) tx.joCode = map[tx.joCode]; });
        s.failed.forEach((f) => { if (map[f.joCode]) f.joCode = map[f.joCode]; });
        if (this._joOpen && map[this._joOpen]) this._joOpen = map[this._joOpen];
        s.jobOrders = res.jobOrders || [];
        s.responses = res.responses || [];
        s.notifications = res.notifications || [];
        s.assignees = res.assignees || [];
        s.serverTime = res.serverTime || '';
        await this.joSave();
        const fresh = s.notifications.filter((n) => !n.readAt && !before.has(n.notificationId) && !s.localRead[n.notificationId]);
        if (fresh.length) {
          this.showToast(fresh.length === 1 ? `🔔 ${fresh[0].message}` : `🔔 You have ${fresh.length} new job order notifications.`, 'info');
          if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
        }
        guard++;
      } while (s.queue.length && guard < 10);
      this.joUpdateBell();
      this.joRefreshScreens();
      if (!quiet) this.showToast('Job orders are up to date.', 'success');
    } catch (err) {
      if (!quiet) this.showToast(`Job orders: ${err.message}`, 'warning');
      console.warn('[JobOrders] sync', err);
    } finally {
      this._joSyncing = false;
    }
  },

  joRefreshScreens() {
    if (this.currentView === 'job-orders') this.joRenderList();
    if (this.currentView === 'notifications') this.renderNotificationsView(document.getElementById('view-content-root'));
    if (this._joOpen && document.getElementById('form-modal')?.classList.contains('active') && document.getElementById('jo-detail')) {
      this.openJobOrder(this._joOpen, true);
    }
  },

  /* ------------------------------------------------------------------ notifications */
  /** Server notifications + overdue reminders (made on the phone) + refused actions. */
  joNotificationList() {
    const s = this._jo;
    if (!s) return [];
    const pendingRead = new Set();
    let pendingAll = false;
    s.queue.filter((tx) => tx.type === 'NOTIF_READ').forEach((tx) => {
      if (tx.data.all) pendingAll = true;
      (tx.data.ids || []).forEach((id) => pendingRead.add(id));
    });
    const list = s.notifications.map((n) => ({
      id: n.notificationId, joCode: n.joCode, type: n.type, message: n.message, at: n.createdAt,
      unread: !n.readAt && !pendingAll && !pendingRead.has(n.notificationId) && !s.localRead[n.notificationId], server: true
    }));
    this.joView().filter((j) => this.joIsOverdue(j)).forEach((j) => {
      const id = `OVERDUE:${j.joCode}:${j.dueDate}:${this.joToday()}`;   // reminds again each day
      list.push({ id, joCode: j.joCode, type: 'OVERDUE', message: `Overdue: ${j.joCode} — ${j.title} (due ${j.dueDate}, ${j.farmBlock})`, at: `${this.joToday()}T00:00:00`, unread: !s.localRead[id] });
    });
    s.failed.forEach((f) => list.push({ id: f.id, joCode: f.joCode, type: f.conflict ? 'CONFLICT' : 'ERROR', message: `${f.type} ${f.joCode || ''} was not saved: ${f.message}`, at: f.at, unread: !s.localRead[f.id] }));
    return list.sort((a, b) => (b.unread - a.unread) || String(b.at).localeCompare(String(a.at)));
  },

  joUnreadCount() { return this.joNotificationList().filter((n) => n.unread).length; },

  joUpdateBell() {
    const el = document.querySelector('#jo-bell .jo-bell-count');
    if (!el) return;
    const n = this._jo ? this.joUnreadCount() : 0;
    el.textContent = n > 99 ? '99+' : String(n);
    el.style.display = n ? 'inline-block' : 'none';
  },

  async joMarkRead(ids, all = false) {
    const s = this._jo;
    const serverIds = [];
    this.joNotificationList().filter((n) => n.unread && (all || ids.includes(n.id))).forEach((n) => {
      s.localRead[n.id] = new Date().toISOString();
      if (n.server) serverIds.push(n.id);
    });
    await this.joSave(['localRead']);
    if (serverIds.length) {
      s.queue.push({ syncId: this.joUuid(), type: 'NOTIF_READ', joCode: '-', data: all ? { all: true } : { ids: serverIds }, deviceId: syncService.getDeviceId(), clientTime: new Date().toISOString() });
      await this.joSave(['queue']);
      if (navigator.onLine) this.joSync(true);
    }
    this.joUpdateBell();
  },

  async renderNotificationsView(container) {
    if (!container) return;
    await this.joLoad();
    const e = (v) => this.esc(v);
    const list = this.joNotificationList();
    const icon = { NEW: '🆕', ASSIGNED: '👤', CLAIMED: '📥', STARTED: '🛠️', RESPONSE: '💬', CLOSED: '✅', REOPENED: '🔁', CANCELLED: '🚫', OVERDUE: '⏰', CONFLICT: '⚠️', ERROR: '⚠️' };
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text-main);">Notifications</h2>
          <p style="font-size:13px;color:var(--text-muted);">Job order updates for your Farm &amp; Blocks. New ones arrive each time this phone syncs.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-outline" onclick="app.joSync(false)">⬇️ Check now</button>
          <button class="btn btn-primary" onclick="app.joMarkRead([], true).then(() => app.navigateTo('notifications'))">✓ Mark all read</button>
        </div>
      </div>
      ${this._jo.queue.length ? `<div class="card jo-pending-sync" style="margin-bottom:12px;font-size:13px;">⏳ ${this._jo.queue.length} job order action(s) waiting to be sent. They are sent automatically when you are online.</div>` : ''}
      <div class="card" style="padding:0;overflow:hidden;">
        ${list.length ? list.map((n) => `
          <div class="jo-notif ${n.unread ? 'unread' : ''}" onclick="app.joOpenNotification('${e(n.id)}', '${e(n.joCode || '')}')">
            <span class="jo-dot"></span>
            <span style="font-size:20px;">${icon[n.type] || '🔔'}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13.5px;${n.unread ? 'font-weight:700;' : ''}">${e(n.message)}</div>
              <div class="jo-meta">${n.type === 'OVERDUE' ? 'Today' : this.joFmt(n.at)}</div>
            </div>
          </div>`).join('') : '<div style="padding:30px;text-align:center;color:var(--text-muted);">No notifications yet.</div>'}
      </div>`;
  },

  async joOpenNotification(id, joCode) {
    await this.joMarkRead([id]);
    if (joCode && joCode !== '-' && this.joView().some((j) => j.joCode === joCode)) this.openJobOrder(joCode);
    else this.navigateTo('notifications');
  },

  /* ------------------------------------------------------------------ dashboard banner */
  async renderJobOrderDashboardCard(container) {
    await this.joLoad();
    const all = this.joView();
    const open = all.filter((j) => !['CLOSED', 'CANCELLED'].includes(j.status));
    const overdue = open.filter((j) => this.joIsOverdue(j)).length;
    const me = auth.getUserId();
    const mine = open.filter((j) => j.assignedTo === me || j.claimedBy === me).length;
    const unread = this.joUnreadCount();
    if (!all.length && !unread && !this.joCanCreate()) return;
    const html = `
      <div class="card jo-banner" style="margin-bottom:22px;" onclick="app.navigateTo('job-orders')">
        <div>
          <div class="card-title">🛠️ Job Orders</div>
          <div class="card-subtitle">${auth.isAdmin() ? 'All Farm &amp; Blocks' : 'Your Farm &amp; Blocks'} &bull; tap to open</div>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;">
          <span><strong style="font-size:18px;">${open.length}</strong> open</span>
          <span class="${overdue ? 'jo-overdue' : ''}"><strong style="font-size:18px;">${overdue}</strong> overdue</span>
          <span><strong style="font-size:18px;">${mine}</strong> mine</span>
          <span><strong style="font-size:18px;color:${unread ? '#dc2626' : 'inherit'};">${unread}</strong> 🔔 new</span>
        </div>
      </div>`;
    const anchor = container.querySelector('.stats-grid');
    if (anchor) anchor.insertAdjacentHTML('beforebegin', html);
    else container.insertAdjacentHTML('afterbegin', html);
  },

  /* ------------------------------------------------------------------ list page */
  async renderJobOrdersView(container) {
    await auth.refreshScope();
    await this.joLoad();
    const e = (v) => this.esc(v);
    const f = this._jo.filter;
    const catalog = this.buildFarmBlockCatalog(auth.getAuthorizedBlocks());
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text-main);">Job Orders</h2>
          <p style="font-size:13px;color:var(--text-muted);">${auth.isAdmin() ? 'All Farm &amp; Blocks.' : 'Only job orders of your Farm &amp; Blocks.'} Works offline — actions are sent when you are online.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="app.joSync(false)">⬇️ Sync</button>
          ${this.joCanCreate() ? '<button class="btn btn-primary" onclick="app.openJobOrderForm()">+ New Job Order</button>' : ''}
        </div>
      </div>
      <div id="jo-summary"></div>
      <div class="filter-toolbar">
        <input type="text" id="jo-q" class="form-control" placeholder="🔍 Search code, title, land owner, parcel..." value="${e(f.q)}" oninput="app._jo.filter.q=this.value; app.joRenderList()" />
        <select class="form-control" onchange="app._jo.filter.status=this.value; app.joRenderList()">
          ${[['OPEN', 'Open (not closed)'], ['ALL', 'All statuses'], ['PENDING', 'Pending'], ['RECEIVED', 'Received'], ['IN PROGRESS', 'In Progress'], ['OVERDUE', 'Overdue'], ['CLOSED', 'Closed'], ['CANCELLED', 'Cancelled']]
            .map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select class="form-control" onchange="app._jo.filter.priority=this.value; app.joRenderList()">
          <option value="ALL">All priorities</option>
          ${['Urgent', 'High', 'Normal', 'Low'].map((p) => `<option value="${p}" ${f.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <select class="form-control" onchange="app._jo.filter.fb=this.value; app.joRenderList()">
          <option value="ALL">All Farm &amp; Blocks</option>
          ${catalog.farms.map((fm) => fm.blocks.map((b) => `<option value="${e(b.code)}" ${f.fb === b.code ? 'selected' : ''}>${e(b.full)}</option>`).join('')).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap;">
          <input type="checkbox" ${f.mine ? 'checked' : ''} onchange="app._jo.filter.mine=this.checked; app.joRenderList()" /> Assigned to me
        </label>
      </div>
      <div id="jo-list"></div>`;
    this.joRenderList();
    if (navigator.onLine && !this._joSyncing) this.joSync(true);
  },

  joRenderList() {
    const box = document.getElementById('jo-list');
    if (!box || !this._jo) return;
    const e = (v) => this.esc(v);
    const f = this._jo.filter;
    const me = auth.getUserId();
    const all = this.joView();
    const q = f.q.trim().toLowerCase();
    const list = all.filter((j) => {
      if (f.status === 'OPEN' && ['CLOSED', 'CANCELLED'].includes(j.status)) return false;
      if (f.status === 'OVERDUE' && !this.joIsOverdue(j)) return false;
      if (!['ALL', 'OPEN', 'OVERDUE'].includes(f.status) && j.status !== f.status) return false;
      if (f.priority !== 'ALL' && j.priority !== f.priority) return false;
      if (f.fb !== 'ALL' && j.farmBlockCode !== f.fb) return false;
      if (f.mine && j.assignedTo !== me && j.claimedBy !== me) return false;
      if (q && ![j.joCode, j.title, j.description, j.landOwner, j.landOwnerNo, j.parcelNumber, j.farmBlock, j.assignedToName].join(' ').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (this.joIsOverdue(b) - this.joIsOverdue(a)) ||
      ((JO_PRIORITY_ORDER[a.priority] ?? 2) - (JO_PRIORITY_ORDER[b.priority] ?? 2)) ||
      String(b.lastUpdated).localeCompare(String(a.lastUpdated)));

    const count = (st) => all.filter((j) => j.status === st).length;
    const sum = document.getElementById('jo-summary');
    if (sum) {
      sum.innerHTML = `<div class="stats-grid">
        ${[['PENDING', '🆕'], ['RECEIVED', '📥'], ['IN PROGRESS', '🛠️'], ['CLOSED', '✅']].map(([st, ic]) => `
          <div class="stat-card" style="cursor:pointer;" onclick="app._jo.filter.status='${st}'; app.navigateTo('job-orders')"><div class="stat-icon green">${ic}</div><div class="stat-info">
            <div class="stat-label">${JO_STATUS_STYLE[st].label}</div><div class="stat-value">${count(st)}</div></div></div>`).join('')}
      </div>
      ${all.some((j) => this.joIsOverdue(j)) ? `<div class="card" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;margin-bottom:14px;cursor:pointer;font-size:13.5px;"
        onclick="app._jo.filter.status='OVERDUE'; app.navigateTo('job-orders')">⏰ <strong>${all.filter((j) => this.joIsOverdue(j)).length}</strong> job order(s) are overdue — tap to see them.</div>` : ''}`;
    }

    box.innerHTML = list.length ? `<div class="jo-grid">${list.map((j) => {
      const st = JO_STATUS_STYLE[j.status] || JO_STATUS_STYLE.PENDING;
      return `
        <div class="jo-card" style="border-top-color:${st.color};" onclick="app.openJobOrder('${e(j.joCode)}')">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <strong style="font-size:13px;color:var(--palm-dark);">${j.isLocal ? 'New (not sent yet)' : e(j.joCode)}</strong>
            <span>${this.joPriorityPill(j.priority)} ${this.joStatusPill(j.status)}</span>
          </div>
          <div style="font-weight:700;font-size:15px;">${e(j.title)}</div>
          <div class="jo-meta">🌴 ${e(j.farmBlock)}${j.landOwner ? ` &bull; ${e(j.landOwner)}${j.landOwnerNo ? ` (${e(j.landOwnerNo)})` : ''} › ${e(j.parcelNumber)}` : ''}</div>
          <div class="jo-meta">👤 ${j.assignedToName ? e(j.assignedToName) : '<em>anyone in the block can claim</em>'}
            ${j.dueDate ? ` &bull; <span class="${this.joIsOverdue(j) ? 'jo-overdue' : ''}">Due ${e(j.dueDate)}${this.joIsOverdue(j) ? ' (overdue)' : ''}</span>` : ''}</div>
          ${j.pendingActions.length ? `<div class="jo-pill jo-pending-sync" style="align-self:flex-start;">⏳ ${j.pendingActions.length} change(s) waiting to sync</div>` : ''}
        </div>`;
    }).join('')}</div>` : `<div class="card" style="text-align:center;color:var(--text-muted);padding:30px;">No job orders here${this._jo.serverTime ? '' : ' yet — they appear after the first sync'}.</div>`;
  },

  /* ------------------------------------------------------------------ create / edit form */
  async openJobOrderForm(joCode = null) {
    await auth.refreshScope();
    await this.joLoad();
    const e = (v) => this.esc(v);
    const jo = joCode ? this.joView().find((j) => j.joCode === joCode) : null;
    const blocks = auth.getAuthorizedBlocks();
    const catalog = this.buildFarmBlockCatalog(blocks);
    const codeOptions = catalog.farms.map((f) => f.blocks.map((b) => `<option value="${e(b.code)}" ${jo && jo.farmBlockCode === b.code ? 'selected' : ''}>${e(b.full)}</option>`).join('')).join('');
    this._joFormBlocks = blocks;

    document.getElementById('form-modal-title').textContent = jo ? `Edit ${jo.joCode}` : 'New Job Order';
    document.getElementById('form-modal-body').innerHTML = `
      <div class="form-group">
        <label class="form-label required">Title</label>
        <input type="text" id="jo-title" class="form-control" maxlength="150" value="${e(jo ? jo.title : '')}" placeholder="e.g. Repair water pump" />
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea id="jo-desc" class="form-control" rows="3" maxlength="4000" placeholder="What is the problem, where exactly, what equipment...">${e(jo ? jo.description : '')}</textarea>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label required">Farm &amp; Block</label>
          <select id="jo-fb" class="form-control" ${jo ? 'disabled' : ''} onchange="app.joFormBlockChanged()">
            <option value="">-- Select Farm &amp; Block --</option>${codeOptions}
          </select>
          <div class="form-helper">Everyone assigned to this Farm &amp; Block will see the job order. Its supervisor is notified.</div>
        </div>
        <div class="form-group">
          <label class="form-label">Land Owner / Parcel (optional)</label>
          <select id="jo-entry" class="form-control" ${jo ? 'disabled' : ''}></select>
        </div>
      </div>
      <div class="form-grid-3">
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select id="jo-priority" class="form-control">
            ${['Urgent', 'High', 'Normal', 'Low'].map((p) => `<option ${(jo ? jo.priority : 'Normal') === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Due Date</label>
          <input type="date" id="jo-due" class="form-control" value="${e(jo ? jo.dueDate : '')}" />
        </div>
        <div class="form-group">
          <label class="form-label">Assign To (optional)</label>
          <select id="jo-assign" class="form-control"></select>
        </div>
      </div>
      ${!this._jo.assignees.length && !navigator.onLine ? '<div class="form-helper">The list of people appears after the first sync. You can leave it empty — staff of the block can claim it.</div>' : ''}
    `;
    this.joFormBlockChanged(jo);
    const btn = document.getElementById('form-modal-submit-btn');
    btn.style.display = '';
    btn.textContent = jo ? 'Save Changes' : 'Create Job Order';
    btn.onclick = async () => {
      if (btn.disabled) return;
      const title = document.getElementById('jo-title').value.trim();
      const code = document.getElementById('jo-fb').value;
      if (!title) { this.showToast('Title is required.', 'warning'); return; }
      if (!code) { this.showToast('Choose the Farm & Block.', 'warning'); return; }
      const data = {
        title,
        description: document.getElementById('jo-desc').value.trim(),
        priority: document.getElementById('jo-priority').value,
        dueDate: document.getElementById('jo-due').value,
        assignedTo: document.getElementById('jo-assign').value
      };
      btn.disabled = true;
      try {
        if (jo) {
          await this.joQueueAction('EDIT', jo.joCode, data, `${jo.joCode} updated.`);
        } else {
          data.farmBlockCode = code;
          data.recordId = document.getElementById('jo-entry').value;
          await this.joQueueAction('CREATE', `TMP-${this.joUuid()}`, data, 'Job order created.');
        }
        this.closeModal('form-modal');
        this.navigateTo('job-orders');
      } finally { btn.disabled = false; }
    };
    this.openModal('form-modal');
  },

  joFormBlockChanged(jo = null) {
    const e = (v) => this.esc(v);
    const code = jo ? jo.farmBlockCode : document.getElementById('jo-fb').value;
    const entries = (this._joFormBlocks || []).filter((b) => this.farmBlockInfo(b).code === code && b.status !== 'Deactivated');
    const entSel = document.getElementById('jo-entry');
    entSel.innerHTML = `<option value="">-- Whole Farm &amp; Block --</option>` + entries.map((b) =>
      `<option value="${e(b.recordId)}" ${jo && jo.recordId === b.recordId ? 'selected' : ''}>${e(b.landOwnerName)}${b.landOwnerNo ? ` (${e(b.landOwnerNo)})` : ''} › ${e(b.parcelNumber)}</option>`).join('');
    const people = this._jo.assignees.filter((u) => u.codes.includes('ALL') || u.codes.includes(code));
    document.getElementById('jo-assign').innerHTML = `<option value="">-- Let block staff claim --</option>` + people.map((u) =>
      `<option value="${e(u.userId)}" ${jo && jo.assignedTo === u.userId ? 'selected' : ''}>${e(u.fullName)} (${e(u.role)})</option>`).join('');
  },

  /* ------------------------------------------------------------------ detail window */
  async openJobOrder(joCode, refreshOnly = false) {
    await this.joLoad();
    const e = (v) => this.esc(v);
    const j = this.joView().find((x) => x.joCode === joCode);
    if (!j) { this.showToast('Job order not found. Sync and try again.', 'warning'); return; }
    this._joOpen = joCode;
    const me = auth.getUserId();
    const boss = this.joIsBoss(j);
    const mine = j.claimedBy === me || j.assignedTo === me;
    const st = j.status;

    // timeline = server responses + key moments + changes still waiting on this phone
    const ev = [];
    ev.push({ at: j.createdAt, who: j.createdByName, text: `Created${j.assignedToName ? ` and assigned to ${j.assignedToName}` : ''}` });
    if (j.claimedAt) ev.push({ at: j.claimedAt, who: j.claimedByName, text: 'Received / claimed the job order' });
    this._jo.responses.filter((r) => r.joCode === joCode).forEach((r) => ev.push({ at: r.timestamp, who: r.userName, text: r.text, attachment: r.attachment, attachmentName: r.attachmentName, type: r.type }));
    j.pendingActions.forEach((tx) => {
      const label = { CREATE: 'Created', CLAIM: 'Received / claimed', START: 'Started work', RESPOND: tx.data.text, CLOSE: `Job closed: ${tx.data.remarks}`, REOPEN: `Reopened: ${tx.data.remarks}`, CANCEL: `Cancelled: ${tx.data.remarks}`, EDIT: 'Edited details' }[tx.type];
      ev.push({ at: tx.clientTime, who: (auth.getCurrentUser() || {}).fullName, text: label, pending: true,
        localAttachment: tx.data.attachment ? `data:${tx.data.attachment.mimeType};base64,${tx.data.attachment.data}` : '' });
    });
    ev.sort((a, b) => String(a.at).localeCompare(String(b.at)));

    const btn = (label, cls, fn) => `<button type="button" class="btn ${cls}" onclick="${fn}">${label}</button>`;
    const actions = [];
    if (st === 'PENDING' && (!j.assignedTo || j.assignedTo === me || boss)) actions.push(btn('📥 Receive / Claim', 'btn-primary', `app.joAction('CLAIM')`));
    if (st === 'RECEIVED' && (mine || boss)) actions.push(btn('🛠️ Start Work', 'btn-primary', `app.joAction('START')`));
    if (['RECEIVED', 'IN PROGRESS'].includes(st) && (mine || boss)) actions.push(btn('✅ Close Job Order', 'btn-primary', `app.joShowPanel('close')`));
    if (st === 'CLOSED' && boss) actions.push(btn('🔁 Reopen', 'btn-outline', `app.joShowPanel('reopen')`));
    if (!['CLOSED', 'CANCELLED'].includes(st) && boss) {
      actions.push(btn('✏️ Edit / Assign', 'btn-outline', `app.openJobOrderForm('${e(joCode)}')`));
      actions.push(btn('🚫 Cancel Job', 'btn-danger', `app.joShowPanel('cancel')`));
    }

    document.getElementById('form-modal-title').textContent = j.isLocal ? 'New job order (not sent yet)' : `${j.joCode}`;
    document.getElementById('form-modal-body').innerHTML = `
      <div id="jo-detail">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">${this.joStatusPill(st)} ${this.joPriorityPill(j.priority)}
          ${this.joIsOverdue(j) ? this.joPill('Overdue', { color: '#fff', bg: '#dc2626' }) : ''}
          ${j.pendingActions.length ? `<span class="jo-pill jo-pending-sync">⏳ ${j.pendingActions.length} waiting to sync</span>` : ''}</div>
        <div style="font-size:18px;font-weight:800;">${e(j.title)}</div>
        ${j.description ? `<p style="font-size:13.5px;color:var(--text-muted);white-space:pre-wrap;margin-top:4px;">${e(j.description)}</p>` : ''}
        <div class="jo-info">
          <div><b>Farm &amp; Block</b>${e(j.farmBlock)}</div>
          <div><b>Land Owner / Parcel</b>${j.landOwner ? `${e(j.landOwner)}${j.landOwnerNo ? ` (${e(j.landOwnerNo)})` : ''} › ${e(j.parcelNumber)}` : 'Whole block'}</div>
          <div><b>Assigned To</b>${e(j.assignedToName || 'Anyone in the block')}</div>
          <div><b>Received By</b>${e(j.claimedByName || '—')}</div>
          <div><b>Due Date</b><span class="${this.joIsOverdue(j) ? 'jo-overdue' : ''}">${e(j.dueDate || '—')}</span></div>
          <div><b>Created</b>${e(j.createdByName || '')}<br>${this.joFmt(j.createdAt)}</div>
          ${j.closedAt ? `<div><b>Closed</b>${e(j.closedByName)}<br>${this.joFmt(j.closedAt)}</div>` : ''}
        </div>
        ${actions.length ? `<div class="jo-actions">${actions.join('')}</div>` : ''}
        <div id="jo-panel"></div>
        <div style="font-weight:700;margin:12px 0 6px;">Activity</div>
        <div class="jo-timeline">
          ${ev.map((x) => `
            <div class="jo-ev ${x.pending ? 'pending' : ''}">
              <small>${this.joFmt(x.at)} &bull; ${e(x.who || '')}${x.pending ? ' &bull; ⏳ waiting to sync' : ''}</small>
              <div style="white-space:pre-wrap;">${e(x.text || '')}</div>
              ${x.attachment && x.attachment.startsWith('drive:') ? `<button type="button" class="btn btn-outline" style="margin-top:6px;padding:4px 10px;font-size:12px;"
                  onclick="app.joViewAttachment('${e(x.attachment.slice(6))}')">📎 ${e(x.attachmentName || 'View attachment')}</button>` : ''}
              ${x.localAttachment ? (x.localAttachment.startsWith('data:image/')
                ? `<img src="${x.localAttachment}" alt="attachment" style="max-width:160px;max-height:120px;border-radius:6px;margin-top:6px;display:block;" />`
                : '<div class="jo-meta">📎 PDF attached (sent with the closing)</div>') : ''}
            </div>`).join('')}
        </div>
        ${!['CLOSED', 'CANCELLED'].includes(st) ? `
          <div style="display:flex;gap:8px;margin-top:10px;">
            <textarea id="jo-response" class="form-control" rows="2" maxlength="2000" placeholder="Write an update or response..."></textarea>
            <button type="button" class="btn btn-primary" onclick="app.joAction('RESPOND')">Send</button>
          </div>` : ''}
      </div>`;
    const sub = document.getElementById('form-modal-submit-btn');
    sub.style.display = 'none';   // actions are inside the window
    if (!refreshOnly) this.openModal('form-modal');
  },

  joShowPanel(kind) {
    const panel = document.getElementById('jo-panel');
    if (!panel) return;
    const t = { close: ['Completion remarks', 'Parts replaced, work done, final result...', '✅ Submit Closing'], reopen: ['Reason to reopen', 'Why is the job not finished?', '🔁 Reopen Job Order'], cancel: ['Reason to cancel', 'e.g. duplicate, no longer needed...', '🚫 Cancel Job Order'] }[kind];
    panel.innerHTML = `
      <div class="card" style="background:var(--bg-hover);margin:6px 0;">
        <div class="form-group">
          <label class="form-label required">${t[0]}</label>
          <textarea id="jo-remarks" class="form-control" rows="3" maxlength="2000" placeholder="${t[1]}"></textarea>
        </div>
        ${kind === 'close' ? `
        <div class="form-group">
          <label class="form-label">Photo or PDF (optional, max 5 MB)</label>
          <input type="file" id="jo-file" class="form-control" accept="image/*,application/pdf" />
          <div class="form-helper">Photos are made smaller on the phone before saving. Stored privately — only people of this Farm &amp; Block can open it.</div>
        </div>` : ''}
        <button type="button" id="jo-panel-btn" class="btn ${kind === 'cancel' ? 'btn-danger' : 'btn-primary'}" style="width:100%;" onclick="app.joAction('${kind.toUpperCase()}')">${t[2]}</button>
      </div>`;
    document.getElementById('jo-remarks').focus();
  },

  async joAction(type) {
    const code = this._joOpen;
    if (!code) return;
    const j = this.joView().find((x) => x.joCode === code);
    if (!j) return;
    if (type === 'RESPOND') {
      const el = document.getElementById('jo-response');
      const text = (el.value || '').trim();
      if (!text) { this.showToast('Write a response first.', 'warning'); return; }
      el.value = '';
      await this.joQueueAction('RESPOND', code, { text }, 'Response saved.');
      return this.openJobOrder(code, true);
    }
    if (['CLOSE', 'REOPEN', 'CANCEL'].includes(type)) {
      const remarks = (document.getElementById('jo-remarks')?.value || '').trim();
      if (!remarks) { this.showToast('Please write the remarks / reason.', 'warning'); return; }
      const pbtn = document.getElementById('jo-panel-btn');
      if (pbtn) { if (pbtn.disabled) return; pbtn.disabled = true; pbtn.textContent = 'Saving...'; }
      const data = { remarks };
      try {
        if (type === 'CLOSE') {
          const file = document.getElementById('jo-file')?.files[0];
          if (file) data.attachment = await this.joReadAttachment(file);
        }
      } catch (err) {
        this.showToast(err.message, 'warning');
        if (pbtn) { pbtn.disabled = false; pbtn.textContent = 'Try again'; }
        return;
      }
      if (type === 'CANCEL' && !confirm(`Cancel ${j.joCode}?`)) { if (pbtn) pbtn.disabled = false; return; }
      await this.joQueueAction(type, code, data, { CLOSE: 'Job order closed.', REOPEN: 'Job order reopened.', CANCEL: 'Job order cancelled.' }[type]);
      return this.openJobOrder(this._joOpen, true);
    }
    await this.joQueueAction(type, code, {}, type === 'CLAIM' ? 'Job order received.' : 'Work started.');
    return this.openJobOrder(this._joOpen, true);
  },

  /** Photo -> smaller JPEG (max 1600 px); PDF as it is. Max 5 MB. */
  async joReadAttachment(file) {
    const isImg = /^image\//.test(file.type);
    if (!isImg && file.type !== 'application/pdf') throw new Error('Only photos or PDF files can be attached.');
    if (isImg) {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Cannot read this photo.')); i.src = url; });
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/jpeg', 0.8).split(',')[1];
        if (data.length * 0.75 > 5 * 1024 * 1024) throw new Error('Photo is still larger than 5 MB.');
        return { name: file.name.replace(/\.\w+$/, '') + '.jpg', mimeType: 'image/jpeg', data };
      } finally { URL.revokeObjectURL(url); }
    }
    if (file.size > 5 * 1024 * 1024) throw new Error('PDF is larger than 5 MB.');
    const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => bad(new Error('Cannot read the file.')); r.readAsDataURL(file); });
    return { name: file.name, mimeType: 'application/pdf', data };
  },

  async joViewAttachment(fileId) {
    if (!navigator.onLine) { this.showToast('Connect to the internet to open the attachment.', 'warning'); return; }
    try {
      const r = await syncService.apiCall('JO_ATTACHMENT', { fileId });
      const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }));
      const w = window.open(url, '_blank');
      if (!w) { const a = document.createElement('a'); a.href = url; a.download = r.name || 'attachment'; a.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }
});
