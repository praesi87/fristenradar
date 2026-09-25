-- =====================================================================================
-- Fristenradar Rhein-Main – Datenbankschema für Supabase (PostgreSQL)
-- Einmalig im Supabase-Dashboard unter "SQL Editor" komplett ausführen.
-- Das Skript ist wiederholbar (idempotent): erneutes Ausführen zerstört keine Daten.
--
-- Sicherheit:
--   * Row Level Security auf allen Tabellen. Lesen/Schreiben nur für angemeldete Nutzer,
--     deren E-Mail in public.erlaubte_nutzer steht (Freischaltliste, nur per SQL pflegbar).
--   * Anonyme Zugriffe (ohne Login) sehen keine Daten.
--   * Einträge können nicht gelöscht werden (nur archiviert). Jede Änderung landet in public.historie.
--   * Die Spur (A = Register, B = Marktradar) ist nach dem Anlegen unveränderlich.
-- =====================================================================================

-- ------------------------------------------------------------------ Freischaltung
-- Zwei Wege, beide nur über den SQL Editor pflegbar (bewusst keine Policies):
--  1. erlaubte_domains: jede Person mit Firmen-Adresse dieser Domain, die sich über MICROSOFT (Entra ID) anmeldet.
--     Die Bindung an den Microsoft-Login ist Absicht: Eine E-Mail-Adresse allein beweist nichts, ein
--     Microsoft-Firmenkonto aus dem eigenen Mandanten schon.
--  2. erlaubte_nutzer: einzelne Adressen (z. B. Externe oder Notfall-Zugang mit Passwort), egal welcher Login.
create table if not exists public.erlaubte_nutzer (
  email text primary key,
  angelegt_am timestamptz not null default now()
);
alter table public.erlaubte_nutzer enable row level security;

create table if not exists public.erlaubte_domains (
  domain text primary key check (domain = lower(domain) and domain !~ '@'),
  angelegt_am timestamptz not null default now()
);
alter table public.erlaubte_domains enable row level security;

create or replace function public.ist_freigeschaltet() returns boolean
language sql stable security definer set search_path = public as $$
  with j as (
    select lower(coalesce(auth.jwt() ->> 'email', '')) as email,
           coalesce(auth.jwt() -> 'app_metadata', '{}'::jsonb) as meta
  )
  select exists (select 1 from public.erlaubte_nutzer n, j where lower(n.email) = j.email and j.email <> '')
      or exists (
        select 1 from public.erlaubte_domains d, j
        where split_part(j.email, '@', 2) = d.domain
          and (j.meta ->> 'provider' = 'azure' or coalesce(j.meta -> 'providers', '[]'::jsonb) ? 'azure')
      );
$$;
revoke all on function public.ist_freigeschaltet() from public;
grant execute on function public.ist_freigeschaltet() to authenticated;

-- Hält das kostenlose Supabase-Projekt aktiv (GitHub Action "keepalive"). Liefert keine Daten.
create or replace function public.ping() returns text language sql stable as $$ select 'ok'::text $$;
grant execute on function public.ping() to anon, authenticated;

-- ------------------------------------------------------------------ Objekte
create table if not exists public.objekte (
  id               bigint generated always as identity primary key,
  spur             text not null check (spur in ('A', 'B')),
  projekt          text not null check (length(btrim(projekt)) > 0),
  adresse          text not null default '',
  plz              text not null default '',
  ort              text not null default '',
  region           text not null default 'Rhein-Main',
  leistung         text not null default '',
  auftragnehmer    text not null default '',
  rolle_an         text not null default '',
  vertragsart      text not null default 'unklar' check (vertragsart in ('VOB/B', 'BGB', 'unklar')),
  datum            text not null default '' check (datum ~ '^([0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?)?$'),
  datumsart        text not null default '',
  bezugsart        text not null default 'fertigstellung' check (bezugsart in ('abnahme', 'fertigstellung', 'zuschlag')),
  projektgroesse   text not null default '' check (projektgroesse in ('', 'klein', 'mittel', 'gross')),
  fristende        text not null default '' check (fristende ~ '^([0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?)?$'),
  bauherr          text not null default '',
  ansprechpartner  text not null default '',
  property_manager text not null default '',
  sicherheit       text not null default '',
  status           text not null default '',
  konfidenz        text not null default '' check (konfidenz in ('', 'hoch', 'mittel', 'niedrig')),
  quelle           text not null default '',
  quelle_titel     text not null default '',
  quelle_datum     text not null default '',
  anrede           text not null default '',
  kontakt_funktion text not null default '',
  bemerkung        text not null default '',
  lat              double precision check (lat is null or lat between -90 and 90),
  lon              double precision check (lon is null or lon between -180 and 180),
  geo_genauigkeit  text not null default '' check (geo_genauigkeit in ('', 'adresse', 'ort', 'manuell')),
  geo_abfrage      text not null default '',
  archiviert       boolean not null default false,
  erstellt_am      timestamptz not null default now(),
  erstellt_von     text not null default '',
  geaendert_am     timestamptz not null default now(),
  geaendert_von    text not null default '',
  -- Quellenzwang im Marktradar: ohne zitierfähige Fundstelle kein Eintrag
  constraint quelle_spur_b check (spur <> 'B' or length(btrim(quelle)) > 0),
  -- "Abnahme" belegen öffentliche Quellen nie – Spur A vorbehalten
  constraint abnahme_nur_spur_a check (spur = 'A' or bezugsart <> 'abnahme')
);
create index if not exists objekte_spur_idx on public.objekte (spur) where not archiviert;

