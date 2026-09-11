/* =============================================
   Global Vision Portal - Inventory Script
   ============================================= */

let allInventory = [];
let employees = [];
let selectedItemId = null;

document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    initAdminPanel();
    loadInventory();
    setupSearchAndFilters();
    setupReturnModal();
});

function initAdminPanel() {
    if (!isAdmin()) return;

    const panel = document.getElementById('adminInventoryPanel');
    const subtitle = document.getElementById('inventorySubtitle');
    if (panel) panel.style.display = 'block';
    if (subtitle) subtitle.textContent = 'Manage inventory, issue items to employees, or upload CSV';

    loadEmployeesForAdmin();
    setupInventoryForm();
    setupIssueForm();
    setupCsvUpload();
}

async function loadEmployeesForAdmin() {
    try {
        const response = await apiCall('/employees');
        employees = (response && response.employees) || [];
        populateEmployeeSelects();
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

function populateEmployeeSelects() {
    const issueSelect = document.getElementById('issueEmployeeSelect');
    if (!issueSelect) return;

    issueSelect.innerHTML = '<option value="">Select employee...</option>' +
        employees
            .filter(e => e.Role === 'Employee' || e.Role === 'Manager')
            .map(e => `<option value="${e.EmployeeID}">${e.Name} (${e.Department})</option>`)
            .join('');
}

function populateIssueItemSelect() {
    const select = document.getElementById('issueItemSelect');
    if (!select) return;

    const available = allInventory.filter(i => i.AvailableQuantity > 0);
    select.innerHTML = '<option value="">Select item...</option>' +
        available.map(i =>
            `<option value="${i.ItemID}">${i.ItemName} (${i.AvailableQuantity} avail.)</option>`
        ).join('');
}

function setupInventoryForm() {
    const form = document.getElementById('inventoryForm');
    const clearBtn = document.getElementById('clearInventoryFormBtn');

    if (form) {
        form.addEventListener('submit', saveInventoryItem);
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', clearInventoryForm);
    }
}

function clearInventoryForm() {
    document.getElementById('editItemId').value = '';
    document.getElementById('inventoryForm').reset();
    document.getElementById('saveInventoryBtn').textContent = 'Save item';
}

function fillEditForm(item) {
    document.getElementById('editItemId').value = item.ItemID;
    document.getElementById('formItemName').value = item.ItemName;
    document.getElementById('formQuantity').value = item.Quantity;
    document.getElementById('formAvailable').value = item.AvailableQuantity;
    document.getElementById('formStatus').value = item.Status || 'Available';
    document.getElementById('saveInventoryBtn').textContent = 'Update item';
    document.getElementById('adminInventoryPanel').scrollIntoView({ behavior: 'smooth' });
}

async function saveInventoryItem(e) {
    e.preventDefault();
    const id = document.getElementById('editItemId').value;
    const body = {
        itemName: document.getElementById('formItemName').value.trim(),
        quantity: parseInt(document.getElementById('formQuantity').value, 10),
        availableQuantity: parseInt(document.getElementById('formAvailable').value, 10),
        status: document.getElementById('formStatus').value
    };

    try {
        const response = id
            ? await apiCall(`/inventory/${id}`, { method: 'PUT', body: JSON.stringify(body) })
            : await apiCall('/inventory', { method: 'POST', body: JSON.stringify(body) });

        if (response && response.success) {
            showMessage(id ? 'Item updated' : 'Item added', 'success', 'inventoryAdminMessage');
            clearInventoryForm();
            await loadInventory();
        }
    } catch (error) {
        showMessage(error.message, 'error', 'inventoryAdminMessage');
    }
}

function setupIssueForm() {
    const btn = document.getElementById('issueInventoryBtn');
    if (btn) btn.addEventListener('click', adminIssueItem);
}

async function adminIssueItem() {
    const itemId = document.getElementById('issueItemSelect').value;
    const employeeId = document.getElementById('issueEmployeeSelect').value;

    if (!itemId || !employeeId) {
        showMessage('Select an item and employee', 'error', 'inventoryAdminMessage');
        return;
    }

    try {
        const response = await apiCall(`/inventory/${itemId}/issue`, {
            method: 'POST',
            body: JSON.stringify({ employeeId: parseInt(employeeId, 10) })
        });

        if (response && response.success) {
            showMessage(`Issued to ${response.item.IssuedToName || 'employee'}`, 'success', 'inventoryAdminMessage');
            await loadInventory();
        }
    } catch (error) {
        showMessage(error.message, 'error', 'inventoryAdminMessage');
    }
}

function setupCsvUpload() {
    const form = document.getElementById('csvUploadForm');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const fileInput = document.getElementById('csvFile');
        if (!fileInput.files.length) {
            showMessage('Choose a CSV file', 'error', 'inventoryAdminMessage');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        try {
            const response = await apiUpload('/inventory/upload-csv', formData);
            if (response && response.success) {
                showMessage(response.message, 'success', 'inventoryAdminMessage');
                fileInput.value = '';
                await loadInventory();
            }
        } catch (error) {
            showMessage(error.message, 'error', 'inventoryAdminMessage');
        }
    });
}

async function loadInventory() {
    try {
        const response = await apiCall('/inventory');
        allInventory = (response && response.items) || [];
        displayInventory(allInventory);
        if (isAdmin()) populateIssueItemSelect();
    } catch (error) {
        console.error('Error loading inventory:', error);
        showMessage('Error loading inventory. Start the backend server.', 'error', 'inventoryAdminMessage');
    }
}

function displayInventory(items) {
    const tbody = document.getElementById('inventoryBody');
    const user = getUser();
    const admin = isAdmin();
    const colSpan = 6;

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center">No inventory items found</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(item => {
        const isMine = item.IssuedTo === user.EmployeeID;
        const canReturn = !admin && item.Status === 'Issued' && isMine;
        const canRequest = !admin && item.Status === 'Available' && item.AvailableQuantity > 0;

        let actions = '';
        if (admin) {
            actions = `
                <button class="btn-secondary btn-small" onclick="editInventoryItem(${item.ItemID})">Edit</button>
                ${item.AvailableQuantity > 0 ?
                    `<button class="btn-primary btn-small" onclick="quickIssue(${item.ItemID})">Issue</button>` : ''}
            `;
        } else if (canReturn) {
            actions = `<button class="btn-primary" onclick="openReturnModal(${item.ItemID})">Return</button>`;
        } else if (canRequest) {
            actions = `<button class="btn-primary" onclick="requestItem(${item.ItemID})">Request</button>`;
        } else {
            actions = '<span class="text-muted">—</span>';
        }

        const issuedTo = item.IssuedToName || (item.IssuedTo ? `ID ${item.IssuedTo}` : '—');

        return `
        <tr>
            <td>${item.ItemName}</td>
            <td>${item.Quantity} (${item.AvailableQuantity} avail.)</td>
            <td>${issuedTo}</td>
            <td>${item.IssueDate ? formatDate(item.IssueDate) : 'N/A'}</td>
            <td>
                <span class="task-status ${item.Status === 'Available' ? 'completed' : 'pending'}">
                    ${item.Status}
                </span>
            </td>
            <td><div class="inventory-actions">${actions}</div></td>
        </tr>
    `;
    }).join('');
}

