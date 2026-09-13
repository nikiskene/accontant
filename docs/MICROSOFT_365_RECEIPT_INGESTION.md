# Microsoft 365 receipt ingestion setup

The production flow uses application credentials and does not depend on a
browser login. `billing@iacy.com` is enabled for review-first ingestion; AI
extraction and automatic booking remain off.

## 1. Add the minimum Microsoft Graph permission

1. Open Microsoft Entra admin center → **App registrations** → **IACy
   Accounting Billing** (the existing application used for sending invoices).
2. Open **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** → **Mail** → select **Mail.Read**.
3. Do not add `Mail.ReadWrite`, mailbox settings, contacts, calendar, or any
   delegated mail permission.
4. Select **Grant admin consent** for the tenant.

The app uses client credentials: it has no redirect URI and no user session.
Retain the existing tenant ID, client ID, client secret and `MS_GRAPH_SENDER`
secrets. There are no new browser-side variables and no new secret values to
copy into Supabase.

## 2. Keep Graph access scoped to one mailbox

Run the updated script from a PowerShell session that can administer Exchange
Online:

```powershell
./scripts/configure-exchange-mailbox-scope.ps1
```

It creates or verifies both `Application Mail.Send` and `Application
Mail.Read`, constrained to `billing@iacy.com`. The final test output must show
`InScope: True` for that mailbox. Do not enable ingestion if it does not.

Microsoft describes Exchange Application RBAC as the supported way to give an
app resource-scoped access, including the `Application Mail.Read` role.

## 3. Test alias evidence in production

Forward one harmless test PDF to `eu@iacy.com` and one to `fzco@iacy.com`.
The ten-minute protected GitHub Actions schedule and the **Sync now** button
both invoke the same ingestion function. The sync inspects Graph recipients
plus the relevant Internet headers (`To`, `Cc`, `Delivered-To`,
`X-Original-To`, and the Exchange original-envelope header). A single matching
alias gives an entity confidence of 1.0; conflicting or absent evidence creates
a review item without a company allocation.

The first incremental query starts at the configured current time. It will not
scan historical mailbox contents. After that it stores only the Graph delta
cursor and processes new pages incrementally.

## 4. Review the controlled test

In Accontant → **Microsoft 365 receipt ingestion**, first use **Sync now**.
Review the two test receipts in **Receipt Inbox** and confirm:

- EU and FZCO were assigned from recipient evidence;
- source emails and attachments are retained in the private bucket;
- no record booked automatically;
- unclear recipient evidence is in review.

Keep AI extraction disabled unless text extraction cannot reliably read the
documents. Automatic booking remains disabled by design until the accounting
review policy explicitly enables it.

## Operational details

- Required existing Supabase secrets: `MS_ENTRA_TENANT_ID`,
  `MS_ENTRA_CLIENT_ID`, `MS_ENTRA_CLIENT_SECRET`, and `OPENAI_API_KEY` only if
  the AI fallback is enabled.
- The original document is SHA-256 hashed; matching files are preserved and
  flagged as duplicates rather than booked twice.
- AI receives a compact text excerpt or a single low-volume image fallback. It
  is instructed to treat document text as untrusted data and its token usage is
  recorded per receipt.
