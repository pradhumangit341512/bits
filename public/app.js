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

let currentCode = null;

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
    resultEl.hidden = false;
    codeInput.value = '';
  } catch {
    showError('Network error. Is the server running?');
  } finally {
    shortenBtn.disabled = false;
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shortLink.textContent);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 1500);
  } catch {
    showError('Could not copy to clipboard.');
  }
});

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
