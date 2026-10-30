-- md5(random()) is not a cryptographic source; public file/media links rely on the id being unguessable.
ALTER TABLE files ALTER COLUMN id SET DEFAULT replace(gen_random_uuid()::text, '-', '');
ALTER TABLE media ALTER COLUMN id SET DEFAULT replace(gen_random_uuid()::text, '-', '');
