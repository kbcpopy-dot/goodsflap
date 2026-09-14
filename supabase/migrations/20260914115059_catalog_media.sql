-- Public catalog artwork is separate from private customer-uploaded originals.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-media', 'catalog-media', true, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
