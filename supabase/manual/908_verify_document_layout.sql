-- Read-only verification for document layout settings and logo uploads.
select jsonb_build_object(
  'layout_columns', (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_templates'
      and column_name in (
        'header_text', 'font_family', 'logo_path', 'accent_color',
        'footer_text', 'payment_instructions', 'terms_text'
      )
  ),
  'private_bucket', coalesce((
    select not public
    from storage.buckets
    where id = 'finance-documents'
  ), false),
  'image_uploads_enabled', coalesce((
    select allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp']::text[]
    from storage.buckets
    where id = 'finance-documents'
  ), false),
  'default_templates', (
    select count(*)
    from public.document_templates
    where is_default
  )
) as verification;
