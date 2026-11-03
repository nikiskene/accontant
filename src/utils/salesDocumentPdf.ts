import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {printVisible,record} from '../features/einvoicing/details.ts';

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
  due_date?: string | null;
  bank_snapshot?: any;
  einvoice_data_snapshot?: any;
  einvoice_metadata?: any;
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

function createLegacySalesDocumentPdf(document: SalesPdfDocument, lines: SalesPdfLine[], fallbackIssuer: string, template: SalesPdfTemplate = {}) {
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

/** Print preferences never change the stored invoice or the electronic payload. */
export function createSalesDocumentPdf(document: SalesPdfDocument, lines: SalesPdfLine[], fallbackIssuer: string, template: SalesPdfTemplate = {}) {
  const metadata=record(document.einvoice_data_snapshot?.metadata || document.einvoice_metadata);
  if(!document.issuer_snapshot?.einvoice_settings || !Object.keys(metadata).length || document.document_type==='quote') return createLegacySalesDocumentPdf(document,lines,fallbackIssuer,template);
  const details=record(metadata.details), profile=record(document.issuer_snapshot?.profile);
  const settings=record(document.issuer_snapshot?.einvoice_settings), nonVat=settings.vat_status==='not_registered';
  const customer=document.customer_snapshot || document.customer || {};
  const pdf=new jsPDF(), font=template.font_family || 'helvetica', currency=document.currency;
  pdf.setFont(font);pdf.setFontSize(10);
  const de=template.language_code==='de';
  const label=document.document_type==='credit_note'?(de?'GUTSCHRIFT':nonVat?'CREDIT NOTE':'TAX CREDIT NOTE'):(de?'RECHNUNG':nonVat?'INVOICE':'TAX INVOICE');
  pdf.setFontSize(19);pdf.text(label,196,21,{align:'right'});
  pdf.setFontSize(9);pdf.text([`${de?'Nr.':'No.'}: ${document.document_number||'DRAFT'}`,`${de?'Datum':'Issue date'}: ${document.issue_date}`,...(document.due_date?[`${de?'Faellig':'Due date'}: ${document.due_date}`]:[])],196,29,{align:'right'});
  let top=21;
  if(template.logo_data_url){pdf.addImage(template.logo_data_url,template.logo_data_url.includes('image/png')?'PNG':'JPEG',14,14,38,18,undefined,'FAST');top=39;}
  const sellerLines=[document.issuer_snapshot?.legal_name||fallbackIssuer,...[profile.address_line_1,profile.address_line_2,[profile.city,profile.state_region,profile.country_code||'AE'].filter(Boolean).join(', ')].filter(Boolean).map(String),...(profile.trade_licence_number?[`Registration: ${profile.trade_licence_number}`]:[]),...(!nonVat&&profile.vat_number?[`VAT TRN: ${profile.vat_number}`]:[])];
  pdf.setFontSize(10);
  let sellerY=top;
  for(const line of sellerLines){const wrapped=pdf.splitTextToSize(line,100);pdf.text(wrapped,14,sellerY);sellerY+=wrapped.length*5;}
  let y=Math.max(55,sellerY+7);
  pdf.setFont(font,'bold');pdf.text(de?'Rechnung an':'Bill to',14,y);pdf.setFont(font,'normal');y+=6;
  const buyerIdentity={...record(customer.einvoice_profile),...record(metadata.buyer)};
  const buyerLines=[customer.company_name||customer.name||customer.alias||'Customer',customer.street_address,[customer.zip,customer.city].filter(Boolean).join(' '),[customer.state,customer.country].filter(Boolean).join(', '),...(customer.vat_trn?[`VAT TRN: ${customer.vat_trn}`]:[]),...(nonVat&&buyerIdentity.registration_number?[`Registration: ${buyerIdentity.registration_number}`]:[])].filter(Boolean);
  for(const line of buyerLines){const wrapped=pdf.splitTextToSize(String(line),182);pdf.text(wrapped,14,y);y+=wrapped.length*5;}
  const note=(label:string,value:unknown)=>{if(!value)return;const wrapped=pdf.splitTextToSize(`${label}: ${String(value)}`,182);if(y+wrapped.length*5>270){pdf.addPage();y=20;}pdf.setFontSize(9);pdf.text(wrapped,14,y);y+=wrapped.length*5+2;};
  y+=3;
  note(de?'Leistungsdatum':'Supply date',metadata.supply_date||document.service_date);
  if(metadata.supply_date&&document.service_date)note(de?'Leistungszeitraum':'Service period',document.service_date);
  note(de?'Betreff':'Reference',document.header_text);
  if(printVisible(details,'buyer_reference'))note('Buyer reference',metadata.buyer_reference);
  if(printVisible(details,'purchase_order'))note('Purchase order',metadata.purchase_order);
  if(printVisible(details,'transaction_type'))note('Transaction classification',metadata.transaction_type);
  note('VAT point date',details.tax_point_date);
  if(details.period_start||details.period_end)note('Supply period',`${details.period_start||''} - ${details.period_end||''}`);
  if(document.document_type==='credit_note')note('Credit reason',metadata.credit_reason);
  const hasDiscount=lines.some(line=>Number((line as SalesPdfLine & {discount_percent?:number}).discount_percent)>0);
  autoTable(pdf,{startY:y+3,margin:{left:14,right:14,bottom:23},styles:{font,fontSize:9,cellPadding:3},head:[[de?'Beschreibung':'Description',de?'Menge':'Qty',de?'Einzelpreis':'Unit price',...(hasDiscount?['Discount']:[]),de?'USt.':'VAT',de?'Gesamt':'Total']],body:lines.map(line=>{const extra=line as SalesPdfLine & {unit?:string;discount_percent?:number;vat_rate?:number};return [line.description,`${line.quantity} ${extra.unit||''}`,`${currency} ${Number(line.unit_price).toFixed(2)}`,...(hasDiscount?[`${extra.discount_percent||0}%`]:[]),`${Number(line.vat_amount).toFixed(2)}${!nonVat&&extra.vat_rate!=null?` (${Number(extra.vat_rate)*100}%)`:''}`,Number(line.gross_amount).toFixed(2)];})});
  y=(pdf as any).lastAutoTable.finalY+9;
  if(y>240){pdf.addPage();y=20;}
  note(de?'Zwischensumme':'Subtotal',`${currency} ${Number(document.subtotal).toFixed(2)}`);
  note(de?'USt.':'VAT',`${currency} ${Number(document.tax_total).toFixed(2)}`);
  pdf.setFont(font,'bold');note(de?'Gesamt':'Total',`${currency} ${Number(document.total).toFixed(2)}`);pdf.setFont(font,'normal');
  if(nonVat)note('VAT status','Seller is not registered for VAT. No VAT charged.');
  if(currency!=='AED'&&metadata.exchange_rate){const rate=Number(metadata.exchange_rate);note('Exchange rate',`1 ${currency} = ${metadata.exchange_rate} AED`);note('VAT in AED',(Number(document.tax_total)*rate).toFixed(2));}
  for(const reason of [...new Set(Object.values(record(metadata.lines)).map(value=>String(record(value).tax_reason||'')).filter(Boolean))])note('Tax treatment',reason);
  const bank=record(document.bank_snapshot);
  if(metadata.payment_means==='30'){note('Account holder',bank.account_name);note(bank.iban?'IBAN':'Account number',bank.iban||bank.account_number);note('SWIFT / BIC',bank.bic_swift);}
  note('Payment instructions',template.payment_instructions);
  note(de?'Zahlungsbedingungen':'Payment terms',document.terms_text);
  if(template.footer_text)for(let page=1;page<=pdf.getNumberOfPages();page++){pdf.setPage(page);pdf.setFontSize(8);pdf.setTextColor(100);pdf.text(pdf.splitTextToSize(template.footer_text,180).slice(0,2),105,285,{align:'center'});pdf.setTextColor(0);}
  return pdf;
}
