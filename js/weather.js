/**
 * FARM OPERATIONS, ACTIVITY MONITORING & KPI MANAGEMENT SYSTEM
 * Weather — Rizal, Palawan (Ransang, Candawaga, Culasian)   (v4.1)
 *
 * - For Administrators and Supervisors.
 * - 1 Week: daily rain (mm), chance of rain, temperature, wind.
 * - 1 Month: daily rain for 30 days + weekly totals (days 17–30 are a longer-range outlook).
 * - Last 30 days: rain that already fell.
 * - The last downloaded copy is kept on the phone, so it can be opened offline.
 * Data: Open-Meteo.com (CC BY 4.0), downloaded by the server (GET_WEATHER).
 *
 * Load this file AFTER app.js in index.html:  <script src="js/weather.js"></script>
 */

const WX_COLORS = ['#0284c7', '#16a34a', '#b45309'];
const WX_CODES = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'], 56: ['🌧️', 'Drizzle'], 57: ['🌧️', 'Drizzle'],
  61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Rain'], 67: ['🌧️', 'Heavy rain'],
  80: ['🌦️', 'Light showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Violent showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm, hail'], 99: ['⛈️', 'Thunderstorm, hail']
};

Object.assign(FarmOpsApp.prototype, {

  wxCanSee() { return auth.isAdmin() || auth.isSupervisor(); },

  async wxLoad(force = false) {
    let data = await db.getSetting('weatherCache');
    let note = '';
    const stale = !data || (Date.now() - new Date(data.updatedAt).getTime() > 3 * 60 * 60 * 1000);
    if ((force || stale) && navigator.onLine && auth.getToken() && !(auth.getCurrentUser() || {}).isOfflineSession) {
      try {
        const r = await syncService.apiCall('GET_WEATHER', { force });
        data = r.weather;
        await db.setSetting('weatherCache', data);
        if (r.warning) note = r.warning;
      } catch (err) {
        note = data ? `Could not refresh (${err.message}). Showing the last saved copy.` : err.message;
      }
    } else if (!navigator.onLine && data) {
      note = 'You are offline — showing the last saved forecast.';
    }
    return { data, note };
  },

  wxIcon(code) { return (WX_CODES[code] || ['🌥️', ''])[0]; },
  wxLabel(code) { return (WX_CODES[code] || ['', ''])[1]; },
  wxDay(date, withDate = true) {
    const d = new Date(`${date}T00:00:00`);
    const w = d.toLocaleDateString('en-PH', { weekday: 'short' });
    return withDate ? `${w} ${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}` : w;
  },
  wxMm(v) { return v === null || v === undefined ? '—' : `${(Math.round(v * 10) / 10).toFixed(1)}`; },
  wxRainColor(mm) {
    if (mm === null || mm === undefined) return '#e2e8f0';
    if (mm >= 50) return '#1e3a8a';
    if (mm >= 20) return '#1d4ed8';
    if (mm >= 7.5) return '#3b82f6';
    if (mm >= 2.5) return '#93c5fd';
    if (mm > 0.1) return '#dbeafe';
    return '#f1f5f9';
  },
  wxRainWord(mm) {
    if (mm === null || mm === undefined) return '';
    if (mm >= 50) return 'Very heavy';
    if (mm >= 20) return 'Heavy';
    if (mm >= 7.5) return 'Moderate';
    if (mm >= 2.5) return 'Light';
    if (mm > 0.1) return 'Trace';
    return 'Dry';
  },

  /** Grouped bar chart (one bar per barangay per day) as inline SVG. */
  wxChart(locations, key, count) {
    const days = locations[0][key].slice(0, count);
    const n = days.length;
    if (!n) return '';
    const W = n <= 7 ? 520 : 900, H = n <= 7 ? 200 : 230, left = 30, bottom = 30, top = 12;
    const max = Math.max(5, ...locations.flatMap((l) => l[key].slice(0, count).map((d) => d.rain || 0)));
    const nice = Math.ceil(max / 10) * 10;
    const slot = (W - left - 6) / n;
    const bw = Math.max(2, (slot - 4) / locations.length);
    const y = (v) => top + (H - top - bottom) * (1 - (v || 0) / nice);
    const e = (v) => this.esc(v);
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily rain in millimetres" style="display:block;">`;
    for (let i = 0; i <= 4; i++) {
      const v = (nice / 4) * i;
      svg += `<line x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8f0" stroke-width="1"/>
        <text x="${left - 4}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#64748b">${Math.round(v)}</text>`;
    }
    days.forEach((d, i) => {
      const x0 = left + i * slot + 2;
      if (d.source === 'outlook') svg += `<rect x="${x0 - 2}" y="${top}" width="${slot}" height="${H - top - bottom}" fill="#fefce8"/>`;
      locations.forEach((l, j) => {
        const r = (l[key][i] || {}).rain || 0;
        svg += `<rect x="${x0 + j * bw}" y="${y(r)}" width="${bw - 1}" height="${Math.max(0, H - bottom - y(r))}" fill="${WX_COLORS[j]}" rx="1">
          <title>${e(l.name)} ${e(d.date)}: ${this.wxMm(r)} mm</title></rect>`;
      });
      const every = n > 14 ? 5 : 1;
      if (i % every === 0) svg += `<text x="${x0 + slot / 2 - 2}" y="${H - bottom + 14}" font-size="11" text-anchor="middle" fill="#475569">${e(n > 14 ? new Date(`${d.date}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : this.wxDay(d.date, false))}</text>`;
    });
    svg += '</svg>';
    const legend = locations.map((l, j) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:12.5px;"><span style="width:12px;height:12px;border-radius:3px;background:${WX_COLORS[j]};display:inline-block;"></span>${e(l.name)}</span>`).join('');
    return `<div style="margin:4px 0 6px;">${legend}${locations[0][key].slice(0, count).some((d) => d.source === 'outlook') ? '<span style="font-size:12px;color:#854d0e;"><span style="display:inline-block;width:12px;height:12px;background:#fefce8;border:1px solid #fde68a;vertical-align:middle;"></span> longer-range outlook (less certain)</span>' : ''}</div>${svg}`;
  },

  async renderWeatherView(container, force = false) {
    const e = (v) => this.esc(v);
    if (!this.wxCanSee()) {
      container.innerHTML = '<div class="card">Weather is available to Supervisors and Administrators.</div>';
      return;
    }
    if (!container.querySelector('#wx-root')) container.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);">Loading weather…</div>';
    const { data, note } = await this.wxLoad(force);
    if (!data) {
      container.innerHTML = `<div class="card">${e(note || 'No weather data yet. Connect to the internet and open this page again.')}</div>`;
      return;
    }
    const tab = this._wxTab || 'week';
    const L = data.locations;
    const updated = new Date(data.updatedAt);

    let body = '';
    if (tab === 'week') {
      body = `
        <div class="card" style="margin-bottom:16px;">
          <div class="card-title" style="margin-bottom:4px;">🌧️ Daily rain — next 7 days (mm)</div>
          ${this.wxChart(L, 'days', 7)}
        </div>
        <div class="wx-grid">
          ${L.map((l, j) => `
            <div class="card wx-loc" style="border-top:4px solid ${WX_COLORS[j]};">
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
                <div class="card-title">${e(l.name)}</div>
                <div style="font-size:13px;color:var(--text-muted);">7-day total <strong style="font-size:18px;color:var(--text-main);">${this.wxMm(l.totals.week)} mm</strong></div>
              </div>
              <table class="wx-table">
                <thead><tr><th>Day</th><th></th><th>Rain</th><th>Chance</th><th>Temp °C</th><th>Wind</th></tr></thead>
                <tbody>${l.days.slice(0, 7).map((d) => `
                  <tr>
                    <td style="white-space:nowrap;"><strong>${e(this.wxDay(d.date))}</strong></td>
                    <td title="${e(this.wxLabel(d.code))}" style="font-size:18px;">${this.wxIcon(d.code)}</td>
                    <td><span class="wx-mm" style="background:${this.wxRainColor(d.rain)};color:${d.rain >= 7.5 ? '#fff' : '#0f172a'};">${this.wxMm(d.rain)} mm</span></td>
                    <td>${d.chance === null ? '—' : `${e(d.chance)}%`}</td>
                    <td style="white-space:nowrap;">${this.wxMm(d.tMax).replace('.0', '')}° / ${this.wxMm(d.tMin).replace('.0', '')}°</td>
                    <td style="white-space:nowrap;">${d.wind === null ? '—' : `${Math.round(d.wind)} km/h`}</td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>`).join('')}
        </div>`;
    } else if (tab === 'month') {
      const weeks = [[0, 7, 'Week 1'], [7, 14, 'Week 2'], [14, 21, 'Week 3'], [21, 28, 'Week 4'], [28, 30, 'Days 29–30']];
      const rng = (l, a, b) => l.days.slice(a, b);
      const sum = (arr) => arr.reduce((t, d) => t + (d.rain || 0), 0);
      const label = (a, b) => {
        const d = L[0].days;
        if (!d[a]) return '';
        const f = (x) => new Date(`${x}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
        return `${f(d[a].date)} – ${f(d[Math.min(b, d.length) - 1].date)}`;
      };
      body = `
        <div class="card" style="margin-bottom:16px;">
          <div class="card-title" style="margin-bottom:4px;">🌧️ Daily rain — next 30 days (mm)</div>
          ${this.wxChart(L, 'days', 30)}
        </div>
        <div class="card" style="padding:0;overflow:hidden;">
          <div class="table-responsive">
            <table class="table">
              <thead><tr><th>Period</th>${L.map((l, j) => `<th style="text-align:right;color:${WX_COLORS[j]};">${e(l.name)}</th>`).join('')}</tr></thead>
              <tbody>
                ${weeks.filter(([a]) => L[0].days[a]).map(([a, b, name]) => `
                  <tr>
                    <td><strong>${name}</strong><br><span style="font-size:11.5px;color:var(--text-muted);">${e(label(a, b))}${a >= 14 ? ' • outlook' : ''}</span></td>
                    ${L.map((l) => { const v = sum(rng(l, a, b)); return `<td style="text-align:right;"><span class="wx-mm" style="background:${this.wxRainColor(v / Math.max(1, b - a))};color:${v / Math.max(1, b - a) >= 7.5 ? '#fff' : '#0f172a'};">${this.wxMm(v)} mm</span></td>`; }).join('')}
                  </tr>`).join('')}
              </tbody>
              <tfoot><tr style="background:var(--bg-hover);font-weight:800;">
                <td>Total next ${L[0].days.length} days</td>${L.map((l) => `<td style="text-align:right;">${this.wxMm(l.totals.month)} mm</td>`).join('')}
              </tr></tfoot>
            </table>
          </div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">Days 1–16 are the regular forecast. Days 17–30 are a longer-range outlook (average of 51 ECMWF runs): good for planning, but the exact day of rain can shift.</p>`;
    } else {
      body = `
        <div class="card" style="margin-bottom:16px;">
          <div class="card-title" style="margin-bottom:4px;">🌧️ Rain that fell — last 30 days (mm)</div>
          ${this.wxChart(L, 'past30', 30)}
        </div>
        <div class="card" style="padding:0;overflow:hidden;">
          <div class="table-responsive">
            <table class="table">
              <thead><tr><th>Barangay</th><th style="text-align:right;">Total (mm)</th><th style="text-align:right;">Rain days (≥ 1 mm)</th><th style="text-align:right;">Wettest day</th></tr></thead>
              <tbody>${L.map((l, j) => {
                const wet = l.past30.reduce((m, d) => ((d.rain || 0) > (m.rain || 0) ? d : m), {});
                return `<tr>
                  <td><strong style="color:${WX_COLORS[j]};">${e(l.name)}</strong></td>
                  <td style="text-align:right;"><strong>${this.wxMm(l.totals.past30)}</strong></td>
                  <td style="text-align:right;">${l.past30.filter((d) => (d.rain || 0) >= 1).length}</td>
                  <td style="text-align:right;">${wet.date ? `${this.wxMm(wet.rain)} mm (${e(this.wxDay(wet.date))})` : '—'}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">Estimated from weather models (not a rain gauge on the farm).</p>`;
    }

    container.innerHTML = `
      <div id="wx-root">
        <style>
          .wx-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px; }
          .wx-tabs .btn.active { background:var(--palm-primary); color:#fff; border-color:var(--palm-primary); }
          .wx-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }
          .wx-table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
          .wx-table th { text-align:left; font-size:11px; text-transform:uppercase; color:var(--text-muted); padding:4px 4px; }
          .wx-table td { padding:6px 4px; border-top:1px solid var(--border); }
          .wx-mm { display:inline-block; padding:2px 8px; border-radius:999px; font-weight:700; font-size:12.5px; white-space:nowrap; }
          @media (max-width:540px) { .wx-grid { grid-template-columns:1fr; } .wx-table th:nth-child(4), .wx-table td:nth-child(4) { display:none; } }
        </style>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
          <div>
            <h2 style="font-size:20px;font-weight:800;color:var(--text-main);">Weather — ${e(data.municipality)}</h2>
            <p style="font-size:13px;color:var(--text-muted);">Barangay Ransang, Candawaga and Culasian &bull; updated ${e(updated.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</p>
          </div>
          <button class="btn btn-outline" onclick="app.renderWeatherView(document.getElementById('view-content-root'), true)">🔄 Refresh</button>
        </div>
        ${note ? `<div class="card" style="background:#fffbeb;border-color:#fde68a;color:#92400e;font-size:13px;margin-bottom:12px;">${e(note)}</div>` : ''}
        <div class="stats-grid">
          ${L.map((l, j) => `
            <div class="stat-card" style="border-left:4px solid ${WX_COLORS[j]};">
              <div class="stat-icon blue" style="font-size:22px;">${this.wxIcon(l.days[0] && l.days[0].code)}</div>
              <div class="stat-info">
                <div class="stat-label">${e(l.name)}</div>
                <div class="stat-value" style="font-size:20px;">${this.wxMm(l.totals.week)} mm</div>
                <div class="stat-sub">next 7 days &bull; ${this.wxMm(l.totals.month)} mm next 30 days</div>
              </div>
            </div>`).join('')}
        </div>
        <div class="wx-tabs">
          ${[['week', '📅 1 Week'], ['month', '🗓️ 1 Month'], ['past', '📊 Last 30 days']].map(([k, t]) =>
            `<button class="btn btn-outline ${tab === k ? 'active' : ''}" onclick="app._wxTab='${k}'; app.renderWeatherView(document.getElementById('view-content-root'))">${t}</button>`).join('')}
        </div>
        ${body}
        <p style="font-size:11.5px;color:var(--text-muted);margin-top:14px;">
          Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0).
          Ransang and Candawaga are about 6 km apart, so they often fall in the same forecast area and can show the same numbers.
        </p>
      </div>`;
  },

  /** Dashboard: one line with the rain expected this week (Supervisors / Admins). */
  async renderWeatherDashboardCard(container) {
    if (!this.wxCanSee()) return;
    const data = await db.getSetting('weatherCache');
    const L = data && data.locations;
    const html = `
      <div class="card" style="margin-bottom:22px;cursor:pointer;" onclick="app.navigateTo('weather')">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div><div class="card-title">🌦️ Rain next 7 days — Rizal, Palawan</div>
            <div class="card-subtitle">${L ? `Updated ${this.esc(new Date(data.updatedAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} • tap for 1 week / 1 month` : 'Tap to load the forecast'}</div></div>
          ${L ? `<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;">${L.map((l, j) => `<span><span style="color:${WX_COLORS[j]};font-weight:800;">${this.esc(l.name)}</span> <strong style="font-size:17px;">${this.wxMm(l.totals.week)}</strong> mm</span>`).join('')}</div>` : ''}
        </div>
      </div>`;
    const anchor = container.querySelector('.stats-grid');
    if (anchor) anchor.insertAdjacentHTML('afterend', html);
    else container.insertAdjacentHTML('beforeend', html);
    // keep the phone copy fresh in the background
    if (navigator.onLine && (!data || Date.now() - new Date(data.updatedAt).getTime() > 3 * 60 * 60 * 1000)) {
      this.wxLoad(false).then((r) => { if (r.data && this.currentView === 'dashboard' && !L) this.navigateTo('dashboard'); });
    }
  }
});
