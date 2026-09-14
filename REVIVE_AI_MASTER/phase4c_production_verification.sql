-- Phase 4C production-safe verification.
-- All fixtures and decisions are transaction-local and are rolled back.

begin;

create temporary table phase4c_results (
  label text primary key,
  passed boolean not null
);

create temporary table phase4c_context (
  name text primary key,
  value text not null
);

insert into phase4c_results values
  ('MIGRATION_RECORDED', exists (
    select 1 from supabase_migrations.schema_migrations where version = '20260914183000'
  )),
  ('NO_SEEDED_WORKSPACE_POLICY', not exists (
    select 1 from public.workspace_execution_policies
  )),
  ('RLS_ENABLED', (
    select count(*) = 3
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('workspace_execution_policies', 'rev_action_executions', 'provider_usage_events')
      and relrowsecurity
  )),
  ('NO_BROAD_AUTHORITY_POLICY', not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('rev_actions', 'approvals', 'audit_log', 'workspace_execution_policies', 'rev_action_executions', 'provider_usage_events')
      and cmd = 'ALL'
  )),
  ('NO_ANON_AUTHORITY_GRANT', not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
      and table_name in ('rev_actions', 'approvals', 'audit_log', 'workspace_execution_policies', 'rev_action_executions', 'provider_usage_events')
  )),
  ('NO_AUTHENTICATED_EVIDENCE_WRITE_GRANT', not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and table_name in ('audit_log', 'rev_action_executions', 'provider_usage_events')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  )),
  ('BACKEND_RESULT_SERVICE_ROLE_ONLY',
    not has_function_privilege('authenticated', 'public.record_rev_action_execution_result(uuid,text,text,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.record_rev_action_execution_result(uuid,text,text,text,jsonb)', 'EXECUTE')
  ),
  ('IDEMPOTENCY_CONSTRAINT_PRESENT', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rev_action_executions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%workspace_id, idempotency_key%'
  )),
  ('IDEMPOTENCY_LOCK_PRESENT', position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'public.prepare_rev_action_execution(uuid,uuid,text,text,uuid,text,text,text,numeric,text)'::regprocedure
    )
  ) > 0),
  ('LEGACY_BINDING_GUARD_PRESENT', position(
    'fresh bound approval required' in pg_get_functiondef(
      'public.prepare_rev_action_execution(uuid,uuid,text,text,uuid,text,text,text,numeric,text)'::regprocedure
    )
  ) > 0),
  ('APPEND_ONLY_TRIGGERS_PRESENT', (
    select count(*) = 3
    from pg_trigger
    where not tgisinternal
      and tgname in ('provider_usage_events_append_only', 'audit_log_append_only', 'approvals_decision_immutable')
  ));

-- Existing controlled identities: A and B are active owners of separate test workspaces;
-- C is the established outsider identity. No Auth identity is created or changed.
do $$
begin
  if not exists (select 1 from auth.users where id = '8b2c373e-73ce-4c35-b1aa-875a5d441bb4'::uuid)
    or not exists (select 1 from auth.users where id = 'd288c613-84f8-4530-b988-9984008427c4'::uuid)
    or not exists (select 1 from auth.users where id = 'be0b5874-4264-4f36-869b-f16ab689c33b'::uuid) then
    raise exception 'controlled production verification identities are missing';
  end if;
end;
$$;

