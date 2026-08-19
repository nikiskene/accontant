// src/pages/CustomerImport.tsx

import { useState, ChangeEvent, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { ArrowLeft, Upload, Check, X } from 'lucide-react';

interface ImportRow {
  alias: string;
  company_name: string; // legal name (REQUIRED by DB constraint)
  street_address: string;
  city: string;
  state: string;
  country: string;
  zip: string;
  phone: string;
  email: string;
  open_balance: string;
}

type FailedRow = {
  rowNumber: number;
  alias?: string;
  company_name?: string;
  email?: string;
  reason: string;
};

const PREVIEW_LIMIT = 20;
const CHUNK_SIZE = 200;

function normalizeEmail(email: string): { email: string | null; email_lc: string | null } {
  const e = (email || '').trim();
  if (!e) return { email: null, email_lc: null };
  return { email: e, email_lc: e.toLowerCase() };
}

function parseNumberSafe(v: string): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Minimal CSV line parser that respects quotes.
 * Handles commas inside quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // handle escaped quotes ""
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }

    cur += ch;
  }

  out.push(cur.trim());
  return out.map((v) => v.replace(/^\uFEFF/, '').trim()); // strip BOM if present
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export function CustomerImport() {
  const { workspaceId } = useApp();
  const [file, setFile] = useState<File | null>(null);

  const [allRows, setAllRows] = useState<ImportRow[]>([]);
  const [previewData, setPreviewData] = useState<ImportRow[]>([]);

  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [progress, setProgress] = useState<{
    total: number;
    processed: number;
    inserted: number;
    updated: number;
    failed: number;
  } | null>(null);

  const [failedRows, setFailedRows] = useState<FailedRow[]>([]);
  const cancelRef = useRef(false);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file');
      return;
    }

    setFile(selectedFile);
    setError('');
    setSuccess('');
    setProgress(null);
    setFailedRows([]);
    cancelRef.current = false;

    parseCSV(selectedFile);
  };

  const parseCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = (e.target?.result as string) || '';
        const rawLines = text
          .split('\n')
          .map((l) => l.replace(/\r/g, ''))
          .filter((l) => l.trim());

        if (rawLines.length === 0) {
          setError('CSV file is empty');
          return;
        }

        const headers = parseCsvLine(rawLines[0]).map((h) => h.trim().replace(/"/g, ''));
        const headerMap: Record<string, number> = {};

        headers.forEach((header, index) => {
          const lowerHeader = header.toLowerCase().trim();

          if (lowerHeader === 'alias' || lowerHeader.includes('alias')) {
            headerMap['alias'] = index;
          } else if (
            lowerHeader.includes('company') ||
            lowerHeader.includes('legal') ||
            lowerHeader.includes('company_name')
          ) {
            headerMap['company_name'] = index;
          } else if (lowerHeader.includes('street') || lowerHeader.includes('address')) {
            headerMap['street_address'] = index;
          } else if (lowerHeader.includes('city')) {
            headerMap['city'] = index;
          } else if (lowerHeader.includes('state')) {
            headerMap['state'] = index;
          } else if (lowerHeader.includes('country')) {
            headerMap['country'] = index;
          } else if (lowerHeader.includes('zip') || lowerHeader.includes('postal')) {
            headerMap['zip'] = index;
          } else if (lowerHeader.includes('phone') || lowerHeader.includes('tel')) {
            headerMap['phone'] = index;
          } else if (lowerHeader.includes('email') || lowerHeader.includes('e-mail')) {
            headerMap['email'] = index;
          } else if (lowerHeader.includes('balance')) {
            headerMap['open_balance'] = index;
          }
        });

        const rows: ImportRow[] = [];

        for (let i = 1; i < rawLines.length; i++) {
          const values = parseCsvLine(rawLines[i]).map((v) => v.replace(/"/g, '').trim());

          const get = (key: keyof ImportRow, fallback = '') => {
            const idx = headerMap[key as string];
            if (idx === undefined) return fallback;
            return values[idx] ?? fallback;
          };

          const company_name = get('company_name', '').trim();
          const alias = (get('alias', '') || company_name).trim();

          const row: ImportRow = {
            alias,
            company_name,
            street_address: get('street_address', ''),
            city: get('city', ''),
            state: get('state', ''),
            country: get('country', ''),
            zip: get('zip', ''),
            phone: get('phone', ''),
            email: get('email', ''),
            open_balance: get('open_balance', '0'),
          };

          // DB constraint: customer must have company_name (legal name)
          if (row.company_name) rows.push(row);
        }

        setAllRows(rows);
        setPreviewData(rows.slice(0, PREVIEW_LIMIT));

        if (rows.length === 0) {
          setError(
            'No valid rows found. Your database requires "Company (legal name)" for customers.'
          );
        }
      } catch (err: any) {
        console.error('Error parsing CSV:', err);
        setError('Failed to parse CSV file. Please ensure it is properly formatted.');
      }
    };

    reader.readAsText(file);
  };

  const handleCancelImport = () => {
    cancelRef.current = true;
  };

  const downloadFailuresCsv = () => {
    if (!failedRows.length) return;

    const header = ['rowNumber', 'alias', 'company_name', 'email', 'reason'];
    const lines = [
      header.join(','),
      ...failedRows.map((r) =>
        [
          r.rowNumber,
          `"${(r.alias || '').replace(/"/g, '""')}"`,
          `"${(r.company_name || '').replace(/"/g, '""')}"`,
          `"${(r.email || '').replace(/"/g, '""')}"`,
          `"${(r.reason || '').replace(/"/g, '""')}"`,
        ].join(',')
      ),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customer-import-failures.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!workspaceId) {
      setError('Missing workspace. Please reload and try again.');
      return;
    }
    if (!file || allRows.length === 0) return;

    setImporting(true);
    setError('');
    setSuccess('');
    setFailedRows([]);
    cancelRef.current = false;

    setProgress({
      total: allRows.length,
      processed: 0,
      inserted: 0,
      updated: 0,
      failed: 0,
    });

    try {
      let inserted = 0;
      let updated = 0;
      let failed = 0;
      const failures: FailedRow[] = [];

      for (let start = 0; start < allRows.length; start += CHUNK_SIZE) {
        if (cancelRef.current) break;

        const chunk = allRows.slice(start, start + CHUNK_SIZE);

        const payload = chunk
          .map((r, idx) => {
            const rowNumber = start + idx + 2;

            const company_name = (r.company_name || '').trim();
            if (!company_name) {
              failures.push({
                rowNumber,
                alias: r.alias,
                company_name: r.company_name,
                email: r.email,
                reason: 'Missing Company (legal name)',
              });
              failed++;
              return null;
            }

            const alias = ((r.alias || '').trim() || company_name).trim();

            const { email, email_lc } = normalizeEmail(r.email);

            return {
              _rowNumber: rowNumber, // internal
              workspace_id: workspaceId,
              kind: 'customer' as const,

              // required / allowed columns
              company_name,
              alias: alias || null,
              street_address: (r.street_address || '').trim() || null,
              city: (r.city || '').trim() || null,
              state: (r.state || '').trim() || null,
              country: (r.country || '').trim() || null,
              zip: (r.zip || '').trim() || null,
              phone: (r.phone || '').trim() || null,
              email,
              open_balance: parseNumberSafe(r.open_balance),

              // internal
              __email_lc: email_lc,
            };
          })
          .filter(Boolean) as any[];

        const withEmail = payload.filter((p) => p.__email_lc);
        const withoutEmail = payload.filter((p) => !p.__email_lc);

        if (withEmail.length) {
          // Email is a delivery address, not a customer identity. Different legal
          // customers may legitimately use the same accounts-payable mailbox.
          const clean = withEmail.map((row) => {
            const { _rowNumber, __email_lc, ...rest } = row;
            return rest;
          });
          const { error: insertError } = await supabase.from('counterparties').insert(clean);
          if (insertError) throw insertError;
          inserted += clean.length;
        }

        // without email: still allowed, but company_name is required (we enforced above)
        if (withoutEmail.length) {
          const clean = withoutEmail.map((row: any) => {
            const { _rowNumber, __email_lc, ...rest } = row;
            return rest;
          });

          const { error: insErr } = await supabase.from('counterparties').insert(clean);
          if (insErr) throw insErr;

          inserted += clean.length;
        }

        const processedNow = Math.min(start + chunk.length, allRows.length);
        setProgress((p) =>
          p
            ? { ...p, processed: processedNow, inserted, updated, failed }
            : null
        );

        await sleep(120);
      }

      setFailedRows(failures);

      if (cancelRef.current) {
        setSuccess(`Import cancelled. Processed ${progress?.processed || 0} of ${allRows.length}.`);
      } else {
        setSuccess(`Import complete. Inserted ${inserted}, updated ${updated}, failed ${failed}.`);
      }
    } catch (err: any) {
      console.error('Error importing:', err);
      setError(err?.message || 'Failed to import customers');
    } finally {
      setImporting(false);
    }
  };

  const handleBack = () => {
    window.history.pushState({}, '', '/customers');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <Button variant="ghost" onClick={handleBack} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Customers
        </Button>
        <h1 className="text-3xl font-bold text-gray-900">Import Customers</h1>
        <p className="text-gray-600 mt-1">Upload a CSV file to import customer data</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select CSV File</label>
          <div className="flex items-center gap-4">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Expected columns: Alias, Company (legal name), Street Address, City, State, Country, Zip,
            Phone, Email, Open balance
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Note: Your database requires Company (legal name) for every customer.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
            <X className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
            <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
        )}

        {progress && (
          <div className="p-4 bg-gray-50 border rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-gray-700">
                Progress: {progress.processed} / {progress.total}
              </div>
              {importing && (
                <Button variant="secondary" onClick={handleCancelImport}>
                  Cancel import
                </Button>
              )}
            </div>

            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                className="bg-blue-600 h-2 rounded-full"
                style={{
                  width:
                    progress.total > 0
                      ? `${Math.min(100, (progress.processed / progress.total) * 100)}%`
                      : '0%',
                }}
              />
            </div>

            <div className="text-sm text-gray-700 grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>Inserted: {progress.inserted}</div>
              <div>Updated: {progress.updated}</div>
              <div>Failed: {progress.failed}</div>
              <div>Chunk size: {CHUNK_SIZE}</div>
            </div>

            {failedRows.length > 0 && (
              <div className="mt-3">
                <Button variant="secondary" onClick={downloadFailuresCsv}>
                  Download failures CSV ({failedRows.length})
                </Button>
              </div>
            )}
          </div>
        )}

        {previewData.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-3">Preview (First 20 rows)</h3>
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Alias</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                      Company (Legal)
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">City</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                      Country
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Email</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Phone</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {previewData.map((row, index) => (
                    <tr key={index}>
                      <td className="px-4 py-2 text-sm text-gray-900">{row.alias || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{row.company_name || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{row.city || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{row.country || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{row.email || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{row.phone || '-'}</td>
                      <td className="px-4 py-2 text-sm text-right text-gray-900">
                        {parseNumberSafe(row.open_balance).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 pt-6">
              <Button onClick={handleImport} disabled={importing || allRows.length === 0}>
                {importing ? (
                  <>
                    <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import {allRows.length} Customers
                  </>
                )}
              </Button>
              <Button variant="secondary" onClick={handleBack} disabled={importing}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
