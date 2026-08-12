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

## Deliberately deferred

- Accountant/auditor review of the repaired UAE trip postings.
- Removal or reversal of the 16 incomplete transaction headers.
- Austrian workspace creation and FreeFinance import.
- Enforcement of period locks inside non-trip posting functions.
- Invoice, credit-note, payment-allocation, fixed-asset, and approval schemas.

Those changes depend on accountant/auditor decisions or additional application
work and should not be bundled into the security foundation.
