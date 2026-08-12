# Manual Supabase hardening runbook

These files target the existing live database. They are intentionally separate
from the historical Bolt migrations and are designed to be run individually in
the Supabase SQL editor.

## Before running

1. Confirm the target project is `ndktajhxihahgfdcsuij`.
2. Take a Supabase database backup or confirm point-in-time recovery.
3. Run each file in order and stop if any file errors.
4. Run `900_verify_hardening.sql` after files 001–007.
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
   nullable one-to-one link between a trip expense and its posted transaction.
8. [`007_add_accounting_periods.sql`](./007_add_accounting_periods.sql) — add the
   period-lock data structure and access policies.
9. [`900_verify_hardening.sql`](./900_verify_hardening.sql) — read-only checks.

## Deliberately deferred

- Classification and repair of the 33 UAE trip expenses.
- Removal or reversal of the 16 incomplete transaction headers.
- Austrian workspace creation and FreeFinance import.
- Enforcement of period locks inside every posting function.
- Invoice, credit-note, payment-allocation, fixed-asset, and approval schemas.

Those changes depend on accountant/auditor decisions or additional application
work and should not be bundled into the security foundation.
