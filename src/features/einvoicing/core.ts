/** Provider-neutral preparation. Passing these checks is NOT PINT-AE certification. */
export type Row = Record<string, unknown>;
export type Finding = { field: string; message: string };
export type Preparation = {
  version: 'samly-uae-1'; workspaceId: string; documentId: string;
  documentType: 'invoice' | 'credit_note'; number: string; issueDate: string;
  currency: string; dueDate: string; seller: Row; buyer: Row; paymentMeans: string;
  transactionType: string; supplyDate: string; precedingInvoice: string;
  creditReason: string; exchangeRate: string; taxCurrency: 'AED'; taxTotalAED: string; lines: Row[];
  totals: { net: string; tax: string; gross: string; paid: string; payable: string };
};
export type Context = {
  workspace: Row; profile: Row; settings: Row; document: Row;
  customer: Row; lines: Row[]; metadata: Row; preceding: Row | null;
};
export const text = (value: unknown) => value == null ? '' : String(value).trim();
const obj = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
/** Parse database decimal values without binary floating-point money arithmetic. */
export function scaled(value: unknown, scale = 2): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text(value));
  if (!match || match[2].length > 15 || (match[3]?.length || 0) > 12) return null;
  const decimals = match[3] || '';
  let n = BigInt(match[2]) * 10n ** BigInt(scale) + BigInt((decimals + '0'.repeat(scale)).slice(0, scale) || '0');
  if (Number(decimals[scale] || 0) >= 5) n++;
  return match[1] ? -n : n;
}
export function decimal(value: bigint, scale = 2): string {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
const abs = (n: bigint) => n < 0n ? -n : n;
const units: Record<string, string> = { each: 'C62', unit: 'C62', hours: 'HUR', hour: 'HUR', days: 'DAY', day: 'DAY', kg: 'KGM', 'C62': 'C62', 'H87': 'H87', 'HUR': 'HUR', 'DAY': 'DAY', 'KGM': 'KGM' };
const categories: Record<string, string> = { standard: 'S', zero: 'Z', exempt: 'E', out_of_scope: 'O' };
export function validDate(value: unknown): boolean {
  const s = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10) === s;
}
export function prepare(context: Context): { payload: Preparation; findings: Finding[]; ready: boolean } {
  const { workspace, document: d, metadata: m } = context;
  const findings: Finding[] = [];
  const require = (condition: boolean, field: string, message: string) => { if (!condition) findings.push({field, message}); };
  const issued = text(d.status) !== 'draft' || (d.document_type === 'credit_note' && !!d.issuer_snapshot);
  const issuer = obj(d.issuer_snapshot);
  const settings=issued&&Object.keys(obj(issuer.einvoice_settings)).length?obj(issuer.einvoice_settings):context.settings;
  const profile = issued ? obj(issuer.profile) : context.profile;
  const customer = issued ? obj(d.customer_snapshot) : context.customer;
  const customerDefaults = issued ? obj(customer.einvoice_profile) : obj(context.customer.einvoice_profile);
  const buyer = {...customerDefaults,...Object.fromEntries(Object.entries(obj(m.buyer)).filter(([,value])=>text(value)!==''))};
  const credit = d.document_type === 'credit_note';
  require(workspace.country === 'AE', 'company', 'UAE e-invoicing preparation applies only to a UAE company.');
  require(['invoice','credit_note'].includes(text(d.document_type)), 'document_type', 'Choose an invoice or credit note. Quotes are not e-invoices.');
  if(settings.vat_status==='not_registered')require(false,'non_vat_provider_review','Not VAT registered — confirmed. The commercial-invoice route needs separate Docflow mapping and sandbox acceptance.');
  else require(settings.vat_registered === true, 'vat_registered', 'Confirm whether the company is VAT registered.');
  require(/^\d{10}$/.test(text(settings.tin)), 'tin', 'Confirm the company’s 10-digit TIN from its FTA records.');
  if(settings.vat_registered===true)require(/^\d{15}$/.test(text(profile.vat_number)), 'seller.vat_number', 'Enter the seller’s 15-digit VAT TRN.');
  const seller: Row = { name: issued ? text(issuer.legal_name) : text(workspace.legal_name), tin: text(settings.tin), vatNumber: text(profile.vat_number), registrationNumber: text(profile.trade_licence_number), registrationType: text(settings.registration_type) || 'TL', authority: text(profile.licensing_authority), address: text(profile.address_line_1), city: text(profile.city), subdivision: text(profile.state_region), country: 'AE' };
  for (const field of ['name','registrationNumber','authority','address','city','subdivision']) require(!!seller[field], `seller.${field}`, `Complete the seller’s ${field === 'registrationNumber' ? 'trade licence number' : field} in Company credentials.`);
  const buyerData: Row = { name: text(customer.company_name || customer.name || customer.alias), address: text(customer.street_address), city: text(customer.city), subdivision: text(customer.state), country: text(buyer.country || customer.country).toUpperCase(), vatNumber: text(customer.vat_trn), tin: text(buyer.tin), electronicAddress: text(buyer.electronic_address), scheme: text(buyer.scheme), registrationNumber: text(buyer.registration_number), registrationType: text(buyer.registration_type), type: text(buyer.type) };
  require(buyerData.type === 'business', 'buyer.type', 'Confirm a business customer. Consumer or unclear transactions need separate scope review.');
  for (const field of ['name','address','city']) require(!!buyerData[field], `buyer.${field}`, `Complete the customer’s ${field}.`);
  require(/^[A-Z]{2}$/.test(text(buyerData.country)), 'buyer.country', 'Use a two-letter country code, such as AE or AT.');
  if (buyerData.country === 'AE') {
    require(!!buyerData.subdivision, 'buyer.subdivision', 'Complete the customer’s emirate.');
    require(/^\d{10}$/.test(text(buyerData.tin)), 'buyer.tin', 'Enter the UAE business customer’s confirmed 10-digit TIN.');
    require(buyerData.scheme === '0235' && buyerData.electronicAddress === buyerData.tin, 'buyer.endpoint', 'Use scheme 0235 and the confirmed customer TIN for the UAE endpoint.');
  } else {
    require(!!buyerData.electronicAddress && !!buyerData.scheme, 'buyer.endpoint', 'The provider must confirm the foreign buyer’s endpoint or applicable fallback.');
    require(false, 'export_review', 'Foreign-buyer and export scenarios require provider mapping and acceptance testing before activation.');
  }
  if (buyerData.vatNumber) require(/^\d{15}$/.test(text(buyerData.vatNumber)) || buyerData.country !== 'AE', 'buyer.vatNumber', 'The UAE buyer VAT TRN must contain 15 digits.');
  require(validDate(d.issue_date), 'issue_date', 'Enter a valid invoice issue date.');
  require(/^[A-Z]{3}$/.test(text(d.currency)), 'currency', 'Select a three-letter invoice currency.');
  require(validDate(m.supply_date || d.service_date), 'supply_date', 'Record an exact supply date for electronic invoicing.');
  require(['1','10','30','42','48','49','58','59'].includes(text(m.payment_means)), 'payment_means', 'Select the payment method.');
  require(/^[01]{8}$/.test(text(m.transaction_type)), 'transaction_type', 'Confirm the eight transaction classification flags.');
  if (text(m.transaction_type) !== '00000000') require(false, 'scenario_review', 'Special transaction scenarios require provider mapping and acceptance testing before activation.');
  const exchangeRate = text(d.currency) === 'AED' ? 100000000n : scaled(m.exchange_rate,8);
  if (text(d.currency) !== 'AED') {
    require((exchangeRate || 0n) > 0n, 'exchange_rate', 'Record the applicable exchange rate to AED.');
    require(false, 'currency_review', 'Foreign-currency AED tax mapping must pass provider acceptance tests before activation.');
  }
  require(context.lines.length > 0, 'lines', 'Add at least one invoice line.');
  const overrides = obj(m.lines);
  let net = 0n, tax = 0n, gross = 0n;
  const lines = context.lines.map((line, i) => {
    const label = `lines.${i + 1}`;
    const override = obj(overrides[text(line.id)]);
    const vat = obj(line.vat_code);
    const category = categories[text(override.tax_category || vat.category)];
    const unit = text(override.unit_code) || (units[text(line.unit).toLowerCase()]||units[text(line.unit)]);
    const n = scaled(line.net_amount), t = scaled(line.vat_amount), g = scaled(line.gross_amount);
    const quantity = scaled(line.quantity,4), price = scaled(line.unit_price,2), rate = scaled(line.vat_rate,6);
    require(!!text(line.description), `${label}.description`, `Line ${i+1}: add a description.`);
    require(!!unit && /^[A-Z0-9]{2,3}$/.test(unit), `${label}.unit`, `Line ${i+1}: choose a standard unit code.`);
    require(!!category, `${label}.tax_category`, `Line ${i+1}: confirm tax treatment; a zero rate alone is not a tax category.`);
    require(quantity !== null && quantity !== 0n && price !== null && price >= 0n, `${label}.quantity`, `Line ${i+1}: check quantity and price.`);
    require(rate !== null && rate >= 0n && rate <= 1000000n, `${label}.rate`, `Line ${i+1}: invalid VAT rate.`);
    if (category === 'S') require(rate === 50000n, `${label}.rate`, `Line ${i+1}: standard UAE VAT must be 5%.`);
    if (category && category !== 'S') {
      require(rate === 0n, `${label}.rate`, `Line ${i+1}: this tax category must have a zero rate.`);
      require(!!text(override.tax_reason), `${label}.tax_reason`, `Line ${i+1}: record the reason for this tax treatment.`);
      require(false, `${label}.tax_review`, `Line ${i+1}: ${category} treatment needs provider rule validation before activation.`);
    }
    require([n,t,g].every(v => v !== null), `${label}.amounts`, `Line ${i+1}: invalid monetary value.`);
    if (n !== null && t !== null && g !== null) {
      require(credit ? n <= 0n && t <= 0n && g <= 0n : n >= 0n && t >= 0n && g >= 0n, `${label}.sign`, `Line ${i+1}: amounts have the wrong sign for this document.`);
      require(n + t === g, `${label}.total`, `Line ${i+1}: net plus VAT must equal the total.`);
      if (quantity !== null && price !== null) {
        const discount = scaled(line.discount_percent ?? 0,4);
        require(discount === 0n, `${label}.discount`, `Line ${i+1}: discounts need explicit allowance mapping before activation.`);
        if (discount === 0n) require(abs(n) === (abs(quantity) * price + 5000n) / 10000n, `${label}.net`, `Line ${i+1}: net does not reconcile with quantity and price.`);
      }
      if (rate !== null) require(abs(t) === (abs(n) * rate + 500000n) / 1000000n, `${label}.tax`, `Line ${i+1}: VAT does not reconcile with the tax rate.`);
      net += n; tax += t; gross += g;
    }
    return { id: text(line.id), description: text(line.description), quantity: quantity === null ? '' : decimal(abs(quantity),4), unit: unit || '', unitPrice: price === null ? '' : decimal(price), taxCategory: category || '', taxReason: text(override.tax_reason), vatRate: rate === null ? '' : decimal(rate,6), net: decimal(abs(n || 0n)), tax: decimal(abs(t || 0n)), gross: decimal(abs(g || 0n)) };
  });
  require(scaled(d.subtotal) === net && scaled(d.tax_total) === tax && scaled(d.total) === gross, 'totals', 'Document totals must reconcile exactly with the rounded invoice lines.');
  require(credit ? gross < 0n : gross > 0n, 'total', 'The document amount has the wrong sign or is zero.');
  const paid = scaled(d.amount_paid ?? 0) ?? -1n;
  require(paid >= 0n && (credit ? paid === 0n : paid <= gross), 'paid', 'Check payment allocations before electronic invoicing.');
  if (paid > 0n) require(false, 'prepayment_review', 'Paid or advance-payment invoices need allocation and tax mapping acceptance tests before activation.');
  if (!credit) require(validDate(d.due_date), 'due_date', 'Set the invoice payment due date.');
  if (credit) {
    require(!!context.preceding?.document_number && context.preceding.workspace_id === workspace.id, 'preceding_invoice', 'Link the credit note to the original invoice in this company.');
    require(!!text(m.credit_reason), 'credit_reason', 'Record the reason for the credit note.');
  }
  require(text(settings.mode) === 'preparation', 'mode', 'Provider activation has not been implemented in this preparation release.');
  const payload: Preparation = {version:'samly-uae-1',workspaceId:text(workspace.id),documentId:text(d.id),documentType:credit?'credit_note':'invoice',number:text(d.document_number),issueDate:text(d.issue_date),currency:text(d.currency),dueDate:text(d.due_date),seller,buyer:buyerData,paymentMeans:text(m.payment_means),transactionType:text(m.transaction_type),supplyDate:text(m.supply_date || d.service_date),precedingInvoice:text(context.preceding?.document_number),creditReason:text(m.credit_reason),exchangeRate:exchangeRate === null ? '' : decimal(exchangeRate,8),taxCurrency:'AED',taxTotalAED:exchangeRate === null || exchangeRate <= 0n ? '' : decimal((abs(tax)*exchangeRate+50000000n)/100000000n),lines,totals:{net:decimal(abs(net)),tax:decimal(abs(tax)),gross:decimal(abs(gross)),paid:decimal(paid),payable:decimal(credit?abs(gross):gross-paid)}};
  return {payload,findings,ready:findings.length === 0};
}

