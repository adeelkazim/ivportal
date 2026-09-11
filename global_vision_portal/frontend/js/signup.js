/* =============================================
   Global Vision Portal - Employee Registration
   ============================================= */

document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signupForm');
    if (signupForm) signupForm.addEventListener('submit', handleSignup);
    loadTeams();
});

async function loadTeams() {
    const select = document.getElementById('teamId');
    if (!select) return;

    try {
        const response = await apiCall('/teams');
        const teams = (response && response.teams) || [];
        select.innerHTML = '<option value="">Select team</option>' +
            teams.map(t => `<option value="${t.TeamID}">${t.TeamName}</option>`).join('');
    } catch (error) {
        select.innerHTML = `
            <option value="1">Engineering</option>
            <option value="2">Sales</option>
            <option value="6">IT</option>
            <option value="7">Operations</option>
        `;
    }
}

function readCvFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function handleSignup(event) {
    event.preventDefault();

    const empName = document.getElementById('empName').value.trim();
    const empFatherName = document.getElementById('empFatherName').value.trim();
    const empQualification = document.getElementById('empQualification').value.trim();
    const empCertifications = document.getElementById('empCertifications').value.trim();
    const empDesignation = document.getElementById('empDesignation').value.trim();
    const empAppointedOn = document.getElementById('empAppointedOn').value;
    const teamId = document.getElementById('teamId').value;
    const department = document.getElementById('department').value;
    const contact = document.getElementById('contact').value.trim();
    const empEmail = document.getElementById('empEmail').value.trim();
    const role = document.getElementById('role').value;
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const cvInput = document.getElementById('empCVFile');

    if (!empName || !empFatherName || !empDesignation || !empEmail || !department || !contact || !teamId || !password) {
        showSignupMessage('Please fill in all required fields', 'error');
        return;
    }

    if (!validateEmail(empEmail)) {
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

    let empCVFile = null;
    if (cvInput.files.length) {
        const file = cvInput.files[0];
        if (file.size > 2_000_000) {
            showSignupMessage('CV file must be under 2 MB', 'error');
            return;
        }
        try {
            empCVFile = await readCvFileAsDataUrl(file);
        } catch {
            showSignupMessage('Could not read CV file', 'error');
            return;
        }
    }

    const payload = {
        empName,
        empFatherName,
        empQualification,
        empCertifications,
        empDesignation,
        empAppointedOn: empAppointedOn || null,
        teamId: parseInt(teamId, 10),
        empEmail,
        password,
        department,
        contact,
        role,
        empCVFile
    };

    try {
        const response = await apiCall('/auth/register', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response.success) {
            const empId = response.empId || response.user?.EmployeeID || '';
            showSignupMessage(
                `Registration successful! Your Employee ID is ${empId}. Redirecting to login...`,
                'success'
            );
            setTimeout(() => {
                window.location.href = 'login.html?email=' + encodeURIComponent(empEmail);
            }, 2500);
        } else {
            showSignupMessage(response.error || 'Registration failed', 'error');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showSignupMessage(error.message || 'Registration failed', 'error');
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