function editInventoryItem(itemId) {
    const item = allInventory.find(i => i.ItemID === itemId);
    if (item) fillEditForm(item);
}

function quickIssue(itemId) {
    const select = document.getElementById('issueItemSelect');
    if (select) {
        select.value = itemId;
        document.getElementById('adminInventoryPanel').scrollIntoView({ behavior: 'smooth' });
    }
}

function setupSearchAndFilters() {
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');

    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (statusFilter) statusFilter.addEventListener('change', applyFilters);
}

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;

    let filtered = allInventory;
    if (searchTerm) {
        filtered = filtered.filter(item => item.ItemName.toLowerCase().includes(searchTerm));
    }
    if (statusFilter) {
        filtered = filtered.filter(item => item.Status === statusFilter);
    }

    displayInventory(filtered);
}

async function requestItem(itemId) {
    try {
        const user = getUser();
        const response = await apiCall(`/inventory/${itemId}/request`, {
            method: 'POST',
            body: JSON.stringify({ employeeId: user.EmployeeID })
        });

        if (response && response.success) {
            showMessage('Item requested successfully!', 'success', 'inventoryAdminMessage');
            await loadInventory();
        }
    } catch (error) {
        showMessage(error.message, 'error', 'inventoryAdminMessage');
    }
}

function openReturnModal(itemId) {
    const item = allInventory.find(i => i.ItemID === itemId);
    if (!item) return;

    selectedItemId = itemId;
    document.getElementById('returnItemName').textContent = item.ItemName;
    document.getElementById('returnDate').valueAsDate = new Date();
    openModal('returnModal');
}

function setupReturnModal() {
    const confirmBtn = document.getElementById('confirmReturnBtn');
    const cancelBtn = document.getElementById('cancelReturnBtn');

    if (confirmBtn) confirmBtn.addEventListener('click', confirmReturn);
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal('returnModal'));
}

async function confirmReturn() {
    if (!selectedItemId) return;

    try {
        const notes = document.getElementById('returnNotes').value;
        const response = await apiCall(`/inventory/${selectedItemId}/return`, {
            method: 'POST',
            body: JSON.stringify({ notes })
        });

        if (response && response.success) {
            showMessage('Item returned successfully!', 'success', 'inventoryAdminMessage');
            closeModal('returnModal');
            document.getElementById('returnNotes').value = '';
            selectedItemId = null;
            await loadInventory();
        }
    } catch (error) {
        showMessage(error.message, 'error', 'inventoryAdminMessage');
    }
}
