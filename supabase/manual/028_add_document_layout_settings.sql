-- Additive document-layout settings and private logo support.
begin;

alter table public.document_templates
  add column if not exists header_text text,
  add column if not exists font_family text not null default 'helvetica'
    check (font_family in ('helvetica','times','courier'));

update storage.buckets
set allowed_mime_types=array[
  'application/pdf','text/csv','application/vnd.ms-excel',
  'image/png','image/jpeg','image/webp'
]
where id='finance-documents';

commit;

select jsonb_build_object(
  'layout_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='document_templates' and column_name in('header_text','font_family','logo_path','accent_color','footer_text')),
  'logo_mime_types',(select allowed_mime_types from storage.buckets where id='finance-documents')
) as verification;
