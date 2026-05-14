/**
 * Cookie Inspector – popup.js
 *
 * Responsibilities:
 *  1. Get the active tab URL → extract domain
 *  2. Query all cookies for that domain (and parent domains)
 *  3. Render cookie cards with collapse/expand, copy, tags
 *  4. Live search / filter
 *  5. Export filtered cookies as JSON
 *  6. Refresh button
 *  7. Toast notifications
 */

'use strict';

/* ================================================================
   DOM refs
   ================================================================ */
const domainEl       = document.getElementById('current-domain');
const searchInput    = document.getElementById('search-input');
const searchClear    = document.getElementById('search-clear');
const cookieList     = document.getElementById('cookie-list');
const emptyState     = document.getElementById('empty-state');
const emptySubText   = document.getElementById('empty-sub-text');
const statTotal      = document.getElementById('stat-total');
const statHttpOnly   = document.getElementById('stat-httponly');
const statSecure     = document.getElementById('stat-secure');
const statSession    = document.getElementById('stat-session');
const filteredCount  = document.getElementById('filtered-count');
const btnRefresh     = document.getElementById('btn-refresh');
const btnExport      = document.getElementById('btn-export');
const toastEl        = document.getElementById('toast');

/* ================================================================
   State
   ================================================================ */
let allCookies    = [];   // full cookie list for current domain
let currentDomain = '';   // e.g. "bilibili.com"
let currentUrl    = '';   // full URL of the active tab
let toastTimer    = null;

/* ================================================================
   Helpers
   ================================================================ */

/**
 * Extract registrable domain from a URL.
 * e.g. "https://www.bilibili.com/video/xxx" → "bilibili.com"
 */
function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch (_) {
    return url;
  }
}

/**
 * Get all parent-domain variants for a hostname so we can query
 * cookies that may be set on ".example.com" for "sub.example.com".
 * Returns an array like ["sub.bilibili.com", "bilibili.com", ".bilibili.com", ".sub.bilibili.com"]
 */
function getDomainVariants(hostname) {
  const variants = new Set();
  // The hostname itself and with leading dot
  variants.add(hostname);
  variants.add('.' + hostname);
  // Walk up the domain tree
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    variants.add(parent);
    variants.add('.' + parent);
  }
  return Array.from(variants);
}

/**
 * Format a cookie expiration date.
 * expirationDate is Unix timestamp (seconds). Returns a readable string.
 */
function formatExpiry(cookie) {
  if (cookie.session || !cookie.expirationDate) {
    return 'Session';
  }
  const d = new Date(cookie.expirationDate * 1000);
  const now = Date.now();
  if (cookie.expirationDate * 1000 < now) {
    return '已过期';
  }
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Truncate a string to maxLen with ellipsis.
 */
function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen) + '…';
}

/**
 * Escape HTML special chars.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Highlight query text in a string (case-insensitive).
 * Returns HTML string.
 */
function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return escapeHtml(text).replace(re, '<span class="highlight">$1</span>');
}

/* ================================================================
   Toast
   ================================================================ */
function showToast(msg, duration = 1800) {
  if (toastTimer) clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  // force reflow so transition fires
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => toastEl.classList.add('hidden'), 300);
  }, duration);
}

/* ================================================================
   Copy to clipboard
   ================================================================ */
async function copyText(text, btnEl) {
  try {
    await navigator.clipboard.writeText(text);
    const origHTML = btnEl.innerHTML;
    btnEl.classList.add('copied');
    btnEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      btnEl.classList.remove('copied');
      btnEl.innerHTML = origHTML;
    }, 1200);
    showToast('✓ 已复制到剪贴板');
  } catch (_) {
    showToast('复制失败，请手动复制');
  }
}

/* ================================================================
   Render a single cookie card
   ================================================================ */
