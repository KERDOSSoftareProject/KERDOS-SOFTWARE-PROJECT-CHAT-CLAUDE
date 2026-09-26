-- KERDOS DATABASE UPDATE
-- Generated from knowledge/migration_003 through migration_012 (008 is unused and intentionally excluded).
-- Do not hand-edit this combined file; update the individual migration and regenerate.

begin;

-- ============================================================
-- migration_003_vocabulary.sql
-- ============================================================

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

-- Fail during migration, rather than on the first live RPC call, when an
-- older base schema is missing a table column required by migrations 003-007.
do $$
declare
  v_missing text;
begin
  select string_agg(format('%I.%I', required.table_name, required.column_name), ', ')
    into v_missing
  from (values
    ('organizations','id'),
    ('organization_members','organization_id'),('organization_members','user_id'),('organization_members','role'),
    ('catalog_categories','name'),
    ('vendors','id'),('vendors','organization_id'),
    ('vendor_items','id'),('vendor_items','organization_id'),('vendor_items','vendor_id'),
    ('vendor_items','vendor_item_code'),('vendor_items','description'),('vendor_items','pack_size'),
    ('vendor_items','price'),('vendor_items','last_updated'),('vendor_items','price_source'),
    ('price_history','vendor_item_id'),('price_history','organization_id'),('price_history','price'),
    ('price_history','source'),('price_history','effective_date'),
    ('invite_codes','code'),('invite_codes','organization_id'),('invite_codes','role'),
    ('invite_codes','used_by'),('invite_codes','used_at'),
    ('invoices','id'),('invoices','organization_id'),('invoices','vendor_id'),
    ('invoices','total_amount'),('invoices','raw_text'),('invoices','invoice_date'),
    ('invoices','invoice_number'),('invoices','status'),('invoices','file_path'),('invoices','file_name'),
    ('invoice_lines','invoice_id'),('invoice_lines','vendor_item_id'),('invoice_lines','vendor_item_code'),
    ('invoice_lines','description'),('invoice_lines','unit_price'),('invoice_lines','line_total'),
    ('invoice_lines','price_variance'),('invoice_lines','match_confidence'),('invoice_lines','match_method'),
    ('catalog_items','id'),('catalog_items','organization_id'),
    ('item_mappings','organization_id'),('item_mappings','catalog_item_id'),('item_mappings','vendor_item_id'),
    ('item_mappings','confidence_score'),('item_mappings','match_method'),('item_mappings','comparison_track')
  ) as required(table_name,column_name)
  where not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid=pg_catalog.to_regclass(format('public.%I',required.table_name))
      and a.attname=required.column_name and a.attnum>0 and not a.attisdropped
  );
  if v_missing is not null then
    raise exception 'KERDOS base schema is missing required columns: %',v_missing;
  end if;
end;
$$;

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
drop policy if exists "industry_vocabulary: read" on industry_vocabulary;
create policy "industry_vocabulary: read" on industry_vocabulary
  for select to authenticated using (true);

-- Org vocabulary: every member reads; owners and managers write.
drop policy if exists "org_vocabulary: members read" on org_vocabulary;
create policy "org_vocabulary: members read" on org_vocabulary
  for select to authenticated using (
    exists (select 1 from organization_members m
            where m.organization_id = org_vocabulary.organization_id
              and m.user_id = auth.uid())
  );

drop policy if exists "org_vocabulary: managers write" on org_vocabulary;
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

-- ============================================================
-- migration_004_context_and_price_lifecycle.sql
-- ============================================================

-- KERDOS 004: run AFTER migration_003_vocabulary.sql.
-- Never delete historical quoted prices. Current vendor_items fields are a
-- materialized view of the latest eligible quote; price_history is append only.

alter table vendor_items add column if not exists price_expired_at timestamptz;
alter table vendor_items add column if not exists price_quote_valid_until date;

alter table price_history add column if not exists quote_valid_until date;
alter table price_history add column if not exists source_file_path text;
alter table price_history add column if not exists source_file_name text;
alter table price_history add column if not exists source_description text;
alter table price_history add column if not exists source_line text;
alter table price_history add column if not exists source_document_id uuid;

-- The untouched source text and file address belong to the organisation;
-- metadata and extracted rows are never substituted for the actual source.
create table if not exists import_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vendor_id uuid not null references vendors(id) on delete cascade,
  document_kind text not null check (document_kind in ('pricelist','invoice')),
  fingerprint text not null,
  original_text text not null,
  file_name text,
  file_path text,
  status text not null default 'processing' check (status in ('processing','complete','partial')),
  created_at timestamptz not null default now(),
  unique(organization_id,vendor_id,document_kind,fingerprint)
);

