let announcements = [];
let allEmployees = [];
let allRoles = [];
let annCategories = [];
/** Employee IDs checked in the picker (survives search/filter re-renders) */
let pickerSelectedEmployeeIds = [];

document.addEventListener('DOMContentLoaded', async function() {
    checkAuth();
    if (!isManagerOrAdmin()) {
        window.location.href = 'dashboard.html';
        return;
    }

    // Set min date on expiry input to today (no picking past dates)
    const expiresInput = document.getElementById('annExpires');
    if (expiresInput) {
        const today = new Date();
        expiresInput.min = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    }

    document.getElementById('btnAddAnn')?.addEventListener('click', () => openAnnModal());
    document.getElementById('btnCancelAnn')?.addEventListener('click', closeAnnModal);
    document.getElementById('annForm')?.addEventListener('submit', saveAnn);
    document.getElementById('btnManageCategories')?.addEventListener('click', openCategoryManager);

    document.querySelectorAll('input[name="annTarget"]').forEach(r => {
        r.addEventListener('change', toggleTargetPanels);
    });
    document.getElementById('annEmployeeSearch')?.addEventListener('input', () => {
        syncPickerSelectionFromDom();
        renderEmployeePicker(pickerSelectedEmployeeIds);
    });
    document.getElementById('annEmployeePicker')?.addEventListener('change', (ev) => {
        if (ev.target && ev.target.name === 'annEmp') syncPickerSelectionFromDom();
    });

    await Promise.all([loadEmployees(), loadRoles(), loadCategories()]);
    await loadAnnouncements();
});

/* ── Announcement Categories ── */

async function loadCategories() {
    try {
        const res = await apiCall('/admin/announcement-categories');
        annCategories = res.categories || [];
        populateCategoryDropdown();
    } catch (e) {
        console.warn('Could not load categories:', e.message);
    }
}

function populateCategoryDropdown(selected = '') {
    const sel = document.getElementById('annCategory');
    if (!sel) return;
    sel.innerHTML = '<option value="">— No category —</option>' +
        annCategories.map(c =>
            `<option value="${escapeHtml(c.CategoryName)}" ${c.CategoryName === selected ? 'selected' : ''}>${escapeHtml(c.CategoryName)}</option>`
        ).join('');
}

