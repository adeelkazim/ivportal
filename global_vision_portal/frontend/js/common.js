/* =============================================
   Global Vision Portal - Common Utilities
   ============================================= */

// ===== API Configuration =====
const TOKEN_KEY = 'authToken';
const USER_KEY = 'currentUser';
const DEFAULT_API_PORT = '3001';

function resolveApiBaseUrl() {
    if (window.PORTAL_API_BASE && String(window.PORTAL_API_BASE).trim()) {
        return String(window.PORTAL_API_BASE).trim().replace(/\/$/, '');
    }

    const stored = localStorage.getItem('portalApiBase');
    if (stored && String(stored).trim()) {
        return String(stored).trim().replace(/\/$/, '');
    }

    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    let host = window.location.hostname;

    if (!host || host === 'null' || host === '') {
        host = '127.0.0.1';
    }

    const port = DEFAULT_API_PORT;
    return `${protocol}//${host}:${port}/api`;
}

function buildApiUrl(endpoint) {
    const base = resolveApiBaseUrl();
    if (!endpoint) return base;
    const path = String(endpoint).startsWith('/') ? endpoint : `/${endpoint}`;
    return `${base}${path}`;
}

/** @deprecated use buildApiUrl() or resolveApiBaseUrl() */
/** @deprecated use buildApiUrl() or resolveApiBaseUrl() */
const API_BASE_URL = resolveApiBaseUrl();

// ===== Local Storage Utilities =====
function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function removeToken() {
    localStorage.removeItem(TOKEN_KEY);
}

function setUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function getUser() {
    const user = localStorage.getItem(USER_KEY);
    if (!user) return null;
    const parsed = JSON.parse(user);
    const id = parsed.id || parsed.EmployeeID;
    return {
        EmployeeID: id != null ? parseInt(id, 10) : null,
        Name: parsed.name || parsed.Name,
        Email: parsed.email || parsed.Email,
        Role: parsed.role || parsed.Role,
        Contact: parsed.contact || parsed.Contact,
        Username: parsed.username || parsed.Username || null,
        profileImageUrl: parsed.profileImageUrl || parsed.ProfileImageUrl || null,
    };
}

function isValidJwt(token) {
    return token && typeof token === 'string' && token.split('.').length === 3;
}

function isPublicApiEndpoint(endpoint) {
    return /^\/auth\/(login|register)/.test(endpoint) || endpoint === '/teams';
}

function removeUser() {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('allowedScreens');
}

async function cacheAllowedScreens() {
    if (!isValidJwt(getToken())) return;
    try {
        const res = await apiCall('/me/screens');
        const keys = ((res && res.screens) || []).map(s => s.ScreenKey || s.screenKey);
        localStorage.setItem('allowedScreens', JSON.stringify(keys));
    } catch (e) {
        console.warn('Screen permissions not loaded', e);
    }
}

// ===== Authentication Check =====
function isAuthenticated() {
    const token = getToken();
    return isValidJwt(token) || getUser() !== null;
}

function checkAuth() {
    const token = getToken();
    if (!isValidJwt(token)) {
        removeToken();
        removeUser();
        window.location.href = 'login.html';
        return false;
    }
    if (!getUser()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

function isAdmin() {
    const user = getUser();
    return user && (user.Role === 'Admin' || user.Role === 'SuperAdmin');
}

function isManagerOrAdmin() {
    const user = getUser();
    return user && (user.Role === 'Admin' || user.Role === 'SuperAdmin' || user.Role === 'Manager');
}

function isFinanceManager() {
    const user = getUser();
    return user && (user.Role === 'Admin' || user.Role === 'SuperAdmin' || user.Role === 'FinanceManager');
}

function isTeamLead() {
    const user = getUser();
    return user && (user.Role === 'TeamLead' || user.Role === 'Manager' || user.Role === 'Admin' || user.Role === 'SuperAdmin');
}

// ===== API Call Wrapper =====
async function apiCall(endpoint, options = {}) {
    const url = buildApiUrl(endpoint);
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    const token = getToken();
    if (token && isValidJwt(token) && !isPublicApiEndpoint(endpoint)) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers
        });
    } catch (error) {
        const msg = error && error.message ? error.message : String(error);
        if (/failed to fetch|parse url|network/i.test(msg)) {
            throw new Error(`Cannot reach API at ${resolveApiBaseUrl()}. Start the backend (npm start in backend folder).`);
        }
        throw error;
    }

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
        removeToken();
        if (!isPublicApiEndpoint(endpoint)) {
            throw new Error('Session expired. Please log in again.');
        }
        return null;
    }

    if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }

    return data;
}

