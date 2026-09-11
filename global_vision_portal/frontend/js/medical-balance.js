document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    if (!getUser()) return;
    await loadAllBalances();
});

async function loadAllBalances() {
    const panel = document.getElementById('myBalancesPanel');
    const grid  = document.getElementById('myBalancesGrid');
    grid.innerHTML = '<p style="color:#94a3b8;padding:8px 0;">Loading…</p>';

    try {
        const [medRes, cardsRes] = await Promise.all([
            apiCall('/medical-balance').catch(() => null),
            apiCall('/balance-cards').catch(() => ({ cards: [] })),
        ]);

        const b     = medRes?.balance;
        // Exclude custom cards whose label duplicates one of the 3 static fields
        const STATIC_LABELS = ['medical balance', 'loan balance', 'leave this year', 'leaves remaining'];
        const cards = (cardsRes.cards || []).filter(c => !STATIC_LABELS.includes(c.Label.toLowerCase()));

        let html = '';

        if (b) {
            const staticMeta = b.lastUpdatedOn
                ? `Updated ${new Date(b.lastUpdatedOn).toLocaleDateString()}${b.updatedByName ? ' by ' + b.updatedByName : ''}`
                : 'Not yet set by HR';

            html += `
            <div class="balance-card-tile" style="border-top:4px solid #2563eb;">
                <div class="bc-icon">⚕</div>
                <span class="bc-type-tag allowance">Allowance</span>
                <div class="bc-label">Medical Balance</div>
                <div class="bc-amount">${formatBalanceMoney(b.balance)}</div>
                <div class="bc-meta">${staticMeta}</div>
            </div>
            <div class="balance-card-tile" style="border-top:4px solid #0891b2;">
                <div class="bc-icon">🏦</div>
                <span class="bc-type-tag allowance">Allowance</span>
                <div class="bc-label">Loan Balance</div>
                <div class="bc-amount">${formatBalanceMoney(b.loanBalance)}</div>
                <div class="bc-meta">${staticMeta}</div>
            </div>
            <div class="balance-card-tile" style="border-top:4px solid #16a34a;">
                <div class="bc-icon">📅</div>
                <span class="bc-type-tag allowance">Allowance</span>
                <div class="bc-label">Leave this year</div>
                <div class="bc-amount"><span style="font-size:28px;font-weight:800;">${Math.round(b.leavesRemaining || 0)}</span> <span style="font-size:14px;font-weight:600;color:#64748b;">days</span></div>
                <div class="bc-meta">${staticMeta}</div>
            </div>`;
        }

        // Custom cards (any beyond the 3 static fields)
        cards.forEach(c => {
            const color       = c.Color || (c.IsDeduction ? '#ef4444' : '#3b82f6');
            const icon        = safeBalanceIcon(c.Icon, c.Label);
            const isDeduction = !!c.IsDeduction;
            const isDays      = c.Unit === 'Days';
            const typeTag     = isDeduction
                ? '<span class="bc-type-tag deduction">Deduction</span>'
                : '<span class="bc-type-tag allowance">Allowance</span>';
            const meta = c.UpdatedAt
                ? `Updated ${new Date(c.UpdatedAt).toLocaleDateString()}${c.UpdatedByName ? ' by ' + c.UpdatedByName : ''}`
                : 'Not yet set by HR';
            const amountHtml = isDays
                ? `<span style="font-size:28px;font-weight:800;color:${isDeduction ? '#dc2626' : '#1e293b'};">${Math.round(c.Amount || 0)}</span> <span style="font-size:14px;font-weight:600;color:#64748b;">days</span>`
                : formatBalanceMoney(c.Amount || 0);
            html += `
            <div class="balance-card-tile${isDeduction ? ' is-deduction' : ''}" style="border-top:4px solid ${escBal(color)};">
                <div class="bc-icon">${icon}</div>
                ${typeTag}
                <div class="bc-label">${escBal(c.Label)}</div>
                <div class="bc-amount">${amountHtml}</div>
                <div class="bc-meta">${meta}</div>
            </div>`;
        });

        if (!html) {
            grid.innerHTML = '<p style="color:#94a3b8;padding:8px 0;">No balances assigned yet. Contact your administrator.</p>';
        } else {
            grid.innerHTML = html;
        }
    } catch (e) {
        showBalanceMsg(e.message, 'error');
        grid.innerHTML = '';
    }
}

function showBalanceMsg(text, type) {
    const el = document.getElementById('medMessage');
    el.textContent   = text;
    el.className     = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function formatBalanceMoney(n) {
    return new Intl.NumberFormat('en-PK', {
        style: 'currency', currency: 'PKR', maximumFractionDigits: 0,
    }).format(parseFloat(n) || 0);
}

function escBal(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function safeBalanceIcon(icon, label) {
    const clean = (icon || '').replace(/\?/g, '').trim();
    if (!clean) {
        const init = (label || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
        return `<span style="display:inline-flex;align-items:center;justify-content:center;
            width:32px;height:32px;border-radius:8px;background:currentColor;
            font-size:13px;font-weight:700;color:#fff;">${init}</span>`;
    }
    return escBal(clean);
}
