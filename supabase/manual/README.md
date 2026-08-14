# Manual Supabase hardening runbook

These files target the existing live database. They are intentionally separate
from the historical Bolt migrations and are designed to be run individually in
the Supabase SQL editor.

## Live execution status

Verified on 12 August 2026:

- Files 000–008 and 900 were run successfully in project
  `ndktajhxihahgfdcsuij`.
- Files 008–010 were run successfully. The legacy repair produced three posted
  reversals, three detailed replacement postings, 33 linked source expenses,
  16 void zero-line headers, and zero remaining unbalanced posted transactions.
- File 900 was rerun after the repair and verified zero unbalanced posted
  transactions, zero unclassified submitted trip expenses, no duplicate
  transaction policies, secure membership, and the expected trip-link shape.
- The verification correctly reports 16 pre-existing unbalanced posted headers
  and 33 pre-existing unclassified submitted trip expenses.

## Before running

1. Confirm the target project is `ndktajhxihahgfdcsuij`.
2. Take a Supabase database backup or confirm point-in-time recovery.
3. Run each file in order and stop if any file errors.
4. Run `900_verify_hardening.sql` after files 001–008.
5. Do not run repair SQL for the 16 empty transaction headers yet. The 33 source
   expenses require accounting and VAT classification first.

## Execution order

1. [`000_preflight.sql`](./000_preflight.sql) — read-only deployment checks.
2. [`001_secure_workspace_membership.sql`](./001_secure_workspace_membership.sql)
   — remove self-enrolment and require an existing admin.
3. [`002_clean_transaction_policies.sql`](./002_clean_transaction_policies.sql)
   — remove duplicate permissive policies.
4. [`003_harden_record_mutations.sql`](./003_harden_record_mutations.sql) — apply
   writer/admin roles consistently to source records.
5. [`004_fix_balance_validation.sql`](./004_fix_balance_validation.sql) — make
   zero-line transactions fail the balance check.
6. [`005_require_trip_classification.sql`](./005_require_trip_classification.sql)
   — reject future submission/posting without account and VAT classification.
7. [`006_link_trip_postings.sql`](./006_link_trip_postings.sql) — add a durable,
   nullable many-expenses-to-one-transaction posting link.
8. [`007_add_accounting_periods.sql`](./007_add_accounting_periods.sql) — add the
   period-lock data structure and access policies.
9. [`008_unify_trip_posting.sql`](./008_unify_trip_posting.sql) — replace the
   conflicting trip RPCs with the UI's single atomic lifecycle.
10. [`009_classify_legacy_trip_expenses.sql`](./009_classify_legacy_trip_expenses.sql)
    — assign the reviewed accounts and OOS VAT treatment to the 33 legacy trip
    expenses without posting or changing trip status.
11. [`010_repair_legacy_trip_postings.sql`](./010_repair_legacy_trip_postings.sql)
    — reverse three aggregate postings, create reviewed detailed replacements,
    link 33 expenses, and audit-void the 16 known zero-line legacy headers.
