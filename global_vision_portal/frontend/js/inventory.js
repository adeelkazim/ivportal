/* =============================================
   Global Vision Portal - Inventory
   ============================================= */

let allInventory = [];
let selectedItemId = null;

document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
    initInventoryPage();
});

async function initInventoryPage() {
    const admin = isAdmin();

    // Show role-appropriate panels
    const adminPanel = document.getElementById('adminInventoryPanel');
    const empActions = document.getElementById('employeeInventoryActions');
    const issuedToHeader = document.getElementById('issuedToHeader');

    const quantityHeader = document.getElementById('quantityHeader');

    if (admin) {
        if (adminPanel) adminPanel.style.display = 'block';
        if (issuedToHeader) issuedToHeader.style.display = '';
        if (quantityHeader) quantityHeader.textContent = 'Qty (Avail / Total)';
        setupAdminForm();
        setupIssuePanel();
        setupCsvUpload();
    } else {
        if (empActions) empActions.style.display = 'block';
        if (issuedToHeader) issuedToHeader.style.display = 'none';
        setupRequestNewModal();
    }

    setupSearchAndFilters();
    setupReturnModal();
    await loadInventory();
}

// ── Load & display ────────────────────────────────────────────────

async function loadInventory() {
    const tbody = document.getElementById('inventoryBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading…</td></tr>';

    try {
        const res = await apiCall('/inventory');
        allInventory = (res && res.items) || [];
        applyFilters();
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">${invEsc(err.message)}</td></tr>`;
    }
}

function displayInventory(items) {
    const tbody = document.getElementById('inventoryBody');
    const user = getUser();
    const admin = isAdmin();

    if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">No inventory items found</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(item => {
        const isMine = parseInt(item.IssuedTo, 10) === (user && user.EmployeeID);
        const canReturn = item.Status === 'Issued' && isMine && !admin;
        const canRequest = item.Status === 'Available' && item.AvailableQuantity > 0 && !admin;
        const canApprove = admin && item.Status === 'Requested';
        const canDelete = admin;

        let action = '';
        if (canReturn) {
            action = `<button class="btn-primary" onclick="openReturnModal(${item.ItemID})">Return</button>`;
        } else if (canRequest) {
            action = `<button class="btn-primary" onclick="requestItem(${item.ItemID})">Request</button>`;
        } else if (canApprove) {
            action = `<button class="btn-primary" onclick="approveRequest(${item.ItemID})">Approve</button>`;
        }

        if (admin) {
            action += ` <button class="btn-secondary" style="margin-left:4px;" onclick="editItem(${item.ItemID})">Edit</button>
                       <button class="btn-danger" style="margin-left:4px;" onclick="deleteItem(${item.ItemID})">Delete</button>`;
        }

        const statusClass = item.Status === 'Available' ? 'completed'
            : item.Status === 'Requested' ? 'on-hold'
            : 'pending';

        const requestNote = item.RequestNotes
            ? ` <small title="${invEsc(item.RequestNotes)}" style="cursor:help;">📝</small>` : '';

        const qtyDisplay = admin
            ? `${item.AvailableQuantity ?? '—'} / ${item.Quantity ?? '—'}`
            : (item.Quantity ?? '—');

        return `
        <tr data-item-id="${item.ItemID}">
            <td>${invEsc(item.ItemName)}</td>
            <td>${qtyDisplay}</td>
            <td>${admin ? invEsc(item.IssuedToName || '—') : (isMine ? 'You' : '—')}</td>
            <td>${item.IssueDate ? formatDate(item.IssueDate) : '—'}</td>
            <td>
                <span class="task-status ${statusClass}">${invEsc(item.Status)}${requestNote}</span>
            </td>
            <td><div class="inventory-actions">${action || '<span class="text-muted">—</span>'}</div></td>
        </tr>`;
    }).join('');
}

// ── Filters ───────────────────────────────────────────────────────

function setupSearchAndFilters() {
    document.getElementById('searchInput')?.addEventListener('input', applyFilters);
    document.getElementById('statusFilter')?.addEventListener('change', applyFilters);
}

function applyFilters() {
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const status = document.getElementById('statusFilter')?.value || '';
    const user = getUser();

    let filtered = allInventory;

    if (!isAdmin()) {
        filtered = filtered.filter(item =>
            !item.IssuedTo || parseInt(item.IssuedTo, 10) === user.EmployeeID
        );
    }
    if (search) {
        filtered = filtered.filter(item =>
            (item.ItemName || '').toLowerCase().includes(search)
        );
    }
    if (status) {
        filtered = filtered.filter(item => item.Status === status);
    }

    displayInventory(filtered);
}

// ── Admin: add / edit item ─────────────────────────────────────────