// ===== Message Display =====
function showMessage(message, type = 'info', elementId = 'profileMessage') {
    const messageEl = document.getElementById(elementId);
    if (messageEl) {
        messageEl.className = `message ${type}`;
        messageEl.textContent = message;
        messageEl.style.display = 'block';

        // Auto-hide after 5 seconds
        setTimeout(() => {
            messageEl.style.display = 'none';
        }, 5000);
    }
}

// ===== Modal Management =====
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

// Setup modal close buttons
document.addEventListener('DOMContentLoaded', function() {
    const modals = document.querySelectorAll('.modal');
    
    modals.forEach(modal => {
        const closeBtn = modal.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                modal.style.display = 'none';
            });
        }

        window.addEventListener('click', function(event) {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    });

    // Setup logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logout();
        });
    }

    // Populate user info in navbar
    const user = getUser();
    const employeeName = document.getElementById('employeeName');
    const employeeRole = document.getElementById('employeeRole');
    
    if (employeeName && user) {
        employeeName.textContent = user.Name || 'Employee';
    }
    
    if (employeeRole && user) {
        employeeRole.textContent = user.Role || 'Employee';
    }
});

// ===== Logout Function =====
function logout() {
    removeToken();
    removeUser();
    window.location.href = 'login.html';
}

// ===== Date Utilities =====
function formatDate(dateString) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString('en-US', options);
}

function formatDateTime(dateString) {
    const options = { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };
    return new Date(dateString).toLocaleDateString('en-US', options);
}

function formatTime(dateString) {
    const options = { 
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    return new Date(dateString).toLocaleTimeString('en-US', options);
}

// ===== String Utilities =====
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function truncateString(string, length = 100) {
    return string.length > length ? string.substring(0, length) + '...' : string;
}

// ===== Form Validation =====
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validatePassword(password) {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    return passwordRegex.test(password);
}

// ===== Authentication Functions =====
async function authenticateUser(emailOrLogin, password) {
    removeToken();
    const login = (emailOrLogin || '').trim();
    const loginLower = login.toLowerCase();

    const url = buildApiUrl('/auth/login');
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: login, password }),
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok && data.success && data.user && data.token) {
            setToken(data.token);
            const user = data.user;
            const normalized = {
                EmployeeID:      parseInt(user.id || user.EmployeeID, 10),
                Name:            user.name  || user.Name,
                Email:           user.email || user.Email,
                Role:            user.role  || user.Role,
                Contact:         user.contact  || user.Contact,
                Username:        user.username || user.Username || null,
                profileImageUrl: user.profileImageUrl || user.ProfileImageUrl || null,
            };
            setUser(normalized);
            await cacheAllowedScreens();
            return normalized;
        }

        if (response.status === 503) {
            return { error: data.error || 'Database unavailable. Start the backend (npm start).' };
        }
        if (response.status === 403) {
            return { error: data.error || 'Account deactivated.' };
        }
        return { error: data.error || 'Invalid email/username or password' };
    } catch (error) {
        const msg = error && error.message ? error.message : String(error);
        if (/failed to fetch|cannot reach/i.test(msg)) {
            return { error: `Cannot reach API at ${resolveApiBaseUrl()}. Start the backend (npm start in backend folder).` };
        }
        return { error: msg || 'Login failed. Check that the server is running.' };
    }

    return { error: 'Invalid email/username or password' };
}

async function registerUserLocally() {
    return {
        success: false,
        error: 'Self-registration is disabled. Contact your administrator for an account.',
    };
}

async function recordAttendanceLogin(employeeId) {
    try {
        await apiCall('/attendance/login', {
            method: 'POST',
            body: JSON.stringify({ employeeId })
        });
    } catch (error) {
        console.warn('Could not record attendance login:', error);
    }
}

async function recordAttendanceLogout(employeeId) {
    try {
        await apiCall('/attendance/logout', {
            method: 'POST',
            body: JSON.stringify({ employeeId })
        });
    } catch (error) {
        console.warn('Could not record attendance logout:', error);
    }
}

function showLoginMessage(message, type = 'info') {
    const messageDiv = document.getElementById('loginMessage');
    if (messageDiv) {
        messageDiv.className = `message message-${type}`;
        messageDiv.textContent = message;
        messageDiv.style.display = 'block';
    }
}

// ===== File Upload (multipart/form-data) =====
async function apiUpload(endpoint, formData) {
    const url = buildApiUrl(endpoint);
    const token = getToken();
    const headers = {};
    if (token && isValidJwt(token)) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    let response;
    try {
        response = await fetch(url, { method: 'POST', headers, body: formData });
    } catch (error) {
        throw new Error(`Cannot reach API at ${resolveApiBaseUrl()}. Start the backend.`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP error! status: ${response.status}`);
    return data;
}

// ===== Export for use in other scripts =====
// (These are already in global scope, but noting for clarity)
