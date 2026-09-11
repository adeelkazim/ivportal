document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    document.getElementById('jobFilterBtn')?.addEventListener('click', loadJobs);
    document.getElementById('jobSearch')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadJobs(); });
    document.getElementById('btnCancelRecommend')?.addEventListener('click', closeRecommendModal);
    document.getElementById('recommendModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeRecommendModal(); });
    document.getElementById('recommendForm')?.addEventListener('submit', submitRecommendation);
    document.getElementById('recCvFile')?.addEventListener('change', function () {
        const label = document.getElementById('recCvName');
        if (!label) return;
        if (this.files.length) {
            const mb = (this.files[0].size / 1024 / 1024).toFixed(2);
            label.textContent = `${this.files[0].name}  (${mb} MB)`;
            label.style.display = 'block';
        } else {
            label.style.display = 'none';
        }
    });
    loadJobs();
});

async function loadJobs() {
    const list = document.getElementById('jobList');
    const search = document.getElementById('jobSearch')?.value || '';
    const department = document.getElementById('jobDept')?.value || '';
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (department) params.set('department', department);
    try {
        const res = await apiCall(`/jobs?${params}`);
        const jobs = res.jobs || [];
        const depts = [...new Set(jobs.map(j => j.department))].sort();
        const deptSel = document.getElementById('jobDept');
        const cur = deptSel.value;
        deptSel.innerHTML = '<option value="">All departments</option>' +
            depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
        deptSel.value = cur;

        if (!jobs.length) {
            list.innerHTML = '<p class="text-muted">No open positions match your filters.</p>';
            return;
        }
        list.innerHTML = jobs.map(j => `
            <article class="admin-ann-card">
                <div class="admin-ann-card-header">
                    <h3>${escapeHtml(j.title)}</h3>
                    <span class="admin-pill">${escapeHtml(j.department)}</span>
                </div>
                ${j.employmentType ? `<p><strong>Employment Type:</strong> ${escapeHtml(j.employmentType)}</p>` : ''}
                <p>${escapeHtml(j.description).replace(/\n/g, '<br>')}</p>
                ${j.qualifications ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:600">Qualifications</summary><p style="margin-top:6px">${escapeHtml(j.qualifications).replace(/\n/g, '<br>')}</p></details>` : ''}
                <p class="csv-hint">
                    Posted ${new Date(j.datePosted).toLocaleDateString()}
                    ${j.expiryDate ? ' · Deadline ' + new Date(j.expiryDate).toLocaleDateString() : ''}
                    ${j.postedByName ? ' · Posted by ' + escapeHtml(j.postedByName) : ''}
                </p>
                <div style="margin-top:12px;">
                    <button type="button" class="admin-btn-primary"
                        style="font-size:12px;padding:7px 16px;display:inline-flex;align-items:center;gap:6px;"
                        data-recommend="${j.id}" data-title="${escapeHtml(j.title)} — ${escapeHtml(j.department)}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        Recommend Someone
                    </button>
                </div>
            </article>
        `).join('');

        list.querySelectorAll('[data-recommend]').forEach(btn => {
            btn.addEventListener('click', () => openRecommendModal(
                parseInt(btn.dataset.recommend, 10),
                btn.dataset.title
            ));
        });
    } catch (e) {
        list.innerHTML = `<p class="message error">${escapeHtml(e.message)}</p>`;
    }
}

/* ── Recommendation Modal ── */

function openRecommendModal(jobId, jobTitle) {
    const modal = document.getElementById('recommendModal');
    modal.style.display = 'flex';

    document.getElementById('recommendJobId').value = jobId;
    document.getElementById('recommendJobTitle').textContent = jobTitle;

    // Pre-fill "Recommended By" with current user's name
    const user = getUser();
    const recByField = document.getElementById('recRecommendedBy');
    if (recByField && !recByField.value) {
        recByField.value = user?.Name || '';
    }

    // Clear fields except recommendedBy
    document.getElementById('recName').value = '';
    document.getElementById('recFatherName').value = '';
    document.getElementById('recContact').value = '';
    document.getElementById('recEmail').value = '';
    document.getElementById('recLinkedIn').value = '';
    const cvInput = document.getElementById('recCvFile');
    if (cvInput) cvInput.value = '';
    const cvLabel = document.getElementById('recCvName');
    if (cvLabel) cvLabel.style.display = 'none';

    const msg = document.getElementById('recommendMsg');
    if (msg) msg.style.display = 'none';

    document.getElementById('recName').focus();
}

function closeRecommendModal() {
    const modal = document.getElementById('recommendModal');
    modal.style.display = 'none';
    document.getElementById('recommendForm').reset();
    const msg = document.getElementById('recommendMsg');
    if (msg) msg.style.display = 'none';
}

async function submitRecommendation(e) {
    e.preventDefault();
    const jobId = parseInt(document.getElementById('recommendJobId').value, 10);

    const name         = document.getElementById('recName').value.trim();
    const fatherName   = document.getElementById('recFatherName').value.trim();
    const contactNo    = document.getElementById('recContact').value.trim();
    const email        = document.getElementById('recEmail').value.trim();
    const linkedIn     = document.getElementById('recLinkedIn').value.trim();
    const recommendedBy = document.getElementById('recRecommendedBy').value.trim();

    if (!name)       { showRecMsg('Candidate name is required', 'error'); return; }
    if (!fatherName) { showRecMsg("Father's name is required", 'error'); return; }
    if (!contactNo)  { showRecMsg('Contact number is required', 'error'); return; }

    const submitBtn = document.querySelector('#recommendForm button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

    try {
        const form = new FormData();
        form.append('candidateName', name);
        form.append('fatherName',    fatherName);
        form.append('contactNo',     contactNo);
        if (email)         form.append('email',         email);
        if (linkedIn)      form.append('linkedIn',      linkedIn);
        if (recommendedBy) form.append('recommendedBy', recommendedBy);
        const cvFile = document.getElementById('recCvFile')?.files[0];
        if (cvFile) form.append('cv', cvFile);

        const token = getToken();
        const res = await fetch(`${API_BASE_URL}/jobs/${jobId}/recommend`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not submit');

        showRecMsg('Recommendation submitted successfully! Thank you.', 'success');
        setTimeout(closeRecommendModal, 2000);
    } catch (err) {
        showRecMsg(err.message || 'Could not submit. Please try again.', 'error');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Recommendation'; }
    }
}

function showRecMsg(text, type) {
    const el = document.getElementById('recommendMsg');
    if (!el) return;
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