insert into public.workspaces (id, name, slug, created_by)
values
  ('4c000000-0000-4000-8000-000000000001', 'TEST FIXTURE Phase 4C Workspace A', 'test-phase-4c-a', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4'),
  ('4c000000-0000-4000-8000-000000000002', 'TEST FIXTURE Phase 4C Workspace B', 'test-phase-4c-b', 'd288c613-84f8-4530-b988-9984008427c4');

insert into public.workspace_members (workspace_id, user_id, role, status)
values
  ('4c000000-0000-4000-8000-000000000001', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', 'owner', 'active'),
  ('4c000000-0000-4000-8000-000000000001', 'd288c613-84f8-4530-b988-9984008427c4', 'admin', 'active'),
  ('4c000000-0000-4000-8000-000000000001', 'be0b5874-4264-4f36-869b-f16ab689c33b', 'member', 'active'),
  ('4c000000-0000-4000-8000-000000000002', 'd288c613-84f8-4530-b988-9984008427c4', 'owner', 'active');

insert into public.rev_actions (
  id, workspace_id, action_type, title, description, requires_approval, status, execution_status
) values
  ('4c000000-0000-4000-8000-000000000101', '4c000000-0000-4000-8000-000000000001', 'test', 'TEST FIXTURE owner approval', 'Transaction-local Phase 4C verification', true, 'awaiting_approval', 'not_executed'),
  ('4c000000-0000-4000-8000-000000000102', '4c000000-0000-4000-8000-000000000001', 'test', 'TEST FIXTURE admin approval', 'Transaction-local Phase 4C verification', true, 'awaiting_approval', 'not_executed'),
  ('4c000000-0000-4000-8000-000000000103', '4c000000-0000-4000-8000-000000000001', 'test', 'TEST FIXTURE member denial', 'Transaction-local Phase 4C verification', true, 'awaiting_approval', 'not_executed'),
  ('4c000000-0000-4000-8000-000000000104', '4c000000-0000-4000-8000-000000000001', 'test', 'TEST FIXTURE stale approval', 'Transaction-local Phase 4C verification', true, 'awaiting_approval', 'not_executed'),
  ('4c000000-0000-4000-8000-000000000105', '4c000000-0000-4000-8000-000000000001', 'test', 'TEST FIXTURE legacy approval', 'Transaction-local Phase 4C verification', true, 'approved', 'not_executed'),
  ('4c000000-0000-4000-8000-000000000106', '4c000000-0000-4000-8000-000000000002', 'test', 'TEST FIXTURE cross tenant', 'Transaction-local Phase 4C verification', true, 'awaiting_approval', 'not_executed');

insert into public.approvals (id, workspace_id, rev_action_id)
values
  ('4c000000-0000-4000-8000-000000000201', '4c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000101'),
  ('4c000000-0000-4000-8000-000000000202', '4c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000102'),
  ('4c000000-0000-4000-8000-000000000203', '4c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000103'),
  ('4c000000-0000-4000-8000-000000000204', '4c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000104');

insert into public.approvals (
  id, workspace_id, rev_action_id, decided_at, decided_by, decision, notes
) values (
  '4c000000-0000-4000-8000-000000000205',
  '4c000000-0000-4000-8000-000000000001',
  '4c000000-0000-4000-8000-000000000105',
  now(),
  '8b2c373e-73ce-4c35-b1aa-875a5d441bb4',
  'approved',
  'TEST FIXTURE legacy unbound approval'
);

insert into phase4c_context values
  ('owner_fingerprint', public.rev_action_material_fingerprint((select action from public.rev_actions action where id = '4c000000-0000-4000-8000-000000000101'))),
  ('admin_fingerprint', public.rev_action_material_fingerprint((select action from public.rev_actions action where id = '4c000000-0000-4000-8000-000000000102'))),
  ('stale_fingerprint', public.rev_action_material_fingerprint((select action from public.rev_actions action where id = '4c000000-0000-4000-8000-000000000104')));
grant select on phase4c_context to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', true);
select public.decide_rev_action_approval(
  '4c000000-0000-4000-8000-000000000201', 1,
  (select value from phase4c_context where name = 'owner_fingerprint'),
  'approved', 'TEST FIXTURE owner decision'
);
reset role;
insert into phase4c_results values ('OWNER_APPROVAL_ALLOWED', exists (
  select 1 from public.approvals
  where id = '4c000000-0000-4000-8000-000000000201' and decision = 'approved'
));

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd288c613-84f8-4530-b988-9984008427c4', true);
select public.decide_rev_action_approval(
  '4c000000-0000-4000-8000-000000000202', 1,
  (select value from phase4c_context where name = 'admin_fingerprint'),
  'approved', 'TEST FIXTURE admin decision'
);
reset role;
insert into phase4c_results values ('ADMIN_APPROVAL_ALLOWED', exists (
  select 1 from public.approvals
  where id = '4c000000-0000-4000-8000-000000000202' and decision = 'approved'
));

set local role authenticated;
select set_config('request.jwt.claim.sub', 'be0b5874-4264-4f36-869b-f16ab689c33b', true);
do $$
declare denied boolean := false;
begin
  begin
    perform public.decide_rev_action_approval(
      '4c000000-0000-4000-8000-000000000203', 1, repeat('0', 64), 'approved', 'must fail'
    );
  exception when others then
    denied := position('active owner or admin role required' in sqlerrm) > 0;
  end;
  if not denied then raise exception 'member authoritative approval was not denied'; end if;
end;
$$;
reset role;
insert into phase4c_results values ('MEMBER_APPROVAL_DENIED', true);

update public.workspace_members
set role = 'viewer'
where workspace_id = '4c000000-0000-4000-8000-000000000001'
  and user_id = 'be0b5874-4264-4f36-869b-f16ab689c33b';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'be0b5874-4264-4f36-869b-f16ab689c33b', true);
do $$
declare denied boolean := false;
begin
  begin
    insert into public.rev_actions (workspace_id, action_type, title, description)
    values ('4c000000-0000-4000-8000-000000000001', 'test', 'viewer write', 'must fail');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'viewer write was not denied'; end if;
end;
$$;
reset role;
insert into phase4c_results values ('VIEWER_WRITE_DENIED', true);

update public.workspace_members
set role = 'member', status = 'suspended'
where workspace_id = '4c000000-0000-4000-8000-000000000001'
  and user_id = 'be0b5874-4264-4f36-869b-f16ab689c33b';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'be0b5874-4264-4f36-869b-f16ab689c33b', true);
