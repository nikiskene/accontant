import type {Context, Finding, Row} from './core.ts';

export const record = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => value == null ? '' : String(value).trim();
export const creditReasons = {
  'DL8.61.1.A': 'Supply cancelled',
  'DL8.61.1.B': 'Tax treatment changed',
  'DL8.61.1.C': 'Consideration altered',
  'DL8.61.1.D': 'Goods or services returned',
  'DL8.61.1.E': 'Tax charged in error',
} as const;
export const billingFrequencies = {DLY:'Daily',WKY:'Weekly',Q15:'Every 15 days',MTH:'Monthly',Q45:'Every 45 days',Q60:'Every 60 days',QTR:'Quarterly',YRL:'Yearly',HYR:'Half-yearly',OTH:'Other'} as const;

/** Conditions from Docflow's field guides, reviewed 3 November 2026.
 * These checks collect data; only the provider can accept a candidate. */
export function conditionalFindings(context: Context, buyer: Row, nonVat: boolean): Finding[] {
  const findings: Finding[] = [], details = record(context.metadata.details);
  const require = (ok: boolean, field: string, message: string) => {if (!ok) findings.push({field,message});};
  const flags = text(context.metadata.transaction_type), credit = context.document.document_type === 'credit_note';
  if (/^[01]{8}$/.test(flags)) {
    require(!/[1]/.test(flags.slice(1,4)) && flags[5] === '0', 'scenario_review', 'Deemed supply, margin schemes, summary invoices and agent billing need a separate supported workflow.');
    if (flags[0] === '1') require(/^(?:\d{10}|\d{15})$/.test(text(details.beneficiary_id)), 'beneficiary_id', 'Enter the free-zone beneficiary’s confirmed TIN or TRN.');
    if (flags[4] === '1') {
      require(Object.prototype.hasOwnProperty.call(billingFrequencies,text(details.billing_frequency)), 'billing_frequency', 'Choose the continuous-supply billing frequency.');
      require(!!text(details.period_start) && !!text(details.period_end), 'invoice_period', 'Enter the continuous-supply period start and end.');
      if (details.billing_frequency === 'OTH') require(!!text(details.note), 'note', 'Explain the other billing frequency in the invoice note.');
    }
    if (flags[6] === '1' || flags[7] === '1') {
      for (const key of ['line1','city','countrySubdivision','countryCode']) require(!!text(record(details.delivery)[key]),`delivery.${key}`,'Complete the delivery address for export or e-commerce, including street, city, region and country.');
    }
  }
  const date = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(text(v)) && !Number.isNaN(Date.parse(text(v))) && new Date(text(v)).toISOString().slice(0,10) === text(v);
  if (details.period_start || details.period_end) {
    require(date(details.period_start) && date(details.period_end) && text(details.period_end) >= text(details.period_start), 'invoice_period', 'Enter a valid period with the end on or after its start.');
  }
  if (details.tax_point_date) require(!credit && date(details.tax_point_date) && text(details.tax_point_date) < text(context.document.issue_date), 'tax_point_date', 'A separate VAT point date must precede the issue date and cannot be used on a credit note.');
  const delivery = record(details.delivery);
  if (Object.values(delivery).some(v=>!!text(v))) require(/^[A-Z]{2}$/.test(text(delivery.countryCode)), 'delivery.countryCode', 'Use a two-letter delivery country code.');
  if (nonVat || text(buyer.registrationNumber)) {
    require(!!text(buyer.registrationNumber) && !!text(buyer.registrationType), 'buyer.registration', 'Complete the buyer legal registration number and type.');
    // Foreign registrars use their actual type; do not relabel them as UAE trade licences.
    if (buyer.country === 'AE') require(['TL','EID','PAS','CD'].includes(text(buyer.registrationType)), 'buyer.registrationType', 'Choose TL, EID, PAS or CD for the UAE buyer’s legal registration.');
    if (buyer.registrationType === 'TL') require(!!text(buyer.authority), 'buyer.authority', 'Enter the authority issuing the buyer’s trade licence.');
    if (buyer.registrationType === 'PAS') require(/^[A-Z]{2}$/.test(text(buyer.passportCountry)), 'buyer.passportCountry', 'Enter the passport issuing country.');
  }
  if (credit) require(Object.prototype.hasOwnProperty.call(creditReasons,text(details.credit_reason_code)), 'credit_reason_code', 'Choose the legal reason for this linked credit note.');
  const payment = text(context.metadata.payment_means);
  if (['54','55'].includes(payment)) require(/^\d{4,6}$/.test(text(details.card_last_digits)), 'card_last_digits', 'Enter only the final four to six card digits, never the full card number.');
  if (payment === '49') require(!!text(details.mandate_reference), 'mandate_reference', 'Enter the direct-debit mandate reference.');
  return findings;
}

/** Keep each line's complete metadata through deletion/reinsertion and reordering. */
export function remapLineMetadata(lines: {metadata?: Row; tax_reason?: string; tax_reason_code?: string}[], inserted: {id: string;line_no: number}[]): Row {
  return Object.fromEntries(inserted.map(saved=>[saved.id,{...record(lines[saved.line_no-1]?.metadata),tax_reason:lines[saved.line_no-1]?.tax_reason || '',tax_reason_code:lines[saved.line_no-1]?.tax_reason_code || ''}]));
}

// Only presentation fields are hideable. Identity, dates, amounts and tax remain visible.
export const optionalPrintFields = {buyer_reference:'Buyer routing reference',purchase_order:'Customer PO number',transaction_type:'Transaction classification'} as const;
export function printVisible(details: unknown, field: keyof typeof optionalPrintFields): boolean {
  return record(record(details).print_hidden)[field] !== true;
}
