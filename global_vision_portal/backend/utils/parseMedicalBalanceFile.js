const XLSX = require('xlsx');

const REQUIRED        = ['employeeid'];
const REQUIRED_LABELS = 'EmployeeID (required). Optional: EmployeeName, Balance, LoanBalance, LeavesRemaining';

function normalizeHeader(h) {
    return String(h)
        .toLowerCase()
        .trim()
        .replace(/ /g, ' ')
        .replace(/[\s_\-\.]+/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function buildHeaderMap(headers) {
    const map = {};
    headers.forEach((h, i) => {
        const key = normalizeHeader(h);
        if (key) map[key] = i;
    });

    // ── Balance / Medical Balance aliases ──────────────────────────
    for (const alias of ['balance', 'medicalbalance', 'medbalance', 'medicalbalanceamount', 'balancepkr', 'balanceamount']) {
        if (map[alias] !== undefined && map.balance === undefined) {
            map.balance = map[alias];
        }
    }

    // ── Loan Balance aliases ───────────────────────────────────────
    for (const alias of ['loanbalance', 'loan', 'loanamount', 'loanbalancepkr']) {
        if (map[alias] !== undefined && map.loanbalance === undefined) {
            map.loanbalance = map[alias];
        }
    }

    // ── Leaves Remaining aliases ───────────────────────────────────
    for (const alias of ['leavesremaining', 'leaves', 'leavethisyear', 'leavesthisyear', 'remainingleaves', 'annualleave']) {
        if (map[alias] !== undefined && map.leavesremaining === undefined) {
            map.leavesremaining = map[alias];
        }
    }

    return map;
}

function readXlsx(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (!workbook.SheetNames.length) throw new Error('Excel file has no sheets');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    return rows
        .filter((row) => Array.isArray(row) && row.some((c) => String(c).trim() !== ''))
        .map((row) => row.map((cell) => String(cell ?? '').trim()));
}

function readCsv(buffer) {
    const text  = buffer.toString('utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
        throw new Error('File must include a header row and at least one data row');
    }
    return lines.map((line) => parseCsvLine(line));
}

function parseCsvLine(line) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { cells.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    cells.push(cur.trim());
    return cells;
}

function parseTable(tableRows) {
    let headerMap;
    let headerRowIndex = -1;

    for (let r = 0; r < Math.min(20, tableRows.length); r++) {
        const map = buildHeaderMap(tableRows[r]);
        if (REQUIRED.every((key) => map[key] !== undefined)) {
            headerMap = map;
            headerRowIndex = r;
            break;
        }
    }

    if (!headerMap) {
        throw new Error(`Missing columns. Required: ${REQUIRED_LABELS}`);
    }

    // At least one numeric balance column must exist
    if (headerMap.balance === undefined && headerMap.loanbalance === undefined && headerMap.leavesremaining === undefined) {
        throw new Error('File must have at least one balance column: Balance, LoanBalance, or LeavesRemaining');
    }

    const rows   = [];
    const errors = [];

    for (let r = headerRowIndex + 1; r < tableRows.length; r++) {
        const row = tableRows[r];
        if (!row || !row.some((c) => String(c).trim() !== '')) continue;

        const employeeId = parseInt(row[headerMap.employeeid], 10);
        if (!employeeId || isNaN(employeeId)) {
            errors.push(`Row ${r + 1}: invalid EmployeeID`);
            continue;
        }

        // balance — keep null if column absent (ISNULL(null, existing) preserves DB value)
        let balance = null;
        if (headerMap.balance !== undefined) {
            const raw = row[headerMap.balance];
            if (raw !== '' && raw != null) {
                const parsed = parseFloat(String(raw).replace(/,/g, ''));
                if (isNaN(parsed)) { errors.push(`Row ${r + 1}: invalid Balance`); continue; }
                balance = parsed;
            }
        }

        let loanBalance = null;
        if (headerMap.loanbalance !== undefined) {
            const raw = row[headerMap.loanbalance];
            if (raw !== '' && raw != null) {
                const parsed = parseFloat(String(raw).replace(/,/g, ''));
                if (isNaN(parsed)) { errors.push(`Row ${r + 1}: invalid LoanBalance`); continue; }
                loanBalance = parsed;
            }
        }

        let leavesRemaining = null;
        if (headerMap.leavesremaining !== undefined) {
            const raw = row[headerMap.leavesremaining];
            if (raw !== '' && raw != null) {
                const parsed = parseInt(String(raw).replace(/,/g, ''), 10);
                if (isNaN(parsed)) { errors.push(`Row ${r + 1}: invalid LeavesRemaining`); continue; }
                leavesRemaining = parsed;
            }
        }

        // Skip rows that have no actual values to update
        if (balance === null && loanBalance === null && leavesRemaining === null) continue;

        rows.push({ employeeId, balance, loanBalance, leavesRemaining });
    }

    if (!rows.length && errors.length) {
        throw new Error(errors.slice(0, 5).join('; '));
    }
    if (!rows.length) {
        throw new Error('No valid data rows found');
    }

    return { rows, errors };
}

function parseMedicalBalanceFile(buffer, filename = '') {
    const ext = (filename || '').toLowerCase();
    const tableRows = ext.endsWith('.xlsx') || ext.endsWith('.xls')
        ? readXlsx(buffer)
        : readCsv(buffer);
    return parseTable(tableRows);
}

module.exports = {
    parseMedicalBalanceFile,
    REQUIRED_LABELS,
};
