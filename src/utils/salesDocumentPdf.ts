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
  header_text?: string | null;
  service_date?: string | null;
  terms_text?: string | null;
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
  font_family?: 'helvetica' | 'times' | 'courier';
  accent_color?: string | null;
  footer_text?: string | null;
  payment_instructions?: string | null;
  payment_instructions_font_size?: number | null;
  logo_data_url?: string | null;
  language_code?: 'en' | 'de' | null;
};

export function createSalesDocumentPdf(document: SalesPdfDocument, lines: SalesPdfLine[], fallbackIssuer: string, template: SalesPdfTemplate = {}) {
  const pdf = new jsPDF();
  const font = template.font_family || 'helvetica';
  pdf.setFont(font);
  const issuer = document.issuer_snapshot?.legal_name || fallbackIssuer;
  const customerData = document.customer_snapshot || document.customer || {};
  const customer = customerData.company_name || customerData.alias || 'Customer';
  const customerAddress = [customerData.street_address, [customerData.zip, customerData.city].filter(Boolean).join(' '), customerData.state, customerData.country].filter(Boolean);
  const de=template.language_code==='de';
  const words=de?{quote:'KOSTENVORANSCHLAG',invoice:'RECHNUNG',credit_note:'GUTSCHRIFT',number:'Nr.',date:'Datum',billTo:'Rechnung an',serviceDate:'Leistungsdatum',description:'Beschreibung',quantity:'Menge',unitPrice:'Einzelpreis',tax:'USt.',total:'Gesamt',subtotal:'Zwischensumme',terms:'Zahlungsbedingungen'}:{quote:'COST ESTIMATE',invoice:'INVOICE',credit_note:'CREDIT NOTE',number:'No.',date:'Date',billTo:'Bill to',serviceDate:'Service date',description:'Description',quantity:'Qty',unitPrice:'Unit price',tax:'Tax',total:'Total',subtotal:'Subtotal',terms:'Payment terms'};
  const label=words[document.document_type as keyof typeof words]||document.document_type.toUpperCase().replace('_',' ');
  if(template.accent_color){const hex=template.accent_color.replace('#','');if(hex.length===6){pdf.setFillColor(parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16));pdf.rect(14,10,182,2,'F')}}
  if(template.logo_data_url)pdf.addImage(template.logo_data_url,template.logo_data_url.includes('image/png')?'PNG':'JPEG',14,15,38,18,undefined,'FAST');
  pdf.setFontSize(20); pdf.text(label, 196, 20, { align: 'right' });
  pdf.setFontSize(10); pdf.text(issuer,14,template.logo_data_url?40:24);
  pdf.text(`${words.number}: ${document.document_number || 'DRAFT'}`, 196, 28, { align: 'right' });
  pdf.text(`${words.date}: ${document.issue_date}`, 196, 34, { align: 'right' });
  pdf.setFont(font,'bold');pdf.text(words.billTo,14,44);pdf.setFont(font,'normal');
  const customerLines=[customer,...customerAddress,...(customerData.vat_trn?[`UID / VAT ID: ${customerData.vat_trn}`]:[])];
  pdf.text(customerLines,14,50);
  let tableY=52+(customerLines.length*5);
  if(document.service_date){pdf.setFontSize(10);pdf.setFont(font,'bold');pdf.text(`${words.serviceDate}:`,14,tableY);pdf.setFont(font,'normal');pdf.text(document.service_date,45,tableY,{maxWidth:150});tableY+=7;}
  if(document.header_text){pdf.setFontSize(10);pdf.setFont(font,'bold');pdf.text(document.header_text,14,tableY,{maxWidth:182});pdf.setFont(font,'normal');tableY+=12;}
  autoTable(pdf, { startY: tableY, head: [[words.description, words.quantity, words.unitPrice, words.tax, words.total]], body: lines.map(line => [line.description, line.quantity, `${document.currency} ${Number(line.unit_price).toFixed(2)}`, Number(line.vat_amount).toFixed(2), Number(line.gross_amount).toFixed(2)]) });
  const y = (pdf as any).lastAutoTable.finalY + 10;
  pdf.text(`${words.subtotal}: ${document.currency} ${Number(document.subtotal).toFixed(2)}`, 140, y);
  pdf.text(`${words.tax}: ${document.currency} ${Number(document.tax_total).toFixed(2)}`, 140, y + 6);
  pdf.setFontSize(12); pdf.text(`${words.total}: ${document.currency} ${Number(document.total).toFixed(2)}`, 140, y + 14);
  let noteY=y+26;
  if(template.payment_instructions){pdf.setFontSize(Number(template.payment_instructions_font_size||9));const lines=pdf.splitTextToSize(template.payment_instructions,180);pdf.text(lines,14,noteY);noteY+=lines.length*Number(template.payment_instructions_font_size||9)*0.45+5;}
  if(document.terms_text){pdf.setFontSize(9);pdf.setFont(font,'bold');pdf.text(words.terms,14,noteY);pdf.setFont(font,'normal');pdf.text(pdf.splitTextToSize(document.terms_text,180),14,noteY+5);}
  if(template.footer_text){pdf.setFontSize(8);pdf.setTextColor(100);pdf.text(template.footer_text,105,287,{align:'center',maxWidth:180});pdf.setTextColor(0)}
  return pdf;
}

export function pdfBase64(pdf: jsPDF) {
  return pdf.output('datauristring').split(',')[1];
}
