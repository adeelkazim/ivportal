const XLSX = require('xlsx');

const REQUIRED = [
    'itemid',
    'itemname',
    'quantityavailable',
    'deskno',
    'employeename',
    'employeeemail',
    'employeeid'
];

const REQUIRED_LABELS =
    'Item ID, Item Name, Quantity Available, Desk No, Employee Name, Employee Email, Employee ID';

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

function parseInventoryFile(buffer, filename = '') {
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

function readXlsx(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (!workbook.SheetNames.length) {
        throw new Error('Excel file has no sheets');
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return rows
        .filter(row => Array.isArray(row) && row.some(c => String(c).trim() !== ''))
        .map(row => row.map(cell => {
            if (typeof cell === 'number' && !isNaN(cell)) return String(cell);
            return String(cell ?? '').trim();
        }));
}

function parseTable(tableRows) {
    let headerRowIndex = -1;
    let headerMap;

    for (let r = 0; r < Math.min(20, tableRows.length); r++) {
        const map = buildHeaderMap(tableRows[r]);
        const hasAll = REQUIRED.every(key => map[key] !== undefined);
        if (hasAll) {
            headerRowIndex = r;
            headerMap = map;
            break;
        }
    }

    if (headerRowIndex < 0) {
        throw new Error(
            `Upload file must use exactly these columns: ${REQUIRED_LABELS}. ` +
            'Other spreadsheets (Date and Time, Room Number, device columns, etc.) are not supported.'
        );
    }

    const dataRows = tableRows.slice(headerRowIndex + 1);
    const rows = [];

    dataRows.forEach((cols, i) => {
        const itemName = (cols[headerMap.itemname] || '').trim();
        if (!itemName) return;

        const qtyAvail = parseNumber(cols[headerMap.quantityavailable]);
        if (qtyAvail === null || qtyAvail < 0) {
            throw new Error(`Invalid Quantity Available on row ${headerRowIndex + i + 2}`);
        }

        rows.push({
            itemId: (cols[headerMap.itemid] || '').trim(),
            itemName,
            quantityAvailable: qtyAvail,
            deskNo: (cols[headerMap.deskno] || '').trim(),
            employeeName: (cols[headerMap.employeename] || '').trim(),
            employeeEmail: (cols[headerMap.employeeemail] || '').trim(),
            employeeId: (cols[headerMap.employeeid] || '').trim()
        });
    });

    if (rows.length === 0) {
        throw new Error('No valid data rows found');
    }
    return rows;
}

function parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = parseInt(String(value).replace(/,/g, '').trim(), 10);
    return isNaN(n) ? null : n;
}

function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQuotes = !inQuotes;
        else if (c === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else current += c;
    }
    result.push(current.trim());
    return result;
}

module.exports = { parseInventoryFile, REQUIRED_LABELS };
