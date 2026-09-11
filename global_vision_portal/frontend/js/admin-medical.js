/* Admin — Manage Balances */

let _cardTypes        = [];
let _activeCtId       = null;
let _overviewReqToken = 0;

document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    if (!isManagerOrAdmin() && !isFinanceManager()) { window.location.href = 'dashboard.html'; return; }

    initTabs();
    document.getElementById('adminUploadForm')?.addEventListener('submit', uploadMedFile);
    document.getElementById('btnAddCardType').addEventListener('click', showAddCardForm);
    document.getElementById('btnSaveCard').addEventListener('click', saveNewCard);
    document.getElementById('btnCancelCard').addEventListener('click', hideAddCardForm);
    document.getElementById('btnCloseValues').addEventListener('click', closeValuesPanel);
    document.getElementById('btnRefreshOverview').addEventListener('click', loadOverview);

    await loadMedBalances();
    await loadCardTypes();
});

// ── Tabs ──────────────────────────────────────────────────────────

function initTabs() {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            ['tabMedical', 'tabCards', 'tabOverview'].forEach(id => {
                document.getElementById(id).style.display = 'none';
            });
            const target = document.getElementById(btn.dataset.tab);
            if (target) target.style.display = 'block';

            if (btn.dataset.tab === 'tabOverview') loadOverview();
        });
    });
}

// ── Tab 1: Medical Balance ────────────────────────────────────────

