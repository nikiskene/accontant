# Austria 2026 setup

Run each file separately in Supabase SQL Editor, in this order:

1. [`023_add_austrian_tax_year_and_finanzonline.sql`](../supabase/manual/023_add_austrian_tax_year_and_finanzonline.sql)
2. [`024_add_austrian_afa_workflow.sql`](../supabase/manual/024_add_austrian_afa_workflow.sql)
3. [`025_add_bank_statement_review.sql`](../supabase/manual/025_add_bank_statement_review.sql)
4. [`026_add_austrian_cross_border_tax_treatments.sql`](../supabase/manual/026_add_austrian_cross_border_tax_treatments.sql)
5. [`906_verify_austrian_2026_foundation.sql`](../supabase/manual/906_verify_austrian_2026_foundation.sql)

For statement upload and controlled import, then run:

6. [`027_add_statement_upload_and_controlled_import.sql`](../supabase/manual/027_add_statement_upload_and_controlled_import.sql)
7. [`907_verify_statement_upload.sql`](../supabase/manual/907_verify_statement_upload.sql)

Deploy `supabase/functions/extract-bank-statement` and add the server-side
`OPENAI_API_KEY` secret before enabling automatic PDF extraction. The key must
never be exposed as a `VITE_` browser variable.

The scripts are rerunnable. They do not import 2025 transactions. Cross-border
tax treatments are deliberately marked `unverified`; they must not be used for
automatic FinanzOnline filing until the full Kennzahl mapping is checked with
the accountant or tax adviser.

The bank workflow stores the original PDF privately, stages structured
extraction proposals, and requires row review and exact balance reconciliation.
Only then can approved rows be copied to the existing bank inbox.
