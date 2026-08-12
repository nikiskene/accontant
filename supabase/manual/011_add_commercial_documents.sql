-- Additive commercial-document foundation shared by all legal entities.
-- Does not alter or repost existing accounting transactions.

begin;

create table if not exists public.products_services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  item_type text not null check (item_type in ('product', 'service')),
  sku text,
  name text not null,
  description text,
  unit text not null default 'each',
  unit_price numeric(15,2) not null default 0,
  currency text not null,
  revenue_account_id uuid references public.accounts(id),
  cogs_account_id uuid references public.accounts(id),
  vat_code_id uuid references public.vat_codes(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, sku)
);

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('quote', 'invoice', 'credit_note', 'reminder')),
  name text not null,
  logo_path text,
  accent_color text not null default '#2563eb',
  footer_text text,
  payment_instructions text,
  terms_text text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_sequences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('quote', 'invoice', 'credit_note')),
  fiscal_year integer not null,
  prefix text not null,
  next_number integer not null default 1 check (next_number > 0),
  padding integer not null default 4 check (padding between 1 and 10),
  primary key (workspace_id, document_type, fiscal_year)
);

create table if not exists public.sales_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('quote', 'invoice', 'credit_note')),
  document_number text,
  customer_id uuid not null references public.counterparties(id),
  template_id uuid references public.document_templates(id),
  issue_date date not null,
  valid_until date,
  due_date date,
  currency text not null,
  status text not null default 'draft' check (status in (
    'draft', 'sent', 'accepted', 'declined', 'partially_invoiced',
    'invoiced', 'partially_paid', 'paid', 'overdue', 'void'
  )),
  customer_reference text,
  introduction text,
  notes text,
  terms_text text,
  subtotal numeric(15,2) not null default 0,
  tax_total numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0,
  amount_paid numeric(15,2) not null default 0,
  sent_at timestamptz,
  accepted_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, document_type, document_number)
);

create table if not exists public.sales_document_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.sales_documents(id) on delete cascade,
  line_no integer not null,
  product_service_id uuid references public.products_services(id),
  description text not null,
  quantity numeric(15,4) not null default 1,
  unit text not null default 'each',
  unit_price numeric(15,2) not null,
  discount_percent numeric(7,4) not null default 0 check (discount_percent between 0 and 100),
  vat_code_id uuid references public.vat_codes(id),
  vat_rate numeric(9,6) not null default 0,
  net_amount numeric(15,2) not null,
  vat_amount numeric(15,2) not null default 0,
  gross_amount numeric(15,2) not null,
  revenue_account_id uuid references public.accounts(id),
  unique (document_id, line_no)
);

create table if not exists public.sales_document_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_document_id uuid not null references public.sales_documents(id),
  target_document_id uuid not null references public.sales_documents(id),
  link_type text not null check (link_type in ('quote_to_invoice', 'invoice_to_credit_note')),
  fraction numeric(9,6) not null default 1 check (fraction > 0 and fraction <= 1),
  created_at timestamptz not null default now(),
  unique (source_document_id, target_document_id)
);

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.counterparties(id),
  payment_date date not null,
  amount numeric(15,2) not null check (amount > 0),
  currency text not null,
  reference text,
  bank_transaction_id uuid references public.bank_transactions(id),
  created_at timestamptz not null default now()
);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payment_id uuid not null references public.customer_payments(id) on delete cascade,
  invoice_id uuid not null references public.sales_documents(id),
  amount numeric(15,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid references public.sales_documents(id),
  from_address text not null,
  to_address text not null,
  cc_addresses text[] not null default '{}',
  subject text not null,
  body_html text not null,
  status text not null default 'pending_configuration' check (status in (
    'pending_configuration', 'queued', 'sending', 'sent', 'failed', 'cancelled'
  )),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists products_services_workspace_idx on public.products_services(workspace_id, is_active);
create index if not exists sales_documents_workspace_idx on public.sales_documents(workspace_id, document_type, issue_date desc);
create index if not exists sales_documents_customer_idx on public.sales_documents(customer_id);
create index if not exists sales_document_lines_document_idx on public.sales_document_lines(document_id, line_no);
create index if not exists customer_payments_workspace_idx on public.customer_payments(workspace_id, payment_date desc);
create index if not exists email_outbox_workspace_idx on public.email_outbox(workspace_id, status, created_at);

alter table public.products_services enable row level security;
alter table public.document_templates enable row level security;
alter table public.document_sequences enable row level security;
alter table public.sales_documents enable row level security;
alter table public.sales_document_lines enable row level security;
alter table public.sales_document_links enable row level security;
alter table public.customer_payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.email_outbox enable row level security;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'products_services', 'document_templates', 'document_sequences',
    'sales_documents', 'sales_document_lines', 'sales_document_links',
    'customer_payments', 'payment_allocations', 'email_outbox'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_read', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_write', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      v_table || '_read', v_table
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_write(workspace_id)) with check (public.can_write(workspace_id))',
      v_table || '_write', v_table
    );
  end loop;
end $$;

insert into public.document_sequences (workspace_id, document_type, fiscal_year, prefix)
select w.id, d.document_type, extract(year from current_date)::integer,
  case d.document_type when 'quote' then 'Q-' when 'invoice' then 'INV-' else 'CN-' end
from public.workspaces w
cross join (values ('quote'), ('invoice'), ('credit_note')) d(document_type)
on conflict do nothing;

insert into public.document_templates (
  workspace_id, document_type, name, is_default, footer_text, payment_instructions
)
select w.id, d.document_type, 'Default ' || replace(d.document_type, '_', ' '), true,
  'Thank you for your business.',
  case when d.document_type = 'invoice' then 'Please pay using the bank details shown on this document.' end
from public.workspaces w
cross join (values ('quote'), ('invoice'), ('credit_note')) d(document_type)
where not exists (
  select 1 from public.document_templates t
  where t.workspace_id = w.id and t.document_type = d.document_type and t.is_default
);

commit;

select table_name
from information_schema.tables
where table_schema = 'public' and table_name in (
  'products_services', 'document_templates', 'document_sequences',
  'sales_documents', 'sales_document_lines', 'sales_document_links',
  'customer_payments', 'payment_allocations', 'email_outbox'
)
order by table_name;