function buildCard(cookie, query) {
  const card = document.createElement('div');
  card.className = 'cookie-card';

  // ---- Tags ----
  const tags = [];
  if (cookie.httpOnly) tags.push('<span class="tag tag-httponly">HttpOnly</span>');
  if (cookie.secure)   tags.push('<span class="tag tag-secure">Secure</span>');
  if (cookie.session || !cookie.expirationDate) tags.push('<span class="tag tag-session">Session</span>');
  if (cookie.sameSite && cookie.sameSite !== 'unspecified') {
    tags.push(`<span class="tag tag-samesite">SameSite:${cookie.sameSite}</span>`);
  }

  // ---- Value display ----
  const rawValue    = cookie.value || '';
  const shortValue  = truncate(rawValue, 40);
  const isLong      = rawValue.length > 40;
  const valueId     = `val-${Math.random().toString(36).slice(2)}`;

  // ---- Expiry ----
  const expiry      = formatExpiry(cookie);
  const isExpired   = expiry === '已过期';

  // ---- Highlighted name / domain ----
  const nameHtml   = highlight(cookie.name   || '(无名称)', query);
  const domainHtml = highlight(cookie.domain || '', query);

  // ---- Build inner HTML ----
  card.innerHTML = `
    <div class="card-top">
      <span class="card-name">${nameHtml}</span>
      <div class="card-actions">
        <button class="card-action-btn btn-copy-name" title="复制名称">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button class="card-action-btn btn-copy-val" title="复制值">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
            <line x1="20" y1="6" x2="9" y2="17"/>
          </svg>
        </button>
      </div>
    </div>

    ${tags.length ? `<div class="card-tags">${tags.join('')}</div>` : ''}

    <div class="card-value-wrap">
      <span class="card-value-label">值:</span>
      <span class="card-value collapsed" id="${valueId}">${escapeHtml(shortValue)}</span>
      ${isLong ? `<span class="value-toggle" data-expanded="false" data-valueid="${valueId}" data-full="${escapeHtml(rawValue)}" data-short="${escapeHtml(shortValue)}">展开</span>` : ''}
    </div>

    <div class="card-meta">
      <span class="card-meta-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span class="meta-val">${domainHtml}</span>
      </span>
      <span class="card-meta-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="2" x2="12" y2="6"/>
          <line x1="12" y1="18" x2="12" y2="22"/>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
          <line x1="2" y1="12" x2="6" y2="12"/>
          <line x1="18" y1="12" x2="22" y2="12"/>
          <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
          <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
        </svg>
        <span class="meta-val ${isExpired ? 'meta-expired' : ''}">${escapeHtml(expiry)}</span>
      </span>
      <span class="card-meta-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <span class="meta-val">${escapeHtml(cookie.path || '/')}</span>
      </span>
    </div>
  `;

  // ---- Event: copy name ----
  card.querySelector('.btn-copy-name').addEventListener('click', (e) => {
    e.stopPropagation();
    copyText(cookie.name || '', e.currentTarget);
  });

  // ---- Event: copy value ----
  card.querySelector('.btn-copy-val').addEventListener('click', (e) => {
    e.stopPropagation();
    copyText(cookie.value || '', e.currentTarget);
  });

  // ---- Event: expand / collapse value ----
  const toggle = card.querySelector('.value-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.dataset.expanded === 'true';
      const valEl    = document.getElementById(toggle.dataset.valueid);
      if (expanded) {
        valEl.textContent = toggle.dataset.short;
        valEl.classList.add('collapsed');
        toggle.textContent = '展开';
        toggle.dataset.expanded = 'false';
      } else {
        valEl.textContent = toggle.dataset.full;
        valEl.classList.remove('collapsed');
        toggle.textContent = '收起';
        toggle.dataset.expanded = 'true';
      }
    });
  }

  return card;
}

/* ================================================================
   Render cookie list
   ================================================================ */
function renderCookies(cookies, query) {
  cookieList.innerHTML = '';

  if (cookies.length === 0) {
    emptyState.classList.remove('hidden');
    emptySubText.textContent = query
      ? `没有匹配 "${query}" 的 Cookie`
      : (currentDomain ? `${currentDomain} 下没有 Cookie` : '当前页面没有 Cookie');
    cookieList.style.display = 'none';
    filteredCount.textContent = '';
    return;
  }

  emptyState.classList.add('hidden');
  cookieList.style.display = 'flex';

  const frag = document.createDocumentFragment();
  cookies.forEach(c => frag.appendChild(buildCard(c, query)));
  cookieList.appendChild(frag);

  // Show filter info
  if (query) {
    filteredCount.textContent = `显示 ${cookies.length} / ${allCookies.length} 个`;
  } else {
    filteredCount.textContent = '';
  }
}

/* ================================================================
   Update stats bar
   ================================================================ */
function updateStats(cookies) {
  const total    = cookies.length;
  const httpOnly = cookies.filter(c => c.httpOnly).length;
  const secure   = cookies.filter(c => c.secure).length;
  const session  = cookies.filter(c => c.session || !c.expirationDate).length;

  statTotal.textContent   = `共 ${total} 个`;
  statHttpOnly.textContent = `HttpOnly: ${httpOnly}`;
  statSecure.textContent   = `Secure: ${secure}`;
  statSession.textContent  = `Session: ${session}`;
}

