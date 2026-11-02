export interface ReceiptFields {
 vendor: string; tax_number: string; invoice_number: string; document_date: string;
 due_date: string; currency: string; gross_amount: number | null; description: string;
 taxes: {gross: number; tax: number; tax_rate: number}[];
}
export const blankReceipt = (): ReceiptFields => ({vendor:'',tax_number:'',invoice_number:'',document_date:'',due_date:'',currency:'',gross_amount:null,description:'',taxes:[]});
export function validateReceipt(value: ReceiptFields): string | null {
 if (!value || typeof value!=='object' || ['vendor','tax_number','invoice_number','document_date','due_date','currency','description'].some(key=>typeof (value as unknown as Record<string,unknown>)[key]!=='string') || !Array.isArray(value.taxes) || value.taxes.length>30) return 'Invalid receipt details.';
 if (Object.values(value).some(item=>typeof item==='string'&&item.length>2000)) return 'Receipt text is too long.';
 if (!value.vendor.trim()) return 'Enter the supplier name.';
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value.document_date) || !Number.isFinite(Date.parse(value.document_date)) || new Date(value.document_date).toISOString().slice(0,10)!==value.document_date) return 'Enter a valid receipt date.';
 if (value.due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(value.due_date) || !Number.isFinite(Date.parse(value.due_date)) || new Date(value.due_date).toISOString().slice(0,10)!==value.due_date)) return 'Enter a valid due date or leave it empty.';
 if (!/^[A-Z]{3}$/.test(value.currency)) return 'Enter the three-letter currency code.';
 if (value.gross_amount===null || !Number.isFinite(value.gross_amount) || value.gross_amount<=0) return 'Enter a positive receipt total.';
 if (!value.taxes.length) return 'Add the VAT breakdown, including a zero VAT line for a tax-free receipt.';
 if (value.taxes.some(line=>!line || typeof line!=='object' || ![line.gross,line.tax,line.tax_rate].every(Number.isFinite) || line.gross<=0 || line.tax<0 || line.tax>line.gross || line.tax_rate<0 || line.tax_rate>100)) return 'Check each VAT line: positive total, VAT between zero and the line total, and rate between 0 and 100.';
 if (Math.round(value.taxes.reduce((sum,line)=>sum+line.gross,0)*100)!==Math.round(value.gross_amount*100)) return 'VAT line totals must add up to the receipt total.';
 return null;
}
