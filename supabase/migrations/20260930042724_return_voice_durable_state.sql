-- Return Intelligence Voice: synthetic demo state, private by default.
-- No secrets, real customer rows or live merchant transactions belong here.
create schema if not exists riv_private;
revoke all on schema riv_private from public, anon, authenticated;
grant usage on schema riv_private to service_role;

create table if not exists riv_private.sessions (
  id uuid primary key,
  owner_id uuid not null,
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists riv_sessions_owner_created on riv_private.sessions(owner_id, created_at desc);
create table if not exists riv_private.records (
  id text primary key,
  session_id uuid not null references riv_private.sessions(id),
  kind text not null check (kind in ('return','exchange','escalation','insight','quality_case','preference','outcome')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists riv_records_session on riv_private.records(session_id);
create unique index if not exists riv_one_resolution_per_demo_item on riv_private.records
  ((payload->>'scopeId'), (payload->>'orderId'), (payload->>'itemId'))
  where kind in ('return','exchange');
create table if not exists riv_private.voice_budget (
  id text primary key check (id = 'global'),
  max_seconds integer not null default 0 check (max_seconds >= 0 and max_seconds <= 10800),
  reserved_seconds integer not null default 0 check (reserved_seconds >= 0),
  active_until timestamptz,
  active_ticket_hash text,
  check (reserved_seconds <= max_seconds)
);
-- A migration/redeployment NEVER resets the allowance. Root must explicitly
-- authorize a nonzero cap after verifying free plan/remaining credits.
insert into riv_private.voice_budget(id) values ('global') on conflict (id) do nothing;
create table if not exists riv_private.voice_tickets (
  ticket_hash text primary key check (length(ticket_hash) = 64),
  session_id uuid not null references riv_private.sessions(id),
  owner_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  reserved_seconds integer not null check (reserved_seconds between 60 and 180),
  created_at timestamptz not null default now()
);

alter table riv_private.sessions enable row level security;
alter table riv_private.records enable row level security;
alter table riv_private.voice_budget enable row level security;
alter table riv_private.voice_tickets enable row level security;
revoke all on all tables in schema riv_private from public, anon, authenticated;
grant select, insert, update on riv_private.sessions, riv_private.records, riv_private.voice_budget, riv_private.voice_tickets to service_role;
-- No user-facing role receives a policy or grant. All application access uses
-- the checked server boundary, with signed browser ownership and invoker RPCs.

create or replace function public.riv_load_state(p_owner_id uuid, p_session_id uuid default null, p_all boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_sessions jsonb; v_records jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'revision',s.revision,'state',s.state)), '[]'::jsonb) into v_sessions
  from (select * from riv_private.sessions where owner_id=p_owner_id and (id=p_session_id or (p_session_id is null and p_all)) order by created_at desc limit 200) s;
  select coalesce(jsonb_agg(jsonb_build_object('payload',r.payload)), '[]'::jsonb) into v_records
  from (select r.payload from riv_private.records r join riv_private.sessions s on s.id=r.session_id where s.owner_id=p_owner_id order by r.created_at limit 5000) r;
  return jsonb_build_object('sessions',v_sessions,'records',v_records);
end $$;

create or replace function public.riv_commit_session(p_id uuid, p_owner_id uuid, p_expected_revision bigint, p_state jsonb, p_records jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_revision bigint; v_record jsonb;
begin
  if p_id is null or p_owner_id is null or jsonb_typeof(p_state) is distinct from 'object' or p_state->>'id' is distinct from p_id::text or pg_column_size(p_state)>2000000 or jsonb_typeof(p_records) is distinct from 'array' then
    raise sqlstate 'PT400' using message='Invalid session transaction';
  end if;
  if p_expected_revision = -1 then
    insert into riv_private.sessions(id,owner_id,state) values(p_id,p_owner_id,p_state) on conflict(id) do nothing returning revision into v_revision;
  else
    update riv_private.sessions set state=p_state, revision=revision+1, updated_at=now()
      where id=p_id and owner_id=p_owner_id and revision=p_expected_revision returning revision into v_revision;
  end if;
  if v_revision is null then raise sqlstate 'PT409' using message='Session revision or ownership conflict'; end if;
  for v_record in select value from jsonb_array_elements(p_records) loop
    if v_record->>'sessionId' is distinct from p_id::text or not (v_record ? 'recordId') or not (v_record ? 'kind') then
      raise sqlstate 'PT400' using message='Ledger record must belong to committed session';
    end if;
    if v_record->>'kind' in ('return','exchange') and (v_record->>'scopeId' is distinct from p_id::text or not (v_record ? 'orderId') or not (v_record ? 'itemId')) then
      raise sqlstate 'PT400' using message='Resolution requires a demo-scoped order item';
    end if;
    insert into riv_private.records(id,session_id,kind,payload) values(v_record->>'recordId',p_id,v_record->>'kind',v_record);
  end loop;
  return jsonb_build_object('committed',true,'revision',v_revision);
end $$;

create or replace function public.riv_voice_status()
returns jsonb language sql security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('max_seconds',max_seconds,'reserved_seconds',reserved_seconds,'active_until',active_until)),'[]'::jsonb) from riv_private.voice_budget where id='global';
$$;
create or replace function public.riv_reserve_voice(p_session_id uuid,p_owner_id uuid,p_ticket_hash text,p_seconds integer,p_cap_seconds integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_reserved integer;
begin
  if p_seconds is null or p_seconds < 60 or p_seconds > 180 or p_cap_seconds is null or p_cap_seconds < p_seconds or p_cap_seconds > 10800 or p_ticket_hash is null or length(p_ticket_hash) <> 64 then raise sqlstate 'PT400' using message='Invalid bounded voice reservation'; end if;
  if not exists(select 1 from riv_private.sessions where id=p_session_id and owner_id=p_owner_id) then raise sqlstate 'PT404' using message='Session not found'; end if;
  update riv_private.voice_budget set reserved_seconds=reserved_seconds+p_seconds,
    active_until=now()+make_interval(secs=>p_seconds+60), active_ticket_hash=p_ticket_hash
    where id='global' and reserved_seconds+p_seconds<=least(max_seconds,p_cap_seconds) and (active_until is null or active_until<now())
    returning reserved_seconds into v_reserved;
  if v_reserved is null then raise sqlstate 'PT429' using message='Voice budget exhausted or a reservation is active'; end if;
  insert into riv_private.voice_tickets(ticket_hash,session_id,owner_id,expires_at,reserved_seconds)
    values(p_ticket_hash,p_session_id,p_owner_id,now()+interval '60 seconds',p_seconds);
  return jsonb_build_object('reserved',true,'reserved_seconds',v_reserved);
end $$;
create or replace function public.riv_consume_voice_ticket(p_ticket_hash text,p_session_id uuid,p_owner_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_seconds integer;
begin
  update riv_private.voice_tickets set consumed_at=now() where ticket_hash=p_ticket_hash and session_id=p_session_id and owner_id=p_owner_id
    and consumed_at is null and expires_at>now() returning session_id,reserved_seconds into v_id,v_seconds;
  if v_id is null then raise sqlstate 'PT403' using message='Invalid or expired voice ticket'; end if;
  -- Start a fresh bounded lease at redemption, covering initialization and
  -- the provider's termination grace period as well as the 180-second call.
  update riv_private.voice_budget set active_until=greatest(active_until,now()+make_interval(secs=>v_seconds+60))
    where id='global' and active_ticket_hash=p_ticket_hash;
  return jsonb_build_object('session_id',v_id);
end $$;
create or replace function public.riv_release_voice(p_ticket_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  update riv_private.voice_budget set active_until=now(),active_ticket_hash=null where id='global' and active_ticket_hash=p_ticket_hash;
  -- Credits remain reserved even after a failure or short session. Reconnects
  -- need a fresh reservation; uncertainty can never increase the allowance.
  return jsonb_build_object('released',true);
end $$;

revoke execute on function public.riv_load_state(uuid,uuid,boolean) from public,anon,authenticated;
revoke execute on function public.riv_commit_session(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
revoke execute on function public.riv_voice_status() from public,anon,authenticated;
revoke execute on function public.riv_reserve_voice(uuid,uuid,text,integer,integer) from public,anon,authenticated;
revoke execute on function public.riv_consume_voice_ticket(text,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.riv_release_voice(text) from public,anon,authenticated;
grant execute on function public.riv_load_state(uuid,uuid,boolean),public.riv_commit_session(uuid,uuid,bigint,jsonb,jsonb),
  public.riv_voice_status(),public.riv_reserve_voice(uuid,uuid,text,integer,integer),public.riv_consume_voice_ticket(text,uuid,uuid),public.riv_release_voice(text) to service_role;
