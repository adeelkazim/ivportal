/**
 * Parse inventory CSV. Expected headers (case-insensitive):
 * ItemName, Quantity, AvailableQuantity (optional), Status (optional)
 */
function parseInventoryCsv(buffer) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
        throw new Error('CSV must include a header row and at least one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const headerMap = {};
    headers.forEach((h, i) => {
        headerMap[h.toLowerCase()] = i;
    });

    const nameIdx = headerMap.itemname ?? headerMap['item name'] ?? headerMap.name;
    const qtyIdx = headerMap.quantity ?? headerMap.qty;
    const availIdx = headerMap.availablequantity ?? headerMap.available;
    const statusIdx = headerMap.status;

    if (nameIdx === undefined || qtyIdx === undefined) {
        throw new Error('CSV must include ItemName and Quantity columns');
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const itemName = (cols[nameIdx] || '').trim();
        if (!itemName) continue;

        const quantity = parseInt(cols[qtyIdx], 10);
        if (isNaN(quantity) || quantity < 0) {
            throw new Error(`Invalid quantity on row ${i + 1}`);
        }

        let available = availIdx !== undefined ? parseInt(cols[availIdx], 10) : quantity;
        if (isNaN(available) || available < 0) available = quantity;

        const status = (statusIdx !== undefined ? (cols[statusIdx] || '').trim() : '') || 'Available';
        rows.push({ itemName, quantity, availableQuantity: available, status });
    }

    if (rows.length === 0) {
        throw new Error('No valid rows found in CSV');
    }
    return rows;
}

function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }
    result.push(current.trim());
    return result;
}

module.exports = { parseInventoryCsv };
