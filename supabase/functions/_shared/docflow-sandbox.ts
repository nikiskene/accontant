/** Server-only sandbox client. No invoice-creation, submission or activation endpoint.
 * Contract source: https://www.docflow.ae/api, inspected 2026-10-28.
 * Callers must authorize the company administrator and load the binding from trusted
 * server storage. Never accept a binding or token directly from a browser request.
 */
type ObjectValue = Record<string, unknown>;
export type DocFlowBinding = Readonly<{
  workspaceId: string;
  providerCompanyId: string;
  tin: string;
  vatTrn: string;
  environment: 'sandbox';
}>;
type Dependencies = {
  getAccessToken: (binding: DocFlowBinding) => Promise<string>;
  fetch?: typeof fetch;
};
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class DocFlowSandboxError extends Error {
  readonly code: string;
  constructor(code: string) { super(`DocFlow sandbox: ${code}`); this.name='DocFlowSandboxError';this.code=code; }
}
export function createDocFlowSandbox(binding: DocFlowBinding, dependencies: Dependencies) {
  // Copy and freeze so later caller mutations cannot change the credential scope.
  const scope: DocFlowBinding = Object.freeze({...binding});
  if(scope.environment!=='sandbox'||!uuid.test(scope.workspaceId)||!uuid.test(scope.providerCompanyId)||!/^\d{10}$/.test(scope.tin)||!/^\d{15}$/.test(scope.vatTrn)) throw new DocFlowSandboxError('invalid_binding');
  const transport = dependencies.fetch || globalThis.fetch;
  async function request(path: string, body?: ObjectValue): Promise<ObjectValue> {
    const token=await dependencies.getAccessToken(scope);
    if(!token||/[\r\n]/.test(token))throw new DocFlowSandboxError('credentials_unavailable');
    let response: Response;
    try {
      response=await transport(`https://sandbox-api.docflow.ae${path}`,{
        method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),
      });
    } catch { throw new DocFlowSandboxError('network_or_timeout'); }
    // Never reflect provider error text, credentials or invoice content into logs/UI.
    const validationFinding=response.status===400&&path==='/api/v1/invoices/validate';
    if(!response.ok&&!validationFinding)throw new DocFlowSandboxError(response.status===401||response.status===403?'authorization_failed':response.status===429?'rate_limited':`http_${response.status}`);
    let envelope: ObjectValue;
    try { envelope=object(await response.json()); } catch { throw new DocFlowSandboxError('invalid_response'); }
    if(typeof envelope.success!=='boolean')throw new DocFlowSandboxError('invalid_response');
    return envelope;
  }
  async function verifyCompany() {
    const envelope=await request(`/api/v1/companies/${scope.providerCompanyId}`);
    if(envelope.success!==true)throw new DocFlowSandboxError('company_lookup_failed');
    const company=object(envelope.data);
    if(company.id!==scope.providerCompanyId||company.tin!==scope.tin||company.trn!==scope.vatTrn||company.isVATRegistered!==true||company.peppolParticipantId!==`0235:${scope.tin}`)throw new DocFlowSandboxError('company_identity_mismatch');
    // Numeric status meanings are not published. Identity match does not mean active.
    return {companyId:scope.providerCompanyId,tin:scope.tin,vatTrn:scope.vatTrn,identityMatched:true as const,activationVerified:false as const};
  }
  async function validateCandidate(candidate: ObjectValue) {
    // Snapshot before any await; don't allow mutation between identity check and send.
    const body=structuredClone(candidate);
    const seller=object(body.seller);
    if(body.companyId!==scope.providerCompanyId||object(seller.taxRegistration).id!==scope.tin||object(seller.taxIdentifier).id!==scope.vatTrn||object(seller.electronicAddress).id!==scope.tin||object(seller.electronicAddress).schemeId!=='0235')throw new DocFlowSandboxError('candidate_identity_mismatch');
    await verifyCompany();
    const result=await request('/api/v1/invoices/validate',{...body,isDraft:true});
    // Observed on the live sandbox on 2026-11-02 for AED and USD synthetic invoices.
    // Unknown shapes stay unverified; validation is never delivery or FTA reporting.
    const validationVerified=result.success===true&&object(result.data).isValid===true&&Array.isArray(result.errors)&&result.errors.length===0;
    return {environment:'sandbox' as const,submitted:false as const,validationVerified,providerResponse:result};
  }
  return {verifyCompany,validateCandidate};
}
