export type ImportRow = {
  booked_date: string; // YYYY-MM-DD
  counterparty: string;
  reference: string;
  amount: number;
  currency: string;
};

export type ImportErrorRow = {
  rowNumber: number;
  reason: string;
  raw: Record<string, any>;
};

export function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

// Minimal CSV parser that supports quoted fields and commas inside quotes.
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    cur.push(field);
    field = '';
  };
  const pushRow = () => {
    if (cur.length === 1 && cur[0] === '') {
      cur = [];
      return;
    }
    rows.push(cur);
    cur = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      pushField();
      continue;
    }

    if (ch === '\n') {
      pushField();
      pushRow();
      continue;
    }

    if (ch === '\r') continue;

    field += ch;
  }

  pushField();
  if (cur.length) pushRow();

  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow || []).map((h) => h.trim());
  return { headers, rows: dataRows };
}

export function toIsoDateOrNull(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

export function parseAmount(input: string): number | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  s = s.replace(/^negative\s+/i, '-');
  s = s.replace(/[$€£]/g, '');
  s = s.replace(/,/g, '');
  s = s.replace(/\s+/g, '');

  const n = Number(s);
  if (!isFinite(n)) return null;
  return n;
}

export function normalizeCurrency(input: string): string | null {
  const c = (input || '').trim().toUpperCase();
  if (!c) return null;
  if (c === 'AED' || c === 'USD' || c === 'EUR') return c;
  return null;
}