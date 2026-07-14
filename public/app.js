const form = document.getElementById('shorten-form');
const urlInput = document.getElementById('url-input');
const codeInput = document.getElementById('code-input');
const shortenBtn = document.getElementById('shorten-btn');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const shortLink = document.getElementById('short-link');
const copyBtn = document.getElementById('copy-btn');
const clicksEl = document.getElementById('clicks');
const refreshBtn = document.getElementById('refresh-btn');
const navLinks = document.getElementById('nav-links');
const qrImg = document.getElementById('qr-img');
const qrDownload = document.getElementById('qr-download');
const qrToggle = document.getElementById('qr-toggle');
const qrBox = document.getElementById('qr-box');
const togglePassword = document.getElementById('toggle-password');
const toggleExpiry = document.getElementById('toggle-expiry');
const passwordField = document.getElementById('password-field');
const expiryField = document.getElementById('expiry-field');
const passwordInput = document.getElementById('password-input');
const expirySelect = document.getElementById('expiry-select');
const resultMeta = document.getElementById('result-meta');

let currentCode = null;

const EXPIRY_LABELS = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days' };

// Reveal/hide an optional field and reflect state on its toggle chip.
function wireToggle(btn, field) {
  if (!btn || !field) return;
  btn.addEventListener('click', () => {
    const opening = field.hidden;
    field.hidden = !opening;
    btn.setAttribute('aria-pressed', String(opening));
    btn.classList.toggle('active', opening);
    if (opening) {
      const input = field.querySelector('input, select');
      if (input) input.focus();
    }
  });
}
wireToggle(togglePassword, passwordField);
wireToggle(toggleExpiry, expiryField);

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.textContent = '';
  errorEl.hidden = true;
}

// Render the nav based on auth state.
async function renderNav() {
  try {
    const res = await fetch('/api/me');
    const { user } = await res.json();
    if (user) {
      navLinks.innerHTML = `
        <a href="/dashboard">Dashboard</a>
        <span class="nav-email">${user.email}</span>
        <button type="button" id="logout-btn" class="link-btn">Log out</button>`;
      document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        renderNav();
      });
    } else {
      navLinks.innerHTML = `<a href="/login">Log in</a> <a href="/login#signup" class="btn-link">Sign up</a>`;
    }
  } catch {
    navLinks.innerHTML = `<a href="/login">Log in</a>`;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  resultEl.hidden = true;
  shortenBtn.disabled = true;

  try {
    const body = { url: urlInput.value.trim() };
    const custom = codeInput.value.trim();
    if (custom) body.code = custom;
    const password = passwordInput ? passwordInput.value : '';
    if (password) body.password = password;
    const expiresIn = expirySelect ? expirySelect.value : '';
    if (expiresIn) body.expiresIn = expiresIn;

    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Could not shorten that URL.');
      return;
    }

    currentCode = data.code;
    shortLink.textContent = data.shortUrl;
    shortLink.href = data.shortUrl;
    clicksEl.textContent = '0 clicks';
    const qrUrl = `/qr/${encodeURIComponent(data.code)}.svg`;
    qrImg.src = qrUrl;
    qrDownload.href = qrUrl;
    qrDownload.setAttribute('download', `${data.code}-qr.svg`);

    // Each new link starts with the QR panel collapsed.
    if (qrBox && qrToggle) {
      qrBox.hidden = true;
      qrToggle.setAttribute('aria-expanded', 'false');
      qrToggle.textContent = 'Show QR code';
    }

    // Summarize any protection/expiry on the new link.
    if (resultMeta) {
      const notes = [];
      if (data.passwordProtected) notes.push('🔒 Password protected');
      if (data.expiresAt && EXPIRY_LABELS[expiresIn]) notes.push(`⏳ Expires in ${EXPIRY_LABELS[expiresIn]}`);
      else if (data.expiresAt) notes.push('⏳ Expires');
      resultMeta.textContent = notes.join(' · ');
      resultMeta.hidden = notes.length === 0;
    }

    resultEl.hidden = false;
    // Reset optional inputs + toggles for the next link.
    codeInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (expirySelect) expirySelect.value = '';
    [ [togglePassword, passwordField], [toggleExpiry, expiryField] ].forEach(([b, f]) => {
      if (!b || !f) return;
      f.hidden = true;
      b.setAttribute('aria-pressed', 'false');
      b.classList.remove('active');
    });
  } catch {
    showError('Network error. Is the server running?');
  } finally {
    shortenBtn.disabled = false;
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shortLink.textContent);
    copyBtn.textContent = 'Copied ✓';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
      copyBtn.classList.remove('copied');
    }, 1500);
  } catch {
    showError('Could not copy to clipboard.');
  }
});

// Show / hide the QR code panel.
if (qrToggle && qrBox) {
  qrToggle.addEventListener('click', () => {
    const show = qrBox.hidden;
    qrBox.hidden = !show;
    qrToggle.setAttribute('aria-expanded', String(show));
    qrToggle.textContent = show ? 'Hide QR code' : 'Show QR code';
  });
}

refreshBtn.addEventListener('click', async () => {
  if (!currentCode) return;
  try {
    const res = await fetch(`/api/stats/${currentCode}`);
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Could not load stats.');
      return;
    }
    const n = data.clicks;
    clicksEl.textContent = `${n} ${n === 1 ? 'click' : 'clicks'}`;
  } catch {
    showError('Network error while refreshing stats.');
  }
});

renderNav();
