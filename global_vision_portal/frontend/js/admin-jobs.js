let jobs = [];

document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    if (!isManagerOrAdmin()) { window.location.href = 'dashboard.html'; return; }
    document.getElementById('btnAddJob')?.addEventListener('click', () => openJobModal());
    document.getElementById('btnCancelJob')?.addEventListener('click', closeJobModal);
    document.getElementById('jobForm')?.addEventListener('submit', saveJob);
    document.getElementById('btnCloseRecs')?.addEventListener('click', closeRecsModal);
    document.getElementById('recsModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeRecsModal(); });
    await loadJobs();
});

async function loadJobs() {
    const list = document.getElementById('jobAdminList');
    try {
        const res = await apiCall('/admin/jobs');
        jobs = res.jobs || [];
        if (!jobs.length) {
            list.innerHTML = '<p class="text-muted">No job postings yet.</p>';
            return;
        }
        list.innerHTML = jobs.map(j => `
            <article class="admin-ann-card ${j.isActive ? '' : 'inactive'}">
                <div class="admin-ann-card-header">
                    <h3>${escapeHtml(j.title)}</h3>
                    <span class="admin-pill">${escapeHtml(j.department)}</span>
                </div>
                ${j.employmentType ? `<p><strong>Type:</strong> ${escapeHtml(j.employmentType)}</p>` : ''}
                <p>${escapeHtml(j.description).replace(/\n/g, '<br>')}</p>
                ${j.qualifications ? `<p><strong>Qualifications:</strong> ${escapeHtml(j.qualifications).replace(/\n/g, '<br>')}</p>` : ''}
                <p class="csv-hint">
                    Posted ${new Date(j.datePosted).toLocaleDateString()}
                    ${j.expiryDate ? ' · Deadline ' + new Date(j.expiryDate).toLocaleDateString() : ''}
                    ${!j.isActive ? ' · <em>Inactive</em>' : ''}
                </p>
                <div class="admin-actions-row">
                    <button type="button" class="admin-link-btn" data-edit="${j.id}">Edit</button>
                    <button type="button" class="admin-link-btn danger" data-del="${j.id}">Delete</button>
                    <button type="button" class="admin-link-btn" data-recs="${j.id}" data-title="${escapeHtml(j.title)}"
                        style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">
                        👥 Recommendations
                    </button>
                </div>
            </article>
        `).join('');
        list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openJobModal(jobs.find(x => x.id === parseInt(b.dataset.edit, 10)))));
        list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteJob(parseInt(b.dataset.del, 10))));
        list.querySelectorAll('[data-recs]').forEach(b => b.addEventListener('click', () => openRecsModal(parseInt(b.dataset.recs, 10), b.dataset.title)));
    } catch (e) {
        list.innerHTML = `<p class="message error">${escapeHtml(e.message)}</p>`;
    }
}

function openJobModal(item) {
    const modal = document.getElementById('jobModal');
    modal.style.display = 'flex';
    modal.classList.add('is-open');
    document.getElementById('jobModalTitle').textContent = item ? 'Edit posting' : 'New posting';
    document.getElementById('jobId').value = item ? item.id : '';
    document.getElementById('jobTitle').value = item ? item.title : '';
    document.getElementById('jobDepartment').value = item ? item.department : '';
    document.getElementById('jobEmploymentType').value = item ? (item.employmentType || '') : '';
    document.getElementById('jobDescription').value = item ? item.description : '';
    document.getElementById('jobQualifications').value = item ? (item.qualifications || '') : '';
    document.getElementById('jobActive').checked = item ? item.isActive : true;
    document.getElementById('jobExpiry').value = item && item.expiryDate ? toLocal(item.expiryDate) : '';
}

function closeJobModal() {
    const modal = document.getElementById('jobModal');
    modal.style.display = 'none';
    modal.classList.remove('is-open');
}

