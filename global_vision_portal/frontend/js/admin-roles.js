let allRoles   = [];
let allScreens = [];
let selectedRoleId = null;

document.addEventListener('DOMContentLoaded', async function () {
    checkAuth();
    if (!isManagerOrAdmin()) { window.location.href = 'dashboard.html'; return; }

    // Create role modal
    document.getElementById('btnAddRole')?.addEventListener('click', openCreateModal);
    document.getElementById('btnCancelRole')?.addEventListener('click', closeCreateModal);
    document.getElementById('roleForm')?.addEventListener('submit', createRole);

    // Edit role modal
    document.getElementById('btnCancelEditRole')?.addEventListener('click', closeEditModal);
    document.getElementById('editRoleForm')?.addEventListener('submit', saveEditRole);

    // Teams
    document.getElementById('btnAddTeam')?.addEventListener('click', () => showInlineAdd('team'));
    document.getElementById('confirmAddTeam')?.addEventListener('click', () => submitInlineAdd('team'));
    document.getElementById('cancelAddTeam')?.addEventListener('click', () => hideInlineAdd('team'));
    document.getElementById('newTeamName')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitInlineAdd('team'); }
        if (e.key === 'Escape') hideInlineAdd('team');
    });

    await loadData();
    await loadTeams();
});

// ── Data ────────────────────────────────────────────────────

async function loadData() {
    try {
        const [rolesRes, screensRes] = await Promise.all([
            apiCall('/admin/roles'),
            apiCall('/admin/screens'),
        ]);
        allRoles   = rolesRes.roles   || [];
        allScreens = screensRes.screens || [];
        renderRoleList();
    } catch (e) { showMsg(e.message, 'error'); }
}

// ── Role list ────────────────────────────────────────────────

function renderRoleList() {
    const list = document.getElementById('roleList');
    if (!allRoles.length) {
        list.innerHTML = '<li class="text-muted" style="padding:12px;">No roles defined</li>';
        return;
    }

    list.innerHTML = allRoles.map(r => `
        <li style="list-style:none;margin-bottom:2px;display:flex;align-items:center;gap:6px;padding:4px 8px 4px 0;">
            <button type="button"
                class="admin-list-item ${selectedRoleId === r.id ? 'active' : ''}"
                data-id="${r.id}"
                style="flex:1;text-align:left;">
                <strong>${esc(r.name)}</strong>
                <span>${r.userCount || 0} users · ${(r.screens || []).length} screens${r.isSystem ? ' · System' : ''}</span>
            </button>
            <!-- Edit icon -->
            <button type="button" class="role-icon-btn" data-edit="${r.id}" title="Edit role name">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
            </button>
            <!-- Delete icon (system roles disabled) -->
            <button type="button" class="role-icon-btn danger" data-del="${r.id}"
                title="${r.isSystem ? 'System role cannot be deleted' : 'Delete role'}"
                ${r.isSystem ? 'disabled' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
            </button>
        </li>
    `).join('');

    // Select role on row click
    list.querySelectorAll('.admin-list-item[data-id]').forEach(btn => {
        btn.addEventListener('click', () => selectRole(parseInt(btn.dataset.id, 10)));
    });

    // Edit button
    list.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(parseInt(btn.dataset.edit, 10));
        });
    });

    // Delete button
    list.querySelectorAll('[data-del]:not([disabled])').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRole(parseInt(btn.dataset.del, 10));
        });
    });
}

// ── Role detail / screen access ──────────────────────────────

