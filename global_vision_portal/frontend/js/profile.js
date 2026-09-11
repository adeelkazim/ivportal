/* =============================================
   Global Vision Portal - Profile Script
   ============================================= */

let pendingProfileImageUrl = null; // set when user picks a new photo, cleared after save

document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    loadProfileData();
    loadWorkingHours();
    setupImageUpload();
    setupProfileForm();
    setupPasswordForm();
});

/* ── Avatar helpers ───────────────────────────────────────── */

function getInitialsFromName(name) {
    if (!name) return '?';
    return (name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
        .map(w => w[0].toUpperCase()).join(''));
}

function showAvatar(imageUrl, name) {
    const img      = document.getElementById('profileAvatarImg');
    const initials = document.getElementById('profileAvatarInitials');
    if (!img) return;
    if (imageUrl) {
        img.src = imageUrl;
        img.style.display = '';
        if (initials) initials.style.display = 'none';
    } else {
        img.style.display = 'none';
        if (initials) {
            initials.textContent = getInitialsFromName(name);
            initials.style.display = '';
        }
    }
}

/* ── Load profile data ────────────────────────────────────── */

async function loadProfileData() {
    try {
        const user = getUser();
        if (!user) { window.location.href = 'login.html'; return; }

        // Populate from cached user first (instant)
        document.getElementById('name').value     = user.Name  || '';
        document.getElementById('email').value    = user.Email || '';
        document.getElementById('role').value     = user.Role  || '';
        document.getElementById('contact').value  = user.Contact || '';
        document.getElementById('username').value = user.Username || '';

        const usernameDisplay = document.getElementById('profileUsernameDisplay');
        if (usernameDisplay) {
            usernameDisplay.textContent = user.Username ? `@${user.Username}` : (user.Email || '');
        }

        showAvatar(user.profileImageUrl, user.Name);

        // Refresh from API
        try {
            const res = await apiCall(`/employees/${user.EmployeeID}`);
            if (res && res.employee) {
                const p = res.employee;
                const name     = p.Name     || p.name     || user.Name;
                const contact  = p.Contact  || p.contact  || '';
                const username = p.Username || p.username || user.Username || '';
                const imageUrl = p.profileImageUrl || p.ProfileImageUrl || user.profileImageUrl || null;

                document.getElementById('name').value    = name;
                document.getElementById('contact').value = contact;
                if (document.getElementById('username')) {
                    document.getElementById('username').value = username;
                }
                if (usernameDisplay) {
                    usernameDisplay.textContent = username ? `@${username}` : (user.Email || '');
                }

                // Only update avatar display if no pending selection
                if (pendingProfileImageUrl === null) {
                    showAvatar(imageUrl, name);
                }

                // Refresh cached user with latest data
                setUser({ ...user, Name: name, Contact: contact, Username: username, profileImageUrl: imageUrl });
            }
        } catch (e) {
            console.warn('Could not refresh profile from API:', e.message);
        }
    } catch (error) {
        console.error('Error loading profile:', error);
        showMessage('Error loading profile data', 'error', 'profileMessage');
    }
}

/* ── Image upload + compression ──────────────────────────── */

function setupImageUpload() {
    const input = document.getElementById('profileImageInput');
    if (!input) return;

    input.addEventListener('change', async function(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowed.includes(file.type)) {
            showMessage('Only JPEG, PNG, WebP, or GIF images are allowed.', 'error', 'profileMessage');
            input.value = '';
            return;
        }

        if (file.size > 2 * 1024 * 1024) {
            showMessage('Image must be smaller than 2 MB.', 'error', 'profileMessage');
            input.value = '';
            return;
        }

        try {
            showMessage('Processing image…', 'info', 'profileMessage');
            const compressed = await compressImage(file, 320, 320, 0.85);
            pendingProfileImageUrl = compressed;

            const img      = document.getElementById('profileAvatarImg');
            const initials = document.getElementById('profileAvatarInitials');
            if (img) { img.src = compressed; img.style.display = ''; }
            if (initials) initials.style.display = 'none';

            showMessage('Photo ready — click Save Changes to upload.', 'success', 'profileMessage');
        } catch (err) {
            showMessage('Could not process image: ' + err.message, 'error', 'profileMessage');
        }
    });
}

function compressImage(file, maxW, maxH, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Failed to decode image'));
            img.onload = () => {
                const scale  = Math.min(1, maxW / img.width, maxH / img.height);
                const canvas = document.createElement('canvas');
                canvas.width  = Math.round(img.width  * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/* ── Profile save form ────────────────────────────────────── */

function setupProfileForm() {
    const profileForm = document.getElementById('profileForm');
    if (!profileForm) return;

    profileForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const user = getUser();
        const payload = {
            name:    document.getElementById('name').value.trim(),
            contact: document.getElementById('contact').value.trim(),
            // Always send the current image so a plain save never wipes it
            profileImageUrl: pendingProfileImageUrl !== null
                ? pendingProfileImageUrl
                : (user.profileImageUrl || null),
        };

        try {
            const res = await apiCall(`/employees/${user.EmployeeID}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });

            const updatedImage = pendingProfileImageUrl !== null
                ? pendingProfileImageUrl
                : (user.profileImageUrl || null);

            setUser({
                ...user,
                Name:            payload.name,
                Contact:         payload.contact,
                profileImageUrl: updatedImage,
            });

            pendingProfileImageUrl = null;
            document.getElementById('profileImageInput').value = '';

            showMessage('Profile updated successfully!', 'success', 'profileMessage');
        } catch (err) {
            showMessage(err.message || 'Could not save profile.', 'error', 'profileMessage');
        }
    });
}

/* ── Working Hours ────────────────────────────────────────── */

async function loadWorkingHours() {
    try {
        const res = await apiCall('/me/working-hours');
        const start = res.shiftStart || '';
        const end   = res.shiftEnd   || '';

        if (!start && !end) {
            document.getElementById('whDisplay').style.display = 'none';
            document.getElementById('whNotSet').style.display  = 'block';
            return;
        }

        document.getElementById('whStartDisplay').textContent = start ? fmt12(start) : '—';
        document.getElementById('whEndDisplay').textContent   = end   ? fmt12(end)   : '—';
        document.getElementById('whHrsDisplay').textContent   = calcHrs(start, end);
    } catch (e) {
        // Non-critical — hide the card silently
        const card = document.getElementById('workingHoursCard');
        if (card) card.style.display = 'none';
    }
}

function fmt12(t) {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function calcHrs(start, end) {
    if (!start || !end) return '—';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) return '—';
    const h = Math.floor(mins / 60), mi = mins % 60;
    return mi ? `${h}h ${mi}m` : `${h}h`;
}

/* ── Password change form ─────────────────────────────────── */

function setupPasswordForm() {
    const passwordForm = document.getElementById('passwordForm');
    if (!passwordForm) return;

    passwordForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword     = document.getElementById('newPassword').value;
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
                'error', 'profileMessage'
            );
            return;
        }

        try {
            const user = getUser();
            await apiCall(`/employees/${user.EmployeeID}/change-password`, {
                method: 'POST',
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            showMessage('Password changed successfully!', 'success', 'profileMessage');
            passwordForm.reset();
        } catch (error) {
            showMessage(error.message || 'Password change failed.', 'error', 'profileMessage');
        }
    });
}
