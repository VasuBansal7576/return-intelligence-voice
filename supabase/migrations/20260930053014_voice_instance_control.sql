-- Cross-instance stop requests do not release a lease or refund its allowance.
alter table riv_private.voice_tickets add column if not exists stop_requested_at timestamptz;

create or replace function public.riv_voice_control(
  p_session_id uuid, p_owner_id uuid, p_ticket_hash text default null, p_cancel boolean default false
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_revision bigint; v_cancelled boolean;
begin
  select revision into v_revision from riv_private.sessions where id=p_session_id and owner_id=p_owner_id;
  if v_revision is null then raise sqlstate 'PT404' using message='Session not found'; end if;
  if p_cancel then
    update riv_private.voice_tickets set stop_requested_at=coalesce(stop_requested_at,now())
      where session_id=p_session_id and owner_id=p_owner_id;
    return jsonb_build_object('stopRequested',true,'providerEnded',false);
  end if;
  select stop_requested_at is not null into v_cancelled from riv_private.voice_tickets
    where ticket_hash=p_ticket_hash and session_id=p_session_id and owner_id=p_owner_id and consumed_at is not null;
  if v_cancelled is null then raise sqlstate 'PT403' using message='Invalid voice control ticket'; end if;
  return jsonb_build_object('cancelled',v_cancelled,'revision',v_revision);
end $$;
revoke execute on function public.riv_voice_control(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.riv_voice_control(uuid,uuid,text,boolean) to service_role;