function selectRole(id) {
    selectedRoleId = id;
    renderRoleList();
    const role = allRoles.find(r => r.id === id);
    if (!role) return;

    const assigned = new Set((role.screens || []).map(s => s.key || s.ScreenKey));
    const panel    = document.getElementById('roleDetailPanel');

    panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:10px;">
            <div>
                <h2 style="margin:0 0 4px;">${esc(role.name)}</h2>
                <p class="csv-hint">${esc(role.description || 'No description')}</p>
            </div>
            <div style="display:flex;gap:8px;">
                <button type="button" class="admin-btn-ghost" id="btnEditRoleInline" style="font-size:13px;padding:6px 14px;">
                    ✏️ Edit name
                </button>
                ${!role.isSystem
                    ? `<button type="button" class="admin-btn-ghost text-danger" id="btnDeleteRoleInline" style="font-size:13px;padding:6px 14px;">
                        🗑 Delete
                      </button>`
                    : '<span class="admin-pill admin-pill-muted" style="align-self:center;">System role</span>'}
            </div>
        </div>

        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">

        <h3 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:14px;">
            Screen Access
        </h3>
        <div class="screen-grid-pro" id="screenCheckGrid">
            ${allScreens.map(s => {
                const key     = s.ScreenKey || s.screenKey;
                const checked = assigned.has(key) ? 'checked' : '';
                return `<label class="screen-tile">
                    <input type="checkbox" value="${esc(key)}" ${checked}>
                    <div>
                        <span>${esc(s.ScreenName || s.screenName)}</span>
                        <small>${esc(s.Path || s.path)}</small>
                    </div>
                </label>`;
            }).join('')}
        </div>
        <div class="admin-actions-row" style="margin-top:20px;">
            <button type="button" class="admin-btn-primary" id="btnSaveScreens">Save screen access</button>
        </div>
    `;

    document.getElementById('btnSaveScreens')?.addEventListener('click', () => saveScreens(id));
    document.getElementById('btnEditRoleInline')?.addEventListener('click', () => openEditModal(id));
    document.getElementById('btnDeleteRoleInline')?.addEventListener('click', () => deleteRole(id));
}

async function saveScreens(roleId) {
    const keys = [...document.querySelectorAll('#screenCheckGrid input:checked')].map(cb => cb.value);
    try {
        await apiCall(`/admin/roles/${roleId}/screens`, {
            method: 'PUT',
            body: JSON.stringify({ screenKeys: keys }),
        });
        showMsg('Screen access saved. Users must log in again to refresh menu.', 'success');
        await loadData();
        selectRole(roleId);
    } catch (e) { showMsg(e.message, 'error'); }
}

// ── Create role ──────────────────────────────────────────────

function openCreateModal() {
    document.getElementById('roleForm').reset();
    const m = document.getElementById('roleModal');
    m.style.display = 'flex';
    m.classList.add('is-open');
}

function closeCreateModal() {
    const m = document.getElementById('roleModal');
    m.style.display = 'none';
    m.classList.remove('is-open');
}

async function createRole(e) {
    e.preventDefault();
    const name        = document.getElementById('roleName').value.trim();
    const description = document.getElementById('roleDesc').value.trim();
    try {
        await apiCall('/admin/roles', {
            method: 'POST',
            body: JSON.stringify({ name, description, screenKeys: ['dashboard', 'profile'] }),
        });
        closeCreateModal();
        showMsg(`Role "${name}" created. Assign screens below.`, 'success');
        await loadData();
    } catch (err) { showMsg(err.message, 'error'); }
}

// ── Edit role ────────────────────────────────────────────────

function openEditModal(id) {
    const role = allRoles.find(r => r.id === id);
    if (!role) return;
    document.getElementById('editRoleId').value       = id;
    document.getElementById('editRoleName').value     = role.name;
    document.getElementById('editRoleDesc').value     = role.description || '';
    const m = document.getElementById('editRoleModal');
    m.style.display = 'flex';
    m.classList.add('is-open');
    document.getElementById('editRoleName').focus();
}

function closeEditModal() {
    const m = document.getElementById('editRoleModal');
    m.style.display = 'none';
    m.classList.remove('is-open');
}

async function saveEditRole(e) {
    e.preventDefault();
    const id          = parseInt(document.getElementById('editRoleId').value, 10);
    const name        = document.getElementById('editRoleName').value.trim();
    const description = document.getElementById('editRoleDesc').value.trim();
    try {
        await apiCall(`/admin/roles/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name, description }),
        });
        closeEditModal();
        showMsg(`Role updated to "${name}".`, 'success');
        const wasSelected = selectedRoleId === id;
        await loadData();
        if (wasSelected) selectRole(id);
    } catch (err) { showMsg(err.message, 'error'); }
}

// ── Delete role ──────────────────────────────────────────────

async function deleteRole(id) {
    const role = allRoles.find(r => r.id === id);
    if (!confirm(`Delete role "${role?.name}"?\nOnly possible if no active users have this role.`)) return;
    try {
        await apiCall(`/admin/roles/${id}`, { method: 'DELETE' });
        if (selectedRoleId === id) {
            selectedRoleId = null;
            document.getElementById('roleDetailPanel').innerHTML =
                '<div class="admin-empty"><p>Select a role to manage screen access</p></div>';
        }
        showMsg('Role deleted.', 'success');
        await loadData();
    } catch (e) { showMsg(e.message, 'error'); }
}

// ── Helpers ──────────────────────────────────────────────────

