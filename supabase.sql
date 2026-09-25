create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('company', 'pharmacy')),
  name text not null unique,
  phone text,
  address text,
  tax_id text,
  license text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  username text unique not null,
  password text not null,
  name text not null,
  role text not null check (role in ('super', 'admin', 'user')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint users_super_tenant_check check (
    (role = 'super' and tenant_id is null)
    or (role in ('admin', 'user') and tenant_id is not null)
  )
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  barcode text unique,
  category text,
  unit text not null default 'علبة',
  purchase_price numeric not null default 0,
  sale_price numeric not null default 0,
  min_stock integer not null default 10,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  batch_no text not null,
  expiry_date date not null,
  quantity integer not null default 0,
  cost numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, product_id, batch_no)
);

create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  batch_id uuid references public.batches(id) on delete set null,
  batch_no text,
  type text not null check (type in ('in', 'out')),
  quantity integer not null,
  reference text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_no text not null,
  type text not null check (type in ('sale', 'purchase')),
  party_id uuid,
  party_name text,
  items jsonb not null,
  subtotal numeric,
  discount numeric,
  tax numeric,
  total numeric,
  user_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, invoice_no)
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null,
  from_tenant uuid not null references public.tenants(id) on delete cascade,
  to_tenant uuid not null references public.tenants(id) on delete cascade,
  items jsonb not null,
  total numeric,
  status text not null default 'pending' check (status in ('pending', 'approved', 'received')),
  note text,
  created_at timestamptz not null default now(),
  unique (from_tenant, order_no)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  from_tenant uuid not null references public.tenants(id) on delete cascade,
  to_tenant uuid not null references public.tenants(id) on delete cascade,
  sender_user text,
  text text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_users_tenant_id on public.users (tenant_id);
create index if not exists idx_products_tenant_category on public.products (tenant_id, category);
create index if not exists idx_batches_tenant_product_expiry on public.batches (tenant_id, product_id, expiry_date);
create index if not exists idx_movements_tenant_product_created_at on public.movements (tenant_id, product_id, created_at desc);
create index if not exists idx_invoices_tenant_type_created_at on public.invoices (tenant_id, type, created_at desc);
create index if not exists idx_purchase_orders_from_status_created_at on public.purchase_orders (from_tenant, status, created_at desc);
create index if not exists idx_purchase_orders_to_status_created_at on public.purchase_orders (to_tenant, status, created_at desc);
create index if not exists idx_messages_from_created_at on public.messages (from_tenant, created_at desc);
create index if not exists idx_messages_to_read_created_at on public.messages (to_tenant, read, created_at desc);

create or replace function public.jwt_tenant_id()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() ->> 'tenant_id',
    auth.jwt() -> 'app_metadata' ->> 'tenant_id',
    auth.jwt() -> 'user_metadata' ->> 'tenant_id'
  );
$$;

create or replace function public.jwt_is_super()
returns boolean
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    auth.jwt() ->> 'app_role',
    auth.jwt() ->> 'role'
  ) = 'super';
$$;

alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.batches enable row level security;
alter table public.movements enable row level security;
alter table public.invoices enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.messages enable row level security;

-- The plaintext custom-login prototype uses anon, so this policy intentionally
-- permits all anon operations. Authenticated policies below enforce JWT tenancy.
drop policy if exists prototype_anon_all_access_tenants on public.tenants;
create policy prototype_anon_all_access_tenants on public.tenants
  for all to anon using (true) with check (true);
drop policy if exists authenticated_tenant_access_tenants on public.tenants;
create policy authenticated_tenant_access_tenants on public.tenants
  for all to authenticated
  using (public.jwt_is_super() or id::text = public.jwt_tenant_id())
  with check (public.jwt_is_super() or id::text = public.jwt_tenant_id());

drop policy if exists prototype_anon_all_access_users on public.users;
create policy prototype_anon_all_access_users on public.users
  for all to anon using (true) with check (true);
