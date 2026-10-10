-- supabase/schema.sql
-- Status: rein dokumentarisch – das eigentliche Schema (perfumes, wear_log,
-- wishlist, user_settings) existiert bereits im Supabase-Projekt inkl. RLS.
-- Es sind keine manuellen DDL-Schritte mehr nötig.
--
-- Migration-Button (Sammlung → "☁ Migrieren") schreibt in:
--   perfumes       : Sammlung + notes (Tags), fill_level, price_ml, declutter_status
--   wear_log       : Trage-Historie (perfume_id + worn_at)
--   wishlist       : Wunschliste (data als JSONB)
--   user_settings  : prefs, user_note_prefs, user_family_prefs, onboarded
-- Alle Tabellen nutzen user_id uuid default auth.uid() + Row Level Security,
-- sodass ein Benutzer ausschließlich seine eigenen Zeilen lesen/schreiben kann.
--
-- Ein früher geplanter JSON-Backup-Table "collection_backups" wurde verworfen.

-- 1) Tabelle: ein Backup-Strip pro Benutzer (Upsert auf user_id)
create table if not exists public.collection_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null,
  item_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- 2) Row Level Security: nur der eigene Benutzer darf auf seine Zeile zugreifen
alter table public.collection_backups enable row level security;

drop policy if exists "collection_backups_select_own" on public.collection_backups;
create policy "collection_backups_select_own"
  on public.collection_backups for select
  using (auth.uid() = user_id);

drop policy if exists "collection_backups_insert_own" on public.collection_backups;
create policy "collection_backups_insert_own"
  on public.collection_backups for insert
  with check (auth.uid() = user_id);

drop policy if exists "collection_backups_update_own" on public.collection_backups;
create policy "collection_backups_update_own"
  on public.collection_backups for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "collection_backups_delete_own" on public.collection_backups;
create policy "collection_backups_delete_own"
  on public.collection_backups for delete
  using (auth.uid() = user_id);

-- 3) updated_at automatisch setzen
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists collection_backups_set_updated_at on public.collection_backups;
create trigger collection_backups_set_updated_at
  before update on public.collection_backups
  for each row execute function public.set_updated_at();