/* =============================================
   Global Vision Portal - Login Script
   ============================================= */

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

async function handleLogin(event) {
    event.preventDefault();

    const email = (document.getElementById('email').value || '').trim();
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    if (!email || !password) {
        showLoginMessage('Please enter email/username and password', 'error');
        return;
    }

    if (email.includes('@') && !validateEmail(email)) {
        showLoginMessage('Please enter a valid email address', 'error');
        return;
    }

    const btn = document.getElementById('loginBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" style="animation:spin .7s linear infinite;transform-origin:center;"/></svg> Signing in…'; }

    try {
        const result = await authenticateUser(email, password);

        if (!result) {
            showLoginMessage('Invalid email or password', 'error');
            return;
        }

        if (result.error) {
            showLoginMessage(result.error, 'error');
            return;
        }

        if (!isValidJwt(getToken())) {
            showLoginMessage('Login could not start a session. Ensure the backend is running and try again.', 'error');
            return;
        }

        if (rememberMe) {
            localStorage.setItem('rememberEmail', email);
        } else {
            localStorage.removeItem('rememberEmail');
        }

        showLoginMessage('Login successful! Redirecting…', 'success');
        const target = isAdmin() ? 'admin-dashboard.html' : 'dashboard.html';
        setTimeout(() => { window.location.href = target; }, 500);
    } catch (error) {
        console.error('Login error:', error);
        showLoginMessage(error.message || 'An error occurred. Please try again.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Sign In';
        }
    }
}

function showLoginMessage(message, type) {
    const el = document.getElementById('loginMessage');
    if (!el) return;
    el.className = `login-message ${type}`;
    el.textContent = message;
    el.style.display = 'block';
    if (type === 'error') {
        setTimeout(() => { el.style.display = 'none'; }, 7000);
    }
}

window.addEventListener('load', function() {
    const params = new URLSearchParams(window.location.search);
    const emailFromUrl = params.get('email');
    const rememberEmail = localStorage.getItem('rememberEmail');
    const emailField = document.getElementById('email');

    if (emailFromUrl && emailField) {
        emailField.value = emailFromUrl;
    } else if (rememberEmail && emailField) {
        emailField.value = rememberEmail;
        const remember = document.getElementById('rememberMe');
        if (remember) remember.checked = true;
    }

    if (isValidJwt(getToken()) && getUser()) {
        window.location.href = isAdmin() ? 'admin-dashboard.html' : 'dashboard.html';
    } else {
        removeToken();
        removeUser();
    }
});
