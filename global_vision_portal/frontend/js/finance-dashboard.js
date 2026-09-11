'use strict';

/* ---- Auth guard ---- */
if (!checkAuth()) throw new Error('unauthenticated');
if (!isFinanceManager()) {
    window.location.href = 'dashboard.html';
    throw new Error('forbidden');
}

/* ---- State ---- */
let _loans    = [];
let _medical  = [];
let _employees = [];  // for dropdown in loan modal

/* ---- Helpers ---- */
function pkr(n) {
    const v = parseFloat(n) || 0;
    return v.toLocaleString('en-PK', { minimumFractionDigits: 0 });
}
function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}
function ce(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showMsg(msg, type = 'success') {
    const el = document.getElementById('finMessage');
    el.className = `message ${type}`;
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ---- Stats ---- */
async function loadStats() {
    try {
        const data = await apiCall('/finance/stats');
        const l = data.loans    || {};
        const b = data.balances || {};
        document.getElementById('fsTotalLoans').textContent  = l.TotalLoans   || 0;
        document.getElementById('fsActiveLoans').textContent = l.ActiveLoans  || 0;
        document.getElementById('fsOutstanding').textContent = pkr(l.TotalOutstanding);
        document.getElementById('fsTotalPaid').textContent   = pkr(l.TotalPaid);
        document.getElementById('fsMedTotal').textContent    = pkr(b.TotalMedical);
    } catch (e) {
        console.error('Stats error', e);
    }
}

/* ======================================================
   LOANS TAB
   ====================================================== */
async function loadLoans() {
    document.getElementById('loanTableBody').innerHTML =
        '<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:24px;">Loading…</td></tr>';
    try {
        const data = await apiCall('/finance/loans');
        _loans = data.loans || [];
        renderLoans();
    } catch (e) {
        document.getElementById('loanTableBody').innerHTML =
            `<tr><td colspan="10" style="text-align:center;color:#dc2626;padding:24px;">${ce(e.message)}</td></tr>`;
    }
}

function renderLoans() {
    const search = (document.getElementById('loanSearch').value || '').toLowerCase();
    const statusF = document.getElementById('loanStatusFilter').value;

    const filtered = _loans.filter(l => {
        const matchName = (l.EmployeeName || '').toLowerCase().includes(search) ||
                          (l.TeamName     || '').toLowerCase().includes(search) ||
                          (l.Purpose      || '').toLowerCase().includes(search);
        const matchStatus = !statusF || l.Status === statusF;
        return matchName && matchStatus;
    });

    document.getElementById('loanCount').textContent =
        `Showing ${filtered.length} of ${_loans.length} loan(s)`;

    if (!filtered.length) {
        document.getElementById('loanTableBody').innerHTML =
            '<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:24px;">No loans found.</td></tr>';
        return;
    }

    document.getElementById('loanTableBody').innerHTML = filtered.map(l => {
        const rem  = parseFloat(l.Remaining) || 0;
        const st   = l.Status || 'Active';
        const badge = st === 'Paid' ? 'status-paid' : st === 'Cancelled' ? 'status-cancelled' : 'status-active';
        const canEdit   = st !== 'Cancelled';
        const canCancel = st === 'Active';
        return `<tr>
            <td><strong>${ce(l.EmployeeName)}</strong></td>
            <td>${ce(l.TeamName || '—')}</td>
            <td class="fin-amount">${pkr(l.LoanAmount)}</td>
            <td class="fin-amount paid">${pkr(l.PaidAmount)}</td>
            <td class="fin-amount ${rem > 0 ? 'outstanding' : ''}">${pkr(rem)}</td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${ce(l.Purpose || '')}">${ce(l.Purpose || '—')}</td>
            <td>${fmtDate(l.IssuedDate)}</td>
            <td>${fmtDate(l.DueDate)}</td>
            <td><span class="status-badge ${badge}">${ce(st)}</span></td>
            <td style="white-space:nowrap;">
                ${canEdit   ? `<button class="btn-icon edit"   onclick="openEditLoan(${l.LoanID})">Edit</button>` : ''}
                ${canCancel ? `<button class="btn-icon cancel" onclick="cancelLoan(${l.LoanID})">Cancel</button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

/* ---- Loan Modal ---- */
async function loadEmployeeDropdown(selectedId) {
    if (_employees.length === 0) {
        try {
            const data = await apiCall('/admin/employees');
            _employees = (data.employees || data || []);
        } catch (e) {
            _employees = [];
        }
    }
    const sel = document.getElementById('loanEmpSelect');
    sel.innerHTML = `<option value="">— Select Employee —</option>` +
        _employees.map(e => `<option value="${e.EmployeeID}" ${e.EmployeeID === selectedId ? 'selected' : ''}>${ce(e.Name)}</option>`).join('');
}

function openAddLoan() {
    document.getElementById('loanModalTitle').textContent = 'New Loan';
    document.getElementById('loanId').value       = '';
    document.getElementById('loanAmount').value   = '';
    document.getElementById('loanPaid').value     = '0';
    document.getElementById('loanStatus').value   = 'Active';
    document.getElementById('loanIssued').value   = new Date().toISOString().split('T')[0];
    document.getElementById('loanDue').value      = '';
    document.getElementById('loanPurpose').value  = '';
    document.getElementById('loanNotes').value    = '';
    document.getElementById('loanEmpSelect').disabled = false;
    loadEmployeeDropdown(null);
    document.getElementById('loanModal').style.display = 'block';
}

function openEditLoan(id) {
    const loan = _loans.find(l => l.LoanID === id);
    if (!loan) return;
    document.getElementById('loanModalTitle').textContent = 'Edit Loan';
    document.getElementById('loanId').value       = loan.LoanID;
    document.getElementById('loanAmount').value   = loan.LoanAmount;
    document.getElementById('loanPaid').value     = loan.PaidAmount;
    document.getElementById('loanStatus').value   = loan.Status || 'Active';
    document.getElementById('loanIssued').value   = loan.IssuedDate ? loan.IssuedDate.split('T')[0] : '';
    document.getElementById('loanDue').value      = loan.DueDate   ? loan.DueDate.split('T')[0]    : '';
    document.getElementById('loanPurpose').value  = loan.Purpose  || '';
    document.getElementById('loanNotes').value    = loan.Notes    || '';
    document.getElementById('loanEmpSelect').disabled = true;
    loadEmployeeDropdown(loan.EmployeeID);
    document.getElementById('loanModal').style.display = 'block';
}

async function cancelLoan(id) {
    if (!confirm('Cancel this loan? This action cannot be undone.')) return;
    try {
        await apiCall(`/finance/loans/${id}`, { method: 'DELETE' });
        showMsg('Loan cancelled.');
        loadStats();
        loadLoans();
    } catch (e) {
        showMsg(e.message, 'error');
    }
}

document.getElementById('loanForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const id = document.getElementById('loanId').value;
    const btn = document.getElementById('btnSaveLoan');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        if (id) {
            await apiCall(`/finance/loans/${id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    loanAmount:  parseFloat(document.getElementById('loanAmount').value),
                    paidAmount:  parseFloat(document.getElementById('loanPaid').value),
                    status:      document.getElementById('loanStatus').value,
                    issuedDate:  document.getElementById('loanIssued').value || null,
                    dueDate:     document.getElementById('loanDue').value    || null,
                    purpose:     document.getElementById('loanPurpose').value,
                    notes:       document.getElementById('loanNotes').value,
                }),
            });
            showMsg('Loan updated.');
        } else {
            await apiCall('/finance/loans', {
                method: 'POST',
                body: JSON.stringify({
                    employeeId:  document.getElementById('loanEmpSelect').value,
                    loanAmount:  parseFloat(document.getElementById('loanAmount').value),
                    issuedDate:  document.getElementById('loanIssued').value || null,
                    dueDate:     document.getElementById('loanDue').value    || null,
                    purpose:     document.getElementById('loanPurpose').value,
                    notes:       document.getElementById('loanNotes').value,
                }),
            });
            showMsg('Loan created.');
        }
        document.getElementById('loanModal').style.display = 'none';
        loadStats();
        loadLoans();
    } catch (ex) {
        showMsg(ex.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Loan';
    }
});

/* ======================================================
   MEDICAL BALANCES TAB
   ====================================================== */
async function loadMedical() {
    document.getElementById('medTableBody').innerHTML =
        '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">Loading…</td></tr>';
    try {
        const data = await apiCall('/finance/medical-balances');
        _medical = data.balances || [];
        renderMedical();
    } catch (e) {
        document.getElementById('medTableBody').innerHTML =
            `<tr><td colspan="7" style="text-align:center;color:#dc2626;padding:24px;">${ce(e.message)}</td></tr>`;
    }
}

function renderMedical() {
    const search = (document.getElementById('medSearch').value || '').toLowerCase();
    const filtered = _medical.filter(m =>
        (m.Name        || '').toLowerCase().includes(search) ||
        (m.TeamName    || '').toLowerCase().includes(search) ||
        (m.Designation || '').toLowerCase().includes(search)
    );

    if (!filtered.length) {
        document.getElementById('medTableBody').innerHTML =
            '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">No records found.</td></tr>';
        return;
    }

    document.getElementById('medTableBody').innerHTML = filtered.map(m => `<tr>
        <td><strong>${ce(m.Name)}</strong></td>
        <td>${ce(m.Designation || '—')}</td>
        <td>${ce(m.TeamName    || '—')}</td>
        <td class="fin-amount">${pkr(m.MedicalBalance)}</td>
        <td class="fin-amount">${pkr(m.LoanBalance)}</td>
        <td style="font-size:11.5px;color:#94a3b8;">${m.UpdatedAt ? fmtDate(m.UpdatedAt) : '—'}</td>
        <td>
            <button class="btn-icon edit" onclick="openEditMed(${m.EmployeeID})">Edit</button>
        </td>
    </tr>`).join('');
}

function openEditMed(empId) {
    const row = _medical.find(m => m.EmployeeID === empId);
    if (!row) return;
    document.getElementById('medModalName').textContent = row.Name;
    document.getElementById('medEmpId').value           = row.EmployeeID;
    document.getElementById('medBalance').value         = row.MedicalBalance;
    document.getElementById('medLoanBalance').value     = row.LoanBalance;
    document.getElementById('medModal').style.display = 'block';
}

document.getElementById('medForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const empId = document.getElementById('medEmpId').value;
    const btn   = this.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        await apiCall(`/finance/medical-balances/${empId}`, {
            method: 'PUT',
            body: JSON.stringify({
                balance:     parseFloat(document.getElementById('medBalance').value)     || 0,
                loanBalance: parseFloat(document.getElementById('medLoanBalance').value) || 0,
            }),
        });
        document.getElementById('medModal').style.display = 'none';
        showMsg('Balance updated.');
        loadStats();
        loadMedical();
    } catch (ex) {
        showMsg(ex.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
});

/* ======================================================
   EXPORT
   ====================================================== */
async function downloadExport() {
    try {
        const token = getToken();
        const url   = buildApiUrl('/finance/export');
        const res   = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `finance_report_${new Date().toISOString().split('T')[0]}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
    } catch (e) {
        showMsg(e.message, 'error');
    }
}

/* ======================================================
   TAB SWITCHING
   ====================================================== */
document.querySelectorAll('.fin-tab').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.fin-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.fin-panel').forEach(p => p.classList.remove('active'));
        this.classList.add('active');
        const tab = this.dataset.tab;
        document.getElementById(`pan${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
        if (tab === 'medical' && _medical.length === 0) loadMedical();
    });
});

/* ======================================================
   EVENT WIRING
   ====================================================== */
document.getElementById('btnAddLoan').addEventListener('click', openAddLoan);
document.getElementById('btnCancelLoan').addEventListener('click', () => {
    document.getElementById('loanModal').style.display = 'none';
});
document.getElementById('btnCancelMed').addEventListener('click', () => {
    document.getElementById('medModal').style.display = 'none';
});
document.getElementById('btnExportFinance').addEventListener('click', downloadExport);

document.getElementById('loanSearch').addEventListener('input', renderLoans);
document.getElementById('loanStatusFilter').addEventListener('change', renderLoans);
document.getElementById('medSearch').addEventListener('input', renderMedical);

/* Close modals on backdrop click */
['loanModal', 'medModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', function(e) {
        if (e.target === this) this.style.display = 'none';
    });
});

/* ======================================================
   INIT
   ====================================================== */
loadStats();
loadLoans();
