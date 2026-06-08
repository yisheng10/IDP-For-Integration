function escapeCsvCell(value) {
  const normalized = value == null ? '' : String(value);
  if (!/[",\n]/.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function stringifyCsv(rows = [], columns = []) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const header = safeColumns.join(',');
  const lines = rows.map((row) =>
    safeColumns.map((column) => escapeCsvCell(row?.[column] ?? '')).join(',')
  );
  return [header, ...lines].join('\n');
}

export function parseCsv(text = '') {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(current);
      if (row.length > 1 || row[0] !== '') {
        rows.push(row);
      }
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  if (!rows.length) return [];

  const [header, ...dataRows] = rows;
  return dataRows.map((cells) => {
    const entry = {};
    header.forEach((column, index) => {
      entry[column] = cells[index] ?? '';
    });
    return entry;
  });
}
