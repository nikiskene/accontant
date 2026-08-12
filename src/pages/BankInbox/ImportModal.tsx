import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';

import { ImportErrorRow, ImportRow, normalizeCurrency, normalizeHeader, parseAmount, parseCsv, toIsoDateOrNull } from './csv';
import { sha256Hex } from './importUtils';
import { BankAccountRow } from './bankInboxApi';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string | null;
  bankAccounts: BankAccountRow[];
  onImported: () => Promise<void> | void;
};

export function ImportModal({ isOpen, onClose, workspaceId, bankAccounts, onImported }: Props) {
  const [importing, setImporting] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [importErrors, setImportErrors] = useState<ImportErrorRow[]>([]);
  const [importPreviewCount, setImportPreviewCount] = useState(0);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importSource, setImportSource] = useState('csv');

  useEffect(() => {
    if (!selectedBankAccountId && bankAccounts.length > 0) {
      setSelectedBankAccountId(bankAccounts[0].id);
    }
  }, [bankAccounts, selectedBankAccountId]);

  const reset = () => {
    setImporting(false);
    setImportFileName('');
    setImportErrors([]);
    setImportPreviewCount(0);
    setImportRows([]);
    setImportSource('csv');
  };

  const handlePickFile = async (file: File | null) => {
    reset();
    if (!file) return;

    setImportFileName(file.name);

    const text = await file.text();
    const { headers, rows } = parseCsv(text);

    const headerMap = headers.map(normalizeHeader);
    const idx = (name: string) => headerMap.indexOf(name);

    const required = ['booked_date', 'counterparty', 'reference', 'amount', 'currency'];
    const missing = required.filter((r) => idx(r) === -1);

    const errs: ImportErrorRow[] = [];
    const parsed: ImportRow[] = [];

    if (missing.length) {
      errs.push({
        rowNumber: 0,
        reason: `Missing required headers: ${missing.join(', ')}`,
        raw: Object.fromEntries(headers.map((h, i) => [h, headers[i]])),
      });
      setImportErrors(errs);
      return;
    }

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rawObj: Record<string, any> = {};
      headers.forEach((h, i) => (rawObj[h] = row[i] ?? ''));

      const booked_date = toIsoDateOrNull(row[idx('booked_date')] ?? '');
      const counterparty = (row[idx('counterparty')] ?? '').trim();
      const reference = (row[idx('reference')] ?? '').trim();
      const amount = parseAmount(row[idx('amount')] ?? '');
      const currency = normalizeCurrency(row[idx('currency')] ?? '');

      const problems: string[] = [];
      if (!booked_date) problems.push('Invalid booked_date');
      if (amount == null) problems.push('Invalid amount');
      if (!currency) problems.push('Invalid currency (must be AED, USD, EUR)');

      if (problems.length) {
        errs.push({ rowNumber: r + 2, reason: problems.join('; '), raw: rawObj });
        continue;
      }

      parsed.push({
        booked_date,
        counterparty,
        reference,
        amount: amount as number,
        currency: currency as string,
      });
    }

    setImportErrors(errs);
    setImportRows(parsed);
    setImportPreviewCount(parsed.length);
  };

  const handleImport = async () => {
    if (!workspaceId) return;
    if (!selectedBankAccountId) {
      alert('No bank account selected. Create a bank account first.');
      return;
    }
    if (!importRows.length) {
      alert('No valid rows to import.');
      return;
    }

    try {
      setImporting(true);
      const nowIso = new Date().toISOString();

      const payload = await Promise.all(
        importRows.map(async (r) => {
          const hashInput = [
            workspaceId,
            selectedBankAccountId,
            r.booked_date,
            String(r.amount),
            r.currency,
            r.counterparty || '',
            r.reference || '',
          ].join('|');

          const hash = await sha256Hex(hashInput);

          return {
            workspace_id: workspaceId,
            bank_account_id: selectedBankAccountId,
            bank_import_id: null,
            booked_date: r.booked_date,
            value_date: null,
            amount: r.amount,
            currency: r.currency,
            description: r.reference || null,
            counterparty: r.counterparty || null,
            reference: r.reference || null,
            external_id: null,
            hash,
            status: 'unreconciled',
            suggested_account_id: null,
            suggested_vat_code_id: null,
            suggested_counterparty_id: null,
            notes: null,
            created_at: nowIso,
            matched_amount: null,
          };
        })
      );

      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id ?? null;

      const { data: importRec, error: importErr } = await supabase
        .from('bank_imports')
        .insert([
          {
            workspace_id: workspaceId,
            bank_account_id: selectedBankAccountId,
            source: importSource,
            file_name: importFileName || null,
            imported_at: nowIso,
            imported_by: userId,
          },
        ])
        .select('id')
        .single();

      if (importErr) throw importErr;

      const bankImportId = importRec?.id ?? null;
      const payloadWithImport = payload.map((p) => ({ ...p, bank_import_id: bankImportId }));

      const { error: insErr } = await supabase.from('bank_transactions').upsert(payloadWithImport, {
        onConflict: 'workspace_id,bank_account_id,hash',
        ignoreDuplicates: true,
      });

      if (insErr) throw insErr;

      alert('Import complete.');
      reset();
      await onImported();
    } catch (e: any) {
      console.error(e);
      alert('Import failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import Bank Transactions (CSV)"
      size="xl"
    >
      <div className="space-y-4">
        <div className="text-sm text-gray-700">
          Required headers (exact): <span className="font-mono">booked_date,counterparty,reference,amount,currency</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account</label>
            <select
              className="w-full border rounded px-3 py-2 text-sm"
              value={selectedBankAccountId}
              onChange={(e) => setSelectedBankAccountId(e.target.value)}
            >
              {bankAccounts.length === 0 ? (
                <option value="">No bank accounts found</option>
              ) : (
                bankAccounts.map((ba) => (
                  <option key={ba.id} value={ba.id}>
                    {ba.name || ba.id}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source (optional)</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={importSource} onChange={(e) => setImportSource(e.target.value)}>
              <option value="csv">csv</option>
              <option value="csv:n26">csv:n26</option>
              <option value="csv:chase">csv:chase</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">CSV File</label>
          <input type="file" accept=".csv,text/csv" className="block w-full text-sm" onChange={(e) => handlePickFile(e.target.files?.[0] ?? null)} />
          {importFileName ? <p className="text-xs text-gray-500 mt-1">{importFileName}</p> : null}
        </div>

        {importErrors.length > 0 && (
          <div className="border rounded p-3 bg-red-50">
            <div className="font-medium text-red-800 text-sm mb-2">
              {importErrors[0].rowNumber === 0 ? 'CSV Header Error' : 'Some rows have issues'}
            </div>
            <div className="max-h-48 overflow-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-red-900">
                    <th className="pr-3 py-1">Row</th>
                    <th className="py-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {importErrors.slice(0, 50).map((er, i) => (
                    <tr key={i} className="text-red-900">
                      <td className="pr-3 py-1 whitespace-nowrap">{er.rowNumber === 0 ? 'Header' : er.rowNumber}</td>
                      <td className="py-1">{er.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="text-sm text-gray-700">
            Valid rows ready to import: <span className="font-medium">{importPreviewCount}</span>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing || importPreviewCount === 0 || importErrors.some((e) => e.rowNumber === 0)}>
              {importing ? 'Importing...' : 'Import'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}