async function openCategoryManager() {
    await loadCategories();
    const list = annCategories.map(c => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;">
            <span style="flex:1;font-size:13px;">${escapeHtml(c.CategoryName)}</span>
            <button type="button" class="admin-link-btn danger" data-del-cat="${escapeHtml(c.CategoryName)}"
                style="font-size:11px;">Delete</button>
        </div>`).join('');

    const html = `
        <div style="margin-bottom:12px;">
            <strong style="font-size:13px;">Manage Categories</strong>
        </div>
        <div style="max-height:220px;overflow-y:auto;margin-bottom:12px;">${list || '<p style="color:#94a3b8;font-size:13px;">No categories yet.</p>'}</div>
        <div style="display:flex;gap:6px;">
            <input type="text" id="newCatInput" class="form-control" placeholder="New category name…" style="flex:1;">
            <button type="button" class="admin-btn-primary" id="btnAddCat" style="white-space:nowrap;">Add</button>
        </div>
        <div id="catMsg" class="message" style="display:none;margin-top:8px;"></div>`;

    // Reuse existing modal space via a simple inline panel under the dropdown
    const wrap = document.getElementById('annCategory')?.closest('.form-group');
    let panel = document.getElementById('catManagerPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'catManagerPanel';
        panel.style.cssText = 'background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:16px;margin-top:8px;';
        wrap?.insertAdjacentElement('afterend', panel);
    }
    panel.innerHTML = html;
    panel.style.display = 'block';

    panel.querySelector('#btnAddCat')?.addEventListener('click', async () => {
        const val = (panel.querySelector('#newCatInput')?.value || '').trim();
        if (!val) return;
        try {
            await apiCall('/admin/announcement-categories', { method: 'POST', body: JSON.stringify({ name: val }) });
            await loadCategories();
            await openCategoryManager();
        } catch (e) {
            const msg = panel.querySelector('#catMsg');
            if (msg) { msg.textContent = e.message; msg.className = 'message error'; msg.style.display = 'block'; }
        }
    });

    panel.querySelectorAll('[data-del-cat]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const name = btn.dataset.delCat;
            if (!confirm(`Delete category "${name}"?`)) return;
            const cat = annCategories.find(c => c.CategoryName === name);
            if (!cat) return;
            try {
                await apiCall(`/admin/announcement-categories/${cat.CategoryID}`, { method: 'DELETE' });
                await loadCategories();
                await openCategoryManager();
            } catch (e) {
                const msg = panel.querySelector('#catMsg');
                if (msg) { msg.textContent = e.message; msg.className = 'message error'; msg.style.display = 'block'; }
            }
        });
    });
}

async function loadEmployees() {
    try {
        const res = await apiCall('/admin/employees');
        allEmployees = (res.employees || []).map(e => ({
            EmployeeID: e.EmployeeID || e.id,
            Name: e.Name || e.name,
            Email: e.Email || e.email,
            Role: e.Role || e.role,
        }));
        if (!allEmployees.length) {
            const usersRes = await apiCall('/admin/users');
            allEmployees = (usersRes.users || []).filter(u => {
                const role = (u.Role || u.role || '').trim();
                const active = u.isActive !== false && u.IsActive !== 0;
                return active && role.toLowerCase() !== 'admin';
            });
        }
        renderEmployeePicker();
    } catch (e) {
        console.warn('Employees for picker:', e.message);
        const box = document.getElementById('annEmployeePicker');
        if (box) box.innerHTML = `<p class="message error" style="padding:8px;">Could not load employees: ${escapeHtml(e.message)}</p>`;
    }
}

async function loadRoles() {
    try {
        const res = await apiCall('/admin/roles');
        allRoles = (res.roles || []).map(r => r.name);
        renderRolePicker();
    } catch (e) {
        console.warn('Roles for picker:', e.message);
    }
}

function getTargetType() {
    const checked = document.querySelector('input[name="annTarget"]:checked');
    const value = (checked && checked.value) ? checked.value.toLowerCase() : 'all';
    if (value === 'selected' || value === 'roles') return value;
    return 'all';
}

function toggleTargetPanels() {
    const type = getTargetType();
    const roleWrap = document.getElementById('annRolePickerWrap');
    const empWrap = document.getElementById('annEmployeePickerWrap');
    if (roleWrap) roleWrap.style.display = type === 'roles' ? 'block' : 'none';
    if (empWrap) {
        empWrap.style.display = type === 'selected' ? 'block' : 'none';
        if (type === 'selected' && !allEmployees.length) loadEmployees();
    }
    const hint = document.getElementById('annSelectedHint');
    if (hint) {
        hint.textContent = type === 'selected'
            ? 'Only checked people will see this on their dashboard (not other users).'
            : '';
    }
}

function renderRolePicker(selectedRoles = []) {
    const box = document.getElementById('annRolePicker');
    if (!box) return;

    const set = new Set(selectedRoles.map(String));

    // Header row with "+ Add Role" button
    const header = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;">Roles</span>
            <button type="button" class="admin-btn-primary" id="btnAddRoleFromAnn" style="font-size:11px;padding:4px 10px;">+ Add Role</button>
        </div>`;

    if (!allRoles.length) {
        box.innerHTML = header + '<p class="text-muted" style="padding:4px 0 8px;">No roles defined. Add one above.</p>';
        box.querySelector('#btnAddRoleFromAnn')?.addEventListener('click', openAddRoleModal);
        return;
    }

    box.innerHTML = header + allRoles.map(role => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f1f5f9;">
            <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;margin:0;">
                <input type="checkbox" name="annRole" value="${escapeHtml(role)}" ${set.has(role) ? 'checked' : ''} style="width:15px;height:15px;accent-color:#1d4ed8;">
                <strong style="font-size:13px;">${escapeHtml(role)}</strong>
            </label>
            <button type="button" class="role-icon-btn" data-ann-edit-role="${escapeHtml(role)}" title="Rename role">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
            </button>
            <button type="button" class="role-icon-btn danger" data-ann-del-role="${escapeHtml(role)}" title="Delete role">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
            </button>
        </div>
    `).join('');

    box.querySelector('#btnAddRoleFromAnn')?.addEventListener('click', openAddRoleModal);

    box.querySelectorAll('[data-ann-edit-role]').forEach(btn => {
        btn.addEventListener('click', () => openEditRoleModal(btn.dataset.annEditRole));
    });

    box.querySelectorAll('[data-ann-del-role]').forEach(btn => {
        btn.addEventListener('click', () => deleteRoleFromAnn(btn.dataset.annDelRole));
    });
}

// ── Role CRUD from announcements picker ──────────────────────

function openAddRoleModal() {
    const box = document.getElementById('annRolePicker');
    if (!box) return;

    // Don't add a second input row if one already exists
    if (box.querySelector('#annNewRoleRow')) return;

    const row = document.createElement('div');
    row.id = 'annNewRoleRow';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;margin-top:4px;border-top:2px dashed #bfdbfe;';
    row.innerHTML = `
        <input type="text" id="annNewRoleName" class="form-control"
            placeholder="New role name…"
            style="flex:1;padding:7px 10px;font-size:13px;border-radius:8px;border:1.5px solid #bfdbfe;">
        <button type="button" id="annConfirmAddRole" class="admin-btn-primary" style="padding:6px 14px;font-size:12px;white-space:nowrap;">
            Add
        </button>
        <button type="button" id="annCancelAddRole" class="admin-btn-ghost" style="padding:6px 10px;font-size:12px;">
            ✕
        </button>
    `;
    box.appendChild(row);

    const input = row.querySelector('#annNewRoleName');
    input.focus();

    row.querySelector('#annConfirmAddRole').addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        await createRoleQuick(name);
    });

    row.querySelector('#annCancelAddRole').addEventListener('click', () => {
        row.remove();
    });

    // Submit on Enter
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const name = input.value.trim();
            if (!name) return;
            await createRoleQuick(name);
        }
        if (e.key === 'Escape') row.remove();
    });
}

async function createRoleQuick(name) {
    try {
        await apiCall('/admin/roles', {
            method: 'POST',
            body: JSON.stringify({ name, description: '', screenKeys: ['dashboard', 'profile'] }),
        });
        showMsg(`Role "${name}" created.`, 'success');
        await loadRoles();
        renderRolePicker(getSelectedRoleNames());
    } catch (e) { showMsg(e.message, 'error'); }
}

function openEditRoleModal(roleName) {
    const box = document.getElementById('annRolePicker');
    if (!box) return;

    // Find the row for this role and replace the label with an input
    const editBtn = box.querySelector(`[data-ann-edit-role="${roleName}"]`);
    if (!editBtn) return;
    const row = editBtn.closest('div');
    if (!row || row.querySelector('input[type="text"]')) return;

    const label = row.querySelector('label');
    const origHTML = label.innerHTML;

    label.innerHTML = `
        <input type="text" class="ann-inline-edit form-control"
            value="${escapeHtml(roleName)}"
            style="flex:1;padding:5px 10px;font-size:13px;border-radius:8px;border:1.5px solid #93c5fd;">
    `;
    const input = label.querySelector('input');
    input.focus();
    input.select();

    const commit = async () => {
        const newName = input.value.trim();
        label.innerHTML = origHTML;
        if (!newName || newName === roleName) return;
        await renameRoleByName(roleName, newName);
    };

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') { e.preventDefault(); await commit(); }
        if (e.key === 'Escape') { label.innerHTML = origHTML; }
    });
    input.addEventListener('blur', commit);
}

async function renameRoleByName(oldName, newName) {
    try {
        const rolesRes = await apiCall('/admin/roles');
        const role = (rolesRes.roles || []).find(r => r.name === oldName);
        if (!role) { showMsg('Role not found', 'error'); return; }
        await apiCall(`/admin/roles/${role.id}`, {
            method: 'PUT',
            body: JSON.stringify({ name: newName }),
        });
        showMsg(`Role renamed to "${newName}".`, 'success');
        await loadRoles();
        renderRolePicker(getSelectedRoleNames().map(r => r === oldName ? newName : r));
    } catch (e) { showMsg(e.message, 'error'); }
}

async function deleteRoleFromAnn(roleName) {
    if (!confirm(`Delete role "${roleName}"?\nThis only works if no employees currently have this role.`)) return;
    try {
        const rolesRes = await apiCall('/admin/roles');
        const role = (rolesRes.roles || []).find(r => r.name === roleName);
        if (!role) { showMsg('Role not found', 'error'); return; }
        if (role.isSystem) { showMsg('System roles cannot be deleted.', 'error'); return; }
        await apiCall(`/admin/roles/${role.id}`, { method: 'DELETE' });
        showMsg(`Role "${roleName}" deleted.`, 'success');
        await loadRoles();
        renderRolePicker(getSelectedRoleNames().filter(r => r !== roleName));
    } catch (e) { showMsg(e.message, 'error'); }
}

function syncPickerSelectionFromDom() {
    const visibleBoxes = [...document.querySelectorAll('input[name="annEmp"]')];
    if (!visibleBoxes.length) return;

    const checkedVisible = visibleBoxes
        .filter((cb) => cb.checked)
        .map((cb) => parseInt(cb.value, 10))
        .filter((id) => !isNaN(id) && id > 0);
    const uncheckedVisible = visibleBoxes
        .filter((cb) => !cb.checked)
        .map((cb) => parseInt(cb.value, 10))
        .filter((id) => !isNaN(id) && id > 0);

    pickerSelectedEmployeeIds = [
        ...pickerSelectedEmployeeIds.filter((id) => !uncheckedVisible.includes(id)),
        ...checkedVisible,
    ];
    pickerSelectedEmployeeIds = [...new Set(pickerSelectedEmployeeIds)];
}

function renderEmployeePicker(selectedIds = []) {
    const box = document.getElementById('annEmployeePicker');
    if (!box) return;

    if (selectedIds.length) {
        pickerSelectedEmployeeIds = [...new Set(
            selectedIds.map((x) => parseInt(x, 10)).filter((id) => !isNaN(id) && id > 0)
        )];
    }

    const q = (document.getElementById('annEmployeeSearch')?.value || '').toLowerCase();
    const filtered = allEmployees.filter(e => {
        const name = (e.Name || e.name || '').toLowerCase();
        const email = (e.Email || e.email || '').toLowerCase();
        const role = (e.Role || e.role || '').toLowerCase();
        return name.includes(q) || email.includes(q) || role.includes(q) || String(e.EmployeeID || e.id).includes(q);
    });

    if (!filtered.length) {
        box.innerHTML = '<p class="text-muted" style="padding:8px;">No people found</p>';
        return;
    }

    const idSet = new Set(pickerSelectedEmployeeIds);
    const pickerHtml = filtered.map(e => {
        const id = parseInt(e.EmployeeID || e.id, 10);
        const role = e.Role || e.role || '';
        return `
        <label>
            <input type="checkbox" name="annEmp" value="${id}" ${idSet.has(id) ? 'checked' : ''}>
            <span>${escapeHtml(e.Name || e.name)}
                <small class="text-hint"> · ${escapeHtml(role)} · ID ${id}</small>
            </span>
        </label>`;
    }).join('');
    box.innerHTML = `
        <div class="admin-actions-row" style="margin-bottom:8px;">
            <button type="button" class="admin-link-btn" id="annSelectAllEmp">Select all</button>
            <button type="button" class="admin-link-btn" id="annClearAllEmp">Clear</button>
            <span class="csv-hint" id="annEmpCount">${pickerSelectedEmployeeIds.length} selected · ${filtered.length} shown</span>
        </div>
        ${pickerHtml}`;
    box.querySelector('#annSelectAllEmp')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        box.querySelectorAll('input[name="annEmp"]').forEach(cb => { cb.checked = true; });
        syncPickerSelectionFromDom();
    });
    box.querySelector('#annClearAllEmp')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        box.querySelectorAll('input[name="annEmp"]').forEach(cb => { cb.checked = false; });
        pickerSelectedEmployeeIds = [];
    });
}

function getSelectedEmployeeIds() {
    return [...pickerSelectedEmployeeIds];
}

function getSelectedRoleNames() {
    return [...document.querySelectorAll('#annRolePicker input[name="annRole"]:checked')]
        .map(cb => cb.value);
}

async function loadAnnouncements() {
    const list = document.getElementById('annList');
    try {
        const res = await apiCall('/admin/announcements');
        announcements = res.announcements || [];
        updateStats();

        if (!announcements.length) {
            list.innerHTML = `
                <div class="admin-empty" style="grid-column:1/-1;">
                    <div class="admin-empty-icon">📭</div>
                    <p>No announcements yet. Create one to notify your team.</p>
                </div>`;
            return;
        }

        list.innerHTML = announcements.map(a => {
            const expired = a.isExpired || (a.expiresAt && new Date(a.expiresAt).getTime() <= Date.now());
            return `
            <article class="admin-ann-card ${a.isActive && !expired ? '' : 'inactive'}">
                <div class="admin-ann-card-header">
                    <h3>${escapeHtml(a.title)}</h3>
                    <span class="admin-pill ${expired ? 'admin-pill-muted' : (a.isActive ? 'admin-pill-success' : 'admin-pill-muted')}">${expired ? 'Expired' : (a.isActive ? 'Active' : 'Inactive')}</span>
                </div>
                <p class="ann-body-text">${escapeHtml(a.body).replace(/\n/g, '<br>')}</p>
                <div class="admin-ann-meta">
                    ${a.category ? `<span class="admin-pill" style="background:#f0f9ff;color:#0369a1;">📂 ${escapeHtml(a.category)}</span>` : ''}
                    <span>👥 ${escapeHtml(a.recipientLabel)}</span>
                    <span>Priority ${a.priority}</span>
                    <span>${formatDate(a.createdAt)}</span>
                    ${a.expiresAt ? `<span class="${expired ? 'admin-pill-muted' : ''}">Expires ${formatDateOnly(a.expiresAt)}${expired ? ' · hidden' : ''}</span>` : ''}
                </div>
                <div class="admin-actions-row" style="margin-top:14px;">
                    <button type="button" class="admin-link-btn" data-edit="${a.id}">Edit</button>
                    <button type="button" class="admin-link-btn danger" data-del="${a.id}">Delete</button>
                </div>
            </article>
        `;
        }).join('');

        list.querySelectorAll('[data-edit]').forEach(btn => {
            btn.addEventListener('click', () => openAnnModal(announcements.find(x => x.id === parseInt(btn.dataset.edit, 10))));
        });
        list.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', () => deleteAnn(parseInt(btn.dataset.del, 10)));
        });
    } catch (e) {
        list.innerHTML = `<p class="message error">${escapeHtml(e.message)}</p>`;
    }
}

function updateStats() {
    document.getElementById('statTotal').textContent = announcements.length;
    document.getElementById('statActive').textContent = announcements.filter(a => a.isActive).length;
    document.getElementById('statAll').textContent = announcements.filter(a => a.targetType === 'all').length;
    const byRoleEl = document.getElementById('statByRole');
    if (byRoleEl) byRoleEl.textContent = announcements.filter(a => a.targetType === 'roles').length;
    document.getElementById('statTargeted').textContent = announcements.filter(a => a.targetType === 'selected').length;
}

function openAnnModal(item) {
    pickerSelectedEmployeeIds = [];
    const searchEl = document.getElementById('annEmployeeSearch');
    if (searchEl) searchEl.value = '';

    const modal = document.getElementById('annModal');
    modal.style.display = 'flex';
    modal.classList.add('is-open');
    document.getElementById('annModalTitle').textContent = item ? 'Edit announcement' : 'New announcement';
    document.getElementById('annId').value = item ? item.id : '';
    document.getElementById('annTitle').value = item ? item.title : '';
    document.getElementById('annBody').value = item ? item.body : '';
    document.getElementById('annPriority').value = item ? item.priority : 0;
    populateCategoryDropdown(item ? (item.category || '') : '');
    // Hide the category manager panel when opening the modal
    const catPanel = document.getElementById('catManagerPanel');
    if (catPanel) catPanel.style.display = 'none';
    document.getElementById('annActive').checked = item ? item.isActive : true;
    document.getElementById('annExpires').value = item && item.expiresAt ? toLocalInput(item.expiresAt) : '';

    const type = item ? item.targetType : 'all';
    const allRadio = document.getElementById('annTargetAll');
    const rolesRadio = document.getElementById('annTargetRoles');
    const selectedRadio = document.getElementById('annTargetSelected');
    if (allRadio) allRadio.checked = type === 'all';
    if (rolesRadio) rolesRadio.checked = type === 'roles';
    if (selectedRadio) selectedRadio.checked = type === 'selected';

    const roleNames = (item && item.roles) ? item.roles.map(r => r.roleName) : [];
    const ids = (item && item.recipients) ? item.recipients.map(r => r.employeeId) : [];
    renderRolePicker(roleNames);
    renderEmployeePicker(ids);
    toggleTargetPanels();

    const hint = document.getElementById('annSelectedHint');
    if (hint) {
        hint.textContent = type === 'selected'
            ? 'Only checked people will see this on their dashboard (not other users).'
            : '';
    }
}

function closeAnnModal() {
    const modal = document.getElementById('annModal');
    modal.style.display = 'none';
    modal.classList.remove('is-open');
}

async function saveAnn(e) {
    e.preventDefault();
    syncPickerSelectionFromDom();
    const id = document.getElementById('annId').value;
    const targetType = getTargetType();
    const employeeIds = targetType === 'selected' ? getSelectedEmployeeIds() : [];
    const roleNames = targetType === 'roles' ? getSelectedRoleNames() : [];

    if (targetType === 'selected' && !employeeIds.length) {
        showMsg('Select at least one person', 'error');
        return;
    }
    if (targetType === 'roles' && !roleNames.length) {
        showMsg('Select at least one role', 'error');
        return;
    }

    const expiresAt = parseExpiryForSave();
    if (expiresAt === false) return;

    const payload = {
        title:    document.getElementById('annTitle').value.trim(),
        body:     document.getElementById('annBody').value.trim(),
        priority: parseInt(document.getElementById('annPriority').value, 10) || 0,
        isActive: document.getElementById('annActive').checked,
        category: document.getElementById('annCategory')?.value.trim() || null,
        expiresAt,
        targetType,
        employeeIds,
        roleNames,
    };

    try {
        if (id) {
            await apiCall(`/admin/announcements/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
            await apiCall('/admin/announcements', { method: 'POST', body: JSON.stringify(payload) });
        }
        closeAnnModal();
        let msg = 'Announcement saved';
        if (targetType === 'selected' && employeeIds.length) {
            const names = allEmployees
                .filter((emp) => employeeIds.includes(parseInt(emp.EmployeeID || emp.id, 10)))
                .map((emp) => emp.Name || emp.name || emp.Email || emp.email)
                .filter(Boolean);
            const who = names.length ? names.join(', ') : `employee ID(s) ${employeeIds.join(', ')}`;
            msg = `Saved. Only ${who} will see this on their dashboard (log in as them to verify).`;
        }
        showMsg(msg, 'success');
        await loadAnnouncements();
    } catch (err) {
        showMsg(err.message, 'error');
    }
}

