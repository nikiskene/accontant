import { FormEvent, useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Input } from '../components/Input';
import { Button } from '../components/Button';

const empty = { legal_form:'',registration_number:'',tax_identification_number:'',vat_number:'',uid_number:'',corporate_tax_number:'',trade_licence_number:'',licensing_authority:'',tax_office:'',address_line_1:'',address_line_2:'',postal_code:'',city:'',state_region:'',billing_email:'billing@iacy.com',phone:'',website:'',authorized_signatory:'',default_payment_terms_days:'14',legal_footer:'' };
const profileKeys = Object.keys(empty);

export function CompanyProfile() {
  const { workspaceId, workspace, refetchReferenceData } = useApp();
  const [legalName,setLegalName]=useState('');
  const [form,setForm]=useState<Record<string,string>>(empty); const [message,setMessage]=useState('');
  useEffect(()=>{setLegalName(workspace?.legal_name||'');if(!workspaceId)return; supabase.from('company_legal_profiles').select(profileKeys.join(',')).eq('workspace_id',workspaceId).single().then(({data,error})=>{if(data){const values=data as unknown as Record<string,unknown>;setForm(Object.fromEntries(profileKeys.map(key=>[key,String(values[key]??'')])))}if(error)setMessage(error.message);});},[workspaceId,workspace?.legal_name]);
  const save=async(e:FormEvent)=>{e.preventDefault();if(!workspaceId||!workspace||!legalName.trim())return;setMessage('Saving…');const profile=Object.fromEntries(profileKeys.map(key=>[key,form[key]?.trim()||null]));const [workspaceResult,profileResult]=await Promise.all([supabase.from('workspaces').update({legal_name:legalName.trim(),updated_at:new Date().toISOString()}).eq('id',workspaceId),supabase.from('company_legal_profiles').upsert({...profile,workspace_id:workspaceId,country_code:workspace.country,default_payment_terms_days:Number(form.default_payment_terms_days||14),updated_at:new Date().toISOString()})]);const error=workspaceResult.error||profileResult.error;if(!error)await refetchReferenceData();setMessage(error?error.message:'Company credentials saved.');};
  const field=(key:string,label:string)=><Input label={label} value={form[key]||''} onChange={e=>setForm({...form,[key]:e.target.value})}/>;
  return <div className="max-w-5xl"><h1 className="text-3xl font-bold">Company credentials</h1><p className="text-gray-600 mt-1 mb-6">Legal identity used for this company’s documents. Issued documents keep an immutable snapshot.</p>
    <form onSubmit={save} className="space-y-6"><section className="bg-white border rounded-xl p-6"><h2 className="text-lg font-semibold mb-4">Legal registration</h2><div className="grid md:grid-cols-2 gap-4">
      <Input required label="Registered name" value={legalName} onChange={e=>setLegalName(e.target.value)}/>{field('legal_form','Legal form')}{field('registration_number','Company / registration number')}{field('tax_identification_number','Tax identification number')}{workspace?.country==='AE'&&<>{field('vat_number','UAE VAT TRN')}{field('corporate_tax_number','UAE corporate tax number')}{field('trade_licence_number','Trade licence number')}{field('licensing_authority','Licensing authority / free zone')}</>}{workspace?.country==='AT'&&<>{field('uid_number','Austrian UID')}{field('tax_office','Finanzamt / tax office')}</>}</div></section>
      <section className="bg-white border rounded-xl p-6"><h2 className="text-lg font-semibold mb-4">Registered address</h2><div className="grid md:grid-cols-2 gap-4">{field('address_line_1','Address line 1')}{field('address_line_2','Address line 2')}{field('postal_code','Postal code')}{field('city','City')}{field('state_region','State / region')}</div></section>
      <section className="bg-white border rounded-xl p-6"><h2 className="text-lg font-semibold mb-4">Document contact</h2><div className="grid md:grid-cols-2 gap-4">{field('billing_email','Billing email')}{field('phone','Phone')}{field('website','Website')}{field('authorized_signatory','Authorized signatory')}{field('default_payment_terms_days','Default payment terms (days)')}</div><div className="mt-4">{field('legal_footer','Legal footer')}</div></section>
      <div className="flex items-center gap-3"><Button type="submit">Save credentials</Button>{message&&<span className="text-sm text-gray-600">{message}</span>}</div></form></div>;
}
