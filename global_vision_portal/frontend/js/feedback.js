document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    document.getElementById('fbForm')?.addEventListener('submit', submitFeedback);
    document.getElementById('fbStatusFilter')?.addEventListener('change', loadReviewQueue);
    document.getElementById('btnRefreshReview')?.addEventListener('click', loadReviewQueue);

    if (isManagerOrAdmin()) {
        const panel = document.getElementById('reviewPanel');
        if (panel) panel.style.display = 'block';
        const title = document.getElementById('reviewPanelTitle');
        if (title) title.textContent = isAdmin() ? 'All employee feedback (Admin)' : 'Review queue (Manager)';
        await loadReviewQueue();
    }
    await loadMine();
});

async function submitFeedback(e) {
    e.preventDefault();
    try {
        await apiCall('/feedback', {
            method: 'POST',
            body: JSON.stringify({
                category: document.getElementById('fbCategory').value,
                title: document.getElementById('fbTitle').value,
                description: document.getElementById('fbDescription').value,
            }),
        });
        showFbMsg('Submitted successfully. Track status below.', 'success');
        document.getElementById('fbForm').reset();
        await loadMine();
        if (isManagerOrAdmin()) await loadReviewQueue();
    } catch (err) {
        showFbMsg(err.message, 'error');
    }
}

async function loadMine() {
    const el = document.getElementById('myFeedbackList');
    try {
        const res = await apiCall('/feedback/mine');
        const items = res.items || [];
        if (!items.length) {
            el.innerHTML = '<p class="text-muted">No submissions yet. Use the form above to send a suggestion or complaint.</p>';
            return;
        }
        el.innerHTML = items.map((item) => renderTrackingCard(item, false)).join('');
    } catch (e) {
        el.innerHTML = `<p class="message error">${escapeHtml(e.message)}</p>`;
    }
}

async function loadReviewQueue() {
    const el = document.getElementById('reviewList');
    const status = document.getElementById('fbStatusFilter')?.value || '';
    try {
        const q = status ? `?status=${encodeURIComponent(status)}` : '';
        const res = await apiCall(`/feedback${q}`);
        const items = res.items || [];
        if (!items.length) {
            el.innerHTML = '<p class="text-muted">No feedback submissions yet.</p>';
            return;
        }
        el.innerHTML = items.map((item) => `
            <article class="admin-ann-card" style="margin-bottom:16px;">
                ${renderTrackingCard(item, true)}
                <div class="form-group" style="margin-top:12px;">
                    <label>Admin / manager response</label>
                    <textarea class="form-control" rows="2" id="resp-${item.id}">${escapeHtml(item.response || '')}</textarea>
                </div>
                <div class="admin-actions-row">
                    <select class="form-control" style="max-width:160px;" id="status-${item.id}">
                        <option value="Pending"     ${item.status === 'Pending'     ? 'selected' : ''}>Pending</option>
                        <option value="In Progress" ${item.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                        <option value="Reviewed"    ${item.status === 'Reviewed'    ? 'selected' : ''}>Reviewed</option>
                        <option value="Resolved"    ${item.status === 'Resolved'    ? 'selected' : ''}>Resolved</option>
                    </select>
                    <button type="button" class="admin-btn-primary" data-review="${item.id}">Save review</button>
                </div>
            </article>
        `).join('');
        el.querySelectorAll('[data-review]').forEach((btn) => {
            btn.addEventListener('click', () => saveReview(parseInt(btn.dataset.review, 10)));
        });
    } catch (e) {
        el.innerHTML = `<p class="message error">${escapeHtml(e.message)}</p>`;
    }
}

async function saveReview(id) {
    try {
        await apiCall(`/feedback/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                status: document.getElementById(`status-${id}`).value,
                response: document.getElementById(`resp-${id}`).value,
            }),
        });
        showFbMsg('Review saved — employee will see the update in their tracking list', 'success');
        await loadReviewQueue();
        await loadMine();
    } catch (e) {
        showFbMsg(e.message, 'error');
    }
}

function renderTrackingCard(item, showEmployee) {
    const steps = ['Pending', 'In Progress', 'Reviewed', 'Resolved'];
    const currentIdx = Math.max(0, steps.indexOf(item.status));
    const timeline = steps.map((step, i) => {
        const done   = i < currentIdx;
        const active = i === currentIdx;
        return `<span class="fb-step ${done ? 'done' : ''} ${active ? 'active' : ''}">${step}</span>`;
    }).join('<span class="fb-step-arrow">→</span>');

    const pillClass = item.status === 'Resolved'    ? 'admin-pill-success'
                    : item.status === 'In Progress'  ? 'admin-pill-warning'
                    : item.status === 'Reviewed'     ? 'admin-pill-info'
                    : 'admin-pill-muted';

    return `
        <div class="admin-ann-card-header">
            <h3>#${item.id} · ${escapeHtml(item.title)} <span class="admin-pill">${escapeHtml(item.category)}</span></h3>
            <span class="admin-pill ${pillClass}">${escapeHtml(item.status)}</span>
        </div>
        <div class="fb-timeline">${timeline}</div>
        <p style="margin-top:10px;">${escapeHtml(item.description).replace(/\n/g, '<br>')}</p>
        <p class="csv-hint">
            ${showEmployee && item.employeeName ? `<strong>${escapeHtml(item.employeeName)}</strong> · ` : ''}
            Submitted ${new Date(item.dateSubmitted).toLocaleString()}
            ${item.reviewedAt ? ' · Updated ' + new Date(item.reviewedAt).toLocaleString() : ''}
        </p>
        ${item.response
            ? `<div class="fb-response-box"><strong>Official response:</strong><br>${escapeHtml(item.response).replace(/\n/g, '<br>')}</div>`
            : '<p class="csv-hint">Awaiting review — you will be notified here when status changes.</p>'}
    `;
}

function showFbMsg(text, type) {
    const el = document.getElementById('fbMessage');
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
