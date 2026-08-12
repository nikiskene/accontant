// src/utils/reportRpc.ts

import { supabase } from '../lib/supabase';
import type { ReportType } from './reportTypes';

type RpcResult = { data: any; error: any };

export async function runReportRpc(params: {
  reportType: ReportType;
  workspaceId: string;
  fromDate: string;
  toDate: string;
  taxYearId?: string | null;
}): Promise<any[]> {
  const { reportType, workspaceId, fromDate, toDate, taxYearId } = params;

  let result: RpcResult;

  switch (reportType) {
    case 'profit_and_loss':
      // profit_and_loss(p_workspace_id uuid, p_from date, p_to date)
      result = await supabase.rpc('profit_and_loss', {
        p_workspace_id: workspaceId,
        p_from: fromDate,
        p_to: toDate,
      });
      break;

    case 'balance_sheet':
      // balance_sheet(p_workspace_id uuid, p_from date, p_to date)
      result = await supabase.rpc('balance_sheet', {
        p_workspace_id: workspaceId,
        p_from: fromDate,
        p_to: toDate,
      });
      break;

    case 'trial_balance':
      // trial_balance(p_workspace_id uuid, p_tax_year_id uuid)
      if (!taxYearId) {
        throw new Error('Trial Balance requires taxYearId (missing in AppContext).');
      }
      result = await supabase.rpc('trial_balance', {
        p_workspace_id: workspaceId,
        p_tax_year_id: taxYearId,
      });
      break;

    case 'vat_summary':
      // vat_summary(p_workspace_id uuid, p_from date, p_to date)
      result = await supabase.rpc('vat_summary', {
        p_workspace_id: workspaceId,
        p_from: fromDate,
        p_to: toDate,
      });
      break;

    default:
      result = { data: [], error: null };
  }

  if (result?.error) {
    throw new Error(result.error?.message ?? 'Unknown RPC error');
  }

  const data = result?.data;
  return Array.isArray(data) ? data : data ? [data] : [];
}