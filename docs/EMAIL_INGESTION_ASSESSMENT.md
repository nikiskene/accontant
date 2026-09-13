# Receipt ingestion assessment — 13 September 2026

Inspected GitHub main b47f93f and the live IACyFZCO database schema. React 18,
TypeScript and Vite use Supabase Auth, workspace membership, PostgreSQL RPCs and
private Storage. The canonical EU company is the existing Austrian workspace;
FZCO is the existing AE workspace. IDs are selected through configuration.

Relevant integration points: `src/contexts/AppContext.tsx`, `src/App.tsx`,
`src/components/Layout.tsx`, `src/pages/NewExpense.tsx`,
`src/pages/NewSupplierInvoice.tsx`, `supabase/manual/016_add_supplier_invoices.sql`,
`018_add_supplier_approval.sql`, and `supabase/functions/send-sales-document`.

Existing supplier invoices have classified lines and attachment links, but their
approval RPC deliberately does not post. NewExpense posts multiple client writes
and has a UAE-specific VAT account assumption; do not copy that design. Live
`accounts.type` and `vat_codes.vat_rate` differ from historical migrations.
The new workflow must use the live schema and a single atomic posting RPC.
Posted receipt corrections require reversal plus replacement, with source and
revision history preserved, and permissions checked in both companies.

Microsoft client-credentials secrets and an OpenAI secret already exist in
Supabase. Existing Graph access is mailbox-scoped Mail.Send. Reading needs a
separate mailbox-scoped Mail.Read role, verified before enabling ingestion.
Chrome login is only for administration, never runtime authentication.
No ingestion tables or services currently exist. Existing chart of accounts is
the expense classification vocabulary; do not seed competing categories.

## Smallest coherent architecture

Microsoft Graph Inbox delta → durable source messages → configurable receiving
alias resolution → immutable private documents → exact duplicate check → native
PDF/text extraction → OCR/vision fallback → vendor/account rules → validated
candidate → review or explicitly enabled automatic booking → existing ledger.
Each source and document has a durable unique identity. Persist a delta cursor
only after the page is durably recorded. Failures remain retryable. A scheduler
invokes the same ingestion endpoint as a manual sync; webhooks can enqueue the
same work later. Folder scope and bootstrap cutoff are explicit settings.

Candidate staging is needed for missing entity/vendor/date/amount; existing
supplier invoices require a supplier and date and cannot represent uncertainty.
Use existing transactions and accounts for booking, with new receipt metadata,
line allocations, immutable revisions, source evidence, rules and processing
state. Source files remain immutable on company reassignment; access follows
current authorized receipt ownership and separately authorized inbox reviewers.

## Booking and Austrian tax controls

Expose company, vendor, invoice number, dates, currency, description, account,
private percentage, expense deductibility percentage and input VAT recovery
percentage separately. A receipt can have multiple tax lines and manual rates
and amounts. Preserve the invoice's actual VAT even where recovery is limited.
No blanket 50% private default for restaurants. Document business purpose and
participants for entertainment; deductions depend on the facts, not a label.
Manual tax treatment and overrides require a reason. Never assume a 0% invoice
means input VAT is recoverable or that foreign VAT is Austrian input VAT.

References consulted:
- https://www.usp.gv.at/themen/steuern-finanzen/umsatzsteuer-ueberblick/weitere-informationen-zur-umsatzsteuer/vorsteuerabzug-und-rechnung/falscher-steuerausweis-und-moegliche-rechnungsmaengel.html
- https://www.wko.at/oe/steuern/betriebsausgaben-gewinnermittlung-broschuere.pdf
- https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0

## Deployment evidence boundary

GitHub access, Supabase project access, existing secret names and live table/RPC
shapes verified. Graph Mail.Read, actual alias headers, hosting deployment path,
and authenticated end-to-end receipt processing are not yet verified.
