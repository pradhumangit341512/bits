const navLinks = document.getElementById('nav-links');
const createForm = document.getElementById('create-form');
const urlInput = document.getElementById('url-input');
const codeInput = document.getElementById('code-input');
const createBtn = document.getElementById('create-btn');
const errorEl = document.getElementById('error');
const linksBody = document.getElementById('links-body');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}
function clearError() {
  errorEl.textContent = '';
  errorEl.hidden = true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtDate(s) {
  // created_at is stored as "YYYY-MM-DD HH:MM:SS" (UTC).
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? s : d.toLocaleDateString();
}

// Require login; redirect out if not authenticated.
async function ensureAuth() {
  const res = await fetch('/api/me');
  const { user } = await res.json();
  if (!user) {
    location.href = '/login';
    return null;
  }
  navLinks.innerHTML = `
    <a href="/">Home</a>
    <span class="nav-email">${escapeHtml(user.email)}</span>
    <button type="button" id="logout-btn" class="link-btn">Log out</button>`;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/';
  });
  return user;
}

function render(links) {
  if (!links.length) {
    linksBody.innerHTML = '<tr><td colspan="5" class="muted">No links yet — create one above.</td></tr>';
    return;
  }
  linksBody.innerHTML = links
    .map(
      (l) => `
      <tr data-code="${escapeHtml(l.code)}">
        <td data-label="Short URL"><a href="${escapeHtml(l.shortUrl)}" target="_blank" rel="noopener">${escapeHtml(l.shortUrl)}</a></td>
        <td class="dest" data-label="Destination"><span class="dest-text">${escapeHtml(l.original)}</span></td>
        <td data-label="Clicks">${l.clicks}</td>
        <td data-label="Created">${fmtDate(l.createdAt)}</td>
        <td class="actions">
          <button type="button" class="link-btn" data-act="copy" title="Copy short link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            <span class="btn-label">Copy</span>
          </button>
          <button type="button" class="link-btn" data-act="qr" title="Show QR code">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
            <span class="btn-label">QR</span>
          </button>
          <button type="button" class="link-btn" data-act="edit" title="Edit destination">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            <span class="btn-label">Edit</span>
          </button>
          <button type="button" class="link-btn danger" data-act="delete" title="Delete link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span class="btn-label">Delete</span>
          </button>
        </td>
      </tr>`
    )
    .join('');
}

async function loadLinks() {
  try {
    const res = await fetch('/api/links');
    if (res.status === 401) {
      location.href = '/login';
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Could not load links.');
      return;
    }
    render(data.links);
  } catch {
    showError('Network error loading links.');
  }
}

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  createBtn.disabled = true;
  try {
    const body = { url: urlInput.value.trim() };
    const custom = codeInput.value.trim();
    if (custom) body.code = custom;

    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Could not create link.');
      return;
    }
    urlInput.value = '';
    codeInput.value = '';
    loadLinks();
  } catch {
    showError('Network error.');
  } finally {
    createBtn.disabled = false;
  }
});

// Event delegation for per-row actions.
linksBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const row = btn.closest('tr');
  const code = row.dataset.code;
  const act = btn.dataset.act;

  if (act === 'copy') {
    const url = row.querySelector('a').textContent;
    const label = btn.querySelector('.btn-label');
    try {
      await navigator.clipboard.writeText(url);
      label.textContent = 'Copied!';
      setTimeout(() => (label.textContent = 'Copy'), 1500);
    } catch {
      showError('Could not copy.');
    }
    return;
  }

  if (act === 'qr') {
    window.open(`/qr/${encodeURIComponent(code)}.svg`, '_blank', 'noopener');
    return;
  }

  if (act === 'delete') {
    if (!confirm('Delete this link? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/links/${encodeURIComponent(code)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError(data.error || 'Could not delete.');
        return;
      }
      loadLinks();
    } catch {
      showError('Network error.');
    }
    return;
  }

  if (act === 'edit') {
    startEdit(row, code);
  }
});

// Inline edit of the destination URL only.
function startEdit(row, code) {
  const cell = row.querySelector('.dest');
  const current = cell.querySelector('.dest-text').textContent;
  cell.innerHTML = `
    <div class="edit-row">
      <input type="url" class="edit-input" value="${escapeHtml(current)}" />
      <button type="button" class="link-btn" data-edit="save">Save</button>
      <button type="button" class="link-btn" data-edit="cancel">Cancel</button>
    </div>`;
  const input = cell.querySelector('.edit-input');
  input.focus();

  cell.querySelector('[data-edit="cancel"]').addEventListener('click', () => loadLinks());
  cell.querySelector('[data-edit="save"]').addEventListener('click', async () => {
    clearError();
    try {
      const res = await fetch(`/api/links/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input.value.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'Could not save.');
        return;
      }
      loadLinks();
    } catch {
      showError('Network error.');
    }
  });
}

(async () => {
  const user = await ensureAuth();
  if (user) loadLinks();
})();