drop policy if exists authenticated_tenant_access_users on public.users;
create policy authenticated_tenant_access_users on public.users
  for all to authenticated
  using (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id())
  with check (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id());

drop policy if exists prototype_anon_all_access_products on public.products;
create policy prototype_anon_all_access_products on public.products
  for all to anon using (true) with check (true);
drop policy if exists authenticated_tenant_access_products on public.products;
create policy authenticated_tenant_access_products on public.products
  for all to authenticated
  using (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id())
  with check (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id());

drop policy if exists prototype_anon_all_access_batches on public.batches;
create policy prototype_anon_all_access_batches on public.batches
  for all to anon using (true) with check (true);
drop policy if exists authenticated_tenant_access_batches on public.batches;
create policy authenticated_tenant_access_batches on public.batches
  for all to authenticated
  using (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id())
  with check (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id());

drop policy if exists prototype_anon_all_access_movements on public.movements;
create policy prototype_anon_all_access_movements on public.movements
  for all to anon using (true) with check (true);
drop policy if exists authenticated_tenant_access_movements on public.movements;
create policy authenticated_tenant_access_movements on public.movements
  for all to authenticated
  using (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id())
  with check (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id());

drop policy if exists prototype_anon_all_access_invoices on public.invoices;
create policy prototype_anon_all_access_invoices on public.invoices
  for all to anon using (true) with check (true);
drop policy if exists authenticated_tenant_access_invoices on public.invoices;
create policy authenticated_tenant_access_invoices on public.invoices
  for all to authenticated
  using (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id())
  with check (public.jwt_is_super() or tenant_id::text = public.jwt_tenant_id());

drop policy if exists prototype_anon_all_access_purchase_orders on public.purchase_orders;
create policy prototype_anon_all_access_purchase_orders on public.purchase_orders
  for all to anon using (true) with check (true);
drop policy if exists authenticated_tenant_access_purchase_orders on public.purchase_orders;
create policy authenticated_tenant_access_purchase_orders on public.purchase_orders
  for all to authenticated
  using (
    public.jwt_is_super()
    or from_tenant::text = public.jwt_tenant_id()
    or to_tenant::text = public.jwt_tenant_id()
  )
  with check (
    public.jwt_is_super()
    or from_tenant::text = public.jwt_tenant_id()
    or to_tenant::text = public.jwt_tenant_id()
  );

drop policy if exists prototype_anon_all_access_messages on public.messages;
create policy prototype_anon_all_access_messages on public.messages
  for all to anon using (true) with check (true);
drop policy if exists authenticated_tenant_access_messages on public.messages;
create policy authenticated_tenant_access_messages on public.messages
  for all to authenticated
  using (
    public.jwt_is_super()
    or from_tenant::text = public.jwt_tenant_id()
    or to_tenant::text = public.jwt_tenant_id()
  )
  with check (
    public.jwt_is_super()
    or from_tenant::text = public.jwt_tenant_id()
    or to_tenant::text = public.jwt_tenant_id()
  );

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.tenants to anon, authenticated;
grant select, insert, update, delete on public.users to anon, authenticated;
grant select, insert, update, delete on public.products to anon, authenticated;
grant select, insert, update, delete on public.batches to anon, authenticated;
grant select, insert, update, delete on public.movements to anon, authenticated;
grant select, insert, update, delete on public.invoices to anon, authenticated;
grant select, insert, update, delete on public.purchase_orders to anon, authenticated;
grant select, insert, update, delete on public.messages to anon, authenticated;

alter table public.messages replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
exception
  when undefined_object then null;
end;
$$;

insert into public.tenants (type, name, phone, address, tax_id, license, active)
values
  ('company', 'شركة الشفاء', '01123456789', 'الرياض، حي العليا', '310123456700003', 'PH-C-2026-001', true),
  ('pharmacy', 'صيدلية النور', '01234567890', 'جدة، حي الروضة', '310987654300003', 'PH-P-2026-002', true)
