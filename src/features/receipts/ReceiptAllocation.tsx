import {useState} from 'react';
import {Button} from '../../components/Button';
import {Input} from '../../components/Input';
import {Select} from '../../components/Select';
import type {Account,VatCode} from '../../lib/types';
import {allocationAmounts,type Allocation} from './model';

interface Props {
 value:Allocation; index:number; multiple:boolean; accounts:Account[]; codes:VatCode[];
 country?:string; currency:string|null; errors:Record<string,string>;
 onChange:(value:Allocation)=>void; onRemove:()=>void;
}
export function ReceiptAllocation({value:l,index,multiple,accounts,codes,country,currency,errors,onChange,onRemove}:Props){
 const [privateEnabled,setPrivateEnabled]=useState(false);
 const [partialEnabled,setPartialEnabled]=useState(false);
 const [partialVat,setPartialVat]=useState(false);
 const update=(key:keyof Allocation,value:string|number)=>onChange({...l,[key]:value});
 const privateVisible=privateEnabled||l.private_percent!==0;
 const partialVisible=partialEnabled||l.deductible_percent!==100;
 const vatVisible=(l.tax>0&&l.private_percent<100)||!Number.isFinite(l.vat_recovery_percent)||l.vat_recovery_percent<0||l.vat_recovery_percent>100;
 const recoveryMode=partialVat||(l.vat_recovery_percent!==0&&l.vat_recovery_percent!==100)?'partial':l.vat_recovery_percent===100?'full':'none';
 const expectedVat=Math.round((l.gross*l.tax_rate/(100+l.tax_rate)+Number.EPSILON)*100)/100;
 const mismatch=l.tax_rate>0&&Math.abs(l.tax-expectedVat)>.01;
 const inputVat=country==='AT'?'Input VAT (Vorsteuer)':'Input VAT';
 return <section className="border rounded-xl p-4 space-y-4">
  <div className="flex justify-between items-center gap-3"><h3 className="font-semibold">{multiple?`Expense split ${index+1}`:'Expense and VAT'}</h3>{multiple&&<Button variant="secondary" onClick={onRemove}>Remove split</Button>}</div>
  <div className="grid sm:grid-cols-2 gap-3">
   <Select label="What kind of expense is this?" aria-label={`Expense account ${index+1}`} error={errors.allocation_account} value={l.account_id} onChange={e=>update('account_id',e.target.value)}><option value="">Choose expense account</option>{accounts.filter(a=>['expense','cogs','asset'].includes(a.type)).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select>
   {multiple&&<Input label="Split total including VAT" error={errors.allocation_gross} type="number" min=".01" step=".01" value={l.gross} onChange={e=>update('gross',Number(e.target.value))}/>}
   <Select label="VAT code" aria-label={`VAT code ${index+1}`} value={l.vat_code_id} onChange={e=>{const code=codes.find(item=>item.id===e.target.value);onChange({...l,vat_code_id:e.target.value,tax_rate:code?code.vat_rate*100:l.tax_rate});}}><option value="">Manual / no code</option>{codes.filter(c=>c.applies_to!=='sales').map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select>
   {(!l.vat_code_id||mismatch||l.tax>0||l.tax_rate>0||errors.allocation_tax)&&<><Input label="VAT rate on receipt (%)" aria-label={`VAT rate ${index+1}`} type="number" min="0" max="100" step=".01" value={l.tax_rate} onChange={e=>update('tax_rate',Number(e.target.value))}/><Input label="VAT amount on receipt" aria-label={`VAT amount ${index+1}`} error={errors.allocation_tax} type="number" min="0" step=".01" value={l.tax} onChange={e=>update('tax',Number(e.target.value))}/></>}
  </div>
  {errors.allocation_gross&&!multiple&&<p role="alert" className="text-sm text-red-700">{errors.allocation_gross} Edit the total in Receipt details.</p>}
  {(l.tax_rate>0||mismatch)&&<div className="text-sm space-y-2">{mismatch&&<p className="text-amber-800">The total implies {expectedVat.toFixed(2)} VAT at {l.tax_rate}%. Compare with the printed receipt; a manual exception is allowed.</p>}<Button variant="secondary" onClick={()=>update('tax',expectedVat)}>Calculate VAT from total</Button></div>}
  {vatVisible&&<div className="space-y-2"><Select label={`Will you reclaim ${inputVat.toLowerCase()}?`} aria-label={`VAT recovery ${index+1}`} value={recoveryMode} onChange={e=>{setPartialVat(e.target.value==='partial');if(e.target.value!=='partial')update('vat_recovery_percent',e.target.value==='full'?100:0);}}><option value="none">No — include VAT in the expense</option><option value="full">Yes — all VAT on the business share</option><option value="partial">Only part of the VAT on the business share</option></Select>{recoveryMode==='partial'&&<Input label="Recoverable VAT on the business share (%)" aria-label={`VAT recovery percentage ${index+1}`} error={errors.allocation_percentages} type="number" min="0" max="100" step=".01" value={l.vat_recovery_percent} onChange={e=>update('vat_recovery_percent',Number(e.target.value))}/>}<p className="text-sm text-gray-500">Choose the amount you are entitled to reclaim. VAT recovery and expense deductibility are separate decisions.</p></div>}
  <div className="space-y-3 border-t pt-3">
   <label className="flex gap-3 items-center min-h-11"><input type="checkbox" className="w-5 h-5" checked={privateVisible} onChange={e=>{setPrivateEnabled(e.target.checked);if(!e.target.checked)update('private_percent',0);}}/><span>Part of this receipt is private</span></label>
   {privateVisible&&<><Input label="Private share (%)" aria-label={`Private share ${index+1}`} error={errors.allocation_percentages} type="number" min="0" max="100" step=".01" value={l.private_percent} onChange={e=>update('private_percent',Number(e.target.value))}/><p className="text-sm text-gray-500">Enter the personal share. Example: with 10% private use and a fully deductible business remainder, enter 10 here and leave deductibility at 100.</p></>}
   <label className="flex gap-3 items-center min-h-11"><input type="checkbox" className="w-5 h-5" checked={partialVisible} onChange={e=>{setPartialEnabled(e.target.checked);if(!e.target.checked)update('deductible_percent',100);}}/><span>The business expense is not fully tax-deductible</span></label>
   {partialVisible&&<><Input label="Tax-deductible business expense (%)" aria-label={`Deductible percentage ${index+1}`} error={errors.allocation_percentages} type="number" min="0" max="100" step=".01" value={l.deductible_percent} onChange={e=>update('deductible_percent',Number(e.target.value))}/><p className="text-sm text-gray-500">Enter the deductible percentage of the business expense: 0 means none, 100 means all. This does not change the private share or VAT recovery.</p></>}
  </div>
  {l.private_percent>0&&l.deductible_percent<100&&<p className="text-sm rounded-lg bg-amber-50 text-amber-900 p-3">Both reductions apply: {l.private_percent}% is private, then {l.deductible_percent}% of the remaining business expense is tax-deductible. Check that you intend both reductions.</p>}
  {errors.allocation_values&&<p role="alert" className="text-red-700 text-sm">{errors.allocation_values}</p>}
  <details open={!!l.description&&multiple}><summary className="cursor-pointer text-sm text-blue-700 min-h-11 py-3">Separate description (optional)</summary><Input label="Split description" value={l.description} onChange={e=>update('description',e.target.value)}/></details>
  <p className="text-sm rounded-lg bg-gray-50 p-3">{(()=>{try{const a=allocationAmounts(l);return `Private ${a.privateAmount.toFixed(2)} · VAT to reclaim ${a.recoverableVat.toFixed(2)} · Tax-deductible expense ${a.deductible.toFixed(2)} · Non-deductible expense ${a.nonDeductible.toFixed(2)} ${currency||''}`;}catch{return 'Check the amounts and percentages above.';}})()}</p>
 </section>;
}
