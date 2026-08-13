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

export type SalesPdfTemplate = {
  header_text?: string | null;
  font_family?: 'helvetica' | 'times' | 'courier';
  accent_color?: string | null;
  footer_text?: string | null;
  payment_instructions?: string | null;
  terms_text?: string | null;
  logo_data_url?: string | null;
};

export function createSalesDocumentPdf(document: SalesPdfDocument, lines: SalesPdfLine[], fallbackIssuer: string, template: SalesPdfTemplate = {}) {
  const pdf = new jsPDF();
  const font = template.font_family || 'helvetica';
  pdf.setFont(font);
  const issuer = document.issuer_snapshot?.legal_name || fallbackIssuer;
  const customer = document.customer_snapshot?.company_name || document.customer?.company_name || document.customer?.alias || 'Customer';
  const label = (document.document_type === 'quote' ? 'COST ESTIMATE' : document.document_type.toUpperCase()).replace('_', ' ');
  if(template.accent_color){const hex=template.accent_color.replace('#','');if(hex.length===6){pdf.setFillColor(parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16));pdf.rect(14,10,182,2,'F')}}
  if(template.logo_data_url)pdf.addImage(template.logo_data_url,template.logo_data_url.includes('image/png')?'PNG':'JPEG',14,15,38,18,undefined,'FAST');
  pdf.setFontSize(20); pdf.text(label, 196, 20, { align: 'right' });
  pdf.setFontSize(10); pdf.text(template.header_text||issuer,14,template.logo_data_url?40:24);
  pdf.text(`No: ${document.document_number || 'DRAFT'}`, 196, 28, { align: 'right' });
  pdf.text(`Date: ${document.issue_date}`, 196, 34, { align: 'right' });
  pdf.text(`Bill to: ${customer}`, 14, 44);
  autoTable(pdf, { startY: 52, head: [['Description', 'Qty', 'Unit price', 'Tax', 'Total']], body: lines.map(line => [line.description, line.quantity, `${document.currency} ${Number(line.unit_price).toFixed(2)}`, Number(line.vat_amount).toFixed(2), Number(line.gross_amount).toFixed(2)]) });
  const y = (pdf as any).lastAutoTable.finalY + 10;
  pdf.text(`Subtotal: ${document.currency} ${Number(document.subtotal).toFixed(2)}`, 140, y);
  pdf.text(`Tax: ${document.currency} ${Number(document.tax_total).toFixed(2)}`, 140, y + 6);
  pdf.setFontSize(12); pdf.text(`Total: ${document.currency} ${Number(document.total).toFixed(2)}`, 140, y + 14);
  let noteY=y+26;pdf.setFontSize(9);if(template.payment_instructions){pdf.text(template.payment_instructions,14,noteY,{maxWidth:180});noteY+=10}if(template.terms_text)pdf.text(template.terms_text,14,noteY,{maxWidth:180});
  if(template.footer_text){pdf.setFontSize(8);pdf.setTextColor(100);pdf.text(template.footer_text,105,287,{align:'center',maxWidth:180});pdf.setTextColor(0)}
  return pdf;
}

export function pdfBase64(pdf: jsPDF) {
  return pdf.output('datauristring').split(',')[1];
}
