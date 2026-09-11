/* =============================================
   Global Vision Portal - Common Utilities
   ============================================= */

// ===== API Configuration =====
const API_BASE_URL = 'http://localhost:3000/api'; // Update with your backend URL
const TOKEN_KEY = 'authToken';
const USER_KEY = 'currentUser';

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
    // Normalize to use capitalized field names for consistency
    return {
        EmployeeID: parsed.id || parsed.EmployeeID,
        Name: parsed.name || parsed.Name,
        Email: parsed.email || parsed.Email,
        Department: parsed.department || parsed.Department,
        Role: parsed.role || parsed.Role,
        Contact: parsed.contact || parsed.Contact
    };
}

function removeUser() {
    localStorage.removeItem(USER_KEY);
}

// ===== Authentication Check =====
function isAuthenticated() {
    return getToken() !== null;
}

function checkAuth() {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
    }
}

function isAdmin() {
    const user = getUser();
    return user && user.Role === 'Admin';
}

function isManagerOrAdmin() {
    const user = getUser();
    return user && (user.Role === 'Admin' || user.Role === 'Manager');
}

async function apiUpload(endpoint, formData) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(url, { method: 'POST', headers, body: formData });
    if (response.status === 401) {
        logout();
        return null;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }
    return data;
}

// ===== API Call Wrapper =====
async function apiCall(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    const token = getToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers
        });

        if (response.status === 401) {
            logout();
            return null;
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
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
        minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString('en-US', options);
}

