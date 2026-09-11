/* Announcements on dashboard (employees + admins) */

let _annAllItems = [];
let _annActiveCategory = 'All';

async function loadPortalAnnouncements() {
    if (!isValidJwt(getToken())) return;

    // Self-inject the section if not already present
    let section = document.getElementById('announcementsSection');
    if (!section) {
        const container = document.querySelector('.portal-page-content') || document.querySelector('.container');
        if (!container) return;

        section = document.createElement('section');
        section.id = 'announcementsSection';
        section.className = 'dashboard-section';
        section.style.display = 'none';
        section.innerHTML = `
            <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <h2>Announcements</h2>
            </div>
            <div id="annCategoryTabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;"></div>
            <div id="announcementsList"></div>`;

        const attendanceSection = container.querySelector('#attendanceSection');
        const statsGrid = container.querySelector('.dashboard-grid');
        if (attendanceSection?.nextSibling) {
            container.insertBefore(section, attendanceSection.nextSibling);
        } else if (statsGrid) {
            container.insertBefore(section, statsGrid);
        } else {
            container.appendChild(section);
        }
    }

    const list = section.querySelector('#announcementsList');
    list.innerHTML = '<p class="text-muted">Loading…</p>';

    try {
        const res = await apiCall('/announcements');
        _annAllItems = (res && res.announcements) || [];

        if (!_annAllItems.length) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        _renderCategoryTabs(section);
        _renderAnnouncementList(list);
    } catch (e) {
        console.error('Announcements load failed:', e);
        section.style.display = 'block';
        list.innerHTML = `<p class="message error">Could not load announcements: ${escapeAnnouncementHtml(e.message || '')}</p>`;
    }
}

function _renderCategoryTabs(section) {
    const tabBar = section.querySelector('#annCategoryTabs');
    if (!tabBar) return;

    // Collect unique categories
    const cats = ['All', ...new Set(_annAllItems.map(a => a.category).filter(Boolean))];
    if (cats.length <= 1) { tabBar.style.display = 'none'; return; }

    tabBar.style.display = 'flex';
    tabBar.innerHTML = cats.map(cat => `
        <button type="button"
            style="padding:5px 14px;border-radius:20px;border:1.5px solid ${cat === _annActiveCategory ? '#3b82f6' : '#e2e8f0'};
                   background:${cat === _annActiveCategory ? '#3b82f6' : '#fff'};
                   color:${cat === _annActiveCategory ? '#fff' : '#475569'};
                   font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;"
            data-ann-cat="${escapeAnnouncementHtml(cat)}">${escapeAnnouncementHtml(cat)}</button>`
    ).join('');

    tabBar.querySelectorAll('[data-ann-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
            _annActiveCategory = btn.dataset.annCat;
            _renderCategoryTabs(section);
            _renderAnnouncementList(section.querySelector('#announcementsList'));
        });
    });
}

function _renderAnnouncementList(list) {
    if (!list) return;
    const filtered = _annActiveCategory === 'All'
        ? _annAllItems
        : _annAllItems.filter(a => a.category === _annActiveCategory);

    if (!filtered.length) {
        list.innerHTML = `<p class="text-muted" style="padding:12px 0;">No announcements in this category.</p>`;
        return;
    }

    list.innerHTML = filtered.map(a => {
        const sender   = a.createdByName ? `<strong>${escapeAnnouncementHtml(a.createdByName)}</strong>` : 'Admin';
        const personal = a.targetType !== 'all' ? ' · <em>Sent to you</em>' : '';
        const catBadge = a.category
            ? `<span style="background:#f0f9ff;color:#0369a1;font-size:10px;font-weight:700;padding:2px 8px;border-radius:12px;margin-right:6px;">📂 ${escapeAnnouncementHtml(a.category)}</span>`
            : '';
        return `
        <article class="announcement-card">
            <h3>${escapeAnnouncementHtml(a.title)}</h3>
            <p>${escapeAnnouncementHtml(a.body).replace(/\n/g, '<br>')}</p>
            <small class="text-hint">${catBadge}From ${sender} · ${formatAnnouncementDate(a.createdAt)}${personal}</small>
        </article>`;
    }).join('');
}

function formatAnnouncementDate(d) {
    if (!d) return '';
    try {
        return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
    } catch {
        return '';
    }
}

function escapeAnnouncementHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}
