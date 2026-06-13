const tabs = document.querySelectorAll('.tab');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const errorEl = document.getElementById('auth-error');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.textContent = '';
  errorEl.hidden = true;
}

function selectTab(name) {
  clearError();
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  loginForm.hidden = name !== 'login';
  signupForm.hidden = name !== 'signup';
}

tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

// Allow /login#signup to open the signup tab directly.
if (location.hash === '#signup') selectTab('signup');

async function submitAuth(endpoint, email, password) {
  clearError();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    showError(data.error || 'Something went wrong.');
    return;
  }
  // Success → go to dashboard.
  location.href = '/dashboard';
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth(
    '/api/auth/login',
    document.getElementById('login-email').value.trim(),
    document.getElementById('login-password').value
  ).catch(() => showError('Network error.'));
});

signupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth(
    '/api/auth/signup',
    document.getElementById('signup-email').value.trim(),
    document.getElementById('signup-password').value
  ).catch(() => showError('Network error.'));
});
