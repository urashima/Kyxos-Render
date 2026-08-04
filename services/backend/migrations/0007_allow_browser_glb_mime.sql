begin;

update storage.buckets
set allowed_mime_types = array[
  'model/gltf-binary',
  'model/gltf+json',
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/ktx2',
  'image/vnd.radiance',
  'image/x-exr'
]::text[]
where id = 'kyxos-assets';

commit;
