// src/pages/Reports.tsx

import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';

import type { ReportType } from '../utils/reportTypes';
import { startOfYearISO, todayISO } from '../utils/reportTypes';
import { runReportRpc } from '../utils/reportRpc';
import { exportRowsToCSV } from '../utils/exportCsv';
import { exportPLPdf } from '../utils/exportPLPdf';
import { exportBSPdf } from '../utils/exportBSPdf';

export function Reports() {
  const { workspaceId, taxYearId } = useApp() as any;

  const [reportType, setReportType] = useState<ReportType>('profit_and_loss');
  const [fromDate, setFromDate] = useState(startOfYearISO());
  const [toDate, setToDate] = useState(todayISO());
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const disableRangeInputs = reportType === 'trial_balance';

  const loadReport = async () => {
    if (!workspaceId) return;

    setLoading(true);
    try {
      const rows = await runReportRpc({
        reportType,
        workspaceId,
        fromDate,
        toDate,
        taxYearId,
      });
      setReportData(rows);
    } catch (e: any) {
      console.error('Error loading report:', e);
      alert(`Failed to load report: ${e?.message ?? String(e)}`);
      setReportData([]);
    } finally {
      setLoading(false);
    }
  };

  const exportToPDF = async () => {
    if (!workspaceId) return;

    try {
      if (reportType === 'profit_and_loss') {
        await exportPLPdf(workspaceId, fromDate, toDate);
        return;
      }

      if (reportType === 'balance_sheet') {
        await exportBSPdf(workspaceId, toDate);
        return;
      }

      alert('PDF export is currently implemented for Profit & Loss and Balance Sheet only.');
    } catch (e: any) {
      console.error('PDF export error:', e);
      alert(`Failed to export PDF: ${e?.message ?? String(e)}`);
    }
  };

  const showPdfButton = reportType === 'profit_and_loss' || reportType === 'balance_sheet';

  const formatValue = (value: any) => {
    if (value === null || value === undefined) return '-';

    const num = Number(value);

    if (!isNaN(num) && value !== '') {
      return num.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    return value;
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-600 mt-1">Generate financial reports and export data</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Select
            label="Report Type"
            value={reportType}
            onChange={(e) => {
              setReportType(e.target.value as ReportType);
              setReportData([]);
            }}
          >
            <option value="profit_and_loss">Profit &amp; Loss</option>
            <option value="balance_sheet">Balance Sheet</option>
            <option value="trial_balance">Trial Balance</option>
            <option value="vat_summary">VAT Summary</option>
          </Select>

          <Input
            type="date"
            label="From Date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            disabled={disableRangeInputs}
          />

          <Input
            type="date"
            label="To Date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            disabled={disableRangeInputs}
          />

          <div className="flex items-end">
            <Button onClick={loadReport} disabled={loading || !workspaceId} className="w-full">
              {loading ? 'Loading...' : 'Generate Report'}
            </Button>
          </div>
        </div>

        {reportType === 'trial_balance' && (
          <div className="mt-3 text-sm text-gray-600">
            Trial Balance uses the selected tax year. If this is empty, expose <code>taxYearId</code> in AppContext.
          </div>
        )}
      </div>

      {reportData.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900">
              {reportType
                .split('_')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ')}
            </h2>

            <div className="flex gap-2">
              {showPdfButton && (
                <Button variant="secondary" onClick={exportToPDF}>
                  Export PDF
                </Button>
              )}

              <Button variant="secondary" onClick={() => exportRowsToCSV(reportType, reportData)}>
                Export CSV
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {Object.keys(reportData[0]).map((key) => (
                    <th
                      key={key}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {key.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="bg-white divide-y divide-gray-200">
                {reportData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    {Object.values(row).map((value: any, i) => (
                      <td key={i} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatValue(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportData.length === 0 && !loading && (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-600">
          Select a report type and date range, then click Generate Report
        </div>
      )}
    </div>
  );
}