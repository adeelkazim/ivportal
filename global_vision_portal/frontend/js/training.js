let myEnrollmentCourseIds = new Set();

document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    await loadMyEnrollments();
    await loadCourses();
});

async function loadMyEnrollments() {
    const el = document.getElementById('myEnrollments');
    try {
        const res = await apiCall('/training/my-enrollments');
        const items = res.enrollments || [];
        myEnrollmentCourseIds = new Set(items.map(e => e.courseId));
        if (!items.length) {
            el.innerHTML = '<p class="text-muted">You are not enrolled in any courses yet.</p>';
            return;
        }
        el.innerHTML = `<div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Course</th><th>Status</th><th>Progress</th><th>Certification</th></tr></thead>
            <tbody>${items.map(e => `
                <tr>
                    <td>${escapeHtml(e.courseTitle)}</td>
                    <td>${escapeHtml(e.status)}</td>
                    <td>${e.progressPct}%</td>
                    <td>${escapeHtml(e.certificationStatus || '—')}</td>
                </tr>
            `).join('')}</tbody></table></div>`;
    } catch (e) {
        el.innerHTML = `<p class="message error">${escapeHtml(e.message)}</p>`;
    }
}

async function loadCourses() {
    const list = document.getElementById('courseList');
    try {
        const res = await apiCall('/training/courses');
        const courses = res.courses || [];
        if (!courses.length) {
            list.innerHTML = '<p class="text-muted">No courses available.</p>';
            return;
        }
        list.innerHTML = courses.map(c => {
            const enrolled = myEnrollmentCourseIds.has(c.id);
            const full = c.enrollmentLimit && c.enrollmentCount >= c.enrollmentLimit;
            return `
            <article class="admin-ann-card">
                <h3>${escapeHtml(c.title)}</h3>
                <div class="course-description">${sanitizeHtml(c.description)}</div>
                <p class="csv-hint">${escapeHtml(c.category || 'General')} · ${escapeHtml(c.trainer || 'TBA')} · ${escapeHtml(c.schedule || '')}</p>
                <p class="csv-hint">${c.enrollmentCount}${c.enrollmentLimit ? '/' + c.enrollmentLimit : ''} enrolled</p>
                <button type="button" class="admin-btn-primary" data-enroll="${c.id}" ${enrolled || full ? 'disabled' : ''}>
                    ${enrolled ? 'Enrolled' : full ? 'Full' : 'Enroll'}
                </button>
            </article>`;
        }).join('');
        list.querySelectorAll('[data-enroll]').forEach(btn => {
            btn.addEventListener('click', () => enroll(parseInt(btn.dataset.enroll, 10)));
        });
    } catch (e) {
        list.innerHTML = `<p class="message error">${escapeHtml(e.message)}</p>`;
    }
}

async function enroll(courseId) {
    try {
        await apiCall(`/training/enroll/${courseId}`, { method: 'POST', body: '{}' });
        showTrMsg('Enrolled successfully', 'success');
        await loadMyEnrollments();
        await loadCourses();
    } catch (e) {
        showTrMsg(e.message, 'error');
    }
}

function showTrMsg(text, type) {
    const el = document.getElementById('trMessage');
    el.textContent = text;
    el.className = `message ${type}`;
    el.style.display = 'block';
}

function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// Sanitize HTML to prevent XSS while allowing safe formatting
function sanitizeHtml(html) {
    if (!html) return '';
    const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre'];
    const allowedAttrs = ['href', 'target', 'rel'];
    
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    
    // Remove script tags and event handlers
    tmp.querySelectorAll('script').forEach(el => el.remove());
    
    // Clean attributes
    tmp.querySelectorAll('*').forEach(el => {
        const attrs = Array.from(el.attributes);
        attrs.forEach(attr => {
            if (!allowedAttrs.includes(attr.name.toLowerCase()) || attr.name.toLowerCase().startsWith('on')) {
                el.removeAttribute(attr.name);
            }
            if (attr.name === 'href') {
                if (!attr.value.startsWith('http') && !attr.value.startsWith('#')) {
                    el.removeAttribute('href');
                }
            }
        });
        
        // Remove disallowed tags, keeping content
        if (!allowedTags.includes(el.tagName.toLowerCase())) {
            while (el.firstChild) {
                el.parentNode.insertBefore(el.firstChild, el);
            }
            el.remove();
        }
    });
    
    return tmp.innerHTML;
}