do $$
begin
  if exists (select 1 from public.rev_actions where workspace_id = '4c000000-0000-4000-8000-000000000001') then
    raise exception 'inactive member retained read access';
  end if;
end;
$$;
reset role;
insert into phase4c_results values ('INACTIVE_MEMBER_DENIED', true);

delete from public.workspace_members
where workspace_id = '4c000000-0000-4000-8000-000000000001'
  and user_id = 'be0b5874-4264-4f36-869b-f16ab689c33b';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'be0b5874-4264-4f36-869b-f16ab689c33b', true);
do $$
begin
  if exists (select 1 from public.rev_actions where workspace_id = '4c000000-0000-4000-8000-000000000001') then
    raise exception 'non-member retained read access';
  end if;
end;
$$;
reset role;
insert into phase4c_results values ('NON_MEMBER_DENIED', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', true);
do $$
begin
  if exists (select 1 from public.rev_actions where workspace_id = '4c000000-0000-4000-8000-000000000002') then
    raise exception 'cross-tenant read was not denied';
  end if;
end;
$$;
reset role;
insert into phase4c_results values ('CROSS_TENANT_DENIED', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', true);
do $$
declare execution_denied boolean := false; usage_denied boolean := false; audit_denied boolean := false;
begin
  begin
    insert into public.rev_action_executions (
      workspace_id, action_id, approval_id, requested_by, capability, risk_class,
      idempotency_key, request_fingerprint, action_version, workspace_policy_version
    ) values (
      '4c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000101',
      '4c000000-0000-4000-8000-000000000201', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4',
      'test', 'read_only', 'forged', repeat('a', 64), 1, 1
    );
  exception when others then execution_denied := true;
  end;
  begin
    insert into public.provider_usage_events (
      workspace_id, provider_key, operation, usage_event_key, correlation_id, status
    ) values (
      '4c000000-0000-4000-8000-000000000001', 'forged', 'forged', 'forged', gen_random_uuid(), 'succeeded'
    );
  exception when others then usage_denied := true;
  end;
  begin
    insert into public.audit_log (workspace_id, actor_type, action, resource_type)
    values ('4c000000-0000-4000-8000-000000000001', 'system', 'execution.succeeded', 'forged');
  exception when others then audit_denied := true;
  end;
  if not execution_denied then raise exception 'direct execution evidence write was not denied'; end if;
  if not usage_denied then raise exception 'direct provider usage write was not denied'; end if;
  if not audit_denied then raise exception 'audit forgery was not denied'; end if;
end;
$$;
reset role;
insert into phase4c_results values
  ('DIRECT_EXECUTION_EVIDENCE_WRITE_DENIED', true),
  ('DIRECT_PROVIDER_USAGE_WRITE_DENIED', true),
  ('AUDIT_FORGERY_DENIED', true);

insert into public.workspace_execution_policies (workspace_id, updated_by)
values ('4c000000-0000-4000-8000-000000000001', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4');
insert into phase4c_results values ('WORKSPACE_POLICY_DEFAULT_OFF', exists (
  select 1 from public.workspace_execution_policies
  where workspace_id = '4c000000-0000-4000-8000-000000000001'
    and not execution_enabled
    and autonomy_mode = 'always_ask'
    and per_attempt_provider_cost_ceiling = 0
    and monthly_provider_cost_ceiling = 0
));

update public.rev_actions
set title = 'TEST FIXTURE stale approval changed'
where id = '4c000000-0000-4000-8000-000000000104';
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', true);
do $$
declare denied boolean := false;
begin
  begin
    perform public.decide_rev_action_approval(
      '4c000000-0000-4000-8000-000000000204', 1,
      (select value from phase4c_context where name = 'stale_fingerprint'),
      'approved', 'must fail'
    );
  exception when others then
    denied := position('stale approval review' in sqlerrm) > 0;
  end;
  if not denied then raise exception 'stale approval was not denied'; end if;
end;
$$;
reset role;
insert into phase4c_results values ('STALE_APPROVAL_DENIED', exists (
  select 1 from public.approvals
  where id = '4c000000-0000-4000-8000-000000000204'
    and decision is null and action_version is null and action_fingerprint is null
));

insert into phase4c_results values ('LEGACY_UNBOUND_APPROVAL_DENIED',
  not exists (
    select 1
    from public.approvals approval
    join public.rev_actions action
      on action.workspace_id = approval.workspace_id and action.id = approval.rev_action_id
    where approval.id = '4c000000-0000-4000-8000-000000000205'
      and approval.decision = 'approved'
      and approval.action_version = action.action_version
      and approval.action_fingerprint = public.rev_action_material_fingerprint(action)
  )
);

-- Create transaction-local evidence directly as the database owner solely to prove the
-- append-only triggers. This does not invoke preparation, execution, or any provider.
insert into public.rev_action_executions (
  id, workspace_id, action_id, approval_id, requested_by, capability, risk_class,
  idempotency_key, request_fingerprint, action_version, approval_fingerprint,
  workspace_policy_version, correlation_id
) select
  '4c000000-0000-4000-8000-000000000301',
  '4c000000-0000-4000-8000-000000000001',
  '4c000000-0000-4000-8000-000000000101',
  '4c000000-0000-4000-8000-000000000201',
  '8b2c373e-73ce-4c35-b1aa-875a5d441bb4',
  'test', 'read_only', 'append-only-test', repeat('b', 64), 1,
  action_fingerprint, 1, '4c000000-0000-4000-8000-000000000501'
from public.approvals where id = '4c000000-0000-4000-8000-000000000201';

insert into public.provider_usage_events (
  id, workspace_id, execution_id, provider_key, operation, usage_event_key,
  correlation_id, status
) values (
  '4c000000-0000-4000-8000-000000000401',
  '4c000000-0000-4000-8000-000000000001',
  '4c000000-0000-4000-8000-000000000301',
  'test-only', 'none', 'append-only-test',
  '4c000000-0000-4000-8000-000000000501', 'estimated'
);

do $$
declare usage_update_denied boolean := false; usage_delete_denied boolean := false;
  audit_update_denied boolean := false; approval_update_denied boolean := false;
begin
  begin
    update public.provider_usage_events set actual_provider_cost = 1
    where id = '4c000000-0000-4000-8000-000000000401';
  exception when others then usage_update_denied := position('append-only' in sqlerrm) > 0;
  end;
  begin
    delete from public.provider_usage_events where id = '4c000000-0000-4000-8000-000000000401';
  exception when others then usage_delete_denied := position('append-only' in sqlerrm) > 0;
  end;
  begin
    update public.audit_log set action = 'forged'
    where workspace_id = '4c000000-0000-4000-8000-000000000001';
  exception when others then audit_update_denied := position('append-only' in sqlerrm) > 0;
  end;
  begin
    update public.approvals set notes = 'forged'
    where id = '4c000000-0000-4000-8000-000000000201';
  exception when others then approval_update_denied := position('append-only' in sqlerrm) > 0;
  end;
  if not usage_update_denied or not usage_delete_denied or not audit_update_denied or not approval_update_denied then
    raise exception 'append-only evidence mutation was not fully denied';
  end if;
end;
$$;
insert into phase4c_results values ('APPEND_ONLY_EVIDENCE_ENFORCED', true);

do $$
begin
  if exists (select 1 from phase4c_results where not passed) then
    raise exception 'one or more Phase 4C production assertions failed';
  end if;
end;
$$;

select jsonb_build_object(
  'passed', count(*) filter (where passed),
  'failed', count(*) filter (where not passed),
  'assertions', jsonb_object_agg(label, passed order by label)
) as phase4c_production_verification
from phase4c_results;

rollback;