async function saveJob(e) {
    e.preventDefault();
    const id = document.getElementById('jobId').value;
    const expiryRaw = document.getElementById('jobExpiry').value;
    let expiresAt = null;
    if (expiryRaw) {
        expiresAt = new Date(expiryRaw).toISOString();
    }
    const payload = {
        title: document.getElementById('jobTitle').value,
        department: document.getElementById('jobDepartment').value,
        employmentType: document.getElementById('jobEmploymentType').value,
        description: document.getElementById('jobDescription').value,
        qualifications: document.getElementById('jobQualifications').value,
        isActive: document.getElementById('jobActive').checked,
        expiryDate: expiresAt,
    };
    try {
        if (id) {
            await apiCall(`/admin/jobs/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
            await apiCall('/admin/jobs', { method: 'POST', body: JSON.stringify(payload) });
        }
        closeJobModal();
        showJobMsg('Saved', 'success');
        await loadJobs();
    } catch (err) {
        showJobMsg(err.message, 'error');
    }
}

async function deleteJob(id) {
    if (!confirm('Delete this posting?')) return;
    try {
        await apiCall(`/admin/jobs/${id}`, { method: 'DELETE' });
        await loadJobs();
    } catch (e) {
        showJobMsg(e.message, 'error');
    }
}

function showJobMsg(t, type) {
    const el = document.getElementById('jobAdminMsg');
    el.textContent = t;
    el.className = `message ${type}`;
    el.style.display = 'block';
}

function toLocal(d) {
    const dt = new Date(d);
    dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
    return dt.toISOString().slice(0, 16);
}

function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

/* ── Recommendations Viewer ── */

async function openRecsModal(jobId, jobTitle) {
    const modal = document.getElementById('recsModal');
    const body  = document.getElementById('recsBody');
    document.getElementById('recsModalTitle').textContent = `Recommendations — ${jobTitle}`;
    document.getElementById('recsModalSub').textContent   = '';
    body.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">Loading…</p>';
    modal.style.display = 'flex';

    try {
        const res = await apiCall(`/admin/jobs/${jobId}/recommendations`);
        const recs = res.recommendations || [];
        document.getElementById('recsModalSub').textContent =
            recs.length ? `${recs.length} recommendation${recs.length > 1 ? 's' : ''} received` : 'No recommendations yet';

        if (!recs.length) {
            body.innerHTML = `
                <div style="text-align:center;padding:40px;color:#94a3b8;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 12px;display:block;">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    <p>No referrals submitted for this position yet.</p>
                </div>`;
            return;
        }

        body.innerHTML = `
            <div style="overflow-x:auto;">
                <table class="admin-table" style="min-width:640px;">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Candidate</th>
                            <th>Father's Name</th>
                            <th>Contact</th>
                            <th>Email</th>
                            <th>LinkedIn</th>
                            <th>CV</th>
                            <th>Referred By</th>
                            <th>Submitted By</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recs.map((r, i) => `
                        <tr>
                            <td>${i + 1}</td>
                            <td><strong>${escapeHtml(r.CandidateName)}</strong></td>
                            <td>${escapeHtml(r.FatherName)}</td>
                            <td>${escapeHtml(r.ContactNo)}</td>
                            <td>${r.Email ? `<a href="mailto:${escapeHtml(r.Email)}" style="color:#3b82f6;">${escapeHtml(r.Email)}</a>` : '<span style="color:#94a3b8;">—</span>'}</td>
                            <td>${r.LinkedIn ? `<a href="${escapeHtml(r.LinkedIn)}" target="_blank" rel="noopener" style="color:#3b82f6;">View</a>` : '<span style="color:#94a3b8;">—</span>'}</td>
                            <td>${r.CvFilePath
                                ? `<button type="button" data-cv-rec="${r.RecommendationID}"
                                    style="background:#f0fdf4;border:1px solid #86efac;color:#166534;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;">
                                    📄 Download</button>`
                                : '<span style="color:#94a3b8;">—</span>'}</td>
                            <td>${escapeHtml(r.RecommendedBy || '—')}</td>
                            <td>
                                ${r.SubmittedByName ? `<span class="admin-pill admin-pill-info" style="font-size:11px;">${escapeHtml(r.SubmittedByName)}</span>` : '<span style="color:#94a3b8;">—</span>'}
                            </td>
                            <td style="white-space:nowrap;color:#64748b;font-size:12px;">${new Date(r.SubmittedAt).toLocaleDateString()}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;

        body.querySelectorAll('[data-cv-rec]').forEach(btn => {
            btn.addEventListener('click', () => downloadCv(parseInt(btn.dataset.cvRec, 10)));
        });
    } catch (err) {
        body.innerHTML = `<p class="message error" style="margin:12px;">${escapeHtml(err.message)}</p>`;
    }
}

function closeRecsModal() {
    document.getElementById('recsModal').style.display = 'none';
}

async function downloadCv(recId) {
    const url = buildApiUrl(`/jobs/recommendations/${recId}/cv`);
    try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            alert(d.error || 'Download failed');
            return;
        }

        // Pull filename from Content-Disposition so the browser saves with the right extension
        const disposition = res.headers.get('Content-Disposition') || '';
        const nameMatch   = disposition.match(/filename="?([^";\r\n]+)"?/i);
        const filename    = nameMatch ? nameMatch[1].trim() : `CV_${recId}.pdf`;

        const blob    = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a       = document.createElement('a');
        a.href        = blobUrl;
        a.download    = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
        alert(err.message || 'Download failed');
    }
}