12. [`900_verify_hardening.sql`](./900_verify_hardening.sql) — read-only checks.
13. [`011_add_commercial_documents.sql`](./011_add_commercial_documents.sql) — commercial document and payment tables.
14. [`012_add_quote_invoice_workflow.sql`](./012_add_quote_invoice_workflow.sql) — numbering and full/partial quote conversion.
15. [`013_add_commercial_reporting_views.sql`](./013_add_commercial_reporting_views.sql) — receivables and monthly sales views.
16. [`901_verify_commercial_foundation.sql`](./901_verify_commercial_foundation.sql) — read-only commercial verification.
17. [`014_add_company_legal_profiles.sql`](./014_add_company_legal_profiles.sql) — entity credentials, bank details, and immutable document snapshots.
18. [`015_add_document_issue_workflow.sql`](./015_add_document_issue_workflow.sql) — validate and snapshot issued documents plus quote acceptance.
19. [`902_verify_legal_profiles.sql`](./902_verify_legal_profiles.sql) — read-only legal-profile verification.
20. [`016_add_supplier_invoices.sql`](./016_add_supplier_invoices.sql) — supplier invoices, classified lines, and receipt links.
21. [`903_verify_operations.sql`](./903_verify_operations.sql) — read-only supplier operations verification.
22. [`017_add_payments_credits_reminders.sql`](./017_add_payments_credits_reminders.sql) — payment allocation, credit notes, and reminder history.
23. [`018_add_supplier_approval.sql`](./018_add_supplier_approval.sql) — controlled supplier-invoice approval without premature ledger posting.
24. [`904_verify_payments_and_approvals.sql`](./904_verify_payments_and_approvals.sql) — read-only workflow verification.
25. [`019_create_austrian_workspace_and_chart.sql`](./019_create_austrian_workspace_and_chart.sql) — Austrian entity with the exact 39-account FreeFinance chart.
26. [`020_add_austrian_tax_assets_defaults.sql`](./020_add_austrian_tax_assets_defaults.sql) — unverified VAT candidates, document defaults, and fixed assets.
27. [`021_add_freefinance_import_staging.sql`](./021_add_freefinance_import_staging.sql) — private raw staging with source controls; no ledger promotion.
28. [`022_add_quickbooks_reconciliation_staging.sql`](./022_add_quickbooks_reconciliation_staging.sql) — non-ledger QuickBooks comparison staging.
29. [`905_verify_austrian_foundation.sql`](./905_verify_austrian_foundation.sql) — read-only Austrian foundation verification.
30. [`023_add_austrian_tax_year_and_finanzonline.sql`](./023_add_austrian_tax_year_and_finanzonline.sql) — annual/periodic VAT settings and versioned FinanzOnline mappings.
31. [`024_add_austrian_afa_workflow.sql`](./024_add_austrian_afa_workflow.sql) — Austrian fixed-asset and depreciation workflow.
32. [`025_add_bank_statement_review.sql`](./025_add_bank_statement_review.sql) — reviewed bank-statement import staging.
33. [`026_add_austrian_cross_border_tax_treatments.sql`](./026_add_austrian_cross_border_tax_treatments.sql) — explicitly unverified cross-border VAT candidates.
34. [`906_verify_austrian_2026_foundation.sql`](./906_verify_austrian_2026_foundation.sql) — read-only Austrian tax and banking verification.
35. [`027_add_statement_upload_and_controlled_import.sql`](./027_add_statement_upload_and_controlled_import.sql) — private statement uploads and controlled import.
36. [`907_verify_statement_upload.sql`](./907_verify_statement_upload.sql) — read-only statement-upload verification.
37. [`028_add_document_layout_settings.sql`](./028_add_document_layout_settings.sql) — document header/font settings and private logo upload types.
38. [`908_verify_document_layout.sql`](./908_verify_document_layout.sql) — read-only document-layout verification.
39. [`029_move_terms_and_header_to_documents.sql`](./029_move_terms_and_header_to_documents.sql) — customer/document payment terms, document headers, and payment-instruction font size.
40. [`909_verify_document_commercial_fields.sql`](./909_verify_document_commercial_fields.sql) — read-only commercial-field verification.
41. [`030_add_controlled_reminder_escalation.sql`](./030_add_controlled_reminder_escalation.sql) — unique two-step reminders, documented late fees, and collection referrals.
42. [`910_verify_reminder_escalation.sql`](./910_verify_reminder_escalation.sql) — read-only reminder-escalation verification.
43. [`031_preflight_fzco_sales_reset.sql`](./031_preflight_fzco_sales_reset.sql) — read-only counts before removing FZCO sales test data.
44. [`032_delete_fzco_sales_test_data.sql`](./032_delete_fzco_sales_test_data.sql) — destructive FZCO-only sales reset before controlled QuickBooks migration.
45. [`033_import_fzco_2026_invoices_from_pdf.sql`](./033_import_fzco_2026_invoices_from_pdf.sql) — authoritative PDF-based customer and invoice import with legacy numbering continuation.
46. [`034_import_nikolaus_skene_2026_invoices_from_pdf.sql`](./034_import_nikolaus_skene_2026_invoices_from_pdf.sql) — authoritative Austrian PDF import for invoices 10084 and 10086, including EVN AG, 20% VAT, paid status, and numbering continuation.
47. [`035_activate_2026_dashboard_years.sql`](./035_activate_2026_dashboard_years.sql) — ensures both entities have 2026 fiscal years and makes 2026 the active default dashboard period.
48. [`036_inspect_legacy_insolvency_source.sql`](./036_inspect_legacy_insolvency_source.sql) — read-only inventory to run against the separate legacy insolvency Supabase before controlled migration.
49. [`037_add_private_insolvency_module.sql`](./037_add_private_insolvency_module.sql) — isolated private case, creditor, schedule, payment and audit schema with owner-only RLS.
50. [`038_export_legacy_insolvency_data.sql`](./038_export_legacy_insolvency_data.sql) — read-only source-data export with migration control totals.
51. [`039_import_legacy_insolvency_data.sql`](./039_import_legacy_insolvency_data.sql) — generated, guarded import of the supplied legacy export with exact record and financial-total reconciliation.
52. [`040_add_controlled_invoice_void.sql`](./040_add_controlled_invoice_void.sql) — audited voiding for unpaid invoices without deleting or rewriting issued documents.

## Deliberately deferred

- Accountant/auditor review of the repaired UAE trip postings.
- Removal or reversal of the 16 incomplete transaction headers.
- Enforcement of period locks inside non-trip posting functions.
- Accountant verification of Austrian FinanzOnline and cross-border VAT mappings.
- Promotion of any FreeFinance or QuickBooks staging data into the ledger.

Those changes depend on accountant/auditor decisions or additional application
work and should not be bundled into the security foundation.
