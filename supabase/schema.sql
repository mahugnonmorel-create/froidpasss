-- =====================================================================
-- FroidPass — schéma de base de données Supabase
-- À coller UNE FOIS dans Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------- TABLES ----------
create table if not exists public.techniciens (
  id              uuid primary key references auth.users(id) on delete cascade,
  nom             text not null default '',
  entreprise      text default '',
  whatsapp        text default '',
  ville           text default '',
  offre           text not null default 'decouverte'
                  check (offre in ('decouverte','solo','pro','equipe')),
  fondateur       boolean not null default false,
  fin_abonnement  date,
  created_at      timestamptz not null default now()
);

create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  technicien_id  uuid not null default auth.uid() references public.techniciens(id) on delete cascade,
  nom            text not null,
  contact        text default '',
  whatsapp       text default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.equipements (
  id             uuid primary key default gen_random_uuid(),
  technicien_id  uuid not null default auth.uid() references public.techniciens(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  emplacement    text not null,
  type           text not null check (type in ('split','cassette','groupe','chambre','vitrine')),
  environnement  text not null default 'cotier' check (environnement in ('cotier','interieur')),
  marque         text default '',
  puissance      text default '',
  fluide         text default '',
  date_pose      date not null default current_date,
  code_public    text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,12),
  created_at     timestamptz not null default now()
);

create table if not exists public.interventions (
  id             uuid primary key default gen_random_uuid(),
  technicien_id  uuid not null default auth.uid() references public.techniciens(id) on delete cascade,
  equipement_id  uuid not null references public.equipements(id) on delete cascade,
  date           date not null default current_date,
  type           text not null default 'preventif' check (type in ('preventif','curatif')),
  hp             numeric, bp numeric, intensite numeric,
  t_soufflage    numeric, t_reprise numeric,
  observations   text default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.paiements (
  id             uuid primary key default gen_random_uuid(),
  technicien_id  uuid not null references public.techniciens(id) on delete cascade,
  fedapay_id     bigint unique,
  plan           text not null,
  montant        integer not null,
  statut         text not null default 'en_attente' check (statut in ('en_attente','approuve','echoue')),
  created_at     timestamptz not null default now()
);

create index if not exists idx_clients_tech on public.clients(technicien_id);
create index if not exists idx_eq_tech on public.equipements(technicien_id);
create index if not exists idx_int_eq on public.interventions(equipement_id);

-- ---------- PROFIL CRÉÉ AUTOMATIQUEMENT À L'INSCRIPTION ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.techniciens (id, nom, whatsapp, ville)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'nom',''),
          coalesce(new.raw_user_meta_data->>'whatsapp',''),
          coalesce(new.raw_user_meta_data->>'ville',''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- QUOTA D'ÉQUIPEMENTS SELON L'OFFRE ----------
create or replace function public.offre_active(t public.techniciens)
returns text language sql stable as $$
  select case when t.offre <> 'decouverte' and t.fin_abonnement is not null
                   and t.fin_abonnement >= current_date
              then t.offre else 'decouverte' end
$$;

create or replace function public.verifier_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.techniciens; o text; n int; lim int;
begin
  select * into t from public.techniciens where id = new.technicien_id;
  o := public.offre_active(t);
  lim := case o when 'decouverte' then 10 when 'solo' then 60 else 100000 end;
  select count(*) into n from public.equipements where technicien_id = new.technicien_id;
  if n >= lim then
    raise exception 'QUOTA: votre offre % permet % équipements. Passez à l''offre supérieure.', o, lim;
  end if;
  return new;
end $$;

drop trigger if exists trg_quota on public.equipements;
create trigger trg_quota before insert on public.equipements
for each row execute function public.verifier_quota();

-- ---------- SÉCURITÉ : chaque technicien ne voit que ses données ----------
alter table public.techniciens  enable row level security;
alter table public.clients      enable row level security;
alter table public.equipements  enable row level security;
alter table public.interventions enable row level security;
alter table public.paiements    enable row level security;

drop policy if exists tech_select on public.techniciens;
create policy tech_select on public.techniciens for select using (id = auth.uid());
drop policy if exists tech_update on public.techniciens;
create policy tech_update on public.techniciens for update using (id = auth.uid()) with check (id = auth.uid());
-- Le technicien ne peut modifier QUE ses informations, jamais son offre ni sa date d'abonnement
revoke update on public.techniciens from authenticated, anon;
grant update (nom, entreprise, whatsapp, ville) on public.techniciens to authenticated;

drop policy if exists own_clients on public.clients;
create policy own_clients on public.clients for all
  using (technicien_id = auth.uid()) with check (technicien_id = auth.uid());

drop policy if exists own_eq on public.equipements;
create policy own_eq on public.equipements for all
  using (technicien_id = auth.uid())
  with check (technicien_id = auth.uid()
              and exists (select 1 from public.clients c where c.id = client_id and c.technicien_id = auth.uid()));

drop policy if exists own_int on public.interventions;
create policy own_int on public.interventions for all
  using (technicien_id = auth.uid())
  with check (technicien_id = auth.uid()
              and exists (select 1 from public.equipements e where e.id = equipement_id and e.technicien_id = auth.uid()));

drop policy if exists own_pay on public.paiements;
create policy own_pay on public.paiements for select using (technicien_id = auth.uid());
-- Aucune écriture de paiement depuis le navigateur : seul le serveur (clé service_role) écrit.

-- ---------- CARNET PUBLIC (page du QR, sans connexion) ----------
-- N'expose JAMAIS le téléphone du client final.
create or replace function public.get_carnet(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'equipement', json_build_object(
        'emplacement', e.emplacement, 'type', e.type, 'environnement', e.environnement,
        'marque', e.marque, 'puissance', e.puissance, 'fluide', e.fluide, 'date_pose', e.date_pose),
    'client', c.nom,
    'technicien', json_build_object('nom', t.nom, 'entreprise', t.entreprise, 'whatsapp', t.whatsapp),
    'interventions', coalesce((
        select json_agg(json_build_object('date', i.date, 'type', i.type, 'observations', i.observations)
                        order by i.date desc)
        from public.interventions i where i.equipement_id = e.id), '[]'::json)
  )
  from public.equipements e
  join public.clients c on c.id = e.client_id
  join public.techniciens t on t.id = e.technicien_id
  where e.code_public = p_code
$$;
revoke all on function public.get_carnet(text) from public;
grant execute on function public.get_carnet(text) to anon, authenticated;
