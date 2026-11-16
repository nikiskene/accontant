import { useEffect, useState } from 'react';
import { loadDocumentLogo } from '../utils/documentLogo';
import { createSalesDocumentPdf, type SalesPdfTemplate } from '../utils/salesDocumentPdf';

type Props = {
  kind: 'invoice' | 'quote' | 'credit_note';
  companyName: string;
  currency: string;
  country?: string;
  logoPath?: string;
  template: SalesPdfTemplate;
};

export function DocumentLayoutPreview({kind,companyName,currency,country,logoPath,template}: Props) {
  const [logo, setLogo] = useState<{path: string; data?: string; error?: string}>();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const currentLogo = logo?.path === logoPath ? logo : undefined;

  useEffect(() => {
    if (!logoPath) return;
    let active = true;
    loadDocumentLogo(logoPath).then(data => {
      if (active) setLogo({path:logoPath,data});
    }).catch(() => {
      if (active) setLogo({path:logoPath,error:'The saved logo could not be loaded. Try reselecting this layout.'});
    });
    return () => { active = false; };
  }, [logoPath]);

  useEffect(() => {
    setPreview('');
    setError('');
    if (logoPath && !currentLogo) return;
    const timer = window.setTimeout(() => {
      try {
        const structured = country === 'AE' && kind !== 'quote';
        const credit = kind === 'credit_note';
        const total = credit ? -1000 : 1000;
        const customer = {
          company_name:'Example Customer GmbH',street_address:'Example Street 1',
          zip:'1010',city:'Vienna',country:'AT',
        };
        const pdf = createSalesDocumentPdf({
          document_type:kind,document_number:'PREVIEW-0001',issue_date:'2026-11-16',
          due_date:'2026-11-30',currency,subtotal:total,tax_total:0,total,
          header_text:'Example project',service_date:'November 2026',
          terms_text:'Payment within 14 days.',
          issuer_snapshot:structured ? {
            legal_name:companyName,profile:{city:'Dubai',country_code:'AE'},
            einvoice_settings:{vat_status:'not_registered'},
          } : {legal_name:companyName},
          customer_snapshot:customer,customer,
          einvoice_metadata:structured ? {
            supply_date:'2026-11-16',buyer_reference:'Example buyer reference',
            transaction_type:'00000000',payment_means:'30',
            ...(credit ? {credit_reason:'Example correction'} : {}),
          } : undefined,
        }, [{description:'Example service',quantity:credit ? -1 : 1,unit_price:1000,vat_amount:0,gross_amount:total}],
        companyName,{...template,logo_data_url:currentLogo?.data});
        setPreview(URL.createObjectURL(pdf.output('blob')));
      } catch {
        setError('The PDF preview could not be generated. Check the logo format and try again.');
      }
    }, 180);
    return () => { window.clearTimeout(timer); };
  }, [kind,companyName,currency,country,logoPath,currentLogo,template]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  return <section className="min-w-0 space-y-3 rounded-xl border bg-white p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">Document layout preview</h2>
      {preview && <a href={preview} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 underline">Open sample PDF</a>}
    </div>
    <p className="text-sm text-gray-600">Uses sample invoice details and your layout settings.</p>
    {(error || currentLogo?.error) && <p role="alert" className="text-sm text-amber-800">{error || currentLogo?.error}</p>}
    {preview ? <iframe title="Document layout PDF preview" src={preview} className="h-[520px] w-full rounded border" />
      : !error && <p role="status" className="text-sm text-gray-600">Generating preview…</p>}
  </section>;
}
