-- Canton QA visitor directions: optional reception-site postal address.
-- No fabricated address; maps only if staff supplied a verified physical address.
alter table public.canton_qr_sites
 add column if not exists street_address text;
