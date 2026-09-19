export interface Allocation {
 account_id: string; vat_code_id: string; description: string; gross: number; tax: number; tax_rate: number;
 private_percent: number; deductible_percent: number; vat_recovery_percent: number;
}
export interface Booking {
 lines: Allocation[]; counter_account_id: string; vat_account_id: string; private_account_id: string;
 nondeductible_account_id: string; fx_rate: number; tax_reason: string; duplicate_override_reason: string;
}
export interface Receipt {
 id: string; workspace_id: string|null; supplier_id: string|null; email_id: string|null; receiving_alias: string|null; vendor: string|null;
 invoice_number: string|null; document_date: string|null; due_date: string|null; currency: string|null;
 gross_amount: number|null; description: string; booking: Partial<Booking>; status: string; revision: number;
 filename: string|null; file_path: string|null; duplicate_status: string; review_reasons: string[];
 failure_reason: string|null; confidence: Record<string,number>; transaction_id: string|null; extraction?: Record<string,unknown>;
}
export const emptyLine = (): Allocation => ({account_id:'',vat_code_id:'',description:'',gross:0,tax:0,tax_rate:0,private_percent:0,deductible_percent:100,vat_recovery_percent:0});
export function bookingFor(r: Receipt): Booking {
 return {counter_account_id:'',vat_account_id:'',private_account_id:'',nondeductible_account_id:'',fx_rate:1,tax_reason:'',duplicate_override_reason:'',...r.booking,lines:r.booking.lines?.length?r.booking.lines:[{...emptyLine(),gross:Number(r.gross_amount||0)}]};
}
export function allocationAmounts(l: Allocation) {
 const cents=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
 for(const n of [l.gross,l.tax,l.private_percent,l.deductible_percent,l.vat_recovery_percent]) if(!Number.isFinite(n)) throw new Error('Enter valid numbers');
 if(l.gross<0||l.tax<0||l.tax>l.gross||[l.private_percent,l.deductible_percent,l.vat_recovery_percent].some(n=>n<0||n>100))throw new Error('Invalid allocation');
 const privateAmount=cents(l.gross*l.private_percent/100);
 const recoverableVat=cents(l.tax*(1-l.private_percent/100)*l.vat_recovery_percent/100);
 const businessExpense=cents(l.gross-privateAmount-recoverableVat);
 const deductible=cents(businessExpense*l.deductible_percent/100);
 return {privateAmount,recoverableVat,businessExpense,deductible,nonDeductible:cents(businessExpense-deductible)};
}
