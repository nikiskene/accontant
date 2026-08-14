import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
});

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[char]!));

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let outboxId: string | null = null;

  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const tenantId = Deno.env.get('MS_ENTRA_TENANT_ID');
    const clientId = Deno.env.get('MS_ENTRA_CLIENT_ID');
    const clientSecret = Deno.env.get('MS_ENTRA_CLIENT_SECRET');
    const sender = Deno.env.get('MS_GRAPH_SENDER')?.toLowerCase();
    if (!tenantId || !clientId || !clientSecret || !sender) throw new Error('Microsoft email is not configured');

    const authorization = request.headers.get('Authorization') ?? '';
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    const { document_id, pdf_base64, file_name, to_address, custom_subject, body_text } = await request.json();
    if (!document_id || typeof pdf_base64 !== 'string' || !pdf_base64) throw new Error('Document and PDF are required');
    if (pdf_base64.length > 13_500_000) throw new Error('PDF attachment exceeds the 10 MB limit');

    const admin = createClient(url, serviceKey);
    const { data: document, error: documentError } = await admin.from('sales_documents')
      .select('id,workspace_id,document_type,document_number,status,currency,total,customer_id,customer:counterparties(email,company_name,alias)')
      .eq('id', document_id).single();
    if (documentError || !document) throw new Error('Sales document not found');
    if (document.status === 'draft' || document.status === 'void') throw new Error('Issue the document before sending it');

    const { data: member } = await admin.from('workspace_members').select('role')
      .eq('workspace_id', document.workspace_id).eq('user_id', user.id).maybeSingle();
    if (!member || !['owner', 'admin', 'writer', 'accountant'].includes(member.role)) return json({ error: 'Not authorized' }, 403);

    const customer = Array.isArray(document.customer) ? document.customer[0] : document.customer;
    const recipient = String(to_address || customer?.email || '').trim().toLowerCase();
    if (!recipient) throw new Error('The customer has no email address');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('Enter a valid recipient email address');
    const kind = document.document_type === 'quote' ? 'Cost estimate' : document.document_type === 'credit_note' ? 'Credit note' : 'Invoice';
    const number = document.document_number ?? document.id;
    const subject = String(custom_subject || `${kind} ${number}`).trim();
    if (!subject || subject.length > 200) throw new Error('Enter an email subject of no more than 200 characters');
    const customerName = customer.company_name || customer.alias || 'Customer';
    const defaultBody = `Dear ${customerName},\n\nPlease find ${kind.toLowerCase()} ${number} attached.\n\nTotal: ${document.currency} ${Number(document.total).toFixed(2)}\n\nKind regards,\nIACy`;
    const bodyText = String(body_text || defaultBody).trim();
    if (!bodyText || bodyText.length > 10000) throw new Error('Enter an email message of no more than 10,000 characters');
    const bodyHtml = `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(bodyText)}</div>`;

    const { data: outbox, error: outboxError } = await admin.from('email_outbox').insert({
      workspace_id: document.workspace_id,
      document_id: document.id,
      from_address: sender,
      to_address: recipient,
      subject,
      body_html: bodyHtml,
      status: 'sending',
      created_by: user.id,
    }).select('id').single();
    if (outboxError) throw outboxError;
    outboxId = outbox.id;

    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    if (!tokenResponse.ok) throw new Error(`Microsoft authentication failed (${tokenResponse.status})`);
    const token = await tokenResponse.json();
    const sendResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        subject,
        body: { contentType: 'HTML', content: bodyHtml },
        toRecipients: [{ emailAddress: { address: recipient } }],
        attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: String(file_name || `${number}.pdf`).replace(/[^a-zA-Z0-9._ -]/g, '_'), contentType: 'application/pdf', contentBytes: pdf_base64 }],
      }, saveToSentItems: true }),
    });
    if (!sendResponse.ok) throw new Error(`Microsoft Graph rejected the email (${sendResponse.status})`);

    await admin.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', outboxId);
    await admin.from('sales_documents').update({ sent_at: new Date().toISOString() }).eq('id', document.id);
    await admin.from('audit_events').insert({ workspace_id: document.workspace_id, entity_type: document.document_type, entity_id: document.id, action: 'emailed', created_by: user.id, details: { outbox_id: outboxId, recipient, subject } });
    return json({ sent: true, recipient, outbox_id: outboxId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (outboxId) {
      const url = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      await createClient(url, serviceKey).from('email_outbox').update({ status: 'failed', last_error: message }).eq('id', outboxId);
    }
    return json({ error: message }, 400);
  }
});