function setupAdminForm() {
    const form = document.getElementById('inventoryForm');
    const clearBtn = document.getElementById('clearInventoryFormBtn');
    if (form) form.addEventListener('submit', saveInventoryItem);
    if (clearBtn) clearBtn.addEventListener('click', clearInventoryForm);
}

async function saveInventoryItem(e) {
    e.preventDefault();
    const editId = document.getElementById('editItemId').value;
    const body = {
        itemName: document.getElementById('formItemName').value.trim(),
        quantity: parseInt(document.getElementById('formQuantity').value, 10),
        availableQuantity: parseInt(document.getElementById('formAvailable').value, 10),
        status: document.getElementById('formStatus').value,
    };

    try {
        let res;
        if (editId) {
            res = await apiCall(`/inventory/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
            res = await apiCall('/inventory', { method: 'POST', body: JSON.stringify(body) });
        }
        if (res && res.success) {
            showMessage(editId ? 'Item updated.' : 'Item added.', 'success', 'inventoryAdminMessage');
            clearInventoryForm();
            await loadInventory();
            await refreshIssueDropdown();
        }
    } catch (err) {
        showMessage(err.message, 'error', 'inventoryAdminMessage');
    }
}

function editItem(itemId) {
    const item = allInventory.find(i => i.ItemID === itemId);
    if (!item) return;
    document.getElementById('editItemId').value = item.ItemID;
    document.getElementById('formItemName').value = item.ItemName;
    document.getElementById('formQuantity').value = item.Quantity;
    document.getElementById('formAvailable').value = item.AvailableQuantity;
    document.getElementById('formStatus').value = item.Status;
    document.getElementById('saveInventoryBtn').textContent = 'Update item';
    document.getElementById('inventoryForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearInventoryForm() {
    document.getElementById('inventoryForm').reset();
    document.getElementById('editItemId').value = '';
    document.getElementById('saveInventoryBtn').textContent = 'Save item';
}

async function deleteItem(itemId) {
    const item = allInventory.find(i => i.ItemID === itemId);
    if (!item) return;
    if (!confirm(`Delete "${item.ItemName}"? This cannot be undone.`)) return;
    try {
        const res = await apiCall(`/inventory/${itemId}/delete`, { method: 'POST' });
        if (res && res.success) {
            showMessage(res.message || 'Deleted.', 'success', 'inventoryAdminMessage');
            await loadInventory();
            await refreshIssueDropdown();
        }
    } catch (err) {
        showMessage(err.message, 'error', 'inventoryAdminMessage');
    }
}

// ── Admin: approve employee request ──────────────────────────────

async function approveRequest(itemId) {
    try {
        const res = await apiCall(`/inventory/${itemId}/approve-request`, { method: 'POST' });
        if (res && res.success) {
            showMessage('Request approved and item issued.', 'success', 'inventoryAdminMessage');
            await loadInventory();
        }
    } catch (err) {
        showMessage(err.message, 'error', 'inventoryAdminMessage');
    }
}

// ── Admin: issue to employee ──────────────────────────────────────

async function setupIssuePanel() {
    const btn = document.getElementById('issueInventoryBtn');
    if (btn) btn.addEventListener('click', issueToEmployee);
    await refreshIssueDropdown();
    await loadEmployeesForIssue();
}

async function refreshIssueDropdown() {
    const sel = document.getElementById('issueItemSelect');
    if (!sel) return;
    try {
        const res = await apiCall('/inventory');
        const available = ((res && res.items) || []).filter(i => i.Status === 'Available' && i.AvailableQuantity > 0);
        sel.innerHTML = available.length
            ? available.map(i => `<option value="${i.ItemID}">${invEsc(i.ItemName)} (avail: ${i.AvailableQuantity})</option>`).join('')
            : '<option value="">No available items</option>';
    } catch (e) {
        sel.innerHTML = '<option value="">Failed to load</option>';
    }
}

async function loadEmployeesForIssue() {
    const sel = document.getElementById('issueEmployeeSelect');
    if (!sel) return;
    try {
        const res = await apiCall('/admin/employees');
        const emps = ((res && res.employees) || []).filter(e => e.Role !== 'Admin');
        sel.innerHTML = emps.length
            ? emps.map(e => `<option value="${e.EmployeeID}">${invEsc(e.Name)} (ID ${e.EmployeeID})</option>`).join('')
            : '<option value="">No employees found</option>';
    } catch (e) {
        sel.innerHTML = '<option value="">Failed to load</option>';
    }
}

async function issueToEmployee() {
    const itemId = parseInt(document.getElementById('issueItemSelect').value, 10);
    const employeeId = parseInt(document.getElementById('issueEmployeeSelect').value, 10);
    if (!itemId || !employeeId) {
        showMessage('Select an item and an employee.', 'error', 'inventoryAdminMessage');
        return;
    }
    try {
        const res = await apiCall(`/inventory/${itemId}/issue`, {
            method: 'POST',
            body: JSON.stringify({ employeeId })
        });
        if (res && res.success) {
            showMessage(`Item issued to ${invEsc(res.item.IssuedToName || 'employee')}.`, 'success', 'inventoryAdminMessage');
            await loadInventory();
            await refreshIssueDropdown();
        }
    } catch (err) {
        showMessage(err.message, 'error', 'inventoryAdminMessage');
    }
}

// ── Admin: CSV upload ─────────────────────────────────────────────

function setupCsvUpload() {
    const form = document.getElementById('csvUploadForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = document.getElementById('csvFile').files[0];
        if (!file) {
            showMessage('Choose a CSV or Excel file first.', 'error', 'inventoryAdminMessage');
            return;
        }
        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await apiUpload('/inventory/upload-csv', fd);
            if (res && res.success) {
                showMessage(res.message, 'success', 'inventoryAdminMessage');
                document.getElementById('csvFile').value = '';
                await loadInventory();
                await refreshIssueDropdown();
            }
        } catch (err) {
            showMessage(err.message, 'error', 'inventoryAdminMessage');
        }
    });
}

// ── Employee: request existing item ──────────────────────────────

async function requestItem(itemId) {
    try {
        const res = await apiCall(`/inventory/${itemId}/request`, {
            method: 'POST',
            body: JSON.stringify({ employeeId: getUser().EmployeeID })
        });
        if (res && res.success) {
            showMessage('Item issued to you.', 'success', 'inventoryEmployeeMessage');
            await loadInventory();
        }
    } catch (err) {
        showMessage(err.message, 'error', 'inventoryEmployeeMessage');
    }
}

// ── Employee: request new item modal ─────────────────────────────

function setupRequestNewModal() {
    const openBtn = document.getElementById('requestNewInventoryBtn');
    const cancelBtn = document.getElementById('cancelRequestInventoryBtn');
    const form = document.getElementById('requestInventoryForm');

    const user = getUser();
    const nameInput = document.getElementById('requestEmployeeName');
    if (nameInput && user) nameInput.value = user.Name || '';

    if (openBtn) openBtn.addEventListener('click', () => openModal('requestInventoryModal'));
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal('requestInventoryModal'));
    if (form) form.addEventListener('submit', submitNewRequest);
}

async function submitNewRequest(e) {
    e.preventDefault();
    const itemName = document.getElementById('requestItemName').value.trim();
    const quantity = parseInt(document.getElementById('requestQuantity').value, 10) || 1;
    const notes = document.getElementById('requestNotes').value.trim();
    if (!itemName) return;

    try {
        const res = await apiCall('/inventory/request-new', {
            method: 'POST',
            body: JSON.stringify({ itemName, quantity, notes })
        });
        if (res && res.success) {
            showMessage(res.message || 'Request submitted.', 'success', 'inventoryEmployeeMessage');
            document.getElementById('requestInventoryForm').reset();
            closeModal('requestInventoryModal');
            await loadInventory();
        }
    } catch (err) {
        showMessage(err.message, 'error', 'inventoryEmployeeMessage');
    }
}

// ── Employee: return item modal ───────────────────────────────────

function openReturnModal(itemId) {
    const item = allInventory.find(i => i.ItemID === itemId);
    if (!item) return;
    selectedItemId = itemId;
    document.getElementById('returnItemName').textContent = item.ItemName;
    document.getElementById('returnDate').valueAsDate = new Date();
    openModal('returnModal');
}

function setupReturnModal() {
    document.getElementById('confirmReturnBtn')?.addEventListener('click', confirmReturn);
    document.getElementById('cancelReturnBtn')?.addEventListener('click', () => closeModal('returnModal'));
}

async function confirmReturn() {
    if (!selectedItemId) return;
    const notes = document.getElementById('returnNotes').value.trim();
    try {
        const res = await apiCall(`/inventory/${selectedItemId}/return`, {
            method: 'POST',
            body: JSON.stringify({ notes })
        });
        if (res && res.success) {
            closeModal('returnModal');
            document.getElementById('returnNotes').value = '';
            selectedItemId = null;
            showMessage('Item returned successfully.', 'success', 'inventoryEmployeeMessage');
            await loadInventory();
        }
    } catch (err) {
        showMessage(err.message, 'error', 'inventoryEmployeeMessage');
    }
}

// ── Util ──────────────────────────────────────────────────────────

function invEsc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