do $$ begin
  if not exists(select 1 from pg_constraint
                where conname='price_history_source_document_fk'
                  and conrelid='public.price_history'::regclass) then
    alter table price_history add constraint price_history_source_document_fk
      foreign key (source_document_id) references import_documents(id) on delete set null;
  end if;
end $$;

alter table import_documents enable row level security;
drop policy if exists "import_documents: members read" on import_documents;
create policy "import_documents: members read" on import_documents
  for select to authenticated using (
    exists(select 1 from organization_members m where m.organization_id=import_documents.organization_id and m.user_id=auth.uid())
  );
drop policy if exists "import_documents: managers insert" on import_documents;
create policy "import_documents: managers insert" on import_documents
  for insert to authenticated with check (
    exists(select 1 from organization_members m where m.organization_id=import_documents.organization_id and m.user_id=auth.uid() and m.role in ('owner','manager'))
  );
drop policy if exists "import_documents: managers update" on import_documents;
create policy "import_documents: managers update" on import_documents
  for update to authenticated using (
    exists(select 1 from organization_members m where m.organization_id=import_documents.organization_id and m.user_id=auth.uid() and m.role in ('owner','manager'))
  ) with check (
    exists(select 1 from organization_members m where m.organization_id=import_documents.organization_id and m.user_id=auth.uid() and m.role in ('owner','manager'))
  );
create index if not exists import_documents_by_vendor on import_documents(organization_id,vendor_id,created_at desc);
create index if not exists price_history_for_invoice on price_history(organization_id,vendor_item_id,effective_date desc);

-- ============================================================
-- migration_005_atomic_price_import.sql
-- ============================================================

-- KERDOS 005: atomic current-price + history write.
-- Run after migration_004_context_and_price_lifecycle.sql.
-- Identity and pack verification remain deterministic KERDOS-core decisions;
-- this function only guarantees that accepted persistence is all-or-nothing.

create or replace function kerdos_apply_price_quote(
  p_vendor_item_id uuid,
  p_organization_id uuid,
  p_vendor_id uuid,
  p_vendor_item_code text,
  p_description text,
  p_pack_size text,
  p_price numeric,
  p_price_unavailable boolean,
  p_effective_date timestamptz,
  p_quote_valid_until date,
  p_source_file_path text,
  p_source_file_name text,
  p_source_line text,
  p_source_document_id uuid
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_item_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from organization_members m
    where m.organization_id=p_organization_id and m.user_id=auth.uid()
      and m.role in ('owner','manager')
  ) then raise exception 'Owner or manager access is required for this organization'; end if;
  if not exists (
    select 1 from vendors v where v.id=p_vendor_id and v.organization_id=p_organization_id
  ) then raise exception 'Vendor is outside the requested organization'; end if;
  if p_source_document_id is not null and not exists (
    select 1 from import_documents d
    where d.id=p_source_document_id and d.organization_id=p_organization_id and d.vendor_id=p_vendor_id
  ) then raise exception 'Source document is outside the requested organization/vendor'; end if;
  if p_effective_date is null then raise exception 'A price quotation requires an effective date'; end if;
  if p_price_unavailable is not true and (p_price is null or p_price <= 0) then
    raise exception 'A current quotation requires a positive price';
  end if;

  if p_vendor_item_id is null then
    insert into vendor_items(
      organization_id,vendor_id,vendor_item_code,description,pack_size,price,
      last_updated,price_source,price_unavailable,price_expired_at,price_quote_valid_until
    ) values (
      p_organization_id,p_vendor_id,p_vendor_item_code,p_description,p_pack_size,p_price,
      p_effective_date,'price_list',p_price_unavailable or p_pack_size is null,null,p_quote_valid_until
    ) returning id into v_item_id;
  else
    update vendor_items set
      price=case when p_price_unavailable then price else p_price end,
      pack_size=coalesce(p_pack_size,pack_size),
      last_updated=p_effective_date,
      price_source='price_list',
      price_unavailable=p_price_unavailable or coalesce(p_pack_size,pack_size) is null,
      price_expired_at=null,
      price_quote_valid_until=p_quote_valid_until
    where id=p_vendor_item_id
      and organization_id=p_organization_id
      and vendor_id=p_vendor_id
    returning id into v_item_id;
    if v_item_id is null then raise exception 'Vendor item is outside the requested organization/vendor'; end if;
  end if;

  if not p_price_unavailable then
    insert into price_history(
      vendor_item_id,organization_id,price,source,effective_date,quote_valid_until,
      source_file_path,source_file_name,source_description,source_line,source_document_id
    ) values (
      v_item_id,p_organization_id,p_price,'price_list',p_effective_date,p_quote_valid_until,
      p_source_file_path,p_source_file_name,p_description,p_source_line,p_source_document_id
    );
  end if;
  return v_item_id;
end;
$$;

