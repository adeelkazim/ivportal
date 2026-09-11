/* =============================================
   Global Vision Portal - Recommendations
   ============================================= */

let _selectedFile = null;

document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
    initRecommendations();
});

async function initRecommendations() {
    setupDropZone();
    await loadMyDocs();

    if (isManagerOrAdmin()) {
        const panel = document.getElementById('adminReviewPanel');
        if (panel) panel.style.display = 'block';
        await loadAdminDocs();
    }
}

// ── Upload / Drop Zone ────────────────────────────────────────────

function setupDropZone() {
    const zone      = document.getElementById('dropZone');
    const fileInput = document.getElementById('recFileInput');
    const nameDisp  = document.getElementById('selectedFileName');
    const uploadBtn = document.getElementById('btnUploadDoc');

    if (!zone || !fileInput) return;

    zone.addEventListener('click', () => fileInput.click());

    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) handleFileSelected(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) handleFileSelected(fileInput.files[0]);
    });

    uploadBtn.addEventListener('click', uploadDocument);

    function handleFileSelected(file) {
        _selectedFile = file;
        const mb = (file.size / 1024 / 1024).toFixed(2);
        nameDisp.textContent = `${file.name}  (${mb} MB)`;
        nameDisp.style.display = 'block';
        uploadBtn.disabled = false;
    }
}

async function uploadDocument() {
    if (!_selectedFile) return;

    const btn = document.getElementById('btnUploadDoc');
    btn.disabled = true;
    btn.textContent = 'Uploading…';

    const form = new FormData();
    form.append('file', _selectedFile);

    try {
        const token = getToken();
        const res = await fetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Upload failed');

        recMsg('Document uploaded successfully.', 'success');
        _selectedFile = null;
        document.getElementById('selectedFileName').style.display = 'none';
        document.getElementById('selectedFileName').textContent = '';
        document.getElementById('recFileInput').value = '';
        await loadMyDocs();
    } catch (err) {
        recMsg(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Upload';
    }
}

// ── My Documents ──────────────────────────────────────────────────

async function loadMyDocs() {
    const container = document.getElementById('myDocsList');
    if (!container) return;
    container.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:16px 0;">Loading…</div>';

    try {
        const res = await apiCall('/documents');
        const docs = (res && res.documents) || [];

        if (!docs.length) {
            container.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:16px 0;">No documents uploaded yet.</div>';
            return;
        }

        container.innerHTML = docs.map(d => buildMyDocRow(d)).join('');
    } catch (err) {
        container.innerHTML = `<div style="color:#ef4444;font-size:13px;padding:12px 0;">${recEsc(err.message)}</div>`;
    }
}

function buildMyDocRow(d) {
    const icon       = fileIcon(d.FileName);
    const kb         = d.FileSizeKB ? `${d.FileSizeKB} KB` : '';
    const uploaded   = d.UploadDate ? new Date(d.UploadDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
    const statusCls  = `rec-status-badge rec-status-${d.ReviewStatus || 'Pending'}`;
    const reviewNote = d.Notes ? `<div style="margin-top:4px;font-style:italic;color:#475569;">${recEsc(d.Notes)}</div>` : '';

    return `
    <div class="rec-doc-row" id="recRow-${d.DocID}">
        <div class="rec-doc-icon">${icon}</div>
        <div class="rec-doc-info">
            <div class="rec-doc-name" title="${recEsc(d.FileName)}">${recEsc(d.FileName)}</div>
            <div class="rec-doc-meta">${kb}${kb && uploaded ? ' · ' : ''}${uploaded}</div>
            ${reviewNote}
        </div>
        <span class="${statusCls}">${recEsc(d.ReviewStatus || 'Pending')}</span>
        <button type="button" onclick="deleteMyDoc(${d.DocID})"
            style="background:none;border:1px solid #fca5a5;color:#ef4444;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">
            Delete
        </button>
    </div>`;
}

async function deleteMyDoc(docId) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
        const res = await apiCall(`/documents/${docId}`, { method: 'DELETE' });
        if (res && res.success) {
            recMsg('Document deleted.', 'success');
            await loadMyDocs();
        }
    } catch (err) {
        recMsg(err.message, 'error');
    }
}

// ── Admin Panel ───────────────────────────────────────────────────