/* ================================================================
   Filter cookies by search query
   ================================================================ */
function getFilteredCookies(query) {
  if (!query) return allCookies;
  const q = query.toLowerCase();
  return allCookies.filter(c =>
    (c.name   || '').toLowerCase().includes(q) ||
    (c.domain || '').toLowerCase().includes(q)
  );
}

/* ================================================================
   Show loading state
   ================================================================ */
function showLoading() {
  cookieList.innerHTML = `
    <div class="loading-wrap">
      <div class="spinner"></div>
      <span>正在加载 Cookie…</span>
    </div>`;
  emptyState.classList.add('hidden');
  cookieList.style.display = 'flex';
}

/* ================================================================
   Main: load cookies for the active tab
   ================================================================ */
async function loadCookies() {
  showLoading();

  try {
    // 1. Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      allCookies = [];
      currentDomain = '无法获取页面';
      domainEl.textContent = currentDomain;
      updateStats([]);
      renderCookies([], '');
      return;
    }

    currentUrl = tab.url;
    currentDomain = extractDomain(currentUrl);
    domainEl.textContent = currentDomain;

    // 2. Query cookies via chrome.cookies.getAll
    //    We query for each domain variant to maximise coverage.
    //    chrome.cookies.getAll({ url }) is the most reliable method.
    let cookies = [];

    // Primary: use url-based query (covers subdomains and parent domains)
    const byCookieUrl = await chrome.cookies.getAll({ url: currentUrl });
    cookies.push(...byCookieUrl);

    // Supplement: also query by domain variants in case some cookies
    // are not returned by URL query (edge cases on some platforms)
    const variants = getDomainVariants(currentDomain);
    for (const domain of variants) {
      const extra = await chrome.cookies.getAll({ domain });
      cookies.push(...extra);
    }

    // Deduplicate by name+domain+path
    const seen = new Set();
    allCookies = cookies.filter(c => {
      const key = `${c.name}||${c.domain}||${c.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort: httpOnly first, then by name
    allCookies.sort((a, b) => {
      if (a.httpOnly && !b.httpOnly) return -1;
      if (!a.httpOnly && b.httpOnly) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    updateStats(allCookies);

    const query = searchInput.value.trim();
    const filtered = getFilteredCookies(query);
    renderCookies(filtered, query);

  } catch (err) {
    console.error('[Cookie Inspector] loadCookies error:', err);
    allCookies = [];
    domainEl.textContent = '加载失败';
    updateStats([]);
    cookieList.innerHTML = '';
    emptyState.classList.remove('hidden');
    emptySubText.textContent = '加载 Cookie 时出错: ' + (err.message || String(err));
    cookieList.style.display = 'none';
  }
}

/* ================================================================
   Export JSON
   ================================================================ */
function exportJson() {
  const query    = searchInput.value.trim();
  const filtered = getFilteredCookies(query);

  if (filtered.length === 0) {
    showToast('没有可导出的 Cookie');
    return;
  }

  const exportData = filtered.map(c => ({
    name:           c.name,
    value:          c.value,
    domain:         c.domain,
    path:           c.path,
    expirationDate: c.expirationDate || null,
    expires:        c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : 'Session',
    httpOnly:       c.httpOnly,
    secure:         c.secure,
    session:        c.session,
    sameSite:       c.sameSite,
    storeId:        c.storeId,
  }));

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const safeDomain = currentDomain.replace(/[^a-z0-9._-]/gi, '_');
  a.download = `cookies_${safeDomain}_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`✓ 已导出 ${exportData.length} 个 Cookie`);
}

/* ================================================================
   Event listeners
   ================================================================ */

// Search – real-time filter
searchInput.addEventListener('input', () => {
  const query    = searchInput.value.trim();
  const filtered = getFilteredCookies(query);

  // Toggle clear button
  if (query) {
    searchClear.classList.remove('hidden');
  } else {
    searchClear.classList.add('hidden');
  }

  renderCookies(filtered, query);
});

// Clear search
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.add('hidden');
  renderCookies(allCookies, '');
  searchInput.focus();
});

// Refresh
btnRefresh.addEventListener('click', () => {
  // Spin animation
  btnRefresh.classList.add('spinning');
  setTimeout(() => btnRefresh.classList.remove('spinning'), 650);
  loadCookies();
});

// Export
btnExport.addEventListener('click', exportJson);

/* ================================================================
   Init
   ================================================================ */
document.addEventListener('DOMContentLoaded', loadCookies);
