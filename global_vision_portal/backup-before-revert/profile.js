/* =============================================
   Global Vision Portal - Profile Script
   ============================================= */

document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    loadProfileData();
    setupProfileForm();
    setupPasswordForm();
});

async function loadProfileData() {
    try {
        const user = getUser();

        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        const response = await apiCall(`/employees/${user.EmployeeID}`);
        const profile = (response && response.employee) || user;

        document.getElementById('name').value = profile.Name || '';
        document.getElementById('email').value = profile.Email || '';
        document.getElementById('department').value = profile.Department || '';
        document.getElementById('role').value = profile.Role || '';
        document.getElementById('contact').value = profile.Contact || '';

        setUser({
            EmployeeID: profile.EmployeeID || profile.id,
            Name: profile.Name,
            Email: profile.Email,
            Department: profile.Department,
            Role: profile.Role,
            Contact: profile.Contact
        });
    } catch (error) {
        console.error('Error loading profile:', error);
        showMessage('Error loading profile data', 'error', 'profileMessage');
    }
}

function setupProfileForm() {
    const profileForm = document.getElementById('profileForm');

    if (profileForm) {
        profileForm.addEventListener('submit', async function(event) {
            event.preventDefault();

            const user = getUser();
            const name = document.getElementById('name').value;
            const contact = document.getElementById('contact').value;

            try {
                const response = await apiCall(`/employees/${user.EmployeeID}`, {
                    method: 'PUT',
                    body: JSON.stringify({ name, contact })
                });

                if (response && response.success) {
                    setUser({
                        ...user,
                        Name: response.employee.Name,
                        Contact: response.employee.Contact
                    });
                    showMessage('Profile updated successfully!', 'success', 'profileMessage');
                }
            } catch (error) {
                console.error('Error updating profile:', error);
                showMessage(error.message || 'Error updating profile', 'error', 'profileMessage');
            }
        });
    }
}

function setupPasswordForm() {
    const passwordForm = document.getElementById('passwordForm');

    if (passwordForm) {
        passwordForm.addEventListener('submit', async function(event) {
            event.preventDefault();

            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (!currentPassword || !newPassword || !confirmPassword) {
                showMessage('All fields are required', 'error', 'profileMessage');
                return;
            }

            if (newPassword !== confirmPassword) {
                showMessage('New passwords do not match', 'error', 'profileMessage');
                return;
            }

            if (!validatePassword(newPassword)) {
                showMessage(
                    'Password must be at least 8 characters with uppercase, lowercase, and numbers',
                    'error',
                    'profileMessage'
                );
                return;
            }

            try {
                const user = getUser();
                const response = await apiCall(`/employees/${user.EmployeeID}/change-password`, {
                    method: 'POST',
                    body: JSON.stringify({ currentPassword, newPassword })
                });

                if (response && response.success) {
                    showMessage('Password changed successfully!', 'success', 'profileMessage');
                    passwordForm.reset();
                }
            } catch (error) {
                console.error('Error changing password:', error);
                showMessage(error.message || 'Error changing password', 'error', 'profileMessage');
            }
        });
    }
}
