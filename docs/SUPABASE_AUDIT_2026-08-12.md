# Supabase accounting audit — 12 August 2026

## Verified deployment

The deployed Supabase project is `ndktajhxihahgfdcsuij`.

The live database is the system of record. The original Bolt migrations in
`supabase/migrations/` are an incomplete historical snapshot and must not be
replayed against production.

The live UAE workspace contains:

- 36 accounts and 4 VAT codes
- 355 counterparties
- 458 posted transactions and 884 transaction lines
- 4 bank accounts and 370 bank transactions
- 3 trips and 33 trip expenses
- 73 audit events
- no attachment rows

All 458 transactions are dated in 2025. The QuickBooks export covers a wider
period, so historical migration is incomplete.

## Verified integrity findings

- All populated posted journals balance.
- No transaction line is missing an account or tax year.
- 16 posted `trip_expense` transaction headers have no transaction lines.
- Each empty header maps one-to-one to a submitted trip expense.
- All 33 submitted trip expenses lack both account and VAT classification.
- The balance function currently treats a transaction with zero lines as balanced.
- The default expense account is Software / SaaS and must not be applied to all
  trip expenses.
- The default VAT code is Exempt and must not be applied automatically to foreign
  purchases. US trip purchases will generally need Out of Scope review.

## Verified access-control findings

- RLS is enabled on every public table.
- The existing workspace-membership insert policy allows a signed-in user to add
  their own user ID to any known workspace ID without an invitation or admin check.
- Duplicate transaction policies weaken the intended `can_write()` control.
- Ordinary workspace members can delete accounting source records on several
  tables.
- Service-role policies inspected were correctly conditional on
  `auth.role() = 'service_role'`.

## Austrian foundation

The Austrian entity is not yet present in Supabase. The FreeFinance 2025 export
should be the canonical source for the Austrian chart of accounts and bookings.
It contains 39 numbered accounts, VAT/UVA metadata, 1,024 booking rows, invoice
register data, fixed assets, and depreciation. QuickBooks should be used as a
customer/invoice-history and reconciliation source, not as the Austrian chart of
accounts.

## Publication boundaries

- `main` contains the untouched Bolt source baseline, without `.env`.
- This audit does not prove authenticated UI workflows.
- None of the SQL in `supabase/manual/` has been executed merely because it is in
  GitHub.
- No QuickBooks/FreeFinance export or financial document belongs in this repo.