function formatTime(dateString) {
    const options = { 
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
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

// ===== Mock Data (for demonstration without backend) =====
const mockEmployees = {
    'admin@globalvision.com': {
        EmployeeID: 1,
        Name: 'Admin User',
        Email: 'admin@globalvision.com',
        Department: 'IT',
        Role: 'Admin',
        Contact: '9876543210'
    },
    'john@globalvision.com': {
        EmployeeID: 2,
        Name: 'John Manager',
        Email: 'john@globalvision.com',
        Department: 'Sales',
        Role: 'Manager',
        Contact: '9876543211'
    },
    'alice@globalvision.com': {
        EmployeeID: 3,
        Name: 'Alice Employee',
        Email: 'alice@globalvision.com',
        Department: 'Sales',
        Role: 'Employee',
        Contact: '9876543212'
    },
    'bob@globalvision.com': {
        EmployeeID: 4,
        Name: 'Bob Employee',
        Email: 'bob@globalvision.com',
        Department: 'IT',
        Role: 'Employee',
        Contact: '9876543213'
    }
};

const mockTasks = [
    {
        TaskID: 1,
        Title: 'Complete Project Report',
        Description: 'Finish the monthly project report and submit to manager',
        AssignedTo: 3,
        Status: 'Pending',
        Priority: 'High',
        Deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        CreatedAt: new Date().toISOString()
    },
    {
        TaskID: 2,
        Title: 'Update Inventory List',
        Description: 'Check and update inventory items in system',
        AssignedTo: 4,
        Status: 'In Progress',
        Priority: 'Medium',
        Deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        CreatedAt: new Date().toISOString()
    },
    {
        TaskID: 3,
        Title: 'Client Meeting Preparation',
        Description: 'Prepare presentation for client meeting',
        AssignedTo: 3,
        Status: 'Pending',
        Priority: 'High',
        Deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        CreatedAt: new Date().toISOString()
    }
];

const mockInventory = [
    {
        ItemID: 1,
        ItemName: 'Laptop',
        Quantity: 5,
        AvailableQuantity: 5,
        IssuedTo: null,
        Status: 'Available',
        IssueDate: null
    },
    {
        ItemID: 2,
        ItemName: 'Monitor',
        Quantity: 10,
        AvailableQuantity: 8,
        IssuedTo: 3,
        Status: 'Issued',
        IssueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
        ItemID: 3,
        ItemName: 'Mouse',
        Quantity: 20,
        AvailableQuantity: 18,
        IssuedTo: 4,
        Status: 'Issued',
        IssueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
        ItemID: 4,
        ItemName: 'Keyboard',
        Quantity: 15,
        AvailableQuantity: 15,
        IssuedTo: null,
        Status: 'Available',
        IssueDate: null
    }
];

const mockKnowledgeBase = [
    {
        ProblemID: 1,
        Title: 'How to reset password?',
        Description: 'Employee forgot password and cannot login to the system',
        Solution: 'Click on "Forgot Password" link on login page. Enter your email address. Check your email for password reset link and follow instructions to create new password.',
        Category: 'Password',
        AddedBy: 1,
        ViewCount: 45,
        CreatedAt: new Date().toISOString()
    },
    {
        ProblemID: 2,
        Title: 'VPN Connection Issues',
        Description: 'Cannot connect to company VPN from home',
        Solution: 'Ensure you are using the latest VPN client. Check internet connection. Restart VPN client. If issue persists, contact IT support with your device details.',
        Category: 'Network',
        AddedBy: 1,
        ViewCount: 78,
        CreatedAt: new Date().toISOString()
    },
    {
        ProblemID: 3,
        Title: 'How to request leave?',
        Description: 'Not sure about the process to request leave',
        Solution: 'Login to portal → Navigate to Leave Management → Click "Request New Leave" → Select dates → Choose leave type → Add comments if needed → Submit for manager approval.',
        Category: 'Other',
        AddedBy: 1,
        ViewCount: 32,
        CreatedAt: new Date().toISOString()
    },
    {
        ProblemID: 4,
        Title: 'System is running slow',
        Description: 'Portal pages are loading very slowly',
        Solution: 'Clear browser cache and cookies. Try using a different browser. Check your internet speed. Disable browser extensions. If problem persists, contact IT support.',
        Category: 'Software',
        AddedBy: 1,
        ViewCount: 56,
        CreatedAt: new Date().toISOString()
    }
];

// ===== Authentication Functions =====
async function authenticateUser(email, password) {
    try {
        // Try to authenticate with backend
        const response = await apiCall('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        if (response && response.success && response.user) {
            if (response.token) {
                setToken(response.token);
            }
            const user = response.user;
            const normalized = {
                EmployeeID: user.id || user.EmployeeID,
                Name: user.name || user.Name,
                Email: user.email || user.Email,
                Department: user.department || user.Department,
                Role: user.role || user.Role,
                Contact: user.contact || user.Contact
            };
            setUser(normalized);
            return normalized;
        }
    } catch (error) {
        console.log('Backend API not available, checking local authentication');
    }

    // Check mock data
    const mockUser = mockEmployees[email];
    if (mockUser && password === 'password123') {
        return mockUser;
    }

    // Check registered users in localStorage
    try {
        const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '{}');
        const registeredUser = registeredUsers[email];
        if (registeredUser && registeredUser.password === password) {
            return {
                EmployeeID: registeredUser.id,
                Name: registeredUser.name,
                Email: registeredUser.email,
                Department: registeredUser.department,
                Role: registeredUser.role,
                Contact: registeredUser.contact
            };
        }
    } catch (error) {
        console.error('Error checking registered users:', error);
    }

    return null;
}

async function registerUserLocally(name, email, department, contact, password) {
    try {
        // Check if user already exists in mock data or localStorage
        const mockUser = mockEmployees[email];
        if (mockUser) {
            return { success: false, error: 'Email already registered' };
        }

        const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '{}');
        if (registeredUsers[email]) {
            return { success: false, error: 'Email already registered' };
        }

        // Generate new user ID
        const allIds = [
            ...Object.values(mockEmployees).map(u => u.EmployeeID),
            ...Object.values(registeredUsers).map(u => u.id)
        ];
        const newUserId = Math.max(...allIds, 0) + 1;

        // Create new user
        const newUser = {
            id: newUserId,
            name,
            email,
            department,
            contact,
            password,
            role: role || 'Employee',
            joinDate: new Date().toISOString().split('T')[0],
            status: 'Active'
        };

        registeredUsers[email] = newUser;
        localStorage.setItem('registeredUsers', JSON.stringify(registeredUsers));

        return { success: true, user: newUser };
    } catch (error) {
        return { success: false, error: 'Registration failed' };
    }
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

// ===== Export for use in other scripts =====
// (These are already in global scope, but noting for clarity)