async function loadMedBalances() {
    const tbody = document.getElementById('medTableBody');
    try {
        const res  = await apiCall('/admin/medical-balances');
        const rows = res.balances || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="color:#94a3b8;">No employees found.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(b => `
            <tr>
                <td><strong>${escM(b.employeeName)}</strong></td>
                <td style="color:#64748b;">${b.employeeId}</td>
                <td>
                    <input type="number" step="0.01" min="0" class="form-control" style="max-width:130px;"
                        data-med-input="balance-${b.employeeId}" value="${b.balance || 0}">
                </td>
                <td>
                    <input type="number" step="0.01" min="0" class="form-control" style="max-width:130px;"
                        data-med-input="loan-${b.employeeId}" value="${b.loanBalance || 0}">
                </td>
                <td>
                    <input type="number" step="1" min="0" class="form-control" style="max-width:100px;"
                        data-med-input="leaves-${b.employeeId}" value="${b.leavesRemaining || 0}">
                </td>
                <td style="color:#64748b;font-size:12px;">
                    ${b.lastUpdatedOn ? new Date(b.lastUpdatedOn).toLocaleDateString() + (b.updatedByName ? ' · ' + escM(b.updatedByName) : '') : '—'}
                </td>
                <td>
                    <button type="button" class="admin-link-btn" data-save-med="${b.employeeId}">Save</button>
                </td>
            </tr>
        `).join('');
        tbody.querySelectorAll('[data-save-med]').forEach(btn => {
            btn.addEventListener('click', () => saveMedBalance(parseInt(btn.dataset.saveMed, 10)));
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:#ef4444;">${escM(e.message)}</td></tr>`;
    }
}

async function saveMedBalance(empId) {
    const balInput    = document.querySelector(`[data-med-input="balance-${empId}"]`);
    const loanInput   = document.querySelector(`[data-med-input="loan-${empId}"]`);
    const leavesInput = document.querySelector(`[data-med-input="leaves-${empId}"]`);
    const balance         = parseFloat(balInput?.value);
    const loanBalance     = parseFloat(loanInput?.value);
    const leavesRemaining = parseInt(leavesInput?.value, 10);
    if (isNaN(balance)) { showMsg('Enter a valid balance amount', 'error'); return; }
    try {
        await apiCall(`/admin/medical-balances/${empId}`, {
            method: 'PUT',
            body: JSON.stringify({
                balance,
                loanBalance:     isNaN(loanBalance)     ? 0 : loanBalance,
                leavesRemaining: isNaN(leavesRemaining) ? 0 : leavesRemaining,
            }),
        });
        showMsg('Balance updated.', 'success');
        await loadMedBalances();
        loadOverview();
    } catch (e) {
        showMsg(e.message, 'error');
    }
}

async function uploadMedFile(e) {
    e.preventDefault();
    const file = document.getElementById('adminUploadFile')?.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
        const res = await apiUpload('/admin/medical-balances/upload', fd);
        showMsg(`Updated ${res.updated} record(s)${res.skipped?.length ? '. Skipped IDs: ' + res.skipped.join(', ') : ''}`, 'success');
        await loadMedBalances();
    } catch (e) {
        showMsg(e.message, 'error');
    }
}

// ── Tab 2: Custom Cards ───────────────────────────────────────────

async function loadCardTypes() {
    try {
        const res  = await apiCall('/admin/balance-card-types');
        _cardTypes = res.cardTypes || [];
        renderCardTypes();
    } catch (e) {
        showCardMsg(e.message, 'error');
    }
}

function renderCardTypes() {
    const container = document.getElementById('cardTypesList');
    if (!_cardTypes.length) {
        container.innerHTML = '<p class="text-muted" style="padding:8px 0;">No custom cards yet. Click "+ Add Card" to create one.</p>';
        return;
    }
    container.innerHTML = _cardTypes.map(ct => {
        const color       = ct.Color || '#3b82f6';
        const icon        = safeAdminIcon(ct.Icon, ct.Label);
        const isDeduction = !!ct.IsDeduction;
        const isDays      = ct.Unit === 'Days';
        const typeBadge   = isDeduction
            ? '<span style="font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:#fee2e2;color:#dc2626;border-radius:4px;padding:2px 6px;margin-left:6px;">Deduction</span>'
            : '<span style="font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:#dcfce7;color:#16a34a;border-radius:4px;padding:2px 6px;margin-left:6px;">Allowance</span>';
        const unitBadge   = isDays
            ? '<span style="font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:#e0f2fe;color:#0369a1;border-radius:4px;padding:2px 6px;margin-left:4px;">Days</span>'
            : '<span style="font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:#f1f5f9;color:#64748b;border-radius:4px;padding:2px 6px;margin-left:4px;">PKR</span>';
        const inactive    = ct.IsActive ? '' : ' <em style="color:#94a3b8;font-size:12px;">(Inactive)</em>';
        return `
        <div class="card-type-row" id="ctRow-${ct.CardTypeID}">
            <div class="ct-icon" style="color:${escM(color)};">${icon}</div>
            <div class="ct-label">${escM(ct.Label)}${typeBadge}${unitBadge}${inactive}</div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
                <button type="button" class="admin-link-btn" data-set-amounts="${ct.CardTypeID}"
                    style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">
                    Set Amounts
                </button>
                <button type="button" class="admin-link-btn" data-edit-ct="${ct.CardTypeID}">Edit</button>
                <button type="button" class="admin-link-btn danger" data-del-ct="${ct.CardTypeID}">Delete</button>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-set-amounts]').forEach(btn => {
        btn.addEventListener('click', () => openValuesPanel(parseInt(btn.dataset.setAmounts, 10)));
    });
    container.querySelectorAll('[data-edit-ct]').forEach(btn => {
        btn.addEventListener('click', () => openEditCard(parseInt(btn.dataset.editCt, 10)));
    });
    container.querySelectorAll('[data-del-ct]').forEach(btn => {
        btn.addEventListener('click', () => deleteCard(parseInt(btn.dataset.delCt, 10)));
    });
}

function showAddCardForm() {
    document.getElementById('newCardLabel').value = '';
    document.getElementById('newCardIcon').value  = '★';
    document.getElementById('newCardColor').value = '#3b82f6';
    document.getElementById('newCardUnit').value  = 'PKR';
    document.getElementById('newCardIsDeduction').checked = false;
    document.getElementById('addCardForm').style.display = 'block';
    document.getElementById('newCardLabel').focus();
}

function hideAddCardForm() {
    document.getElementById('addCardForm').style.display = 'none';
}

async function saveNewCard() {
    const label       = document.getElementById('newCardLabel').value.trim();
    const icon        = document.getElementById('newCardIcon').value.trim() || '★';
    const color       = document.getElementById('newCardColor').value || '#3b82f6';
    const unit        = document.getElementById('newCardUnit').value || 'PKR';
    const isDeduction = document.getElementById('newCardIsDeduction').checked;
    if (!label) { showCardMsg('Label is required', 'error'); return; }
    try {
        await apiCall('/admin/balance-card-types', {
            method: 'POST',
            body: JSON.stringify({ label, icon, color, unit, isDeduction }),
        });
        hideAddCardForm();
        showCardMsg(`${isDeduction ? 'Deduction' : 'Allowance'} card "${label}" created.`, 'success');
        await loadCardTypes();
    } catch (e) {
        showCardMsg(e.message, 'error');
    }
}

function openEditCard(ctId) {
    const ct  = _cardTypes.find(c => c.CardTypeID === ctId);
    if (!ct) return;
    const row = document.getElementById(`ctRow-${ctId}`);
    if (!row) return;

    row.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;flex:1;flex-wrap:wrap;">
            <input type="text" class="form-control" id="ei-icon-${ctId}"
                value="${escM(ct.Icon || '★')}" maxlength="4"
                style="width:52px;text-align:center;font-size:18px;">
            <input type="text" class="form-control" id="ei-label-${ctId}"
                value="${escM(ct.Label)}" style="flex:1;min-width:140px;">
            <input type="color" id="ei-color-${ctId}" value="${ct.Color || '#3b82f6'}"
                style="width:44px;height:36px;border:1.5px solid #e2e8f0;border-radius:6px;cursor:pointer;padding:2px;">
            <select id="ei-unit-${ctId}" class="form-control" style="width:90px;">
                <option value="PKR" ${(ct.Unit || 'PKR') === 'PKR' ? 'selected' : ''}>PKR (₨)</option>
                <option value="Days" ${ct.Unit === 'Days' ? 'selected' : ''}>Days</option>
            </select>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;">
                <input type="checkbox" id="ei-active-${ctId}" ${ct.IsActive ? 'checked' : ''}> Active
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#dc2626;">
                <input type="checkbox" id="ei-deduction-${ctId}" ${ct.IsDeduction ? 'checked' : ''}> Deduction
            </label>
            <button type="button" class="admin-btn-primary" data-save-ct="${ctId}">Save</button>
            <button type="button" class="admin-btn-ghost" data-cancel-ct="${ctId}">Cancel</button>
        </div>`;

    row.querySelector(`[data-save-ct]`).addEventListener('click', () => saveEditCard(ctId));
    row.querySelector(`[data-cancel-ct]`).addEventListener('click', () => renderCardTypes());
}

async function saveEditCard(ctId) {
    const label       = document.getElementById(`ei-label-${ctId}`)?.value.trim();
    const icon        = document.getElementById(`ei-icon-${ctId}`)?.value.trim() || '★';
    const color       = document.getElementById(`ei-color-${ctId}`)?.value || '#3b82f6';
    const unit        = document.getElementById(`ei-unit-${ctId}`)?.value || 'PKR';
    const isActive    = document.getElementById(`ei-active-${ctId}`)?.checked;
    const isDeduction = document.getElementById(`ei-deduction-${ctId}`)?.checked;
    if (!label) { showCardMsg('Label is required', 'error'); return; }
    try {
        await apiCall(`/admin/balance-card-types/${ctId}`, {
            method: 'PUT',
            body: JSON.stringify({ label, icon, color, unit, isActive, isDeduction }),
        });
        showCardMsg('Card updated.', 'success');
        await loadCardTypes();
    } catch (e) {
        showCardMsg(e.message, 'error');
    }
}

async function deleteCard(ctId) {
    const ct = _cardTypes.find(c => c.CardTypeID === ctId);
    if (!confirm(`Delete card "${ct?.Label}"?\nThis removes all employee amounts for it too.`)) return;
    try {
        await apiCall(`/admin/balance-card-types/${ctId}`, { method: 'DELETE' });
        showCardMsg('Card deleted.', 'success');
        if (_activeCtId === ctId) closeValuesPanel();
        await loadCardTypes();
    } catch (e) {
        showCardMsg(e.message, 'error');
    }
}

// ── Per-employee amounts panel ────────────────────────────────────

async function openValuesPanel(ctId) {
    _activeCtId = ctId;
    const ct    = _cardTypes.find(c => c.CardTypeID === ctId);
    const sec   = document.getElementById('cardValuesSection');
    const tbody = document.getElementById('cardValuesBody');

    document.getElementById('cardValuesTitle').textContent =
        `${safeAdminIconText(ct?.Icon)} ${ct?.Label || ''} — Set Per-Employee Amounts`;
    tbody.innerHTML   = '<tr><td colspan="4" style="color:#94a3b8;padding:12px;">Loading…</td></tr>';
    sec.style.display = 'block';
    sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const res    = await apiCall(`/admin/balance-card-types/${ctId}/values`);
        const values = res.values || [];
        if (!values.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="color:#94a3b8;padding:12px;">No employees found.</td></tr>';
            return;
        }
        tbody.innerHTML = values.map(v => `
            <tr>
                <td><strong>${escM(v.EmployeeName)}</strong></td>
                <td>
                    <input type="number" step="0.01" min="0" class="form-control" style="max-width:130px;"
                        id="vi-${ctId}-${v.EmployeeID}" value="${v.Amount || 0}">
                </td>
                <td style="color:#64748b;font-size:12px;">
                    ${v.UpdatedAt ? new Date(v.UpdatedAt).toLocaleDateString() + (v.UpdatedByName ? ' · ' + escM(v.UpdatedByName) : '') : '—'}
                </td>
                <td>
                    <button type="button" class="admin-link-btn"
                        data-sv="${ctId}" data-eid="${v.EmployeeID}">Save</button>
                </td>
            </tr>
        `).join('');
        tbody.querySelectorAll('[data-sv]').forEach(btn => {
            btn.addEventListener('click', () =>
                saveCardValue(parseInt(btn.dataset.sv, 10), parseInt(btn.dataset.eid, 10))
            );
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:#ef4444;padding:12px;">${escM(e.message)}</td></tr>`;
    }
}

function closeValuesPanel() {
    document.getElementById('cardValuesSection').style.display = 'none';
    _activeCtId = null;
}

async function saveCardValue(ctId, empId) {
    const input  = document.getElementById(`vi-${ctId}-${empId}`);
    const amount = parseFloat(input?.value);
    if (isNaN(amount) || amount < 0) { showCardMsg('Enter a valid amount', 'error'); return; }
    try {
        await apiCall(`/admin/balance-card-types/${ctId}/values/${empId}`, {
            method: 'PUT',
            body: JSON.stringify({ amount }),
        });
        showCardMsg('Amount saved.', 'success');
        await openValuesPanel(ctId);
        // Silently refresh overview in background so it's current when user switches to it
        loadOverview();
    } catch (e) {
        showCardMsg(e.message, 'error');
    }
}

// ── Tab 3: Overview ───────────────────────────────────────────────

async function loadOverview() {
    // Increment token so any in-flight request knows it's been superseded
    const token = ++_overviewReqToken;

    const thead = document.getElementById('overviewHead');
    const tbody = document.getElementById('overviewBody');
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="4" style="color:#94a3b8;padding:12px;">Loading…</td></tr>';

    try {
        const res = await apiCall('/admin/balances-overview');
        if (token !== _overviewReqToken) return; // a newer request arrived; discard this result

        const cardTypes = res.cardTypes  || [];
        const employees = res.employees  || [];

        // Filter out custom cards that duplicate a static column to avoid double columns
        const STATIC_LABELS = ['medical balance', 'loan balance', 'leave this year', 'leaves remaining'];
        const customCards = cardTypes.filter(ct => !STATIC_LABELS.includes(ct.Label.toLowerCase()));

        const cardColHeaders = customCards.map(ct => {
            const badge = ct.IsDeduction
                ? '<span style="font-size:9px;font-weight:700;text-transform:uppercase;background:#fee2e2;color:#dc2626;border-radius:3px;padding:1px 4px;margin-left:4px;">−</span>'
                : '<span style="font-size:9px;font-weight:700;text-transform:uppercase;background:#dcfce7;color:#16a34a;border-radius:3px;padding:1px 4px;margin-left:4px;">+</span>';
            return escM(ct.Label) + badge;
        });
        const cols = [
            'Employee',
            'Medical Balance (PKR)',
            'Loan Balance (PKR)',
            'Leave this year (days)',
            ...cardColHeaders,
        ];
        thead.innerHTML = cols.map(c => `<th>${c}</th>`).join('');

        if (!employees.length) {
            tbody.innerHTML = `<tr><td colspan="${cols.length}" style="color:#94a3b8;padding:12px;">No employees.</td></tr>`;
            return;
        }

        tbody.innerHTML = employees.map(emp => {
            const medCell   = `<td class="amount-cell ${emp.medicalBalance  ? '' : 'zero'}">${fmtPKR(emp.medicalBalance)}</td>`;
            const loanCell  = `<td class="amount-cell ${emp.loanBalance     ? '' : 'zero'}">${fmtPKR(emp.loanBalance)}</td>`;
            const leaveCell = `<td class="amount-cell ${emp.leavesRemaining ? '' : 'zero'}">${emp.leavesRemaining || 0} days</td>`;
            const cardCells = customCards.map(ct => {
                const amt     = emp.cardAmounts[ct.CardTypeID] ?? 0;
                const isDays  = ct.Unit === 'Days';
                const style   = ct.IsDeduction && amt ? 'color:#dc2626;' : '';
                const display = isDays ? `${Math.round(amt)} days` : fmtPKR(amt);
                return `<td class="amount-cell ${amt ? '' : 'zero'}" style="${style}">${display}</td>`;
            }).join('');
            return `<tr>
                <td><strong>${escM(emp.name)}</strong></td>
                ${medCell}${loanCell}${leaveCell}
                ${cardCells}
            </tr>`;
        }).join('');
    } catch (e) {
        if (token !== _overviewReqToken) return;
        thead.innerHTML = '<th>Employee</th><th>Medical Balance (PKR)</th><th>Loan Balance (PKR)</th><th>Leave this year (days)</th>';
        tbody.innerHTML = `<tr><td colspan="2" style="color:#ef4444;padding:12px;">${escM(e.message)}</td></tr>`;
    }
}

// ── Utilities ─────────────────────────────────────────────────────

function showMsg(text, type) {
    const el = document.getElementById('adminMedMsg');
    el.textContent   = text;
    el.className     = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function showCardMsg(text, type) {
    const el = document.getElementById('cardMsg');
    el.textContent   = text;
    el.className     = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function fmtPKR(n) {
    return new Intl.NumberFormat('en-PK', {
        style: 'currency', currency: 'PKR', maximumFractionDigits: 0,
    }).format(parseFloat(n) || 0);
}

function escM(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function safeAdminIcon(icon, label) {
    const clean = (icon || '').replace(/\?/g, '').trim();
    if (!clean) {
        const init = (label || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
        return `<span style="display:inline-flex;align-items:center;justify-content:center;
            width:28px;height:28px;border-radius:6px;background:currentColor;
            font-size:12px;font-weight:700;color:#fff;">${init}</span>`;
    }
    return escM(clean);
}

function safeAdminIconText(icon) {
    const clean = (icon || '').replace(/\?/g, '').trim();
    return clean || '';
}
