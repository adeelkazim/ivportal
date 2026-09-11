/* =============================================
   Global Vision Portal - Sign Up Script
   ============================================= */

document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signupForm');
    
    if (signupForm) {
        signupForm.addEventListener('submit', handleSignup);
    }
});

async function handleSignup(event) {
    event.preventDefault();
    
    const fullName = document.getElementById('fullName').value;
    const email = document.getElementById('signupEmail').value;
    const department = document.getElementById('department').value;
    const contact = document.getElementById('contact').value;
    const role = document.getElementById('role').value;
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const messageDiv = document.getElementById('signupMessage');

    // Validation
    if (!fullName || !email || !department || !contact || !role || !password || !confirmPassword) {
        showSignupMessage('Please fill in all fields', 'error');
        return;
    }

    if (!validateEmail(email)) {
        showSignupMessage('Please enter a valid email address', 'error');
        return;
    }

    if (password.length < 8) {
        showSignupMessage('Password must be at least 8 characters', 'error');
        return;
    }

    if (password !== confirmPassword) {
        showSignupMessage('Passwords do not match', 'error');
        return;
    }

    try {
        // Try to register with backend
        const response = await apiCall('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ 
                name: fullName,
                email: email,
                department: department,
                contact: contact,
                password: password,
                role: role
            })
        });

        if (response.success) {
            showSignupMessage('Account created successfully! Redirecting to login...', 'success');
            setTimeout(() => {
                window.location.href = 'login.html?email=' + encodeURIComponent(email);
            }, 2000);
        } else {
            showSignupMessage(response.error || 'Registration failed', 'error');
        }
    } catch (error) {
        console.log('Backend registration failed, using local storage:', error);
        // Fallback to local registration (localStorage)
        const result = await registerUserLocally(fullName, email, department, contact, password, role);
        if (result.success) {
            showSignupMessage('Account created successfully! Redirecting to login...', 'success');
            setTimeout(() => {
                window.location.href = 'login.html?email=' + encodeURIComponent(email);
            }, 2000);
        } else {
            showSignupMessage(result.error, 'error');
        }
    }
}

function showSignupMessage(message, type = 'info') {
    const messageDiv = document.getElementById('signupMessage');
    if (messageDiv) {
        messageDiv.className = `message message-${type}`;
        messageDiv.textContent = message;
        messageDiv.style.display = 'block';
    }
}
