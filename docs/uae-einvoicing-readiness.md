> Historical assessment / preparation notes. For the current 2 November 2026 deployment, implemented sandbox setup and remaining activation gates, see [Docflow January release](docflow-january-release.md). Earlier “local only” statements below describe the prior stage.

# UAE e-invoicing readiness

Initial customer target (not a product default): voluntary activation 1 January 2027 for the user's VAT-registered company, confirmed annual revenue below AED 50 million. Statutory ASP appointment is 31 March 2027; implementation 1 July 2027, based on MoF guidance checked 28 October 2026. This target is not a scheduled automation.

## Public product and company profiles

This is a reusable Samly feature for every eligible UAE company, not a private integration for the initial customer. The company profile is the existing workspace/legal entity. A user's login grants membership and permissions; it does not share tax settings or a provider connection across that user's companies.

- Each company supplies its own VAT status, TIN, revenue band and optional activation target. New profiles start unconfirmed, without a target date; the initial customer's January target must not become everyone's default.
- Each company completes its own provider onboarding and has its own provider account binding, sandbox/production state, connection health and activation decision. One company's activation never activates another.
- Future connection administration must require company administrator authorization. Credentials must be stored in a server-only encrypted secret store with company-scoped references, never browser storage or shared customer credentials. Global environment configuration is only appropriate for platform-level adapter settings and secret-store access.
- Workers and verified callbacks must resolve the company from the stored provider-account binding and check it against the submission; never trust a caller-supplied company ID alone. Account bindings must not be reusable across unrelated companies.
- Settings, invoices, receipts, inbox documents, queues and audit history stay company-scoped. Company switching must clear the previous company's form and connection state.
- Public onboarding must let authorized company users independently prepare, register with an eligible supported provider, connect, test and activate through the same workflow. Assisted setup for the initial customer must not be a required product dependency.
- Release acceptance includes two unrelated customer accounts, one user with multiple companies, read-only membership, unauthorized connection changes, mismatched callbacks and independent activation/disconnection. Existing isolation tests cover part of this; connection acceptance remains pending implementation.

## Delivery and ownership

1. Prepare Samly and verify its invoice workflows.
2. Compare accredited providers against the prepared data and actual scenario needs.
3. User completes signup, contracting and FTA/EmaraTax registration.
4. Connect and test together, then explicitly activate.

DocFlow is the preferred provider for the initial shared integration, subject to the commercial and sandbox gates in `docflow-provider-assessment.md`. No credentials are collected by this release. No live submission or activation is available. Do not describe this as 100% ready, compliant or connected.

## Implemented locally

- UAE-only preparation page at `/e-invoicing`, also accessible from invoice detail.
- Per-company VAT confirmation, TIN, revenue band and target date; target dates do not change statutory deadlines or schedule activation.
- Per-document identity, supply date, payment method, scenario and line mapping metadata.
- Preparation includes AED tax-total conversion using an eight-decimal exchange rate. Rate provenance and provider acceptance remain activation requirements.
- Exact decimal arithmetic and amount reconciliation for the supported ordinary domestic VAT scenario; negative credit-note accounting converts to positive exchange amounts.
- Frozen identities for issued invoices. Draft credit notes retain original parties.
- Downloadable provider-neutral preparation JSON. This is not PINT-AE XML or a legal e-invoice.
- Server-side tenant-authorized context and saves; read-only client access to submission/event/inbox tables.
- Database records for separate exchange and reporting statuses, immutable submission snapshots, event deduplication and incoming original XML.
- Guards protect production-submitted invoice content against legacy edits/voiding and line changes. Payment updates remain possible.
- Credit note creation/issuance works with negative totals, cumulative credit limits and original invoice identity. Ordinary legacy issuance behaviour is retained while e-invoicing is inactive.
- Incoming document review with supplier/account/VAT selection, original XML download and draft-only import. Repeated deliveries are linked only when the supplier, number, date, currency, amounts and lines match. Sandbox import and cross-company coding are rejected.
- Durable job records with exclusive leases, stale-worker rejection and mandatory reconciliation flag after an uncertain result or expired lease. These are queue primitives; no provider worker is running.
- Local tests exercise decimal correctness, frozen snapshots, failure classifications, replay-safe lifecycle handling, RLS isolation, denied receipt forgery, migrations, credit limits and production-record protections.

## Not yet implemented or verified

- Full PINT-AE business rules and provider-specific XML/JSON transformation.
- Accepted mappings for exports, foreign currencies/AED tax amounts, zero-rated/exempt/out-of-scope treatments, advances, discounts, special scenarios and non-VAT sellers. These are explicitly flagged, not silently accepted.
- Provider-owned onboarding/API credentials, submission worker, callbacks, cryptographic verification and reconciliation. A server-only DocFlow sandbox identity/validation component and mocked contract tests exist; it is not deployed or connected. The lifecycle reducer is a tested contract component, not a connected worker.
- Live inbound provider parsing, supplier identity verification and end-to-end import acceptance. The local draft review workflow is implemented but not connected.
- Complete archival service/export and post-cancellation retention guarantees. Database immutability is only one component.
- Provider-specific corrected-document processing and reference mappings. Local credit-note issuance is not evidence of network compliance.
- Reconciliation of issued credits against receivables/accounting, partial-payment/refund cases and accountant approval before rollout.
- Authentication/session UI QA on a deployed environment.
- Live migration reconciliation, application deployment, provider sandbox and production end-to-end acceptance.

## Release instructions

1. Inspect the actual database definitions/migration history first. Manual SQL files are not automatically deployed.
2. Apply `085_add_uae_einvoicing_preparation.sql`, then `086_fix_credit_note_issuance.sql`, then `087_add_einvoice_queue_and_inbox_review.sql` in a staging database and rerun tenant/credit tests against that environment.
3. Deploy UI only with the matching database release. If unavailable, the page shows an installation-needed state and makes no readiness claims.
4. Keep preparation mode. There is intentionally no user-facing switch to activate a provider that has not been integrated.

Run `npm run test:einvoicing` (Node 22 with type stripping) and `npm run build`. PGlite tests use a disposable PostgreSQL engine and existing commercial schema migrations with a minimal base fixture, not production Supabase. Full repository `npm run typecheck` currently has unrelated existing failures; assess those separately before a broader release.

## Acceptance gate for “100% ready to activate”

The gate requires a defined set of customer transaction scenarios, all applicable mandatory data, validated tax and currency calculations, immutable records, corrected-document lifecycle, inbound invoices and deduplication, durable queues, timeout recovery, independent reporting evidence, role/tenant isolation, archive retrieval, accountant reconciliation and end-to-end provider evidence. A successful HTTP call, emailed PDF, local green check or sandbox mock is not this gate.

The provider must return unique document identity, validation findings, Peppol delivery evidence and FTA reporting evidence separately. Never treat a delivery event as payment or reported tax. A timeout after submission must reconcile using the same idempotency identity before retrying. Customer credentials and webhook secrets belong in company-scoped server-only secret storage; the browser receives only safe connection status.

Current legal reference: MoF Guidelines v2.0 (26 October 2026), Mandatory Fields v1.1 (28 October 2026), Decisions 168/2026 and 197/2026, and current PINT-AE specifications. Research evidence is in the parent project's `research/uae-einvoicing-2026-10-28/` folder.
