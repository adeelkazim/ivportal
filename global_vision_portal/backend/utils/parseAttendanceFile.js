const XLSX = require('xlsx');

const REQUIRED = ['employeeid', 'date', 'logintime'];
const REQUIRED_LABELS = 'EmployeeID, Date, LoginTime (required). Optional: LogoutTime, TotalHours, CreatedAt — leave LogoutTime blank until employee logs out';

function normalizeHeader(h) {
    return String(h)
        .toLowerCase()
        .trim()
        .replace(/\u00a0/g, ' ')
        .replace(/[\s_\-\.]+/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function buildHeaderMap(headers) {
    const map = {};
    headers.forEach((h, i) => {
        const key = normalizeHeader(h);
        if (key) map[key] = i;
    });
    return map;
}

function parseAttendanceFile(buffer, filename = '') {
    const ext = (filename || '').toLowerCase();
    const tableRows = ext.endsWith('.xlsx') || ext.endsWith('.xls')
        ? readXlsx(buffer)
        : readCsv(buffer);
    return parseTable(tableRows);
}

function readCsv(buffer) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
        throw new Error('File must include a header row and at least one data row');
    }
    return lines.map(line => parseCsvLine(line));
}

function parseCsvLine(line) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === ',' && !inQuotes) {
            cells.push(cur.trim());
            cur = '';
            continue;
        }
        cur += ch;
    }
    cells.push(cur.trim());
    return cells;
}

function readXlsx(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (!workbook.SheetNames.length) throw new Error('Excel file has no sheets');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    return rows
        .filter(row => Array.isArray(row) && row.some(c => String(c).trim() !== ''))
        .map(row => row.map(cell => String(cell ?? '').trim()));
}

function parseTable(tableRows) {
    let headerMap;
    let headerRowIndex = -1;

    for (let r = 0; r < Math.min(20, tableRows.length); r++) {
        const map = buildHeaderMap(tableRows[r]);
        if (REQUIRED.every(key => map[key] !== undefined)) {
            headerMap = map;
            headerRowIndex = r;
            break;
        }
    }

    if (!headerMap) {
        throw new Error(`Missing required columns. Expected: ${REQUIRED_LABELS}`);
    }

    const rows = [];
    for (let r = headerRowIndex + 1; r < tableRows.length; r++) {
        const line = tableRows[r];
        if (!line || !line.some(c => String(c).trim() !== '')) continue;

        const get = (key) => {
            const idx = headerMap[key];
            return idx !== undefined ? String(line[idx] ?? '').trim() : '';
        };

        const employeeId = parseInt(get('employeeid'), 10);
        const dateStr = get('date');
        const loginStr = get('logintime');
        const logoutStr = get('logouttime');
        const totalHoursStr = get('totalhours');
        const createdAtStr = get('createdat');

        if (!employeeId || isNaN(employeeId)) {
            throw new Error(`Row ${r + 1}: invalid EmployeeID`);
        }

        const date = parseDateOnly(dateStr);
        if (!date) throw new Error(`Row ${r + 1}: invalid Date`);

        const loginTime = parseDateTime(date, loginStr);
        if (!loginTime) throw new Error(`Row ${r + 1}: invalid LoginTime`);

        const logoutTime = parseOptionalLogoutTime(date, logoutStr);

        let totalHours = parseOptionalHours(totalHoursStr);

        if ((totalHours === null || totalHours === undefined) && loginTime && logoutTime) {
            totalHours = roundHours((logoutTime - loginTime) / (1000 * 60 * 60));
        }

        const createdAt = createdAtStr ? parseDateTime(date, createdAtStr) || parseDateOnly(createdAtStr) : null;

        rows.push({
            employeeId,
            date,
            loginTime,
            logoutTime,
            totalHours: totalHours != null && !isNaN(totalHours) ? totalHours : null,
            createdAt
        });
    }

    if (!rows.length) throw new Error('No data rows found');
    return rows;
}

function isEmptyCell(val) {
    const s = String(val ?? '').trim().toLowerCase();
    return !s
        || s === '-'
        || s === '--'
        || s === 'n/a'
        || s === 'na'
        || s === 'null'
        || s === 'none'
        || s === '#n/a'
        || s.startsWith('#');
}

/** LogoutTime is optional — blank or unparseable means still checked in (logout set when user logs out) */
function parseOptionalLogoutTime(baseDate, str) {
    if (isEmptyCell(str)) return null;

    const s = String(str).trim();

    let parsed = parseDateTime(baseDate, s);
    if (parsed) return parsed;

    parsed = parseDateTime(null, s);
    if (parsed) return parsed;

    if (/^\d+(\.\d+)?$/.test(s)) {
        const serial = parseFloat(s);
        if (serial > 0 && serial < 1) {
            const minutes = Math.round(serial * 24 * 60);
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            const d = new Date(baseDate);
            d.setHours(h, m, 0, 0);
            return d;
        }
    }

    return null;
}

/** TotalHours is optional — blank or unparseable values are ignored (computed from login/logout when possible) */
function parseOptionalHours(str) {
    if (isEmptyCell(str)) return null;

    let s = String(str).trim().replace(/\u00a0/g, ' ');
    s = s.replace(/,/g, '.'); // 8,25 → 8.25

    const timeMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const sec = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        const ampm = timeMatch[4];
        if (ampm) {
            const up = ampm.toUpperCase();
            if (up === 'PM' && h < 12) h += 12;
            if (up === 'AM' && h === 12) h = 0;
        }
        if (h >= 0 && h < 24 && m >= 0 && m < 60 && sec >= 0 && sec < 60) {
            return roundHours(h + m / 60 + sec / 3600);
        }
    }

    const hoursMinutes = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(\d+)?\s*m(?:in(?:utes?)?)?$/i);
    if (hoursMinutes) {
        const h = parseFloat(hoursMinutes[1]);
        const m = hoursMinutes[2] ? parseInt(hoursMinutes[2], 10) : 0;
        if (!isNaN(h) && h >= 0) return roundHours(h + m / 60);
    }

    if (/^\d+(\.\d+)?$/.test(s)) {
        const n = parseFloat(s);
        if (isNaN(n) || n < 0) return null;
        if (n > 0 && n < 1) return roundHours(n * 24); // Excel day fraction, e.g. 0.34375 → 8.25 h
        return n;
    }

    return null;
}

function parseDateOnly(str) {
    if (!str) return null;
    const s = String(str).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(s.slice(0, 10) + 'T12:00:00');
        return isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s)) {
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDateTime(baseDate, str) {
    if (!str) return null;
    const s = String(str).trim();

    if (/^\d{4}-\d{2}-\d{2}[T\s]\d/.test(s)) {
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    const timeMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (timeMatch && baseDate) {
        let h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const sec = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        const ampm = timeMatch[4];
        if (ampm) {
            const up = ampm.toUpperCase();
            if (up === 'PM' && h < 12) h += 12;
            if (up === 'AM' && h === 12) h = 0;
        }
        const d = new Date(baseDate);
        d.setHours(h, m, sec, 0);
        return d;
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

function roundHours(h) {
    return Math.round(h * 100) / 100;
}

module.exports = { parseAttendanceFile, REQUIRED_LABELS };
