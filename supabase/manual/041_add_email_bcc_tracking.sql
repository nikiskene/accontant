alter table public.email_outbox add column if not exists bcc_addresses text[]not null default'{}';
select exists(select 1 from information_schema.columns where table_schema='public'and table_name='email_outbox'and column_name='bcc_addresses')as verification;