export type ExchangeStatus = 'pending' | 'delivered' | 'rejected';
export type ReportingStatus = 'pending' | 'reported' | 'rejected';
export type ProviderEvent = { id: string; workspaceId: string; submissionId: string; kind: 'delivered' | 'delivery_rejected' | 'reported' | 'reporting_rejected'; occurredAt: string; evidence: string };
export type DeliveryState = { workspaceId: string; submissionId: string; exchange: ExchangeStatus; reporting: ReportingStatus; exchangeAt: string | null; reportingAt: string | null; eventIds: string[] };
/** Late events on one channel must never reset the other channel or an acknowledged success. */
export function applyEvent(state: DeliveryState, event: ProviderEvent): DeliveryState {
  if (event.workspaceId !== state.workspaceId || event.submissionId !== state.submissionId) throw new Error('Event belongs to another company or submission');
  if (!event.id || !event.evidence || !Number.isFinite(Date.parse(event.occurredAt))) throw new Error('Event evidence and timestamp are required');
  if (state.eventIds.includes(event.id)) return state;
  const next = {...state,eventIds:[...state.eventIds,event.id]};
  const reporting = event.kind === 'reported' || event.kind === 'reporting_rejected';
  const last = reporting ? state.reportingAt : state.exchangeAt;
  if (last && Date.parse(event.occurredAt) < Date.parse(last)) return next;
  if (reporting) {
    if (state.reporting === 'reported' && event.kind !== 'reported') return next;
    next.reporting = event.kind === 'reported' ? 'reported' : 'rejected'; next.reportingAt = event.occurredAt;
  } else {
    if (state.exchange === 'delivered' && event.kind !== 'delivered') return next;
    next.exchange = event.kind === 'delivered' ? 'delivered' : 'rejected'; next.exchangeAt = event.occurredAt;
  }
  return next;
}
