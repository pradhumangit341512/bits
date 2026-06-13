const tabs = document.querySelectorAll('.tab');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const errorEl = document.getElementById('auth-error');
const titleEl = document.getElementById('auth-title');
const subEl = document.getElementById('auth-sub');
const robotBox = document.getElementById('robot-check');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (name === 'signup') {
    titleEl.textContent = 'Create your account';
    subEl.textContent = 'Start shortening and tracking your links.';
  } else {
    titleEl.textContent = 'Welcome back';
    subEl.textContent = 'Sign in to manage your links.';
  }
}

tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
if (location.hash === '#signup') selectTab('signup');

// Visual state for the "I'm not a robot" box.
document.getElementById('signup-human').addEventListener('change', (e) => {
  robotBox.classList.toggle('checked', e.target.checked);
});

async function submitAuth(endpoint, body) {
  clearError();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    showError(data.error || 'Something went wrong.');
    return;
  }
  location.href = '/dashboard';
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearError();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!EMAIL_RE.test(email)) return showError('Please enter a valid email address.');
  if (!password) return showError('Please enter your password.');
  submitAuth('/api/auth/login', { email, password }).catch(() => showError('Network error.'));
});

signupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearError();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm = document.getElementById('signup-confirm').value;
  const human = document.getElementById('signup-human').checked;
  const terms = document.getElementById('signup-terms').checked;

  if (!EMAIL_RE.test(email)) return showError('Please enter a valid email address.');
  if (password.length < 8) return showError('Password must be at least 8 characters.');
  if (password !== confirm) return showError('Passwords do not match.');
  if (!human) return showError("Please confirm you're not a robot.");
  if (!terms) return showError('Please accept the Terms to continue.');

  submitAuth('/api/auth/signup', { email, password, confirmPassword: confirm, human })
    .catch(() => showError('Network error.'));
});
