import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export type SalesPdfDocument = {
  document_type: string;
  document_number: string | null;
  issue_date: string;
  currency: string;
  subtotal: number;
  tax_total: number;
  total: number;
  issuer_snapshot: any;
  customer_snapshot: any;
  customer: any;
};

export type SalesPdfLine = {
  description: string;
  quantity: number;
  unit_price: number;
  vat_amount: number;
  gross_amount: number;
};

export function createSalesDocumentPdf(document: SalesPdfDocument, lines: SalesPdfLine[], fallbackIssuer: string) {
  const pdf = new jsPDF();
  const issuer = document.issuer_snapshot?.legal_name || fallbackIssuer;
  const customer = document.customer_snapshot?.company_name || document.customer?.company_name || document.customer?.alias || 'Customer';
  const label = (document.document_type === 'quote' ? 'COST ESTIMATE' : document.document_type.toUpperCase()).replace('_', ' ');
  pdf.setFontSize(20); pdf.text(label, 14, 20);
  pdf.setFontSize(10); pdf.text(issuer, 14, 30);
  pdf.text(`No: ${document.document_number || 'DRAFT'}`, 140, 20);
  pdf.text(`Date: ${document.issue_date}`, 140, 26);
  pdf.text(`Bill to: ${customer}`, 14, 44);
  autoTable(pdf, { startY: 52, head: [['Description', 'Qty', 'Unit price', 'Tax', 'Total']], body: lines.map(line => [line.description, line.quantity, `${document.currency} ${Number(line.unit_price).toFixed(2)}`, Number(line.vat_amount).toFixed(2), Number(line.gross_amount).toFixed(2)]) });
  const y = (pdf as any).lastAutoTable.finalY + 10;
  pdf.text(`Subtotal: ${document.currency} ${Number(document.subtotal).toFixed(2)}`, 140, y);
  pdf.text(`Tax: ${document.currency} ${Number(document.tax_total).toFixed(2)}`, 140, y + 6);
  pdf.setFontSize(12); pdf.text(`Total: ${document.currency} ${Number(document.total).toFixed(2)}`, 140, y + 14);
  return pdf;
}

export function pdfBase64(pdf: jsPDF) {
  return pdf.output('datauristring').split(',')[1];
}
