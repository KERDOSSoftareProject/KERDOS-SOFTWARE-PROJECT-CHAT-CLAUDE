-- KERDOS migration 003: industry and organization vocabulary.
--
-- The matching engine ships with a small base vocabulary and learns the
-- rest from data. industry_vocabulary holds each industry's starter pack
-- (global, read-only to orgs); org_vocabulary is the organization's own
-- editable copy, seeded from its industry when one is chosen and grown by
-- its own corrections in Admin. Four kinds of row:
--   unit       term -> canonical unit code   ("sheets" -> SHEET, "bdft" -> BF)
--   packaging  term is a container word      ("bundle")
--   stopword   term carries no meaning       ("premium")
--   synonym    term -> canonical word         ("chix" -> chicken)

create table if not exists industry_vocabulary (
  id          uuid primary key default gen_random_uuid(),
  industry    text not null,
  kind        text not null check (kind in ('unit','packaging','stopword','synonym')),
  term        text not null,
  canonical   text,
  created_at  timestamptz not null default now(),
  unique (industry, kind, term)
);

create table if not exists org_vocabulary (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  kind             text not null check (kind in ('unit','packaging','stopword','synonym')),
  term             text not null,
  canonical        text,
  created_at       timestamptz not null default now(),
  unique (organization_id, kind, term)
);

alter table industry_vocabulary enable row level security;
alter table org_vocabulary      enable row level security;

-- Industry packs: readable by any signed-in user, like industry_templates.
create policy "industry_vocabulary: read" on industry_vocabulary
  for select to authenticated using (true);

-- Org vocabulary: every member reads; owners and managers write.
create policy "org_vocabulary: members read" on org_vocabulary
  for select to authenticated using (
    exists (select 1 from organization_members m
            where m.organization_id = org_vocabulary.organization_id
              and m.user_id = auth.uid())
  );

create policy "org_vocabulary: managers write" on org_vocabulary
  for all to authenticated
  using (
    exists (select 1 from organization_members m
            where m.organization_id = org_vocabulary.organization_id
              and m.user_id = auth.uid()
              and m.role in ('owner','manager'))
  )
  with check (
    exists (select 1 from organization_members m
            where m.organization_id = org_vocabulary.organization_id
              and m.user_id = auth.uid()
              and m.role in ('owner','manager'))
  );

-- The holding category (where unmatched items wait for a person) is
-- identified by a flag, not by its name, so an org may rename it.
alter table catalog_categories add column if not exists is_holding_pen boolean not null default false;
update catalog_categories set is_holding_pen = true where name = 'Uncategorized' and not is_holding_pen;