on conflict (name) do update set
  type = excluded.type,
  phone = excluded.phone,
  address = excluded.address,
  tax_id = excluded.tax_id,
  license = excluded.license,
  active = excluded.active;

insert into public.users (tenant_id, username, password, name, role, active)
values
  (null, 'super', 'super123', 'مدير المنصة', 'super', true),
  ((select id from public.tenants where name = 'شركة الشفاء'), 'shifa', '123456', 'مدير شركة الشفاء', 'admin', true),
  ((select id from public.tenants where name = 'صيدلية النور'), 'nour', '123456', 'مدير صيدلية النور', 'admin', true)
on conflict (username) do update set
  tenant_id = excluded.tenant_id,
  password = excluded.password,
  name = excluded.name,
  role = excluded.role,
  active = excluded.active;

insert into public.products (
  tenant_id, name, barcode, category, unit, purchase_price, sale_price, min_stock, active
)
values
  ((select id from public.tenants where name = 'شركة الشفاء'), 'بنادول إكسترا', '5000158107892', 'مسكنات', 'علبة', 12.00, 18.50, 20, true),
  ((select id from public.tenants where name = 'شركة الشفاء'), 'أوجمنتين 625', '5000283009441', 'مضادات حيوية', 'علبة', 51.00, 68.00, 10, true),
  ((select id from public.tenants where name = 'شركة الشفاء'), 'فيتامين د3 1000 وحدة', '8712561484171', 'فيتامينات', 'علبة', 21.00, 32.00, 15, true),
  ((select id from public.tenants where name = 'شركة الشفاء'), 'كونجستال', '6223001360131', 'برد وحساسية', 'علبة', 14.50, 22.00, 18, true),
  ((select id from public.tenants where name = 'شركة الشفاء'), 'كتافلام 50', '6223001360407', 'مسكنات', 'علبة', 19.00, 28.00, 12, true),
  ((select id from public.tenants where name = 'صيدلية النور'), 'بروفين 400', '6281007021465', 'مسكنات', 'علبة', 10.00, 16.00, 25, true),
  ((select id from public.tenants where name = 'صيدلية النور'), 'زيرتك 10', '3574660258234', 'حساسية', 'علبة', 16.00, 24.00, 12, true),
  ((select id from public.tenants where name = 'صيدلية النور'), 'أوميبرازول 20', '6281100290119', 'جهاز هضمي', 'علبة', 18.00, 29.00, 15, true)
on conflict (barcode) do update set
  tenant_id = excluded.tenant_id,
  name = excluded.name,
  category = excluded.category,
  unit = excluded.unit,
  purchase_price = excluded.purchase_price,
  sale_price = excluded.sale_price,
  min_stock = excluded.min_stock,
  active = excluded.active;

insert into public.batches (tenant_id, product_id, batch_no, expiry_date, quantity, cost)
select t.id, p.id, seed.batch_no, seed.expiry_date, seed.quantity, seed.cost
from (
  values
    ('شركة الشفاء', '5000158107892', 'PX2401', date '2026-10-05', 120, 12.00::numeric),
    ('شركة الشفاء', '5000158107892', 'PX2507', date '2028-07-31', 180, 12.50::numeric),
    ('شركة الشفاء', '5000283009441', 'AG2502', date '2027-02-28', 54, 51.00::numeric),
    ('شركة الشفاء', '8712561484171', 'D32401', date '2026-11-15', 90, 21.00::numeric),
    ('شركة الشفاء', '6223001360131', 'CG2505', date '2028-05-31', 75, 14.50::numeric),
    ('شركة الشفاء', '6223001360407', 'CF2411', date '2027-11-30', 65, 19.00::numeric),
    ('صيدلية النور', '6281007021465', 'IB2409', date '2026-09-30', 140, 10.00::numeric),
    ('صيدلية النور', '3574660258234', 'ZT2503', date '2027-03-31', 60, 16.00::numeric),
    ('صيدلية النور', '6281100290119', 'OM2506', date '2029-06-30', 110, 18.00::numeric)
) as seed(tenant_name, barcode, batch_no, expiry_date, quantity, cost)
join public.tenants t on t.name = seed.tenant_name
join public.products p on p.tenant_id = t.id and p.barcode = seed.barcode
on conflict (tenant_id, product_id, batch_no) do update set
  expiry_date = excluded.expiry_date,
  quantity = excluded.quantity,
  cost = excluded.cost;

