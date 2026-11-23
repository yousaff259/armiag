alter table public.homepage_content
  add column if not exists mobile_image_url text default '';
