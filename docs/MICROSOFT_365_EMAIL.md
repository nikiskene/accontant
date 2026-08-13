# Microsoft 365 billing email

The accounting app sends issued quotes, invoices, and credit notes from
`billing@iacy.com` through Microsoft Graph.

## Controls

- The Supabase Edge Function requires an authenticated user with a writable
  role in the document's workspace.
- The recipient is read from the document's customer record; callers cannot
  supply an arbitrary recipient.
- Only issued, non-void documents can be sent.
- The generated PDF is attached, the attempt is recorded in `email_outbox`,
  and successful delivery is added to `audit_events`.
- Exchange Online Application RBAC limits `Application Mail.Send` to the
  `billing@iacy.com` mailbox. There is no tenant-wide Entra `Mail.Send` grant.

## Supabase secrets

The deployed function expects:

- `MS_ENTRA_TENANT_ID`
- `MS_ENTRA_CLIENT_ID`
- `MS_ENTRA_CLIENT_SECRET`
- `MS_ENTRA_CLIENT_SECRET_EXPIRES_AT`
- `MS_GRAPH_SENDER`

The current client secret expires on 2028-08-12. Rotate it in Microsoft Entra
and update the Supabase secret before that date. Never commit the secret value.

## Reapply or verify the mailbox scope

Install PowerShell and the Exchange Online module, then run:

```powershell
./scripts/configure-exchange-mailbox-scope.ps1
```

The script is idempotent and finishes by checking that `Application Mail.Send`
is in scope for `billing@iacy.com`.
