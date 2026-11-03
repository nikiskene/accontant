# UAE invoice acceptance preparation — 3 November 2026

## Implemented

This extends the 2 November data-enforcement release; it does not activate production transmission.

- Tax invoices (380), non-VAT commercial invoices (480), linked tax credit notes (381) and linked commercial credit notes (81) have explicit Docflow validation mapping. Commercial sellers have TIN/tax registration, no invented VAT identity, out-of-scope lines and buyer legal registration. Issued seller VAT status comes from the frozen snapshot, including when crediting an older invoice after company settings change.
- Non-VAT UAE business buyers can use their confirmed TIN. Explicitly confirmed buyers that have not implemented e-invoicing can use 0235:9900000098 with VAT or legal identity; foreign non-Peppol export buyers use 0235:9900000099. No fallback is inferred from a missing address. Other foreign Peppol schemes remain blocked pending clarification of the guide's 0235-only rule.
- Exports/e-commerce collect delivery address; free-zone supplies collect beneficiary TIN/TRN; continuous supplies collect period and frequency. Other frequency needs an explanation. A separate earlier tax point date is supported for invoices. These conditions also run in the database before new required UAE invoices issue.
- Buyer legal registration includes the issuing authority and passport issuing country when applicable. UAE seller/buyer VAT numbers are checked separately from Corporate Tax TRNs, using the documented VAT pattern. Seller TIN must start with 1.
- Line discounts are calculated with decimal arithmetic and mapped once as line allowances, with reason code 95. Document allowances/charges and prepayments remain unsupported. Exempt/out-of-scope rates are omitted from JSON, rather than emitting an invalid zero rate; exemption codes are checked against the published UAE list. Bank transfer uses the documented `bic` and IBAN/LOCAL account scheme. Optional unknown bank country is not invented.
- Credit/debit card payments store only the last four to six digits; direct debit uses a mandate reference. No full card number is collected. The current supported codes match the field guide, replacing the earlier generic card code.
- The main invoice form preserves its draft issue date, discounts and full per-line metadata when lines are saved under new IDs. Failed metadata loading prevents saving over unread advanced values.
- Optional printed buyer reference, PO and transaction classification have “don’t show on printed invoice” controls. They remain in storage, issuance snapshots, validation and the Docflow payload. Required identity, supply date, tax and totals cannot be hidden. New structured invoices include issuer address/registration, invoice dates, tax treatment, bank details and applicable AED tax values in downloaded and emailed PDFs. Historical PDFs use the previous rendering path.
- Sandbox connection storage/client can represent confirmed non-VAT companies without a VAT TRN. Company TIN, registration status, provider ID and endpoint must still match the actual provider account before connection/validation.

## Headline field coverage

Invoice number/date/type/currency/flags/due date/payment means are sourced from the document/metadata. Seller name, endpoint/scheme, registration/type, tax identity/scheme and address come from frozen company data. Buyer equivalents come from frozen customer data plus per-document overrides. Totals and category breakdowns are derived from reconciled rounded lines. Lines include stable line number, quantity/unit, net amount, pre-discount and net price, basis quantity, category/rate, applicable AED amounts, name and description. Docflow generates `ProfileID` and `CustomizationID` for its JSON route; these are not separate form inputs. This covers the previously identified 51-element mapping gaps for supported tax invoices and the differing commercial-invoice identity route, subject to provider acceptance.

## Verification and limits

66 automated checks passed, including SQL migration/issuance, immutable snapshots, company isolation, non-VAT connection identity, tax/commercial credits, export routing, discounts, conditional fields, print visibility and metadata preservation. Vite production build passed. Full repository typecheck still has existing unrelated errors; none were reported in changed invoice/e-invoicing/PDF files.

A live database transaction applied the new schema, rejected incomplete issuance, issued a complete synthetic non-VAT export invoice, preserved print preferences, enforced immutability and allowed payment updates; it then rolled back all changes. A generated synthetic PDF was rendered and visually checked. This is application/data QA, not provider acceptance.

There was no saved sandbox connection on 3 November. The previous successful AED/USD provider checks from 2 November covered synthetic VAT-invoice candidates. New scenarios must still be validated against Docflow using a correctly configured sandbox company and valid company-scoped credentials.

Still separate: production submission/idempotency/retries, signed provider events, delivery and FTA reporting evidence, inbound/XML archive integration, unrelated-company provider isolation, token lifecycle/customer authorization/referral onboarding and commercial agreement. Non-trade-licence sellers, consumer invoices, reverse-charge supplies, deemed supply, margin schemes, summary invoices, agent billing, volume-discount credits and advance allocations need their own supported workflows. No automatic January activation, invoice transmission, payment or provider agreement is enabled here.

## Sources reviewed live

- https://www.docflow.ae/fta-einvoice-guide-1 — document types, process/spec identifiers, routing fallbacks, party identity, credit reasons and conditional scenarios.
- https://www.docflow.ae/fta-einvoice-guide-2 — line allowances, tax rates/exemptions, AED amounts, payment details and exchange-rate precision.
- https://www.docflow.ae/api — validation-only endpoint contract, distinct from creation/delivery.

## Release

Apply migration `20261103120000_extend_uae_invoice_acceptance` once; manual file 093 is its identical source, not a second migration to run. Deploy `docflow-sandbox` after the schema update, then publish the frontend. Do not replay migration 092. The new column uses the existing metadata access controls and issuance freeze protections; stored credentials remain server-only encrypted.