-- ------------------------------------------------------------------ Historie (Audit)
create table if not exists public.historie (
  id          bigint generated always as identity primary key,
  objekt_id   bigint not null references public.objekte (id),
  zeitpunkt   timestamptz not null default now(),
  nutzer      text not null default '',
  aktion      text not null check (aktion in ('angelegt', 'geaendert')),
  aenderungen jsonb not null default '{}'::jsonb
);
create index if not exists historie_objekt_idx on public.historie (objekt_id, zeitpunkt desc);

create or replace function public.aktueller_nutzer() returns text language sql stable as $$
  select coalesce(nullif(auth.jwt() ->> 'email', ''), current_user::text);
$$;

create or replace function public.objekte_stempel() returns trigger
language plpgsql set search_path = public as $$
begin
  new.geaendert_am := now();
  new.geaendert_von := public.aktueller_nutzer();
  if tg_op = 'INSERT' then
    new.erstellt_am := now();
    new.erstellt_von := new.geaendert_von;
  else
    -- unveränderliche Felder
    new.id := old.id;
    new.spur := old.spur;
    new.erstellt_am := old.erstellt_am;
    new.erstellt_von := old.erstellt_von;
  end if;
  return new;
end $$;

create or replace function public.objekte_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  alt jsonb;
  neu jsonb := to_jsonb(new);
  diff jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'INSERT' then
    insert into public.historie (objekt_id, nutzer, aktion, aenderungen)
    values (new.id, new.erstellt_von, 'angelegt', neu - 'erstellt_am' - 'geaendert_am' - 'erstellt_von' - 'geaendert_von');
    return new;
  end if;
  alt := to_jsonb(old);
  for k in select jsonb_object_keys(neu) loop
    if k not in ('geaendert_am', 'geaendert_von') and (alt -> k) is distinct from (neu -> k) then
      diff := diff || jsonb_build_object(k, jsonb_build_object('alt', alt -> k, 'neu', neu -> k));
    end if;
  end loop;
  if diff <> '{}'::jsonb then
    insert into public.historie (objekt_id, nutzer, aktion, aenderungen)
    values (new.id, new.geaendert_von, 'geaendert', diff);
  end if;
  return new;
end $$;

drop trigger if exists objekte_stempel on public.objekte;
create trigger objekte_stempel before insert or update on public.objekte
  for each row execute function public.objekte_stempel();
drop trigger if exists objekte_audit on public.objekte;
create trigger objekte_audit after insert or update on public.objekte
  for each row execute function public.objekte_audit();

-- ------------------------------------------------------------------ Austragungen (§ 7 UWG / Widerspruch)
create table if not exists public.austragungen (
  id           bigint generated always as identity primary key,
  name         text not null check (length(btrim(name)) > 0),
  notiz        text not null default '',
  erstellt_am  timestamptz not null default now(),
  erstellt_von text not null default public.aktueller_nutzer()
);

-- ------------------------------------------------------------------ Einstellungen (Team-weit, z. B. Büroadresse)
create table if not exists public.einstellungen (
  schluessel   text primary key,
  wert         jsonb not null,
  geaendert_am timestamptz not null default now(),
  geaendert_von text not null default public.aktueller_nutzer()
);

-- ------------------------------------------------------------------ Rechte
alter table public.objekte       enable row level security;
alter table public.historie      enable row level security;
alter table public.austragungen  enable row level security;
alter table public.einstellungen enable row level security;

-- Supabase vergibt auf dem Schema public standardmäßig alle Rechte an anon/authenticated.
-- Deshalb erst alles entziehen, dann genau das Nötige erlauben (kein DELETE, Historie nur lesen).
revoke all on public.objekte, public.historie, public.austragungen, public.einstellungen, public.erlaubte_nutzer, public.erlaubte_domains from anon, authenticated;
grant select, insert, update on public.objekte to authenticated;
grant select on public.historie to authenticated;
grant select, insert on public.austragungen to authenticated;
grant select, insert, update on public.einstellungen to authenticated;

drop policy if exists objekte_lesen on public.objekte;
create policy objekte_lesen on public.objekte for select to authenticated using (public.ist_freigeschaltet());
drop policy if exists objekte_anlegen on public.objekte;
create policy objekte_anlegen on public.objekte for insert to authenticated with check (public.ist_freigeschaltet());
drop policy if exists objekte_aendern on public.objekte;
create policy objekte_aendern on public.objekte for update to authenticated using (public.ist_freigeschaltet()) with check (public.ist_freigeschaltet());

drop policy if exists historie_lesen on public.historie;
create policy historie_lesen on public.historie for select to authenticated using (public.ist_freigeschaltet());

drop policy if exists austragungen_lesen on public.austragungen;
create policy austragungen_lesen on public.austragungen for select to authenticated using (public.ist_freigeschaltet());
drop policy if exists austragungen_anlegen on public.austragungen;
create policy austragungen_anlegen on public.austragungen for insert to authenticated with check (public.ist_freigeschaltet());

drop policy if exists einstellungen_lesen on public.einstellungen;
create policy einstellungen_lesen on public.einstellungen for select to authenticated using (public.ist_freigeschaltet());
drop policy if exists einstellungen_anlegen on public.einstellungen;
create policy einstellungen_anlegen on public.einstellungen for insert to authenticated with check (public.ist_freigeschaltet());
drop policy if exists einstellungen_aendern on public.einstellungen;
create policy einstellungen_aendern on public.einstellungen for update to authenticated using (public.ist_freigeschaltet()) with check (public.ist_freigeschaltet());

-- =====================================================================================
-- Danach einmalig die Firmen-Domain freischalten (gilt für Microsoft-Login), z. B.:
--   insert into public.erlaubte_domains (domain) values ('firma.de');
-- Optional einzelne Adressen (Externe, Passwort-Login):
--   insert into public.erlaubte_nutzer (email) values ('vorname.nachname@beispiel.de');
-- =====================================================================================
