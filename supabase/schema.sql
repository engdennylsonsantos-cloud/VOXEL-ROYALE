create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  is_vip boolean not null default false,
  vip_until timestamptz,
  equipped_skin_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.skins (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  rarity text not null default 'common',
  description text not null default '',
  price_coins integer not null default 0,
  price_brl integer not null default 0,
  is_vip_only boolean not null default false,
  is_active boolean not null default true,
  preview_color text not null default '#7dd3fc',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_skins (
  user_id uuid not null references auth.users (id) on delete cascade,
  skin_id uuid not null references public.skins (id) on delete cascade,
  source text not null default 'purchase',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, skin_id)
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'stripe',
  provider_reference text,
  kind text not null,
  target_id text,
  status text not null default 'pending',
  amount_brl integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'stripe',
  plan_code text not null default 'vip',
  status text not null default 'inactive',
  current_period_end timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add constraint profiles_equipped_skin_fkey
  foreign key (equipped_skin_id) references public.skins (id) on delete set null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.skins enable row level security;
alter table public.user_skins enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "skins_are_public" on public.skins;
create policy "skins_are_public"
on public.skins
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "user_skins_select_own" on public.user_skins;
create policy "user_skins_select_own"
on public.user_skins
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "purchase_orders_select_own" on public.purchase_orders;
create policy "purchase_orders_select_own"
on public.purchase_orders
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
on public.subscriptions
for select
to authenticated
using (auth.uid() = user_id);

insert into public.skins (slug, name, rarity, description, price_brl, preview_color)
values
  ('default-ranger', 'Ranger Azul', 'common', 'Visual base para todos os jogadores.', 0, '#38bdf8'),
  ('ember-ops', 'Ember Ops', 'rare', 'Traje laranja com brilho quente.', 1290, '#f97316'),
  ('neon-shadow', 'Neon Shadow', 'epic', 'Visual escuro com detalhes em neon.', 2490, '#8b5cf6')
on conflict (slug) do update
set
  name = excluded.name,
  rarity = excluded.rarity,
  description = excluded.description,
  price_brl = excluded.price_brl,
  preview_color = excluded.preview_color;
