-- Supplier invoices, payments, and receipt links.
begin;
create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_id uuid not null references public.counterparties(id), supplier_invoice_number text,
  invoice_date date not null, due_date date, currency text not null, subtotal numeric(15,2) not null default 0,
  tax_total numeric(15,2) not null default 0, total numeric(15,2) not null, amount_paid numeric(15,2) not null default 0,
  status text not null default 'draft' check(status in('draft','approved','posted','partially_paid','paid','void')),
  transaction_id uuid references public.transactions(id), notes text, created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), unique(workspace_id,supplier_id,supplier_invoice_number)
);
create table if not exists public.supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoices(id) on delete cascade, line_no integer not null,
  description text not null, account_id uuid not null references public.accounts(id), vat_code_id uuid references public.vat_codes(id),
  cost_center_id uuid references public.cost_centers(id), net_amount numeric(15,2) not null, vat_amount numeric(15,2) not null default 0,
  gross_amount numeric(15,2) not null, unique(supplier_invoice_id,line_no)
);
alter table public.attachments add column if not exists supplier_invoice_id uuid references public.supplier_invoices(id) on delete set null;
alter table public.supplier_invoices enable row level security; alter table public.supplier_invoice_lines enable row level security;
create index if not exists supplier_invoices_workspace_idx on public.supplier_invoices(workspace_id,invoice_date desc);
drop policy if exists supplier_invoices_read on public.supplier_invoices; drop policy if exists supplier_invoices_write on public.supplier_invoices;
create policy supplier_invoices_read on public.supplier_invoices for select to authenticated using(public.is_workspace_member(workspace_id));
create policy supplier_invoices_write on public.supplier_invoices for all to authenticated using(public.can_write(workspace_id)) with check(public.can_write(workspace_id));
drop policy if exists supplier_invoice_lines_read on public.supplier_invoice_lines; drop policy if exists supplier_invoice_lines_write on public.supplier_invoice_lines;
create policy supplier_invoice_lines_read on public.supplier_invoice_lines for select to authenticated using(public.is_workspace_member(workspace_id));
create policy supplier_invoice_lines_write on public.supplier_invoice_lines for all to authenticated using(public.can_write(workspace_id)) with check(public.can_write(workspace_id));
commit;
select table_name from information_schema.tables where table_schema='public' and table_name in('supplier_invoices','supplier_invoice_lines') order by table_name;