async function loadAdminDocs() {
    const tbody = document.getElementById('adminDocsBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="color:#94a3b8;font-size:13px;">Loading…</td></tr>';

    try {
        const res = await apiCall('/admin/employee-documents');
        const docs = (res && res.documents) || [];

        if (!docs.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="color:#94a3b8;font-size:13px;padding:12px;">No documents uploaded yet.</td></tr>';
            return;
        }

        tbody.innerHTML = docs.map(d => buildAdminDocRow(d)).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:#ef4444;font-size:13px;">${recEsc(err.message)}</td></tr>`;
    }
}

function buildAdminDocRow(d) {
    const uploaded  = d.UploadDate ? new Date(d.UploadDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
    const kb        = d.FileSizeKB ? `${d.FileSizeKB} KB` : '—';
    const statusCls = `rec-status-badge rec-status-${d.ReviewStatus || 'Pending'}`;

    return `
    <tr id="adminRecRow-${d.DocID}">
        <td>${recEsc(d.EmployeeName || '—')}</td>
        <td>
            <span title="${recEsc(d.FileName)}" style="max-width:160px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;">${fileIcon(d.FileName)} ${recEsc(d.FileName)}</span>
        </td>
        <td>${kb}</td>
        <td>${uploaded}</td>
        <td><span class="${statusCls}">${recEsc(d.ReviewStatus || 'Pending')}</span></td>
        <td style="white-space:nowrap;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <button type="button" onclick="adminDownload(${d.DocID})"
                style="background:#f0f9ff;border:1px solid #7dd3fc;color:#0369a1;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">
                Download
            </button>
            ${isAdmin() ? `<button type="button" onclick="openAdminReview(${d.DocID})"
                style="background:#f0fdf4;border:1px solid #86efac;color:#166534;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">
                Review
            </button>` : ''}
        </td>
    </tr>`;
}

async function adminDownload(docId) {
    const token = getToken();
    const url   = buildApiUrl(`/documents/${docId}/download`);
    try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || 'Download failed');
        }

        const disposition = res.headers.get('Content-Disposition') || '';
        const nameMatch   = disposition.match(/filename="?([^";\r\n]+)"?/i);
        const filename    = nameMatch ? nameMatch[1].trim() : `document_${docId}`;

        const blob    = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link    = document.createElement('a');
        link.href     = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
        recMsg(err.message, 'error');
    }
}

// ── Inline review panel ───────────────────────────────────────────

let _reviewDocId = null;

function openAdminReview(docId) {
    _reviewDocId = docId;
    let panel = document.getElementById('recReviewInline');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'recReviewInline';
        panel.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;box-shadow:0 8px 32px rgba(0,0,0,.12);z-index:9999;width:320px;max-width:95vw;';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <strong style="font-size:14px;">Review Document</strong>
                <button type="button" onclick="closeAdminReview()" style="background:none;border:none;font-size:18px;cursor:pointer;color:#64748b;">✕</button>
            </div>
            <div style="margin-bottom:10px;">
                <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Status</label>
                <select id="reviewStatusSel" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;">
                    <option value="Pending">Pending</option>
                    <option value="Reviewed">Reviewed</option>
                    <option value="Rejected">Rejected</option>
                </select>
            </div>
            <div style="margin-bottom:14px;">
                <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Notes</label>
                <textarea id="reviewNotesTxt" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;resize:vertical;" placeholder="Optional feedback…"></textarea>
            </div>
            <button type="button" onclick="submitAdminReview()" style="width:100%;background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:9px;font-size:13px;font-weight:600;cursor:pointer;">Save Review</button>`;
        document.body.appendChild(panel);
    }
    panel.style.display = 'block';
    document.getElementById('reviewStatusSel').value = 'Pending';
    document.getElementById('reviewNotesTxt').value  = '';
}

function closeAdminReview() {
    const panel = document.getElementById('recReviewInline');
    if (panel) panel.style.display = 'none';
    _reviewDocId = null;
}

async function submitAdminReview() {
    if (!_reviewDocId) return;
    const status = document.getElementById('reviewStatusSel').value;
    const notes  = document.getElementById('reviewNotesTxt').value.trim();

    try {
        const res = await apiCall(`/admin/employee-documents/${_reviewDocId}/review`, {
            method: 'PUT',
            body: JSON.stringify({ status, notes })
        });
        if (res && res.success) {
            recMsg('Review saved.', 'success');
            closeAdminReview();
            await loadAdminDocs();
        }
    } catch (err) {
        recMsg(err.message, 'error');
    }
}

// ── Utilities ─────────────────────────────────────────────────────

function fileIcon(name) {
    if (!name) return '📄';
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'pdf')            return '📕';
    if (ext === 'doc' || ext === 'docx') return '📘';
    if (['jpg','jpeg','png'].includes(ext)) return '🖼️';
    return '📄';
}

function recEsc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

function recMsg(msg, type) {
    const el = document.getElementById('recMsg');
    if (!el) return;
    el.textContent = msg;
    el.className = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}
