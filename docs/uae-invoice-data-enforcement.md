> Extended on 3 November: [conditional fields, commercial/credit mapping and print controls](uae-invoice-acceptance-2026-11-03.md).

# Required data for new UAE invoices

Enabled from 2 November 2026 for newly created UAE invoices and credit notes. Historical documents and existing drafts keep their prior behavior; Austrian documents and quotes are outside this enforcement. Quotes converted into new UAE invoices acquire the requirement automatically.

The invoice editor collects the exact supply date, payment method, buyer reference or customer PO, transaction flags, foreign-currency rate to AED, unit codes and VAT treatment/reasons where applicable. Company details, bank information and reusable customer legal/electronic identity are checked before issuance. Confirmed non-VAT companies are not asked for a VAT TRN and cannot charge VAT.

Incomplete drafts remain saveable. A missing-data list explains what must be completed before issuance. The database also enforces these checks, so a direct call to issue or an attempt to change the status cannot bypass them. Creation starts in draft status. Failed issue attempts reuse the same draft and double submission is prevented in the form.

Money is rounded per line before summing totals. Quantity, unit price, discount, tax and gross amounts must reconcile. Bank-transfer invoices need complete default company bank details; cash does not require a bank account. Foreign buyers require an explicit Peppol route or confirmation that the non-Peppol export fallback applies; the export flag must be set. Non-VAT commercial invoices require buyer legal registration details rather than asking every buyer for a VAT number.

Issued new UAE invoices retain a frozen readiness snapshot, structured metadata and company/customer snapshots. Invoice lines, fiscal details and structured metadata cannot be changed in place after issuance. Use a linked credit note for corrections; payment status and paid amounts remain updateable. The app's existing credit-note/over-credit safeguards still apply.

This is mandatory data completeness, **not** a statement that Docflow has accepted every scenario. The non-VAT commercial-invoice payload, export routing, credit-note contract and remaining provider acceptance tests still need completion before production activation. Docflow passwords, tokens, referral registration and provider company IDs are connection details and are not required for invoice creation. Historical PDFs or existing records are not sent or rewritten by this change.

Verification: 50 integration checks passed, including a complete non-VAT issuance, missing-field rejection, direct status bypass rejection, immutability, payment updates and Austrian isolation. A live database transaction repeated incomplete/complete issuance and immutability checks, then rolled back all synthetic data. Build passed; no TypeScript errors in the changed invoice/readiness files (the repository retains unrelated existing TypeScript errors).

Migration: `20261102180000_require_new_uae_invoice_data.sql`, applied once and recorded in migration history. It includes manual script 092; do not replay the manual script separately.
