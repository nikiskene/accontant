> Historical assessment / preparation notes. For the current 2 November 2026 deployment, implemented sandbox setup and remaining activation gates, see [Docflow January release](docflow-january-release.md). Earlier “local only” statements below describe the prior stage.

# DocFlow decision and integration assessment

Checked 28 October 2026. Decision: preferred provider for the first shared Samly integration, subject to commercial terms and sandbox acceptance. This is an evidence-based selection for evaluation, not a claim that production reliability or interoperability has been proven.

## Accreditation

The UAE Ministry of Finance register lists Cloud Consulting LLC-FZ (DocFlow), accreditation 181172. Its listed partner contact is partners@docflow.ae. Recheck official status before contracting and activation.

Source: https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/

## Documented technical fit

DocFlow publishes sandbox and production hosts, JSON invoice validation, JSON creation, UBL validation/submission, company lookup and JWT authentication. Invoice creation uses companyId. The company-list documentation describes access to an account's own company and its company group; it does not establish permission to pool unrelated Samly customers into a single group. The shared integration must retain each customer's separate authorization.

The validation endpoint is described as neither saving nor sending. Creation with isDraft false queues delivery. Status examples expose a numeric status and approval/payment dates, without a separate reporting receipt contract. These must not become Samly's FTA reporting evidence.

Source: https://www.docflow.ae/api

## Why proceed

Our assessment: accredited status, published APIs, a sandbox and explicit company identity make DocFlow a credible fit for preserving Samly as the invoice application. A single adapter can be reused with company-specific credentials. We do not yet have measured reliability, a price quote, a partner agreement or sandbox results. Those facts limit any recommendation to a conditional one.

## Questions that must be settled with DocFlow

1. Can an independent SaaS integrate once while each unrelated customer contracts and authorizes its own account? Which partner agreement is required, if any?
2. What is the supported server-to-server authorization flow, including MFA, token scopes, expiry, refresh rotation and revocation? The public login examples are not a basis for storing customer passwords.
3. Confirm company-list and details paths and Partner JWT requirements. Confirm how company scope is supplied when listing and reading invoices.
4. Supply a versioned OpenAPI specification, validation response schemas, status enums and valid minimal invoice/credit-note examples. Resolve the public example's 15-digit electronic-address value versus the 10-digit TIN endpoint guidance. Samly must use confirmed identities, not copy sample data.
5. Specify idempotency and exact document-ID lookup after a timed-out create request. Without these, automatic retries remain disabled.
6. Provide independent Peppol delivery and FTA reporting evidence, signed callback verification/replay rules, and polling/reconciliation endpoints.
7. Provide incoming invoice retrieval, original XML and receipt exports, event pagination, retention after cancellation, and exit/migration procedures.
8. Confirm API/sandbox entitlement, fees per separate company, support/SLA, limits, overage charges, data processing terms and the precise scope of any free-document allowance.

No message has been sent to DocFlow. No contract, signup, credentials or live submission has been created.

## Work completed locally

- Shared server-only sandbox client at `supabase/functions/_shared/docflow-sandbox.ts`.
- Immutable company-scoped credential lookup, fixed sandbox host, timeout and redirect rejection.
- Company ID, TIN, VAT TRN and endpoint identity matching before validation.
- Validation-only endpoint, with no creation/submission method; undocumented response semantics cannot mark an invoice compliant.
- Mocked contract tests for identity mismatch, company separation, error sanitization and inability to target production.

This component is not deployed or wired to a user-facing connection button. Its caller still needs authenticated company-administrator authorization, trusted persisted bindings, encrypted secrets, token lifecycle and a tested invoice mapper. The token callback is a dependency contract, not an implemented credential store.

## Next concrete acceptance step

Obtain DocFlow's technical integration pack and sandbox account through the user's registration process. The same onboarding design must work for another unrelated Samly company. Use two synthetic companies to verify authorization isolation before real invoice data. Validate ordinary invoices, then credits, currencies and special tax scenarios; test timeout recovery, incoming documents, separate reporting evidence and exports before enabling production.

## Provider response received 29 October 2026

Source: email text supplied by the user in this chat. DocFlow confirms REST APIs and says sandbox access and technical guidance can be provided. Its commercial models are Referral and Reseller. The agreement for Samly, separate customer authorization/accounts, delivery and FTA confirmations, retries/duplicates, XML access and archive access remain subject to technical/commercial review. No partnership model or technical acceptance is confirmed by this reply.

DocFlow states a 15% discount for companies joining in the second phase. Obtain the base price, eligible products/customers, meaning of second phase, term, renewal treatment and API/setup/support charges before treating this as a usable quote. The reply requests a call in Dubai time.

Call objective: confirm a shared adapter with independently authorized company accounts and direct customer contracts as the preferred starting arrangement; compare Referral versus Reseller obligations without committing to either. Ask the technical team to attend and request the API specification and sandbox access process ahead of the call.
