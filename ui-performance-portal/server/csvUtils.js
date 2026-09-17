/** Parse CSV rows respecting quoted fields (handles commas in URLs). */
export function parseCsvContent(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field.trim());
      field = '';
    } else if (c === '\n' || (c === '\r' && next === '\n')) {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      if (c === '\r') i++;
    } else {
      field += c;
    }
  }

  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  if (!rows.length) return { headers: [], data: [] };

  const headers = rows[0];
  const data = rows.slice(1).map((cells, idx) => {
    const obj = { id: String(idx + 1) };
    headers.forEach((h, j) => {
      obj[h] = cells[j] ?? '';
    });
    return obj;
  });

  return { headers, data };
}

export function parseCsvFile(filePath, fs) {
  if (!fs.existsSync(filePath)) return { headers: [], data: [] };
  return parseCsvContent(fs.readFileSync(filePath, 'utf8'));
}

/** Count testable URLs in a static / crawled test-case CSV (handles comma-separated URLs per row). */
export function countUrlsInCsvFile(filePath, fs) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  try {
    const { data: rows } = parseCsvFile(filePath, fs);
    let count = 0;
    for (const row of rows) {
      const urls = row['Path Page URL'] ?? row.pageUrl ?? '';
      if (!urls) continue;
      count += urls.split(',').map((u) => u.trim()).filter(Boolean).length;
    }
    return count || rows.length;
  } catch {
    return 0;
  }
}

/** Count data rows in any test-case CSV (scripted steps or static URL rows). */
export function countRowsInCsvFile(filePath, fs) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  try {
    const { data } = parseCsvFile(filePath, fs);
    return data.length;
  } catch {
    return 0;
  }
}

/** Parse every CSV row as a string array (no header row assumed). */
export function parseCsvAllRows(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || (c === '\r' && next === '\n')) {
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      if (c === '\r') i++;
    } else {
      field += c;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

export const UEM_RESULT_COLUMNS = [
  'RUN_ID', 'Timestamp', 'HostName', 'Transaction', 'Page URL',
  'First Contentful Paint', 'Last Contentful Paint', 'Total Blocking Time',
  'Cumulative Layout Shift', 'Speed Index', 'Performance Score', 'Page Load Time',
  'Network Time', 'DNS Lookup Time', 'Connection Time', 'Server Processing Time',
  'Response Time', 'Browser Time', 'DOM Interaction Time', 'DOM Complete Time',
  'Playwright Full Page Load Time', 'Element Load Time', 'Test Status', 'Failure Reason',
  'Audit Titles', 'Audit Scores', 'TBT Savings',
];

/** Parse UEM result CSV with or without a header row. */
export function parseUemResultRows(content) {
  const allRows = parseCsvAllRows(content);
  if (!allRows.length) return [];

  let startIdx = 0;
  const first = allRows[0];
  if (first[0] === 'RUN_ID' || first[3] === 'Transaction') {
    startIdx = 1;
  }

  return allRows.slice(startIdx).map((cells) => {
    const obj = {};
    UEM_RESULT_COLUMNS.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim();
    });
    return obj;
  });
}

export function escapeCsvField(value) {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsvRow(fields) {
  return fields.map(escapeCsvField).join(',');
}
