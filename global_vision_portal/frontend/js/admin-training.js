let courses = [];
let descriptionEditor = null;

document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    if (!isManagerOrAdmin()) { window.location.href = 'dashboard.html'; return; }
    document.getElementById('btnAddCourse')?.addEventListener('click', () => openCourseModal());
    document.getElementById('btnCancelCourse')?.addEventListener('click', closeCourseModal);
    document.getElementById('courseForm')?.addEventListener('submit', saveCourse);
    document.getElementById('progressCourseFilter')?.addEventListener('change', loadProgress);
    await loadCourses();
    await loadProgress();
});

function initQuillEditor() {
    if (descriptionEditor) {
        descriptionEditor.setContents([]);
        return;
    }
    descriptionEditor = new Quill('#courseDescriptionEditor', {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline', 'strike'],
                ['blockquote', 'code-block'],
                [{ 'header': 1 }, { 'header': 2 }],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['link']
            ]
        },
        placeholder: 'Enter course description...'
    });
}

async function loadCourses() {
    const list = document.getElementById('courseAdminList');
    const filter = document.getElementById('progressCourseFilter');
    try {
        const res = await apiCall('/admin/training/courses');
        courses = res.courses || [];
        filter.innerHTML = '<option value="">All courses</option>' +
            courses.map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('');

        if (!courses.length) {
            list.innerHTML = '<p class="text-muted">No courses yet.</p>';
            return;
        }
        list.innerHTML = courses.map(c => `
            <article class="admin-ann-card">
                <h3>${escapeHtml(c.title)}</h3>
                <div class="course-description">${sanitizeHtml(c.description)}</div>
                <p class="csv-hint">${escapeHtml(c.category || '')} · ${escapeHtml(c.trainer || '')} · ${c.enrollmentCount} enrolled</p>
                <div class="admin-actions-row">
                    <button type="button" class="admin-link-btn" data-edit="${c.id}">Edit</button>
                    <button type="button" class="admin-link-btn danger" data-del="${c.id}">Delete</button>
                </div>
            </article>
        `).join('');
        list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openCourseModal(courses.find(x => x.id === parseInt(b.dataset.edit, 10)))));
        list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteCourse(parseInt(b.dataset.del, 10))));
    } catch (e) {
        list.innerHTML = `<p class="message error">${escapeHtml(e.message)}</p>`;
    }
}

async function loadProgress() {
    const tbody = document.getElementById('progressBody');
    const courseId = document.getElementById('progressCourseFilter')?.value || '';
    const q = courseId ? `?courseId=${courseId}` : '';
    try {
        const res = await apiCall(`/admin/training/progress${q}`);
        const rows = res.enrollments || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6">No enrollments yet</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${escapeHtml(r.employeeName)}</td>
                <td>${escapeHtml(r.courseTitle)}</td>
                <td><select class="form-control" data-st="${r.id}" style="max-width:120px;">
                    <option ${r.status === 'Enrolled' ? 'selected' : ''}>Enrolled</option>
                    <option ${r.status === 'Completed' ? 'selected' : ''}>Completed</option>
                </select></td>
                <td><input type="number" min="0" max="100" class="form-control" style="max-width:70px;" data-pct="${r.id}" value="${r.progressPct}"></td>
                <td><input type="text" class="form-control" data-cert="${r.id}" value="${escapeHtml(r.certificationStatus || '')}" placeholder="e.g. Passed"></td>
                <td><button type="button" class="admin-link-btn" data-save-prog="${r.id}">Save</button></td>
            </tr>
        `).join('');
        tbody.querySelectorAll('[data-save-prog]').forEach(b => {
            b.addEventListener('click', () => saveProgress(parseInt(b.dataset.saveProg, 10)));
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(e.message)}</td></tr>`;
    }
}

async function saveProgress(id) {
    const status = document.querySelector(`[data-st="${id}"]`)?.value;
    const progressPct = document.querySelector(`[data-pct="${id}"]`)?.value;
    const certificationStatus = document.querySelector(`[data-cert="${id}"]`)?.value;
    try {
        await apiCall(`/admin/training/enrollments/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                status,
                progressPct,
                certificationStatus,
                completionDate: status === 'Completed' ? new Date().toISOString() : null,
            }),
        });
        showTrAdminMsg('Progress updated', 'success');
        await loadProgress();
    } catch (e) {
        showTrAdminMsg(e.message, 'error');
    }
}

function openCourseModal(item) {
    document.getElementById('courseModal').style.display = 'flex';
    document.getElementById('courseModalTitle').textContent = item ? 'Edit course' : 'Add course';
    document.getElementById('courseId').value = item ? item.id : '';
    document.getElementById('courseTitle').value = item ? item.title : '';
    
    if (!descriptionEditor) {
        initQuillEditor();
    }
    
    if (item && item.description) {
        try {
            // Check if it's JSON (Delta format from old data)
            if (item.description.startsWith('{')) {
                const parsed = JSON.parse(item.description);
                descriptionEditor.setContents(parsed);
            } else {
                // It's HTML - set directly
                descriptionEditor.root.innerHTML = item.description;
            }
        } catch (e) {
            // Fallback to plain text
            descriptionEditor.setText(item.description);
        }
    } else {
        descriptionEditor.setContents([]);
    }
    
    document.getElementById('courseTrainer').value = item ? (item.trainer || '') : '';
    document.getElementById('courseSchedule').value = item ? (item.schedule || '') : '';
    document.getElementById('courseDuration').value = item ? (item.duration || '') : '';
    document.getElementById('courseCategory').value = item ? (item.category || 'Technical') : 'Technical';
    document.getElementById('courseLimit').value = item && item.enrollmentLimit ? item.enrollmentLimit : '';
    document.getElementById('courseActive').checked = item ? item.isActive : true;
}

function closeCourseModal() {
    document.getElementById('courseModal').style.display = 'none';
}

async function saveCourse(e) {
    e.preventDefault();
    const id = document.getElementById('courseId').value;
    // Get HTML content instead of JSON Delta format
    const description = descriptionEditor ? descriptionEditor.root.innerHTML : '';
    const payload = {
        title: document.getElementById('courseTitle').value,
        description: description,
        trainer: document.getElementById('courseTrainer').value,
        schedule: document.getElementById('courseSchedule').value,
        duration: document.getElementById('courseDuration').value,
        category: document.getElementById('courseCategory').value,
        enrollmentLimit: document.getElementById('courseLimit').value || null,
        isActive: document.getElementById('courseActive').checked,
    };
    try {
        if (id) {
            await apiCall(`/admin/training/courses/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
            await apiCall('/admin/training/courses', { method: 'POST', body: JSON.stringify(payload) });
        }
        closeCourseModal();
        showTrAdminMsg('Course saved', 'success');
        await loadCourses();
        await loadProgress();
    } catch (err) {
        showTrAdminMsg(err.message, 'error');
    }
}

async function deleteCourse(id) {
    if (!confirm('Delete this course and all enrollments?')) return;
    try {
        await apiCall(`/admin/training/courses/${id}`, { method: 'DELETE' });
        await loadCourses();
        await loadProgress();
    } catch (e) {
        showTrAdminMsg(e.message, 'error');
    }
}

function showTrAdminMsg(t, type) {
    const el = document.getElementById('trAdminMsg');
    el.textContent = t;
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
    const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'td', 'th'];
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