insert into public.movements (
  id, tenant_id, product_id, batch_id, batch_no, type, quantity, reference, note
)
select
  '00000000-0000-4000-8000-000000000101'::uuid,
  t.id,
  p.id,
  b.id,
  b.batch_no,
  'in',
  120,
  'OPEN-SHF-001',
  'رصيد افتتاحي'
from public.tenants t
join public.products p on p.tenant_id = t.id and p.barcode = '5000158107892'
join public.batches b on b.product_id = p.id and b.batch_no = 'PX2401'
where t.name = 'شركة الشفاء'
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  product_id = excluded.product_id,
  batch_id = excluded.batch_id,
  batch_no = excluded.batch_no,
  type = excluded.type,
  quantity = excluded.quantity,
  reference = excluded.reference,
  note = excluded.note;

insert into public.invoices (
  tenant_id, invoice_no, type, party_id, party_name, items, subtotal, discount, tax, total, user_name
)
select
  shifa.id,
  'INV-SHF-001',
  'sale',
  nour.id,
  nour.name,
  jsonb_build_array(jsonb_build_object(
    'product_id', p.id,
    'name', p.name,
    'barcode', p.barcode,
    'quantity', 2,
    'price', 18.50
  )),
  37.00,
  0,
  5.55,
  42.55,
  'shifa'
from public.tenants shifa
join public.tenants nour on nour.name = 'صيدلية النور'
join public.products p on p.tenant_id = shifa.id and p.barcode = '5000158107892'
where shifa.name = 'شركة الشفاء'
on conflict (tenant_id, invoice_no) do update set
  type = excluded.type,
  party_id = excluded.party_id,
  party_name = excluded.party_name,
  items = excluded.items,
  subtotal = excluded.subtotal,
  discount = excluded.discount,
  tax = excluded.tax,
  total = excluded.total,
  user_name = excluded.user_name;

insert into public.purchase_orders (
  order_no, from_tenant, to_tenant, items, total, status, note
)
select
  'PO-SHF-001',
  shifa.id,
  nour.id,
  jsonb_build_array(jsonb_build_object(
    'product_id', p.id,
    'name', p.name,
    'barcode', p.barcode,
    'quantity', 20,
    'cost', 12.00
  )),
  240.00,
  'approved',
  'طلب توريد تجريبي'
from public.tenants shifa
join public.tenants nour on nour.name = 'صيدلية النور'
join public.products p on p.tenant_id = shifa.id and p.barcode = '5000158107892'
where shifa.name = 'شركة الشفاء'
on conflict (from_tenant, order_no) do update set
  to_tenant = excluded.to_tenant,
  items = excluded.items,
  total = excluded.total,
  status = excluded.status,
  note = excluded.note;

insert into public.messages (id, from_tenant, to_tenant, sender_user, text, read)
select
  '00000000-0000-4000-8000-000000000201'::uuid,
  shifa.id,
  nour.id,
  'shifa',
  'تمت الموافقة على طلب التوريد.',
  false
from public.tenants shifa
join public.tenants nour on nour.name = 'صيدلية النور'
where shifa.name = 'شركة الشفاء'
on conflict (id) do update set
  from_tenant = excluded.from_tenant,
  to_tenant = excluded.to_tenant,
  sender_user = excluded.sender_user,
  text = excluded.text,
  read = excluded.read;
