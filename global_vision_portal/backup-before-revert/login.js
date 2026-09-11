/* =============================================
   Global Vision Portal - Login Script
   ============================================= */

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const messageDiv = document.getElementById('loginMessage');

    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

async function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('rememberMe').checked;
    const messageDiv = document.getElementById('loginMessage');

    // Validation
    if (!email || !password) {
        showLoginMessage('Please enter email and password', 'error');
        return;
    }

    if (!validateEmail(email)) {
        showLoginMessage('Please enter a valid email address', 'error');
        return;
    }

    try {
        // For demo purposes, we'll use mock authentication
        // In production, this would call your backend API
        const user = await authenticateUser(email, password);

        if (user) {
            if (rememberMe) {
                localStorage.setItem('rememberEmail', email);
            } else {
                localStorage.removeItem('rememberEmail');
            }

            showLoginMessage('Login successful! Redirecting...', 'success');

            // Redirect to dashboard
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 800);
        } else {
            showLoginMessage('Invalid email or password', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showLoginMessage('An error occurred during login. Please try again.', 'error');
    }
}

function showLoginMessage(message, type) {
    const messageDiv = document.getElementById('loginMessage');
    if (messageDiv) {
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        messageDiv.style.display = 'block';

        if (type === 'error') {
            setTimeout(() => {
                messageDiv.style.display = 'none';
            }, 5000);
        }
    }
}

// Restore email if "Remember Me" was checked
window.addEventListener('load', function() {
    const params = new URLSearchParams(window.location.search);
    const emailFromUrl = params.get('email');
    const rememberEmail = localStorage.getItem('rememberEmail');
    const emailField = document.getElementById('email');

    if (emailFromUrl && emailField) {
        emailField.value = emailFromUrl;
    } else if (rememberEmail && emailField) {
        emailField.value = rememberEmail;
        document.getElementById('rememberMe').checked = true;
    }

    if (isAuthenticated()) {
        window.location.href = 'dashboard.html';
    }
});
