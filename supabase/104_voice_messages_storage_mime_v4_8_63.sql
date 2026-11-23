-- SUPER LEADER V4.8.63 HOTFIX
-- Allow private voice-message MIME types in the existing private Storage bucket.
-- Keeps all previously allowed document/image MIME types unchanged.

begin;

update storage.buckets
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav'
  ]::text[]
where id = 'super-leader-private';

-- Fail visibly if the expected private bucket does not exist.
do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'super-leader-private'
  ) then
    raise exception 'Storage bucket super-leader-private does not exist';
  end if;
end $$;

commit;
