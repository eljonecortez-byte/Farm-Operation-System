/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Themes (v4.6.0) — 6 colour themes + Light / Dark / Same as phone.
 *  - Each user picks his own; saved in the Users sheet ("Theme") so it follows him to any phone.
 *  - Works offline (saved on the phone, sent at the next sync).
 *  - Status colours (Valid / Completed green, On Track blue, For Review yellow, Invalid / Behind red) never change.
 *
 * Load LAST in index.html:  <script src="js/theme.js"></script>
 */

const THEMES = {
  palm:    { name: '🌴 Palm Green',     c: ['#064e3b', '#14532d', '#166534', '#15803d', '#22c55e', '#4ade80', '#f0fdf4', '#bbf7d0'] },
  ocean:   { name: '🌊 Ocean Blue',     c: ['#0c4a6e', '#075985', '#0369a1', '#0284c7', '#0ea5e9', '#38bdf8', '#f0f9ff', '#bae6fd'] },
  sunset:  { name: '🌅 Sunset Orange',  c: ['#7c2d12', '#9a3412', '#c2410c', '#ea580c', '#f97316', '#fb923c', '#fff7ed', '#fed7aa'] },
  purple:  { name: '🍇 Royal Purple',   c: ['#3b0764', '#581c87', '#6b21a8', '#7e22ce', '#a855f7', '#c084fc', '#faf5ff', '#e9d5ff'] },
  coconut: { name: '🥥 Coconut Brown',  c: ['#451a03', '#78350f', '#92400e', '#a16207', '#ca8a04', '#eab308', '#fefce8', '#fde68a'] },
  slate:   { name: '🪨 Slate Gray',     c: ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#f8fafc', '#cbd5e1'] }
};
const THEME_MODE_LABELS = [['light', '☀️ Light'], ['dark', '🌙 Dark'], ['auto', '📱 Same as phone']];
const THEME_LS = 'farmops-theme';

const themeService = {
  current: { colour: 'palm', mode: 'light' },

  parse(v) {
    const [colour, mode] = String(v || '').split('|');
    return { colour: THEMES[colour] ? colour : 'palm', mode: ['light', 'dark', 'auto'].includes(mode) ? mode : 'light' };
  },

  isDark(mode) {
    return mode === 'dark' || (mode === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  },

  css() {
    const hex = (h, a) => h + Math.round(a * 255).toString(16).padStart(2, '0');
    let out = '';
    Object.entries(THEMES).forEach(([k, t]) => {
      const [dark, primary, medium, bright, emerald, light, subtle, border] = t.c;
      out += `html[data-theme="${k}"] { --brand-1:${dark}; --brand-2:${primary}; --brand-3:${medium};
        --palm-dark:${dark}; --palm-primary:${primary}; --palm-medium:${medium}; --palm-bright:${bright}; --palm-emerald:${emerald};
        --palm-light:${light}; --palm-subtle:${subtle}; --palm-border:${border}; --border-focus:${bright}; --shadow-palm:0 12px 24px -4px ${hex(primary, 0.15)}; }
      html[data-theme="${k}"][data-mode="dark"] { --palm-dark:${light}; --palm-primary:${bright}; --palm-medium:${medium}; --palm-bright:${light};
        --palm-subtle:${hex(bright, 0.14)}; --palm-border:${hex(bright, 0.4)}; --border-focus:${light}; }\n`;
    });
    const D = 'html[data-mode="dark"]';
    const tint = (colours, bg, fg, bd) => colours.map((c) => `${D} [style*="background:${c}"], ${D} [style*="background: ${c}"], ${D} [style*="background-color:${c}"], ${D} [style*="background-color: ${c}"]`).join(', ') +
      ` { background-color:${bg} !important; color:${fg} !important; border-color:${bd} !important; }\n`;
    const text = (colours, fg) => colours.map((c) => `${D} [style*="color:${c}"], ${D} [style*="color: ${c}"]`).join(', ') + ` { color:${fg} !important; }\n`;
    out += `
      /* brand areas keep the strong theme colour in light and dark */
      .sidebar-header { background: linear-gradient(135deg, var(--brand-1) 0%, var(--brand-2) 100%) !important; }
      .user-avatar { background: linear-gradient(135deg, var(--brand-3), var(--brand-2)); }
      .btn-primary { background-color: var(--brand-2); border-color: var(--brand-2); }
      .btn-primary:hover { background-color: var(--brand-3); }
      .nav-link.active { background-color: var(--brand-2) !important; }
      .pg-tab.on { background: var(--brand-2) !important; border-color: var(--brand-2) !important; }
      .stat-icon.green { background: var(--palm-subtle); color: var(--palm-bright); }
      .btn-secondary:hover { background-color: var(--palm-subtle); }

      ${D} { --bg-page:#0b1120; --bg-surface:#111827; --bg-hover:#1f2937; --text-main:#e5e7eb; --text-muted:#9ca3af; --text-light:#6b7280;
        --border:#2b3545; --coconut-cream:#2a2410; --sun-light:#4a3b0a; color-scheme: dark; }
      ${D} body { background-color: var(--bg-page); color: var(--text-main); }
      ${D} #sidebar, ${D} #top-bar, ${D} .btn-outline, ${D} .form-control, ${D} .stat-card, ${D} .activity-hub-card, ${D} .filter-toolbar,
      ${D} .modal-container, ${D} .toast, ${D} #bottom-nav, ${D} .card { background-color: var(--bg-surface) !important; color: var(--text-main); }
      ${D} .table th, ${D} .modal-footer, ${D} .gps-pill { background-color: var(--bg-hover) !important; }
      ${D} .table td, ${D} .table th { border-color: var(--border); }
      ${D} .form-control:disabled { background-color: #1f2937 !important; }
      ${D} .form-control::placeholder { color: #6b7280; }
      ${D} select.form-control option { background: #111827; color: #e5e7eb; }
      ${D} .activity-card-footer { border-top-color: var(--border); }
      ${D} .modal-overlay { background-color: rgba(0, 0, 0, 0.65); }
      ${D} .btn-danger { background-color: #3f1515; border-color: #7f1d1d; color: #fecaca; }
      ${D} .btn-danger:hover { background-color: #5b1d1d; }
      ${D} .status-online { background: #12301f; color: #86efac; border-color: #166534; }
      ${D} .status-offline { background: #3f1515; color: #fca5a5; border-color: #7f1d1d; }
      ${D} .status-pending { background: #3a2a0c; color: #fcd34d; border-color: #78350f; }
      ${D} .status-syncing { background: #0f2e2b; color: #5eead4; border-color: #115e59; }
      ${D} .gps-pill.gps-active { background: #172554 !important; color: #93c5fd; border-color: #1e3a8a; }
      ${D} .stat-icon.amber { background: #3a2a0c; color: #fcd34d; }
      ${D} .stat-icon.blue { background: #172554; color: #93c5fd; }
      ${D} .stat-icon.emerald { background: #12301f; color: #6ee7b7; }
      ${D} .stat-icon.brown { background: #3a1d0c; color: #fdba74; }
      ${D} .badge-completed { background: #14532d; color: #bbf7d0; }
      ${D} .badge-ahead { background: #0c4a6e; color: #bae6fd; }
      ${D} .badge-ontrack { background: #12301f; color: #86efac; border-color: #166534; }
      ${D} .badge-behind { background: #7f1d1d; color: #fecaca; }
      ${D} .badge-ongoing { background: #78350f; color: #fde68a; }
      ${D} .badge-notstarted { background: #1f2937; color: #9ca3af; }
      ${D} svg text[fill="#064e3b"], ${D} svg text[fill="#0f172a"], ${D} svg text[fill="#334155"], ${D} svg text[fill="#475569"], ${D} svg text[fill="#64748b"] { fill: #d1d5db; }
      ${D} svg line[stroke="#e2e8f0"], ${D} svg line[stroke="#f1f5f9"] { stroke: #2b3545; }
      ${D} .pg-blocks, ${D} .pg-bc, ${D} .pg-tab:not(.on), ${D} .ph-view-box, ${D} .ph-view-bar { background: var(--bg-surface) !important; color: var(--text-main); }
      ${D} .pg-blocks { background: #0f1623 !important; }
      ${D} .pg-bar, ${D} .pg-acts span { background: #374151 !important; }
      /* light boxes written inside the pages */
      ${tint(['#fff', '#ffffff', '#fafafa', '#f8fafc'], 'var(--bg-surface)', 'inherit', 'var(--border)')}
      ${tint(['#f1f5f9', '#e5e7eb', '#e2e8f0'], '#1f2937', 'inherit', 'var(--border)')}
      ${tint(['#fffbeb', '#fef3c7', '#fef9c3', '#fefce8', '#fff7ed'], '#3a2a0c', '#fde68a', '#78350f')}
      ${tint(['#fef2f2', '#fee2e2'], '#3f1515', '#fecaca', '#7f1d1d')}
      ${tint(['#f0fdf4', '#dcfce7', '#ecfdf5'], '#12301f', '#bbf7d0', '#166534')}
      ${tint(['#dbeafe', '#eff6ff', '#e0f2fe', '#f0f9ff'], '#172554', '#bfdbfe', '#1e3a8a')}
      ${tint(['#ede9fe', '#faf5ff', '#f5f3ff'], '#2e1065', '#ddd6fe', '#5b21b6')}
      ${text(['#0f172a', '#1e293b', '#334155', '#374151'], '#e5e7eb')}
      ${text(['#475569', '#64748b'], '#9ca3af')}
      ${text(['#92400e', '#854d0e', '#b45309', '#78350f'], '#fcd34d')}
      ${text(['#991b1b', '#b91c1c', '#dc2626'], '#fca5a5')}
      ${text(['#166534', '#15803d', '#047857', '#064e3b'], '#86efac')}
      ${text(['#1e40af', '#1d4ed8', '#0369a1', '#0284c7'], '#93c5fd')}
      ${text(['#5b21b6', '#6b21a8'], '#c4b5fd')}
      ${D} .ph-thumb, ${D} .av-img { border-color: #1f2937; }
      ${D} .jo-banner { background: linear-gradient(90deg, var(--palm-subtle), #2a2410) !important; color: var(--text-main); }
      ${D} .jo-banner * { color: inherit; }
      ${D} .jo-notif.unread { background: var(--palm-subtle); }
    `;
    return out;
  },

  apply(colour, mode) {
    const t = this.parse(colour + '|' + mode);
    this.current = t;
    const html = document.documentElement;
    html.dataset.theme = t.colour;
    html.dataset.mode = this.isDark(t.mode) ? 'dark' : 'light';
    if (!document.getElementById('theme-style')) {
      const st = document.createElement('style');
      st.id = 'theme-style';
      st.textContent = this.css();
      document.head.appendChild(st);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', html.dataset.mode === 'dark' ? '#111827' : THEMES[t.colour].c[1]);
    try { localStorage.setItem(THEME_LS, t.colour + '|' + t.mode); } catch (e) { /* private mode */ }
  },

  /** Theme of the signed-in user (a change waiting to sync on this phone wins). */
  applyUser(user) {
    let v = user && user.theme;
    try {
      const p = JSON.parse(localStorage.getItem(THEME_LS + '-pending') || 'null');
      if (p && user && p.userId === user.userId) v = p.value;
    } catch (e) { /* ignore */ }
    if (v) { const t = this.parse(v); this.apply(t.colour, t.mode); }
  }
};

/* apply the last theme used on this phone right away (also on the sign-in screen) */
(function () {
  let saved = '';
  try { saved = localStorage.getItem(THEME_LS) || ''; } catch (e) { /* ignore */ }
  const t = themeService.parse(saved);
  themeService.apply(t.colour, t.mode);
  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (themeService.current.mode === 'auto') themeService.apply(themeService.current.colour, 'auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
})();

Object.assign(FarmOpsApp.prototype, {

  themePickerHtml() {
    const cur = themeService.current;
    const e = (v) => this.esc(v);
    return `
      <div class="card" id="theme-card" style="max-width: 680px; margin: 18px auto 0;">
        <div class="card-header"><div><div class="card-title">🎨 Theme</div>
          <div class="card-subtitle">Only changes the app on your account. Saved with your profile, so it follows you to any phone.</div></div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;">
          ${Object.entries(THEMES).map(([k, t]) => `
            <button type="button" onclick="app.themeChoose('${k}', null)" aria-pressed="${k === cur.colour}"
              style="text-align:left;border:2px solid ${k === cur.colour ? 'var(--text-main)' : 'var(--border)'};border-radius:14px;padding:10px;background:var(--bg-surface);color:var(--text-main);cursor:pointer;font:inherit;">
              <div style="height:42px;border-radius:9px;display:flex;overflow:hidden;margin-bottom:8px;">${[t.c[0], t.c[2], t.c[4], t.c[6]].map((x) => `<i style="flex:1;--sw:${x};background:var(--sw)"></i>`).join('')}</div>
              <span style="font-weight:700;font-size:13px;">${e(t.name)}</span>${k === cur.colour ? '<span style="float:right;">✓</span>' : ''}
            </button>`).join('')}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
          ${THEME_MODE_LABELS.map(([k, l]) => `
            <button type="button" onclick="app.themeChoose(null, '${k}')" aria-pressed="${k === cur.mode}"
              style="border:2px solid ${k === cur.mode ? 'var(--text-main)' : 'var(--border)'};border-radius:12px;padding:9px 14px;background:var(--bg-surface);color:var(--text-main);cursor:pointer;font:inherit;font-size:13.5px;font-weight:600;">${l}</button>`).join('')}
        </div>
        <div class="form-helper" style="margin-top:10px;">Status colours (green Valid / Completed, blue On Track, yellow For Review, red Invalid / Behind) stay the same in every theme.</div>
      </div>`;
  },

  async themeChoose(colour, mode) {
    const cur = themeService.current;
    const next = { colour: colour || cur.colour, mode: mode || cur.mode };
    themeService.apply(next.colour, next.mode);
    const card = document.getElementById('theme-card');
    if (card) card.outerHTML = this.themePickerHtml();
    const user = auth.getCurrentUser();
    if (!user) return;
    const value = next.colour + '|' + next.mode;
    try { localStorage.setItem(THEME_LS + '-pending', JSON.stringify({ userId: user.userId, value })); } catch (e) { /* ignore */ }
    await this.themeSyncPending();
  },

  /** Sends a theme chosen offline (or just now). */
  async themeSyncPending() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(THEME_LS + '-pending') || 'null'); } catch (e) { p = null; }
    const user = auth.getCurrentUser();
    if (!p || !user || p.userId !== user.userId || !navigator.onLine || !auth.getToken()) return;
    const t = themeService.parse(p.value);
    try {
      const res = await syncService.apiCall('SET_THEME', { colour: t.colour, mode: t.mode });
      await auth.updateProfile({ ...auth.getCurrentUser(), theme: res.theme });
      const still = JSON.parse(localStorage.getItem(THEME_LS + '-pending') || 'null');
      if (still && still.value === p.value) localStorage.removeItem(THEME_LS + '-pending');
    } catch (err) { console.warn('[Theme] not sent yet:', err.message); }
  }
});

/* ===== hooks ===== */
(function () {
  const origHeader = FarmOpsApp.prototype.renderUserMetaHeader;
  FarmOpsApp.prototype.renderUserMetaHeader = function (...args) {
    try { themeService.applyUser(auth.getCurrentUser()); } catch (err) { console.warn('[Theme]', err); }
    return origHeader.apply(this, args);
  };

  const origProfile = FarmOpsApp.prototype.renderProfileView;
  FarmOpsApp.prototype.renderProfileView = async function (container) {
    const res = await origProfile.call(this, container);
    if (container && !document.getElementById('theme-card')) container.insertAdjacentHTML('beforeend', this.themePickerHtml());
    return res;
  };

  const origSync = syncService.syncPendingRecords.bind(syncService);
  syncService.syncPendingRecords = async function () {
    const res = await origSync();
    app.themeSyncPending().catch(() => {});
    return res;
  };

  try { themeService.applyUser(auth.getCurrentUser()); } catch (e) { /* not signed in yet */ }
})();
