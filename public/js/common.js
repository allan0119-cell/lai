/**
 * 共用前端工具(v2)
 *   api.get / post / put / del
 *   auth.login / logout / token / requireAdmin
 *   ui.toast(msg, type)        Toast 通知(取代 alert)
 *   ui.alert(msg, type)        頁面內 alert(用於 #flash)
 *   ui.badge(text)
 *   ui.formatDate(s)
 *   ui.icon(name)              SVG icon (Lucide-style)
 *   ui.loading(el)             顯示 spinner
 *   ui.empty(el, msg)          顯示空狀態
 *   ui.confirm(msg)            漂亮的 confirm dialog
 *   ui.renderHeader(active)    自動產生頂部導覽
 *   ui.renderFooter()          自動產生 footer
 */
(function () {
  const TOKEN_KEY = 'ctp_admin_token';

  /* ============ Auth ============ */
  const auth = {
    token() { return localStorage.getItem(TOKEN_KEY); },
    setToken(t) { localStorage.setItem(TOKEN_KEY, t); },
    logout() { localStorage.removeItem(TOKEN_KEY); location.href = '/login.html'; },
    async login(username, password) {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '登入失敗');
      auth.setToken(data.token);
      return data;
    },
    requireAdmin() {
      if (!auth.token()) {
        location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname);
      }
    },
  };

  /* ============ API ============ */
  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = auth.token();
    if (t) headers['Authorization'] = 'Bearer ' + t;

    const r = await fetch(path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data;
    try { data = await r.json(); } catch { data = {}; }

    if (r.status === 401) {
      auth.logout();
      throw new Error('請重新登入');
    }
    if (!r.ok) throw new Error(data.error || `請求失敗 (${r.status})`);
    return data;
  }

  const api = {
    get:  (p) => request('GET',  p),
    post: (p, b) => request('POST', p, b),
    put:  (p, b) => request('PUT',  p, b),
    del:  (p) => request('DELETE', p),
  };

  /* ============ Icons (Lucide SVG) ============ */
  const ICONS = {
    cross:    '<path d="M14 4h-4v6H4v4h6v6h4v-6h6v-4h-6V4z"/>',
    user:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    search:   '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    chart:    '<path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 5-5"/>',
    list:     '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    plus:     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    check:    '<polyline points="20 6 9 17 4 12"/>',
    x:        '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    info:     '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    warn:     '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    print:    '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    mail:     '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    line:     '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 14V9M11 14L7 9M11 14V9M15 14L11 9M15 14V9M19 14V9"/>',
    refresh:  '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    logout:   '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    eye:      '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    sparkle:  '<path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13"/>',
    home:     '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    arrow_right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  };
  function icon(name, size = 16) {
    const path = ICONS[name];
    if (!path) return '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  /* ============ Toast 通知 ============ */
  function ensureToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-container';
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }
  function toast(msg, type = 'info', duration = 3500) {
    const c = ensureToastContainer();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const iconName = type === 'success' ? 'check' : type === 'error' ? 'warn' : type === 'warn' ? 'warn' : 'info';
    el.innerHTML = `<span style="color:var(--${type})">${icon(iconName, 18)}</span><div style="flex:1">${msg}</div>`;
    c.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 200ms, transform 200ms';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 220);
    }, duration);
  }

  /* ============ 頁面內 alert ============ */
  function alert(msg, type = 'info', target = 'flash') {
    const el = document.getElementById(target);
    if (!el) { toast(msg, type); return; }
    el.innerHTML = `<div class="alert ${type}"><span>${icon(type === 'error' ? 'warn' : type === 'success' ? 'check' : 'info', 18)}</span><div>${msg}</div></div>`;
  }

  /* ============ Badge ============ */
  function badge(text) {
    const map = {
      '已啟用': 'success', '通過': 'success', '完成': 'success', '接受': 'success', '已寄出': 'success', '確認': 'success',
      '待審核': 'warn', '待審': 'warn', '招募中': 'warn', '邀請中': 'warn', '徵詢中': 'warn',
      '退回': 'error', '婉拒': 'error', '取消': 'error', '失敗': 'error', '停用': 'error',
      '進行中': 'info', '已寄送': 'info',
    };
    const cls = map[text] || 'muted';
    return `<span class="badge badge-${cls}">${text}</span>`;
  }

  /* ============ 日期 ============ */
  function formatDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString('zh-TW'); }
    catch { return s; }
  }
  function formatDateTime(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit', year: 'numeric' }); }
    catch { return s; }
  }

  /* ============ 載入 / 空狀態 ============ */
  function loading(el, msg = '載入中…') {
    if (typeof el === 'string') el = document.getElementById(el) || document.querySelector(el);
    if (!el) return;
    el.innerHTML = `<div class="loading"><span class="spinner"></span><span>${msg}</span></div>`;
  }
  function empty(el, msg = '目前沒有資料', iconName = 'list') {
    if (typeof el === 'string') el = document.getElementById(el) || document.querySelector(el);
    if (!el) return;
    el.innerHTML = `<div class="empty-state"><div class="icon">${icon(iconName, 24)}</div><h3>${msg}</h3></div>`;
  }

  /* ============ Confirm ============ */
  function confirmDialog(msg) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(45,42,38,.5);z-index:9998;display:flex;align-items:center;justify-content:center;animation:slideIn 200ms;padding:1rem;';
      overlay.innerHTML = `
        <div class="card" style="max-width:400px;margin:0;box-shadow:var(--shadow-xl);">
          <div style="display:flex;gap:0.875rem;align-items:flex-start;margin-bottom:1rem;">
            <span style="color:var(--warn);flex-shrink:0;">${icon('warn', 24)}</span>
            <div style="flex:1;line-height:1.6;">${msg}</div>
          </div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
            <button class="btn-secondary" data-ans="0">取消</button>
            <button data-ans="1">確認</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelectorAll('button').forEach(b => {
        b.onclick = () => {
          resolve(b.dataset.ans === '1');
          overlay.remove();
        };
      });
    });
  }

  /* ============ Header / Footer ============ */
  const NAV_ITEMS = [
    { key: 'admin',     href: '/admin.html',     icon: 'search',   label: '人才查詢' },
    { key: 'matching',  href: '/matching.html',  icon: 'sparkle',  label: '人才媒合' },
    { key: 'roster',    href: '/roster.html',    icon: 'list',     label: '服務名單' },
    { key: 'dashboard', href: '/dashboard.html', icon: 'chart',    label: '儀表板' },
  ];
  function renderHeader(activeKey, options = {}) {
    const isAdmin = !!auth.token();
    const items = isAdmin ? NAV_ITEMS.map(n =>
      `<a href="${n.href}" class="${n.key === activeKey ? 'active' : ''}">${icon(n.icon)}${n.label}</a>`
    ).join('') : '';
    const logoutBtn = isAdmin
      ? `<a href="#" onclick="auth.logout();return false;">${icon('logout')}登出</a>`
      : '';
    return `<header class="site-header">
      <h1>
        <span class="logo-mark">${icon('cross', 16)}</span>
        <span>${options.title || '愛德人才服務平台'}</span>
      </h1>
      <nav>${items}${logoutBtn}</nav>
    </header>`;
  }
  function renderFooter() {
    return `<footer class="site-footer">
      <div>天主教會愛德人才服務平台 · 因主之名服務</div>
      <div class="mt-1">
        <a href="/index.html">回首頁</a> ·
        <a href="/privacy.html">隱私權</a> ·
        <a href="/help.html">使用說明</a>
      </div>
      <div class="mt-1 muted-2" style="font-size:0.78rem;">
        &copy; ${new Date().getFullYear()} · 凡你們對我這些最小兄弟中的一個所做的,就是對我做的(瑪 25:40)
      </div>
    </footer>`;
  }
  function injectHeaderFooter(activeKey, options) {
    document.body.insertAdjacentHTML('afterbegin', renderHeader(activeKey, options));
    document.body.insertAdjacentHTML('beforeend', renderFooter());
  }

  /* ============ exports ============ */
  window.api = api;
  window.auth = auth;
  window.ui = {
    toast, alert, badge, formatDate, formatDateTime,
    icon, loading, empty, confirm: confirmDialog,
    renderHeader, renderFooter, injectHeaderFooter,
  };
})();
