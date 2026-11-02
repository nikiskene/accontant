# Docflow preparation for January 2027

Release date: 2 November 2026. Production delivery and FTA reporting are **not activated**.

## Delivered

- UAE-only `/e-invoicing` setup and links from invoice details.
- Separate company TIN, VAT confirmation, registration type and target date. The initial IACy company's target is 1 January 2027; other companies have no forced target.
- Reusable customer electronic identity under customer details; new invoice snapshots retain these values.
- Issued company snapshots also retain e-invoice settings. No historical invoice data is rewritten.
- Buyer reference and customer PO reference inputs. No procurement or purchase-order workflow is required.
- Docflow JSON validation mapper: names/addresses/endpoints, stable document/line identities, unit codes, tax categories/rates, grouped VAT breakdown, invoice totals and per-line AED values. Prices are VAT-exclusive; quantities and price basis are distinct. Decimal arithmetic is used before JSON serialization.
- Each company administrator can verify and connect a Docflow **sandbox** account using its company ID and access token. No customer password is stored. Tokens are encrypted with AES-GCM and company-specific authenticated context; secrets have no browser read/write grants.
- Saved invoice data can be sent explicitly to the validation-only endpoint. Provider responses and the exact candidate are retained as immutable, company-scoped evidence. Unknown provider response semantics never become a successful compliance assertion.
- Separate exchange/reporting states, an inbox review/import path and a durable queue foundation. Sandbox documents cannot enter accounting. Invoice import and submission evidence have company and duplicate guards.
- Signed credit-note issuance and cumulative over-credit protection. Credit-note provider mapping remains gated until its JSON contract is confirmed.

## Deliberate boundaries

No Docflow production submission endpoint, automatic January activation, production credentials, automatic retry/send worker, provider webhook parser or incoming-provider fetcher is enabled. Incoming review is ready for normalized provider records, but provider ingestion still needs a tested contract. The queue is not a statement that automatic transmission is operational.

Candidate generation supports the currently tested ordinary VAT-registered seller / VAT-registered business-buyer route. Foreign-buyer endpoints, non-VAT buyer fallback, credit-note JSON, discounts, advances, special transaction flags, card/direct-debit details and non-trade-licence sellers stay blocked until their specific provider contracts and tests are available. Foreign-currency and zero/exempt candidate calculations have local coverage; provider acceptance is still pending. Trade-licence authority, TIN/TRN identity and accepted emirate codes are checked rather than inferred from sample values.

## Next external dependency

Docflow must supply the sandbox company ID and access token, current schema/response contract, and valid invoice/credit-note scenarios. The connected email thread contained no sandbox credentials as of this release. Do not use credentials printed as examples in the public documentation.

Before production: test two unrelated company accounts; verify accepted validation outcomes; confirm idempotent creation and timeout recovery; obtain separate Peppol delivery and FTA reporting evidence; test incoming/XML archive retrieval; agree activation and token lifecycle. Reconcile opening balances, unpaid invoices and credit notes referencing older invoices without migrating old invoices into electronic submissions.

## Deployment

Apply `supabase/migrations/20261102120000_prepare_docflow_january_sandbox.sql` exactly once. It contains manual preparation changes 085, 086, 087 and 089 as a single transaction and records its migration version. Do not separately replay the manual files after it. Existing unrelated manual migration history is not rewritten.

Deploy `supabase/functions/docflow-sandbox` with `DOCFLOW_CREDENTIAL_ENCRYPTION_KEY` set to a base64-encoded 32-byte server secret. Preserve that key while stored connections exist. Rotate credentials through company setup; removal deletes the locally stored token but does not revoke a token at Docflow.

Tests: `npm run test:einvoicing`. The complete repository still has pre-existing TypeScript errors; the touched e-invoicing/customer/invoice files have no TypeScript errors. Build output and live verification are separate from provider acceptance.