function showMsg(text, type) {
    const el = document.getElementById('rolesMessage');
    el.textContent  = text;
    el.className    = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── Inline add / hide helpers ────────────────────────────────

function showInlineAdd(type) {
    const wrap = document.getElementById(`${type}InlineAdd`);
    const input = document.getElementById(`new${type.charAt(0).toUpperCase() + type.slice(1)}Name`);
    if (wrap) { wrap.style.display = 'block'; }
    if (input) { input.value = ''; input.focus(); }
}

function hideInlineAdd(type) {
    const wrap = document.getElementById(`${type}InlineAdd`);
    const input = document.getElementById(`new${type.charAt(0).toUpperCase() + type.slice(1)}Name`);
    if (wrap) wrap.style.display = 'none';
    if (input) input.value = '';
}

async function submitInlineAdd(type) {
    const key   = type.charAt(0).toUpperCase() + type.slice(1);
    const input = document.getElementById(`new${key}Name`);
    const name  = (input?.value || '').trim();
    if (!name) { input?.focus(); return; }
    try {
        await apiCall(`/admin/${type}s`, { method: 'POST', body: JSON.stringify({ name }) });
        hideInlineAdd(type);
        showDeptTeamMsg(type, `${key} "${name}" added.`, 'success');
        await loadTeams();
    } catch (e) {
        showDeptTeamMsg(type, e.message, 'error');
    }
}

// ── Teams ────────────────────────────────────────────────────

async function loadTeams() {
    const el = document.getElementById('teamList');
    if (!el) return;
    try {
        const res = await apiCall('/teams');
        const teams = (res && res.teams) || [];
        if (!teams.length) {
            el.innerHTML = '<p class="text-muted" style="font-size:13px;">No teams yet.</p>';
            return;
        }
        el.innerHTML = teams.map(t => `
            <div class="dept-team-row" data-team="${t.TeamID}">
                <span class="dept-team-name">${esc(t.TeamName)}</span>
                <button type="button" class="role-icon-btn" data-edit-team="${t.TeamID}" data-edit-team-name="${esc(t.TeamName)}" title="Rename">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button type="button" class="role-icon-btn danger" data-del-team="${t.TeamID}" data-del-team-name="${esc(t.TeamName)}" title="Delete">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                </button>
            </div>
        `).join('');

        el.querySelectorAll('[data-edit-team]').forEach(btn => {
            btn.addEventListener('click', () => startInlineRename('team', btn.dataset.editTeamName, btn.dataset.editTeam));
        });
        el.querySelectorAll('[data-del-team]').forEach(btn => {
            btn.addEventListener('click', () => deleteTeam(btn.dataset.delTeam, btn.dataset.delTeamName));
        });
    } catch (e) {
        el.innerHTML = `<p class="text-danger" style="font-size:13px;">${esc(e.message)}</p>`;
    }
}

async function deleteTeam(id, name) {
    if (!confirm(`Delete team "${name}"?`)) return;
    try {
        await apiCall(`/admin/teams/${id}`, { method: 'DELETE' });
        showDeptTeamMsg('team', `Deleted "${name}".`, 'success');
        await loadTeams();
    } catch (e) { showDeptTeamMsg('team', e.message, 'error'); }
}

// ── Inline rename (shared for dept and team) ─────────────────

function startInlineRename(type, currentName, id) {
    const listEl  = document.getElementById(`${type}List`);
    const selector = type === 'dept' ? `[data-dept="${currentName}"]` : `[data-team="${id}"]`;
    const row = listEl?.querySelector(selector);
    if (!row) return;

    const nameSpan = row.querySelector('.dept-team-name');
    if (!nameSpan || row.querySelector('input')) return;

    const orig = nameSpan.textContent;
    nameSpan.innerHTML = `
        <input type="text" value="${esc(orig)}"
            style="padding:4px 8px;font-size:13px;border:1.5px solid #93c5fd;border-radius:6px;width:130px;outline:none;">
    `;
    const input = nameSpan.querySelector('input');
    input.focus(); input.select();

    const commit = async () => {
        const newName = input.value.trim();
        nameSpan.textContent = orig;
        if (!newName || newName === orig) return;
        try {
            await apiCall(`/admin/teams/${id}`, {
                method: 'PUT', body: JSON.stringify({ name: newName })
            });
            showDeptTeamMsg('team', `Renamed to "${newName}".`, 'success');
            await loadTeams();
        } catch (e) { showDeptTeamMsg(type, e.message, 'error'); }
    };

    input.addEventListener('keydown', async e => {
        if (e.key === 'Enter') { e.preventDefault(); await commit(); }
        if (e.key === 'Escape') { nameSpan.textContent = orig; }
    });
    input.addEventListener('blur', commit);
}

// ── Dept/Team message helper ─────────────────────────────────

function showDeptTeamMsg(type, text, kind) {
    const el = document.getElementById(`${type}Message`);
    if (!el) return;
    el.textContent  = text;
    el.className    = `message ${kind}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}