async function deleteAnn(id) {
    if (!confirm('Delete this announcement?')) return;
    try {
        await apiCall(`/admin/announcements/${id}`, { method: 'DELETE' });
        showMsg('Deleted', 'success');
        await loadAnnouncements();
    } catch (e) {
        showMsg(e.message, 'error');
    }
}

function showMsg(text, type) {
    const el = document.getElementById('annMessage');
    el.textContent = text;
    el.className = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4500);
}

function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleString();
}

function formatDateOnly(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function toLocalInput(d) {
    // Return just the YYYY-MM-DD part for the date input
    const dt = new Date(d);
    const yyyy = dt.getFullYear();
    const mm   = String(dt.getMonth() + 1).padStart(2, '0');
    const dd   = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function parseExpiryForSave() {
    const raw = (document.getElementById('annExpires')?.value || '').trim();
    if (!raw) return null;
    // Parse as local date and set to end-of-day so the announcement stays visible all day
    const [year, month, day] = raw.split('-').map(Number);
    if (!year || !month || !day) {
        showMsg('Invalid expiry date', 'error');
        return false;
    }
    const dt = new Date(year, month - 1, day, 23, 59, 59, 999);
    if (Number.isNaN(dt.getTime())) {
        showMsg('Invalid expiry date', 'error');
        return false;
    }
    // Allow today — only reject dates that are fully in the past (yesterday or earlier)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (dt < startOfToday) {
        showMsg('Expiry date cannot be in the past.', 'error');
        return false;
    }
    return dt.toISOString();
}

function escapeHtml(s) {
    if (!s) return '';
    const el = document.createElement('div');
    el.textContent = s;
    return el.innerHTML;
}
