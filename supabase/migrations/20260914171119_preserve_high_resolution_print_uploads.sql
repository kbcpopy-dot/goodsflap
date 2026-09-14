update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'customer-originals';

update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array['image/png', 'image/webp']
where id = 'design-previews';
