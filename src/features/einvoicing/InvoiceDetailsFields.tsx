import {Input} from '../../components/Input';
import {Select} from '../../components/Select';
import type {Row} from './core';
import {billingFrequencies,creditReasons,optionalPrintFields,record} from './details';

export function InvoiceDetailsFields({metadata,onChange,credit=false}:{metadata:Row;onChange:(value:Row)=>void;credit?:boolean}) {
  const details=record(metadata.details), delivery=record(details.delivery), flags=String(metadata.transaction_type||'');
  const set=(key:string,value:unknown)=>onChange({...metadata,details:{...details,[key]:value}});
  const field=(key:string,label:string,type='text')=><Input type={type} label={label} value={String(details[key]||'')} onChange={e=>set(key,e.target.value)}/>;
  return <div className="space-y-4">
    {flags[0]==='1'&&field('beneficiary_id','Free-zone beneficiary TIN or TRN')}
    {flags[4]==='1'&&<div className="grid sm:grid-cols-2 gap-4">{field('period_start','Supply period starts','date')}{field('period_end','Supply period ends','date')}<Select label="Billing frequency" value={String(details.billing_frequency||'')} onChange={e=>set('billing_frequency',e.target.value)}><option value="">Choose frequency</option>{Object.entries(billingFrequencies).map(([code,label])=><option key={code} value={code}>{label}</option>)}</Select>{details.billing_frequency==='OTH'&&field('note','Explain the billing frequency')}</div>}
    {(flags[6]==='1'||flags[7]==='1')&&<fieldset className="border rounded-lg p-4"><legend className="text-sm font-medium px-1">Delivery location for these goods or services</legend><p className="text-sm text-gray-600 mb-3">Confirm where the supply is delivered. For services, use the actual place of delivery.</p><div className="grid sm:grid-cols-2 gap-4">{[['line1','Street / address'],['city','City'],['countrySubdivision','Region / emirate'],['countryCode','Country code (e.g. AE or AT)']].map(([key,label])=><Input key={key} label={label} maxLength={key==='countryCode'?2:undefined} value={String(delivery[key]||'')} onChange={e=>set('delivery',{...delivery,[key]:key==='countryCode'?e.target.value.toUpperCase():e.target.value})}/>)}</div></fieldset>}
    {credit&&<div className="grid sm:grid-cols-2 gap-4"><Select label="Credit note reason" value={String(details.credit_reason_code||'')} onChange={e=>set('credit_reason_code',e.target.value)}><option value="">Choose reason</option>{Object.entries(creditReasons).map(([code,label])=><option key={code} value={code}>{label}</option>)}</Select><Input label="Reason explanation" value={String(metadata.credit_reason||'')} onChange={e=>onChange({...metadata,credit_reason:e.target.value})}/></div>}
    {['54','55'].includes(String(metadata.payment_means))&&<Input inputMode="numeric" maxLength={6} label="Final four to six card digits only" value={String(details.card_last_digits||'')} onChange={e=>set('card_last_digits',e.target.value.replace(/\D/g,''))}/>}
    {metadata.payment_means==='49'&&field('mandate_reference','Direct-debit mandate reference')}
    {!credit&&<details><summary className="cursor-pointer text-sm text-blue-700 py-2">VAT point date, if different from the issue date</summary>{field('tax_point_date','Earlier VAT point date (only if applicable)','date')}</details>}
    <details className="border-t pt-2"><summary className="cursor-pointer text-sm text-blue-700 py-2">Printed invoice details</summary><p className="text-sm text-gray-600 mb-2">Hidden details remain saved and included in electronic invoicing. Required invoice information stays visible.</p><div className="space-y-1">{Object.entries(optionalPrintFields).map(([key,label])=><label key={key} className="flex items-center gap-3 min-h-11 text-sm"><input type="checkbox" checked={record(details.print_hidden)[key]===true} onChange={e=>set('print_hidden',{...record(details.print_hidden),[key]:e.target.checked})}/><span>{label}: don’t show on printed invoice</span></label>)}</div></details>
  </div>;
}