revoke all on function kerdos_apply_price_quote(uuid,uuid,uuid,text,text,text,numeric,boolean,timestamptz,date,text,text,text,uuid) from public;
grant execute on function kerdos_apply_price_quote(uuid,uuid,uuid,text,text,text,numeric,boolean,timestamptz,date,text,text,text,uuid) to authenticated;

-- ============================================================
-- migration_006_atomic_invites.sql
-- ============================================================

-- KERDOS 006: consume an invitation and join its organization atomically.
-- The conditional update is the lock: only one caller can consume a code.

create or replace function kerdos_accept_invite(p_code text, p_user_id uuid)
returns table(organization_id uuid, role text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_org uuid;
  v_role text;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'Invitation user does not match the signed-in user';
  end if;

  update public.invite_codes
  set used_by=p_user_id, used_at=now()
  where upper(code)=upper(trim(p_code)) and used_by is null
  returning invite_codes.organization_id, invite_codes.role into v_org,v_role;

  if v_org is null then raise exception 'Invitation code was not found or has already been used'; end if;

  insert into public.organization_members(organization_id,user_id,role)
  values(v_org,p_user_id,v_role)
  on conflict do nothing;

  return query select v_org,v_role;
end;
$$;

revoke all on function kerdos_accept_invite(text,uuid) from public;
grant execute on function kerdos_accept_invite(text,uuid) to authenticated;

-- ============================================================
-- migration_007_atomic_invoices.sql
-- ============================================================

-- KERDOS 007: invoice header and all invoice lines are one transaction.
-- Run after migration_006_atomic_invites.sql.

create or replace function kerdos_record_invoice(p_header jsonb,p_lines jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_line jsonb;
  v_vendor_item_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if nullif(p_header->>'organization_id','') is null or nullif(p_header->>'vendor_id','') is null then
    raise exception 'Invoice organization and vendor are required';
  end if;
  if not exists (
    select 1 from organization_members m
    where m.organization_id=(p_header->>'organization_id')::uuid
      and m.user_id=auth.uid() and m.role in ('owner','manager')
  ) then raise exception 'Owner or manager access is required for this organization'; end if;
  if not exists (
    select 1 from vendors v
    where v.id=(p_header->>'vendor_id')::uuid
      and v.organization_id=(p_header->>'organization_id')::uuid
  ) then raise exception 'Vendor is outside the requested organization'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'An invoice requires at least one line';
  end if;

  insert into invoices(
    organization_id,vendor_id,total_amount,raw_text,invoice_date,
    invoice_number,status,file_path,file_name
  ) values (
    (p_header->>'organization_id')::uuid,(p_header->>'vendor_id')::uuid,
    (p_header->>'total_amount')::numeric,p_header->>'raw_text',
    (p_header->>'invoice_date')::date,nullif(p_header->>'invoice_number',''),
    'recorded',nullif(p_header->>'file_path',''),nullif(p_header->>'file_name','')
  ) returning id into v_invoice_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_vendor_item_id=nullif(v_line->>'vendor_item_id','')::uuid;
    if v_vendor_item_id is not null and not exists (
      select 1 from vendor_items vi
      where vi.id=v_vendor_item_id
        and vi.organization_id=(p_header->>'organization_id')::uuid
        and vi.vendor_id=(p_header->>'vendor_id')::uuid
    ) then raise exception 'Invoice vendor item is outside the requested organization/vendor'; end if;
    if nullif(v_line->>'catalog_item_id','') is not null and not exists (
      select 1 from catalog_items ci
      where ci.id=(v_line->>'catalog_item_id')::uuid
        and ci.organization_id=(p_header->>'organization_id')::uuid
    ) then raise exception 'Catalog item is outside the requested organization'; end if;
    if v_vendor_item_id is null and coalesce((v_line->>'create_vendor_item')::boolean,false) then
      select id into v_vendor_item_id from vendor_items
      where organization_id=(p_header->>'organization_id')::uuid
        and vendor_id=(p_header->>'vendor_id')::uuid
        and ((nullif(v_line->>'vendor_item_code','') is not null and vendor_item_code=v_line->>'vendor_item_code')
          or (nullif(v_line->>'vendor_item_code','') is null and description=v_line->>'description'))
      limit 1;
      if v_vendor_item_id is null then
        insert into vendor_items(
        organization_id,vendor_id,vendor_item_code,description,pack_size,price,last_updated,price_source
        ) values (
          (p_header->>'organization_id')::uuid,(p_header->>'vendor_id')::uuid,
          nullif(v_line->>'vendor_item_code',''),v_line->>'description',nullif(v_line->>'pack_size',''),
          (v_line->>'unit_price')::numeric,(p_header->>'invoice_date')::date,'invoice'
        ) returning id into v_vendor_item_id;
      end if;

      if nullif(v_line->>'catalog_item_id','') is not null then
        insert into item_mappings(
          organization_id,catalog_item_id,vendor_item_id,confidence_score,match_method,comparison_track
        ) values (
          (p_header->>'organization_id')::uuid,(v_line->>'catalog_item_id')::uuid,v_vendor_item_id,
          coalesce((v_line->>'catalog_confidence')::integer,0),'rule_based',
          coalesce(nullif(v_line->>'catalog_track',''),'similar')
        ) on conflict do nothing;
      end if;
    end if;

    insert into invoice_lines(
      invoice_id,vendor_item_id,vendor_item_code,description,unit_price,
      line_total,price_variance,match_confidence,match_method
    ) values (
      v_invoice_id,v_vendor_item_id,nullif(v_line->>'vendor_item_code',''),v_line->>'description',
      (v_line->>'unit_price')::numeric,(v_line->>'line_total')::numeric,
      nullif(v_line->>'price_variance','')::numeric,nullif(v_line->>'match_confidence','')::integer,
      nullif(v_line->>'match_method','')
    );
  end loop;

  return v_invoice_id;
end;
$$;

revoke all on function kerdos_record_invoice(jsonb,jsonb) from public;
grant execute on function kerdos_record_invoice(jsonb,jsonb) to authenticated;

-- ============================================================
-- migration_009_price_basis.sql
-- ============================================================

-- Migration 009: price basis and product identifiers.
-- A vendor's price is for one full pack ("case"), one inner unit ("each"),
-- or one unit of measure such as a pound ("measure"). KERDOS ranks vendors
-- on the price of one full pack, so the basis must travel with every quote
-- and every history row; without it a per-pound price looks like a case
-- price and produces a false cheapest vendor and false invoice variances.
-- Rows with a null basis predate this migration and were always pack prices.

alter table vendor_items add column if not exists selling_unit text;
alter table vendor_items add column if not exists price_basis text;
alter table vendor_items drop constraint if exists vendor_items_price_basis_check;
alter table vendor_items add constraint vendor_items_price_basis_check
  check (price_basis is null or price_basis in ('case','each','measure'));

-- Identifiers a vendor prints on its listing. A GTIN (UPC/EAN) names one
-- trade item across vendors; a manufacturer code does the same within a
-- brand. Both let the engine prove identity without comparing wording.
alter table vendor_items add column if not exists gtin text;
alter table vendor_items add column if not exists manufacturer_code text;
create index if not exists vendor_items_gtin_idx on vendor_items(organization_id,gtin) where gtin is not null;

-- A new product is placed in its most likely category rather than the
-- holding pen. When that placement is a best guess, the item carries a
-- review flag and the reason, cleared when the client confirms or moves it.
alter table catalog_items add column if not exists category_review boolean not null default false;
alter table catalog_items add column if not exists category_reason text;

alter table price_history add column if not exists selling_unit text;
alter table price_history add column if not exists price_basis text;
alter table price_history drop constraint if exists price_history_price_basis_check;
alter table price_history add constraint price_history_price_basis_check
  check (price_basis is null or price_basis in ('case','each','measure'));

-- The quote function gains two parameters. The old signature is removed so
-- there is exactly one function; both new parameters default to null, so a
-- caller that has not been updated keeps working and records legacy rows.
drop function if exists kerdos_apply_price_quote(uuid,uuid,uuid,text,text,text,numeric,boolean,timestamptz,date,text,text,text,uuid);

create or replace function kerdos_apply_price_quote(
  p_vendor_item_id uuid,
  p_organization_id uuid,
  p_vendor_id uuid,
  p_vendor_item_code text,
  p_description text,
  p_pack_size text,
  p_price numeric,
  p_price_unavailable boolean,
  p_effective_date timestamptz,
  p_quote_valid_until date,
  p_source_file_path text,
  p_source_file_name text,
  p_source_line text,
  p_source_document_id uuid,
  p_selling_unit text default null,
  p_price_basis text default null,
  p_gtin text default null,
  p_manufacturer_code text default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_item_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from organization_members m
    where m.organization_id=p_organization_id and m.user_id=auth.uid()
      and m.role in ('owner','manager')
  ) then raise exception 'Owner or manager access is required for this organization'; end if;
  if not exists (
    select 1 from vendors v where v.id=p_vendor_id and v.organization_id=p_organization_id
  ) then raise exception 'Vendor is outside the requested organization'; end if;
  if p_source_document_id is not null and not exists (
    select 1 from import_documents d
    where d.id=p_source_document_id and d.organization_id=p_organization_id and d.vendor_id=p_vendor_id
  ) then raise exception 'Source document is outside the requested organization/vendor'; end if;
  if p_effective_date is null then raise exception 'A price quotation requires an effective date'; end if;
  if p_price_unavailable is not true and (p_price is null or p_price <= 0) then
    raise exception 'A current quotation requires a positive price';
  end if;
  if p_price_basis is not null and p_price_basis not in ('case','each','measure') then
    raise exception 'Price basis must be case, each or measure';
  end if;

  if p_vendor_item_id is null then
    insert into vendor_items(
      organization_id,vendor_id,vendor_item_code,description,pack_size,price,
      last_updated,price_source,price_unavailable,price_expired_at,price_quote_valid_until,
      selling_unit,price_basis,gtin,manufacturer_code
    ) values (
      p_organization_id,p_vendor_id,p_vendor_item_code,p_description,p_pack_size,p_price,
      p_effective_date,'price_list',p_price_unavailable or p_pack_size is null,null,p_quote_valid_until,
      p_selling_unit,p_price_basis,p_gtin,p_manufacturer_code
    ) returning id into v_item_id;
  else
    update vendor_items set
      price=case when p_price_unavailable then price else p_price end,
      pack_size=coalesce(p_pack_size,pack_size),
      last_updated=p_effective_date,
      price_source='price_list',
      price_unavailable=p_price_unavailable or coalesce(p_pack_size,pack_size) is null,
      price_expired_at=null,
      price_quote_valid_until=p_quote_valid_until,
      selling_unit=case when p_price_unavailable then selling_unit else p_selling_unit end,
      price_basis=case when p_price_unavailable then price_basis else p_price_basis end,
      gtin=coalesce(p_gtin,gtin),
      manufacturer_code=coalesce(p_manufacturer_code,manufacturer_code)
    where id=p_vendor_item_id
      and organization_id=p_organization_id
      and vendor_id=p_vendor_id
    returning id into v_item_id;
    if v_item_id is null then raise exception 'Vendor item is outside the requested organization/vendor'; end if;
  end if;

  if not p_price_unavailable then
    insert into price_history(
      vendor_item_id,organization_id,price,source,effective_date,quote_valid_until,
      source_file_path,source_file_name,source_description,source_line,source_document_id,
      selling_unit,price_basis
    ) values (
      v_item_id,p_organization_id,p_price,'price_list',p_effective_date,p_quote_valid_until,
      p_source_file_path,p_source_file_name,p_description,p_source_line,p_source_document_id,
      p_selling_unit,p_price_basis
    );
  end if;
  return v_item_id;
end;
$$;

revoke all on function kerdos_apply_price_quote(uuid,uuid,uuid,text,text,text,numeric,boolean,timestamptz,date,text,text,text,uuid,text,text,text,text) from public;
grant execute on function kerdos_apply_price_quote(uuid,uuid,uuid,text,text,text,numeric,boolean,timestamptz,date,text,text,text,uuid,text,text,text,text) to authenticated;

-- ============================================================
-- migration_010_catalog_rows.sql
-- ============================================================

-- Migration 010: editable catalog rows and durable field corrections.
-- Existing catalog numbers, vendor links and quote history are retained.
alter table public.vendor_items add column if not exists field_resolutions jsonb not null default '{}'::jsonb;
alter table public.vendor_items add column if not exists import_row jsonb not null default '{}'::jsonb;
alter table public.vendor_items add column if not exists row_revision bigint not null default 0;

-- Replace the old quote overload; new arguments default for older clients.
drop function if exists public.kerdos_apply_price_quote(uuid,uuid,uuid,text,text,text,numeric,boolean,timestamptz,date,text,text,text,uuid,text,text,text,text);
create or replace function kerdos_apply_price_quote(
  p_vendor_item_id uuid,
  p_organization_id uuid,
  p_vendor_id uuid,
  p_vendor_item_code text,
  p_description text,
  p_pack_size text,
  p_price numeric,
  p_price_unavailable boolean,
  p_effective_date timestamptz,
  p_quote_valid_until date,
  p_source_file_path text,
  p_source_file_name text,
  p_source_line text,
  p_source_document_id uuid,
  p_selling_unit text default null,
  p_price_basis text default null,
  p_gtin text default null,
  p_manufacturer_code text default null,
  p_import_row jsonb default null,
  p_field_resolutions jsonb default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_item_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from organization_members m
    where m.organization_id=p_organization_id and m.user_id=auth.uid()
      and m.role in ('owner','manager')
  ) then raise exception 'Owner or manager access is required for this organization'; end if;
  if not exists (
    select 1 from vendors v where v.id=p_vendor_id and v.organization_id=p_organization_id
  ) then raise exception 'Vendor is outside the requested organization'; end if;
  if p_source_document_id is not null and not exists (
    select 1 from import_documents d
    where d.id=p_source_document_id and d.organization_id=p_organization_id and d.vendor_id=p_vendor_id
  ) then raise exception 'Source document is outside the requested organization/vendor'; end if;
  if p_effective_date is null then raise exception 'A price quotation requires an effective date'; end if;
  if p_price_unavailable is not true and (p_price is null or p_price <= 0) then
    raise exception 'A current quotation requires a positive price';
  end if;
  if p_price_basis is not null and p_price_basis not in ('case','each','measure') then
    raise exception 'Price basis must be case, each or measure';
  end if;

  if p_vendor_item_id is null then
    insert into vendor_items(
      organization_id,vendor_id,vendor_item_code,description,pack_size,price,
      last_updated,price_source,price_unavailable,price_expired_at,price_quote_valid_until,
      selling_unit,price_basis,gtin,manufacturer_code,import_row,field_resolutions
    ) values (
      p_organization_id,p_vendor_id,p_vendor_item_code,p_description,p_pack_size,p_price,
      p_effective_date,'price_list',p_price_unavailable or p_pack_size is null,null,p_quote_valid_until,
      p_selling_unit,p_price_basis,p_gtin,p_manufacturer_code,coalesce(p_import_row,'{}'::jsonb),coalesce(p_field_resolutions,'{}'::jsonb)
    ) returning id into v_item_id;
  else
    update vendor_items set
      price=case when p_price_unavailable then price else p_price end,
      pack_size=coalesce(p_pack_size,pack_size),
      last_updated=p_effective_date,
      price_source='price_list',
      price_unavailable=p_price_unavailable or coalesce(p_pack_size,pack_size) is null,
      price_expired_at=null,
      price_quote_valid_until=p_quote_valid_until,
      selling_unit=case when p_price_unavailable then selling_unit else p_selling_unit end,
      price_basis=case when p_price_unavailable then price_basis else p_price_basis end,
      gtin=coalesce(p_gtin,gtin),
      manufacturer_code=coalesce(p_manufacturer_code,manufacturer_code),
      import_row=coalesce(p_import_row,import_row),
      field_resolutions=coalesce(p_field_resolutions,field_resolutions),
      row_revision=row_revision+1
    where id=p_vendor_item_id
      and organization_id=p_organization_id
      and vendor_id=p_vendor_id
    returning id into v_item_id;
    if v_item_id is null then raise exception 'Vendor item is outside the requested organization/vendor'; end if;
  end if;

  if not p_price_unavailable then
    insert into price_history(
      vendor_item_id,organization_id,price,source,effective_date,quote_valid_until,
      source_file_path,source_file_name,source_description,source_line,source_document_id,
      selling_unit,price_basis
    ) values (
      v_item_id,p_organization_id,p_price,'price_list',p_effective_date,p_quote_valid_until,
      p_source_file_path,p_source_file_name,p_description,p_source_line,p_source_document_id,
      p_selling_unit,p_price_basis
    );
  end if;
  return v_item_id;
end;
$$;

revoke all on function kerdos_apply_price_quote(uuid,uuid,uuid,text,text,text,numeric,boolean,timestamptz,date,text,text,text,uuid,text,text,text,text,jsonb,jsonb) from public;
grant execute on function kerdos_apply_price_quote(uuid,uuid,uuid,text,text,text,numeric,boolean,timestamptz,date,text,text,text,uuid,text,text,text,text,jsonb,jsonb) to authenticated;

-- Save one row, its category, and any changed price together. A rejected
-- write rolls back all of them. Optimistic revision prevents lost updates.
create or replace function public.kerdos_save_catalog_row(
  p_organization_id uuid, p_vendor_item_id uuid, p_mapping_id uuid,
  p_expected_revision bigint, p_patch jsonb, p_price_basis text,
  p_price_available boolean
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_old vendor_items%rowtype;
  v_new vendor_items%rowtype;
  v_mapping item_mappings%rowtype;
  v_category uuid;
  v_key text;
  v_source_key text;
  v_price_changed boolean;
  v_identity_changed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if not exists (select 1 from organization_members where organization_id=p_organization_id and user_id=auth.uid() and role in ('owner','manager')) then
    raise exception 'Owner or manager access is required for this organization';
  end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'A field patch is required'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('description','brand','pack_size','price','selling_unit','category_id')) then
    raise exception 'Unsupported catalog field';
  end if;
  select * into v_old from vendor_items where id=p_vendor_item_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Vendor item is outside the requested organization'; end if;
  if p_expected_revision is null or v_old.row_revision<>p_expected_revision then
    raise exception 'This item changed since you opened it. Reload its saved values before saving your changes.';
  end if;
  select * into v_mapping from item_mappings where id=p_mapping_id and vendor_item_id=v_old.id and organization_id=p_organization_id for update;
  if not found then raise exception 'Catalog association changed; reload this row'; end if;
  perform 1 from catalog_items where id=v_mapping.catalog_item_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Catalog item is outside the requested organization'; end if;
  v_new := v_old;
  if p_patch ? 'description' then v_new.description:=btrim(p_patch->>'description'); end if;
  if nullif(v_new.description,'') is null then raise exception 'Enter a product description'; end if;
  if p_patch ? 'brand' then v_new.brand:=nullif(btrim(p_patch->>'brand'),''); end if;
  if p_patch ? 'pack_size' then v_new.pack_size:=nullif(btrim(p_patch->>'pack_size'),''); end if;
  if p_patch ? 'selling_unit' then v_new.selling_unit:=nullif(btrim(p_patch->>'selling_unit'),''); end if;
  if p_patch ? 'price' then v_new.price:=(p_patch->>'price')::numeric; end if;
  if v_new.price is not null and v_new.price<=0 then raise exception 'Enter a positive quoted amount'; end if;
  if p_price_basis is not null and p_price_basis not in ('case','each','measure') then raise exception 'Unknown price basis'; end if;
  v_price_changed:=p_patch ?| array['price','selling_unit','pack_size'];
  v_identity_changed:=v_new.description is distinct from v_old.description or v_new.brand is distinct from v_old.brand or v_new.pack_size is distinct from v_old.pack_size;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key in ('description','brand','pack_size','selling_unit') then
      v_source_key:=case v_key when 'pack_size' then 'packSize' when 'selling_unit' then 'sellingUnit' else v_key end;
      v_new.field_resolutions:=jsonb_set(v_new.field_resolutions,array[v_key],jsonb_build_object(
        'value',p_patch->v_key,'confirmedAt',now(),'confirmedBy',auth.uid(),
        'sourceValue',coalesce(v_old.field_resolutions->v_key->'sourceValue',v_old.import_row->'row'->v_source_key,to_jsonb(v_old)->v_key)));
    end if;
  end loop;
  if p_patch ? 'category_id' then
    v_category:=(p_patch->>'category_id')::uuid;
    if not exists (select 1 from catalog_categories where id=v_category and organization_id=p_organization_id) then raise exception 'Choose a category from this organization'; end if;
    update catalog_items set category_id=v_category,
      category_review=(select is_holding_pen from catalog_categories where id=v_category),category_reason=null
      where id=v_mapping.catalog_item_id and organization_id=p_organization_id;
  end if;
  if v_identity_changed then
    update item_mappings set comparison_track='review',confidence_score=null,match_method='manual' where id=v_mapping.id;
    -- A sole listing supplies its catalog label. Multi-vendor identities
    -- keep the shared label and await the existing mapping review controls.
    if v_new.description is distinct from v_old.description and not exists (
      select 1 from item_mappings where catalog_item_id=v_mapping.catalog_item_id and id<>v_mapping.id
    ) then update catalog_items set name=left(v_new.description,120) where id=v_mapping.catalog_item_id; end if;
  end if;
  update vendor_items set description=v_new.description,brand=v_new.brand,pack_size=v_new.pack_size,
    price=v_new.price,selling_unit=v_new.selling_unit,
    price_basis=case when v_price_changed then p_price_basis else price_basis end,
    price_unavailable=case when v_price_changed then not (coalesce(p_price_available,false) and coalesce(v_new.price>0,false) and v_new.selling_unit is not null and v_new.pack_size is not null and p_price_basis is not null) else price_unavailable end,
    field_resolutions=v_new.field_resolutions,import_row=case when p_patch ? 'price' then jsonb_set(jsonb_set(import_row,'{reviewRequired}','false'::jsonb),'{baseline}',coalesce(import_row->'row','{}'::jsonb)) else import_row end,row_revision=row_revision+1,
    last_updated=case when p_patch ? 'price' then now() else last_updated end
    where id=v_old.id returning * into v_new;
  if v_price_changed and not v_new.price_unavailable then
    insert into price_history(vendor_item_id,organization_id,price,source,effective_date,quote_valid_until,
      source_file_name,source_line,source_description,selling_unit,price_basis)
    values (v_new.id,p_organization_id,v_new.price,'price_list',now(),v_new.price_quote_valid_until,
      'Catalog field correction',v_old.import_row->'row'->>'sourceLine',v_new.description,v_new.selling_unit,v_new.price_basis);
  end if;
  return to_jsonb(v_new);
end;
$$;
revoke all on function public.kerdos_save_catalog_row(uuid,uuid,uuid,bigint,jsonb,text,boolean) from public;
grant execute on function public.kerdos_save_catalog_row(uuid,uuid,uuid,bigint,jsonb,text,boolean) to authenticated;

-- ============================================================
-- migration_011_document_deletion.sql
-- ============================================================

-- Delete one organization's source document and its dependent history together.
-- Current quotes from a deleted price sheet become unavailable. Associations,
-- accepted descriptions, pack sizes and prices from other sheets are retained.
create or replace function public.kerdos_delete_price_sheet(p_organization_id uuid,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_doc public.import_documents%rowtype;
  v_quotes integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=auth.uid()
      and m.role in ('owner','manager')
  ) then raise exception 'Owner or manager access is required for this organization'; end if;
  select * into v_doc from public.import_documents
  where id=p_document_id and organization_id=p_organization_id and document_kind='pricelist'
  for update;
  if not found then raise exception 'Price sheet not found for this organization'; end if;

  update public.vendor_items set price=null,price_unavailable=true,
    price_quote_valid_until=null,price_expired_at=null
  where organization_id=p_organization_id and price_source='price_list'
    and (import_row->>'sourceDocumentId')=p_document_id::text;

  delete from public.price_history
  where organization_id=p_organization_id and source_document_id=p_document_id;
  get diagnostics v_quotes=row_count;
  delete from public.import_documents
  where id=p_document_id and organization_id=p_organization_id;

  return jsonb_build_object('file_path',v_doc.file_path,'removed_quotes',v_quotes);
end;
$$;
revoke all on function public.kerdos_delete_price_sheet(uuid,uuid) from public;
grant execute on function public.kerdos_delete_price_sheet(uuid,uuid) to authenticated;

create or replace function public.kerdos_delete_invoice_record(p_organization_id uuid,p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=auth.uid()
      and m.role in ('owner','manager')
  ) then raise exception 'Owner or manager access is required for this organization'; end if;
  select * into v_invoice from public.invoices
  where id=p_invoice_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Invoice not found for this organization'; end if;
  delete from public.invoice_lines where invoice_id=p_invoice_id;
  delete from public.invoices where id=p_invoice_id and organization_id=p_organization_id;
  return jsonb_build_object('file_path',v_invoice.file_path);
end;
$$;
revoke all on function public.kerdos_delete_invoice_record(uuid,uuid) from public;
grant execute on function public.kerdos_delete_invoice_record(uuid,uuid) to authenticated;

-- ============================================================
-- migration_012_vendor_nvim.sql
-- ============================================================

-- A stable, organization/vendor-scoped number only when the vendor supplied
-- no item code. The shared KERDOS catalog number remains separate.
create table if not exists public.vendor_nvim_counters (
  organization_id uuid not null,
  vendor_id uuid not null,
  last_number bigint not null check (last_number > 0),
  primary key (organization_id, vendor_id)
);
alter table public.vendor_nvim_counters enable row level security;
revoke all on public.vendor_nvim_counters from anon, authenticated;

alter table public.vendor_items add column if not exists nvim_number bigint;

-- Assign existing listings once. Their order here is deterministic; future
-- numbers are allocated by a locked, transactional counter at insertion.
with numbered as (
  select vi.id,
    row_number() over (partition by vi.organization_id, vi.vendor_id
      order by nullif(to_jsonb(vi)->>'created_at','')::timestamptz nulls last,vi.id)
      + coalesce((select max(saved.nvim_number) from public.vendor_items saved
        where saved.organization_id=vi.organization_id and saved.vendor_id=vi.vendor_id),0) as number
  from public.vendor_items vi
  where vi.nvim_number is null and nullif(btrim(vi.vendor_item_code),'') is null
)
update public.vendor_items vi set nvim_number=numbered.number
from numbered where vi.id=numbered.id;

create unique index if not exists vendor_items_nvim_unique
  on public.vendor_items(organization_id,vendor_id,nvim_number);

insert into public.vendor_nvim_counters (organization_id,vendor_id,last_number)
select organization_id,vendor_id,max(nvim_number)
from public.vendor_items group by organization_id,vendor_id
having max(nvim_number) is not null
on conflict (organization_id,vendor_id) do update
  set last_number=greatest(public.vendor_nvim_counters.last_number,excluded.last_number);

create or replace function public.kerdos_assign_vendor_nvim()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.vendor_id is distinct from old.vendor_id then
      raise exception 'A vendor listing cannot change its organization or vendor';
    end if;
    if old.nvim_number is not null then
      if new.nvim_number is distinct from old.nvim_number then
        raise exception 'A vendor listing NVIM cannot change';
      end if;
      return new;
    end if;
  end if;
  if new.nvim_number is not null then
    raise exception 'A vendor listing NVIM is assigned by KERDOS';
  end if;
  if nullif(btrim(new.vendor_item_code),'') is not null then
    return new;
  end if;
  insert into public.vendor_nvim_counters (organization_id,vendor_id,last_number)
  values (new.organization_id,new.vendor_id,1)
  on conflict (organization_id,vendor_id) do update
    set last_number=public.vendor_nvim_counters.last_number+1
  returning last_number into new.nvim_number;
  return new;
end;
$$;

drop trigger if exists vendor_items_assign_nvim on public.vendor_items;
create trigger vendor_items_assign_nvim
before insert or update on public.vendor_items
for each row execute function public.kerdos_assign_vendor_nvim();

commit;
