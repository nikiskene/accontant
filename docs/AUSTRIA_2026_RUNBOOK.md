# Austria 2026 setup

Run each file separately in Supabase SQL Editor, in this order:

1. [`023_add_austrian_tax_year_and_finanzonline.sql`](../supabase/manual/023_add_austrian_tax_year_and_finanzonline.sql)
2. [`024_add_austrian_afa_workflow.sql`](../supabase/manual/024_add_austrian_afa_workflow.sql)
3. [`025_add_bank_statement_review.sql`](../supabase/manual/025_add_bank_statement_review.sql)
4. [`026_add_austrian_cross_border_tax_treatments.sql`](../supabase/manual/026_add_austrian_cross_border_tax_treatments.sql)
5. [`906_verify_austrian_2026_foundation.sql`](../supabase/manual/906_verify_austrian_2026_foundation.sql)

The scripts are rerunnable. They do not import 2025 transactions. Cross-border
tax treatments are deliberately marked `unverified`; they must not be used for
automatic FinanzOnline filing until the full Kennzahl mapping is checked with
the accountant or tax adviser.

The bank workflow stores review and reconciliation state. PDF extraction and
Microsoft/AI secrets are a later integration step; extracted rows cannot be
treated as reconciled while dates or amounts are missing or proposed rows have
not been reviewed.
