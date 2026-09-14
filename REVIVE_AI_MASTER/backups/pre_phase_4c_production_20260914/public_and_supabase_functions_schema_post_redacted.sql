


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "supabase_functions";


ALTER SCHEMA "supabase_functions" OWNER TO "supabase_admin";


CREATE OR REPLACE FUNCTION "public"."create_workspace_with_owner"("workspace_name" "text", "workspace_slug" "text") RETURNS TABLE("created_workspace_id" "uuid", "created_workspace_name" "text", "created_workspace_slug" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  creator_user_id uuid;
  new_workspace_id uuid;
  safe_workspace_name text;
  safe_workspace_slug text;
begin
  creator_user_id := auth.uid();
  if creator_user_id is null then
    raise exception 'authenticated user required';
  end if;

  safe_workspace_name := pg_catalog.btrim(workspace_name);
  safe_workspace_slug := pg_catalog.btrim(workspace_slug);
  if safe_workspace_name is null or pg_catalog.char_length(safe_workspace_name) not between 1 and 120 then
    raise exception 'workspace name must be between 1 and 120 characters';
  end if;
  if safe_workspace_slug is null or safe_workspace_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or pg_catalog.char_length(safe_workspace_slug) not between 1 and 80 then
    raise exception 'workspace slug must use lowercase letters, numbers, and single hyphens';
  end if;

  insert into public.workspaces (name, slug, created_by)
    values (safe_workspace_name, safe_workspace_slug, creator_user_id)
    returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
    values (new_workspace_id, creator_user_id, 'owner', 'active');

  insert into public.audit_log (workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
    values (new_workspace_id, creator_user_id, 'user', 'workspace.created', 'workspace', new_workspace_id, '{"source":"bootstrap"}'::jsonb);

  return query select new_workspace_id, safe_workspace_name, safe_workspace_slug;
end;
$_$;


ALTER FUNCTION "public"."create_workspace_with_owner"("workspace_name" "text", "workspace_slug" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."approvals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "rev_action_id" "uuid" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone,
    "decided_by" "uuid",
    "decision" "text",
    "notes" "text",
    "action_version" bigint,
    "action_fingerprint" "text",
    CONSTRAINT "approvals_action_binding_shape_check" CHECK (((("action_version" IS NULL) AND ("action_fingerprint" IS NULL)) OR (("action_version" IS NOT NULL) AND ("action_version" > 0) AND ("action_fingerprint" ~ '^[0-9a-f]{64}$'::"text")))),
    CONSTRAINT "approvals_decision_check" CHECK (("decision" = ANY (ARRAY['approved'::"text", 'rejected'::"text", 'edited'::"text"])))
);


ALTER TABLE "public"."approvals" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_rev_action_approval"("target_approval_id" "uuid", "expected_action_version" bigint, "expected_action_fingerprint" "text", "approval_decision" "text", "decision_notes" "text" DEFAULT NULL::"text") RETURNS "public"."approvals"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  locked_approval public.approvals;
  locked_action public.rev_actions;
  computed_fingerprint text;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'authenticated user required';
  end if;
  if approval_decision not in ('approved', 'rejected') then
    raise exception 'approval decision must be approved or rejected';
  end if;

  select * into locked_approval
  from public.approvals
  where id = target_approval_id
  for update;
  if not found then raise exception 'approval not found'; end if;

  if not public.has_workspace_role(locked_approval.workspace_id, array['owner', 'admin']) then
    raise exception 'active owner or admin role required';
  end if;

  select * into locked_action
  from public.rev_actions
  where workspace_id = locked_approval.workspace_id
    and id = locked_approval.rev_action_id
  for update;
  if not found then raise exception 'REV action not found'; end if;

  if locked_approval.decision is not null or locked_approval.decided_at is not null then
    raise exception 'approval is already decided';
  end if;
  if locked_action.status <> 'awaiting_approval' or locked_action.execution_status <> 'not_executed' then
    raise exception 'REV action is not pending approval';
  end if;

  computed_fingerprint := public.rev_action_material_fingerprint(locked_action);
  if locked_action.action_version <> expected_action_version
    or computed_fingerprint <> expected_action_fingerprint then
    raise exception 'stale approval review';
  end if;

  update public.approvals
  set decision = approval_decision,
      decided_at = pg_catalog.now(),
      decided_by = actor_id,
      notes = decision_notes,
      action_version = locked_action.action_version,
      action_fingerprint = computed_fingerprint
  where id = locked_approval.id
  returning * into locked_approval;

  update public.rev_actions
  set status = case when approval_decision = 'approved' then 'approved' else 'rejected' end,
      approved_at = case when approval_decision = 'approved' then pg_catalog.now() else null end
  where workspace_id = locked_action.workspace_id and id = locked_action.id;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    locked_action.workspace_id,
    actor_id,
    'user',
    'approval.' || approval_decision,
    'approval',
    locked_approval.id,
    pg_catalog.jsonb_build_object(
      'rev_action_id', locked_action.id,
      'action_version', locked_action.action_version,
      'action_fingerprint', computed_fingerprint
    )
  );

  return locked_approval;
end;
$$;


ALTER FUNCTION "public"."decide_rev_action_approval"("target_approval_id" "uuid", "expected_action_version" bigint, "expected_action_fingerprint" "text", "approval_decision" "text", "decision_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
      and role = any(allowed_roles)
  );
$$;


ALTER FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_workspace_member"("target_workspace_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;


ALTER FUNCTION "public"."is_active_workspace_member"("target_workspace_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rev_action_executions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "action_id" "uuid" NOT NULL,
    "approval_id" "uuid",
    "requested_by" "uuid" NOT NULL,
    "capability" "text" NOT NULL,
    "risk_class" "text" NOT NULL,
    "mode" "text" DEFAULT 'dry_run'::"text" NOT NULL,
    "status" "text" DEFAULT 'prepared'::"text" NOT NULL,
    "correlation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "request_fingerprint" "text" NOT NULL,
    "action_version" bigint NOT NULL,
    "approval_fingerprint" "text",
    "workspace_policy_version" bigint NOT NULL,
    "jurisdiction" "text",
    "estimated_provider_cost" numeric(12,4) DEFAULT 0 NOT NULL,
    "provider_key" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "result_summary" "text",
    "failure_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rev_action_executions_action_version_check" CHECK (("action_version" > 0)),
    CONSTRAINT "rev_action_executions_approval_fingerprint_check" CHECK ((("approval_fingerprint" IS NULL) OR ("approval_fingerprint" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "rev_action_executions_check" CHECK (((("status" = 'prepared'::"text") AND ("started_at" IS NULL) AND ("completed_at" IS NULL)) OR (("status" = 'in_progress'::"text") AND ("started_at" IS NOT NULL) AND ("completed_at" IS NULL)) OR (("status" = ANY (ARRAY['succeeded'::"text", 'failed'::"text", 'cancelled'::"text"])) AND ("completed_at" IS NOT NULL)))),
    CONSTRAINT "rev_action_executions_estimated_provider_cost_check" CHECK (("estimated_provider_cost" >= (0)::numeric)),
    CONSTRAINT "rev_action_executions_idempotency_key_check" CHECK ((("char_length"("idempotency_key") >= 1) AND ("char_length"("idempotency_key") <= 200))),
    CONSTRAINT "rev_action_executions_mode_check" CHECK (("mode" = ANY (ARRAY['dry_run'::"text", 'live'::"text"]))),
    CONSTRAINT "rev_action_executions_request_fingerprint_check" CHECK (("request_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "rev_action_executions_risk_class_check" CHECK (("risk_class" = ANY (ARRAY['read_only'::"text", 'prepare_only'::"text", 'internal_write'::"text", 'external_communication'::"text", 'financial'::"text", 'high_risk'::"text"]))),
    CONSTRAINT "rev_action_executions_status_check" CHECK (("status" = ANY (ARRAY['prepared'::"text", 'in_progress'::"text", 'succeeded'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "rev_action_executions_workspace_policy_version_check" CHECK (("workspace_policy_version" > 0))
);


ALTER TABLE "public"."rev_action_executions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_rev_action_execution"("target_workspace_id" "uuid", "target_action_id" "uuid", "target_idempotency_key" "text", "target_request_fingerprint" "text", "target_correlation_id" "uuid", "target_capability" "text", "target_risk_class" "text", "target_jurisdiction" "text", "target_estimated_provider_cost" numeric, "target_provider_key" "text" DEFAULT NULL::"text") RETURNS "public"."rev_action_executions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_id uuid;
  policy public.workspace_execution_policies;
  locked_action public.rev_actions;
  bound_approval public.approvals;
  existing_attempt public.rev_action_executions;
  current_fingerprint text;
  monthly_committed numeric(12, 4);
  created_attempt public.rev_action_executions;
begin
  actor_id := auth.uid();
  if actor_id is null then raise exception 'authenticated user required'; end if;
  if not public.has_workspace_role(target_workspace_id, array['owner', 'admin']) then
    raise exception 'active owner or admin role required';
  end if;
  if target_idempotency_key is null or pg_catalog.char_length(target_idempotency_key) not between 1 and 200 then
    raise exception 'valid idempotency key required';
  end if;
  if target_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'valid request fingerprint required'; end if;
  if target_estimated_provider_cost < 0 then raise exception 'estimated provider cost cannot be negative'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_workspace_id::text || ':' || target_idempotency_key, 0)
  );

  select * into existing_attempt
  from public.rev_action_executions
  where workspace_id = target_workspace_id and idempotency_key = target_idempotency_key;
  if found then
    if existing_attempt.request_fingerprint <> target_request_fingerprint then
      raise exception 'idempotency key conflict';
    end if;
    return existing_attempt;
  end if;

  select * into policy
  from public.workspace_execution_policies
  where workspace_id = target_workspace_id
  for update;
  if not found or not policy.execution_enabled or policy.autonomy_mode <> 'always_ask' then
    raise exception 'workspace execution is disabled';
  end if;
  if target_capability = any(policy.disabled_capabilities) then
    raise exception 'capability is disabled for workspace';
  end if;
  if target_estimated_provider_cost > policy.per_attempt_provider_cost_ceiling then
    raise exception 'per-attempt provider cost ceiling exceeded';
  end if;

  select * into locked_action
  from public.rev_actions
  where workspace_id = target_workspace_id and id = target_action_id
  for update;
  if not found then raise exception 'REV action not found'; end if;
  if locked_action.status <> 'approved' or locked_action.execution_status <> 'not_executed' then
    raise exception 'REV action is not approved for preparation';
  end if;

  current_fingerprint := public.rev_action_material_fingerprint(locked_action);
  select * into bound_approval
  from public.approvals
  where workspace_id = target_workspace_id
    and rev_action_id = locked_action.id
    and decision = 'approved'
    and action_version = locked_action.action_version
    and action_fingerprint = current_fingerprint
  order by decided_at desc
  limit 1
  for update;
  if not found then raise exception 'fresh bound approval required'; end if;

  select coalesce(pg_catalog.sum(provider_usage_events.actual_provider_cost), 0)
    + coalesce((
      select pg_catalog.sum(rev_action_executions.estimated_provider_cost)
      from public.rev_action_executions
      where rev_action_executions.workspace_id = target_workspace_id
        and rev_action_executions.status in ('prepared', 'in_progress')
        and rev_action_executions.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
    ), 0)
  into monthly_committed
  from public.provider_usage_events
  where provider_usage_events.workspace_id = target_workspace_id
    and provider_usage_events.occurred_at >= pg_catalog.date_trunc('month', pg_catalog.now());

  if monthly_committed + target_estimated_provider_cost > policy.monthly_provider_cost_ceiling then
    raise exception 'monthly provider cost ceiling exceeded';
  end if;

  insert into public.rev_action_executions (
    workspace_id, action_id, approval_id, requested_by, capability, risk_class, mode, status,
    correlation_id, idempotency_key, request_fingerprint, action_version, approval_fingerprint,
    workspace_policy_version, jurisdiction, estimated_provider_cost, provider_key
  ) values (
    target_workspace_id, locked_action.id, bound_approval.id, actor_id, target_capability,
    target_risk_class, 'dry_run', 'prepared', target_correlation_id, target_idempotency_key,
    target_request_fingerprint, locked_action.action_version, current_fingerprint,
    policy.version, target_jurisdiction, target_estimated_provider_cost, target_provider_key
  ) returning * into created_attempt;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    target_workspace_id, actor_id, 'user', 'execution.prepared', 'rev_action_execution',
    created_attempt.id, pg_catalog.jsonb_build_object(
      'rev_action_id', locked_action.id,
      'capability', target_capability,
      'mode', 'dry_run',
      'correlation_id', target_correlation_id
    )
  );

  return created_attempt;
end;
$_$;


ALTER FUNCTION "public"."prepare_rev_action_execution"("target_workspace_id" "uuid", "target_action_id" "uuid", "target_idempotency_key" "text", "target_request_fingerprint" "text", "target_correlation_id" "uuid", "target_capability" "text", "target_risk_class" "text", "target_jurisdiction" "text", "target_estimated_provider_cost" numeric, "target_provider_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_append_only_evidence_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;


ALTER FUNCTION "public"."prevent_append_only_evidence_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_opportunity_identity_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id is immutable on public.opportunities';
  end if;
  if new.contact_id is distinct from old.contact_id then
    raise exception 'contact_id is immutable on public.opportunities';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is immutable on public.opportunities';
  end if;
  if new.created_by_type is distinct from old.created_by_type then
    raise exception 'created_by_type is immutable on public.opportunities';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_opportunity_identity_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_rev_action_material_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  trusted_actor boolean := current_user in ('postgres', 'service_role');
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.id is distinct from old.id
    or new.proposed_at is distinct from old.proposed_at then
    raise exception 'REV action identity is immutable';
  end if;

  if not trusted_actor and (
    new.execution_status is distinct from old.execution_status
    or new.executed_at is distinct from old.executed_at
    or new.outcome_summary is distinct from old.outcome_summary
  ) then
    raise exception 'REV action execution evidence is trusted-backend-only';
  end if;

  if new.goal_id is distinct from old.goal_id
    or new.contact_id is distinct from old.contact_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.action_type is distinct from old.action_type
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.rationale is distinct from old.rationale
    or new.requires_approval is distinct from old.requires_approval then
    if old.execution_status in ('in_progress', 'succeeded') then
      raise exception 'Material action fields cannot change after execution starts';
    end if;
    new.action_version := old.action_version + 1;
    new.status := case when new.requires_approval then 'awaiting_approval' else 'proposed' end;
    new.approved_at := null;
  elsif new.action_version is distinct from old.action_version then
    raise exception 'action_version is managed by the database';
  end if;

  if not trusted_actor and new.status is distinct from old.status then
    if new.status not in ('proposed', 'awaiting_approval', 'cancelled') then
      raise exception 'Authoritative REV action transitions require a trusted transaction';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_rev_action_material_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_workspace_execution_policy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Workspace execution policy identity is immutable';
  end if;
  new.version := old.version + 1;
  new.updated_by := auth.uid();
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_workspace_execution_policy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_rev_action_execution_result"("target_execution_id" "uuid", "target_status" "text", "target_result_summary" "text", "target_failure_code" "text", "usage_events" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "public"."rev_action_executions"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  locked_execution public.rev_action_executions;
  event jsonb;
  updated_execution public.rev_action_executions;
begin
  if target_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'terminal execution status required';
  end if;
  if pg_catalog.jsonb_typeof(usage_events) <> 'array' then raise exception 'usage_events must be an array'; end if;

  select * into locked_execution
  from public.rev_action_executions
  where id = target_execution_id
  for update;
  if not found then raise exception 'execution not found'; end if;
  if locked_execution.status not in ('prepared', 'in_progress') then
    raise exception 'execution is already terminal';
  end if;

  for event in select value from pg_catalog.jsonb_array_elements(usage_events)
  loop
    insert into public.provider_usage_events (
      workspace_id, execution_id, provider_key, operation, usage_event_key, units,
      estimated_provider_cost, actual_provider_cost, currency, provider_reference,
      correlation_id, status, occurred_at
    ) values (
      locked_execution.workspace_id,
      locked_execution.id,
      event->>'provider_key',
      event->>'operation',
      event->>'usage_event_key',
      coalesce((event->>'units')::numeric, 0),
      coalesce((event->>'estimated_provider_cost')::numeric, 0),
      (event->>'actual_provider_cost')::numeric,
      coalesce(event->>'currency', 'GBP'),
      event->>'provider_reference',
      locked_execution.correlation_id,
      coalesce(event->>'status', 'succeeded'),
      coalesce((event->>'occurred_at')::timestamptz, pg_catalog.now())
    );
  end loop;

  update public.rev_action_executions
  set status = target_status,
      started_at = coalesce(started_at, pg_catalog.now()),
      completed_at = pg_catalog.now(),
      result_summary = target_result_summary,
      failure_code = target_failure_code
  where id = locked_execution.id
  returning * into updated_execution;

  update public.rev_actions
  set status = case when target_status = 'succeeded' then 'completed' else 'failed' end,
      execution_status = case when target_status = 'succeeded' then 'succeeded' else 'failed' end,
      executed_at = pg_catalog.now(),
      outcome_summary = target_result_summary
  where workspace_id = locked_execution.workspace_id and id = locked_execution.action_id;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    locked_execution.workspace_id, null, 'system', 'execution.' || target_status,
    'rev_action_execution', locked_execution.id,
    pg_catalog.jsonb_build_object(
      'rev_action_id', locked_execution.action_id,
      'correlation_id', locked_execution.correlation_id,
      'failure_code', target_failure_code
    )
  );

  return updated_execution;
end;
$$;


ALTER FUNCTION "public"."record_rev_action_execution_result"("target_execution_id" "uuid", "target_status" "text", "target_result_summary" "text", "target_failure_code" "text", "usage_events" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rev_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "goal_id" "uuid",
    "contact_id" "uuid",
    "action_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "rationale" "text",
    "requires_approval" boolean DEFAULT true NOT NULL,
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "execution_status" "text" DEFAULT 'not_executed'::"text" NOT NULL,
    "proposed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_at" timestamp with time zone,
    "executed_at" timestamp with time zone,
    "outcome_summary" "text",
    "opportunity_id" "uuid",
    "action_version" bigint DEFAULT 1 NOT NULL,
    CONSTRAINT "rev_actions_action_version_check" CHECK (("action_version" > 0)),
    CONSTRAINT "rev_actions_execution_status_check" CHECK (("execution_status" = ANY (ARRAY['not_started'::"text", 'not_executed'::"text", 'in_progress'::"text", 'succeeded'::"text", 'failed'::"text"]))),
    CONSTRAINT "rev_actions_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'awaiting_approval'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."rev_actions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rev_action_material_fingerprint"("target_action" "public"."rev_actions") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'id', target_action.id,
          'workspace_id', target_action.workspace_id,
          'goal_id', target_action.goal_id,
          'contact_id', target_action.contact_id,
          'opportunity_id', target_action.opportunity_id,
          'action_type', target_action.action_type,
          'title', target_action.title,
          'description', target_action.description,
          'rationale', target_action.rationale,
          'requires_approval', target_action.requires_approval,
          'action_version', target_action.action_version
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;


ALTER FUNCTION "public"."rev_action_material_fingerprint"("target_action" "public"."rev_actions") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "supabase_functions"."http_request"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'supabase_functions'
    AS $$
    DECLARE
      request_id bigint;
      payload jsonb;
      url text := TG_ARGV[0]::text;
      method text := TG_ARGV[1]::text;
      headers jsonb DEFAULT '{}'::jsonb;
      params jsonb DEFAULT '{}'::jsonb;
      timeout_ms integer DEFAULT 1000;
    BEGIN
      IF url IS NULL OR url = 'null' THEN
        RAISE EXCEPTION 'url argument is missing';
      END IF;

      IF method IS NULL OR method = 'null' THEN
        RAISE EXCEPTION 'method argument is missing';
      END IF;

      IF TG_ARGV[2] IS NULL OR TG_ARGV[2] = 'null' THEN
        headers = '{"Content-Type": "application/json"}'::jsonb;
      ELSE
        headers = TG_ARGV[2]::jsonb;
      END IF;

      IF TG_ARGV[3] IS NULL OR TG_ARGV[3] = 'null' THEN
        params = '{}'::jsonb;
      ELSE
        params = TG_ARGV[3]::jsonb;
      END IF;

      IF TG_ARGV[4] IS NULL OR TG_ARGV[4] = 'null' THEN
        timeout_ms = 1000;
      ELSE
        timeout_ms = TG_ARGV[4]::integer;
      END IF;

      CASE
        WHEN method = 'GET' THEN
          SELECT http_get INTO request_id FROM net.http_get(
            url,
            params,
            headers,
            timeout_ms
          );
        WHEN method = 'POST' THEN
          payload = jsonb_build_object(
            'old_record', OLD,
            'record', NEW,
            'type', TG_OP,
            'table', TG_TABLE_NAME,
            'schema', TG_TABLE_SCHEMA
          );

          SELECT http_post INTO request_id FROM net.http_post(
            url,
            payload,
            params,
            headers,
            timeout_ms
          );
        ELSE
          RAISE EXCEPTION 'method argument % is invalid', method;
      END CASE;

      INSERT INTO supabase_functions.hooks
        (hook_table_id, hook_name, request_id)
      VALUES
        (TG_RELID, TG_NAME, request_id);

      RETURN NEW;
    END
  $$;


ALTER FUNCTION "supabase_functions"."http_request"() OWNER TO "supabase_functions_admin";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "actor_type" "text" NOT NULL,
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['user'::"text", 'rev'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_memory_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "title" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "structured_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "created_by_type" "text" NOT NULL,
    "created_by_id" "uuid",
    CONSTRAINT "business_memory_events_created_by_type_check" CHECK (("created_by_type" = ANY (ARRAY['user'::"text", 'rev'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."business_memory_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_profiles" (
    "workspace_id" "uuid" NOT NULL,
    "business_name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "website" "text",
    "industry" "text",
    "target_customers" "text" DEFAULT ''::"text" NOT NULL,
    "service_areas" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "opening_hours" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "differentiators" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "brand_voice" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."business_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "price_information" "text",
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."business_services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_suppressions" (
    "workspace_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contact_suppressions_reason_check" CHECK (("reason" = ANY (ARRAY['do_not_contact'::"text", 'unsubscribed'::"text", 'bounced'::"text", 'invalid_contact'::"text", 'frequency_cap'::"text"])))
);


ALTER TABLE "public"."contact_suppressions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "lifecycle" "text" NOT NULL,
    "name" "text" NOT NULL,
    "company" "text",
    "email" "text",
    "phone" "text",
    "source" "text",
    "estimated_value" numeric,
    "score" numeric,
    "last_interaction_at" timestamp with time zone,
    "next_action_at" timestamp with time zone,
    "owner_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contacts_lifecycle_check" CHECK (("lifecycle" = ANY (ARRAY['prospect'::"text", 'lead'::"text", 'customer'::"text", 'former_customer'::"text"]))),
    CONSTRAINT "contacts_score_check" CHECK ((("score" >= (0)::numeric) AND ("score" <= (100)::numeric)))
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "objective" "text" NOT NULL,
    "metric" "text" NOT NULL,
    "target_value" numeric NOT NULL,
    "current_value" numeric DEFAULT 0 NOT NULL,
    "start_date" "date" NOT NULL,
    "target_date" "date" NOT NULL,
    "priority" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "goals_current_value_check" CHECK (("current_value" >= (0)::numeric)),
    CONSTRAINT "goals_priority_check" CHECK (("priority" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "goals_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'paused'::"text", 'completed'::"text", 'archived'::"text"]))),
    CONSTRAINT "goals_target_value_check" CHECK (("target_value" >= (0)::numeric))
);


ALTER TABLE "public"."goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."opportunities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "opportunity_type" "text" NOT NULL,
    "stage" "text" DEFAULT 'new'::"text" NOT NULL,
    "source" "text" NOT NULL,
    "estimated_value" numeric(12,2),
    "currency" "text" DEFAULT 'GBP'::"text" NOT NULL,
    "probability" numeric(3,2),
    "attribution" "text" DEFAULT 'unattributed'::"text" NOT NULL,
    "created_by_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_activity_at" timestamp with time zone,
    "next_action_at" timestamp with time zone,
    "won_at" timestamp with time zone,
    "lost_at" timestamp with time zone,
    "lost_reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "opportunities_attribution_check" CHECK (("attribution" = ANY (ARRAY['owner_generated'::"text", 'rev_generated'::"text", 'rev_assisted'::"text", 'rev_recovered'::"text", 'unattributed'::"text"]))),
    CONSTRAINT "opportunities_created_by_type_check" CHECK (("created_by_type" = ANY (ARRAY['user'::"text", 'rev'::"text", 'system'::"text"]))),
    CONSTRAINT "opportunities_currency_check" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "opportunities_estimated_value_check" CHECK ((("estimated_value" IS NULL) OR ("estimated_value" >= (0)::numeric))),
    CONSTRAINT "opportunities_opportunity_type_check" CHECK (("opportunity_type" = ANY (ARRAY['commercial_lead'::"text", 'tender'::"text", 'contract'::"text", 'grant'::"text", 'partnership'::"text"]))),
    CONSTRAINT "opportunities_probability_check" CHECK ((("probability" IS NULL) OR (("probability" >= (0)::numeric) AND ("probability" <= (1)::numeric)))),
    CONSTRAINT "opportunities_source_check" CHECK (("source" = ANY (ARRAY['existing_customer'::"text", 'referral'::"text", 'website_enquiry'::"text", 'manual_lead'::"text", 'rev_prospect_discovery'::"text", 'rev_reactivation'::"text", 'tender'::"text", 'grant'::"text", 'campaign'::"text", 'social'::"text", 'partner'::"text", 'other'::"text"]))),
    CONSTRAINT "opportunities_stage_check" CHECK (("stage" = ANY (ARRAY['new'::"text", 'qualified'::"text", 'contacted'::"text", 'conversation'::"text", 'appointment'::"text", 'quote'::"text", 'follow_up'::"text", 'won'::"text", 'lost'::"text", 'dormant'::"text"])))
);


ALTER TABLE "public"."opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_usage_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "execution_id" "uuid",
    "provider_key" "text" NOT NULL,
    "operation" "text" NOT NULL,
    "usage_event_key" "text" NOT NULL,
    "units" numeric(14,4) DEFAULT 0 NOT NULL,
    "estimated_provider_cost" numeric(12,4) DEFAULT 0 NOT NULL,
    "actual_provider_cost" numeric(12,4),
    "currency" "text" DEFAULT 'GBP'::"text" NOT NULL,
    "provider_reference" "text",
    "correlation_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "provider_usage_events_actual_provider_cost_check" CHECK ((("actual_provider_cost" IS NULL) OR ("actual_provider_cost" >= (0)::numeric))),
    CONSTRAINT "provider_usage_events_currency_check" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "provider_usage_events_estimated_provider_cost_check" CHECK (("estimated_provider_cost" >= (0)::numeric)),
    CONSTRAINT "provider_usage_events_status_check" CHECK (("status" = ANY (ARRAY['estimated'::"text", 'succeeded'::"text", 'failed'::"text", 'ambiguous'::"text"]))),
    CONSTRAINT "provider_usage_events_units_check" CHECK (("units" >= (0)::numeric)),
    CONSTRAINT "provider_usage_events_usage_event_key_check" CHECK ((("char_length"("usage_event_key") >= 1) AND ("char_length"("usage_event_key") <= 200)))
);


ALTER TABLE "public"."provider_usage_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "full_name" "text" NOT NULL,
    "business_name" "text",
    "email" "text" NOT NULL,
    "phone" "text",
    "contact_method" "text" DEFAULT 'email'::"text" NOT NULL,
    "project_type" "text",
    "current_url" "text",
    "business_type" "text",
    "target_audience" "text",
    "page_count" "text",
    "budget" "text",
    "pages_needed" "text"[],
    "features_needed" "text"[],
    "branding_ready" "text",
    "content_ready" "text",
    "assets_ready" "text",
    "launch_date" "date",
    "start_soon" "text",
    "deposit_ok" "text",
    "project_details" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "selected_package" "text",
    "payment_option" "text",
    "payment_link_label" "text",
    "maintenance_plan" "text",
    "design_addons" "text"[],
    "payment_status" "text" DEFAULT 'unpaid'::"text",
    "consultation_status" "text" DEFAULT 'not_booked'::"text"
);


ALTER TABLE "public"."quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_execution_policies" (
    "workspace_id" "uuid" NOT NULL,
    "execution_enabled" boolean DEFAULT false NOT NULL,
    "autonomy_mode" "text" DEFAULT 'always_ask'::"text" NOT NULL,
    "per_attempt_provider_cost_ceiling" numeric(12,4) DEFAULT 0 NOT NULL,
    "monthly_provider_cost_ceiling" numeric(12,4) DEFAULT 0 NOT NULL,
    "approval_cost_threshold" numeric(12,4) DEFAULT 0 NOT NULL,
    "disabled_capabilities" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "version" bigint DEFAULT 1 NOT NULL,
    "updated_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspace_execution_policies_approval_cost_threshold_check" CHECK (("approval_cost_threshold" >= (0)::numeric)),
    CONSTRAINT "workspace_execution_policies_autonomy_mode_check" CHECK (("autonomy_mode" = ANY (ARRAY['always_ask'::"text", 'trusted_routine_actions'::"text", 'ask_above_threshold'::"text", 'disabled'::"text"]))),
    CONSTRAINT "workspace_execution_policies_monthly_provider_cost_ceilin_check" CHECK (("monthly_provider_cost_ceiling" >= (0)::numeric)),
    CONSTRAINT "workspace_execution_policies_per_attempt_provider_cost_ce_check" CHECK (("per_attempt_provider_cost_ceiling" >= (0)::numeric)),
    CONSTRAINT "workspace_execution_policies_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."workspace_execution_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_members" (
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspace_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text", 'viewer'::"text"]))),
    CONSTRAINT "workspace_members_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."workspace_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspaces_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "supabase_functions"."hooks" (
    "id" bigint NOT NULL,
    "hook_table_id" integer NOT NULL,
    "hook_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "request_id" bigint
);


ALTER TABLE "supabase_functions"."hooks" OWNER TO "supabase_functions_admin";


COMMENT ON TABLE "supabase_functions"."hooks" IS 'Supabase Functions Hooks: Audit trail for triggered hooks.';



CREATE SEQUENCE IF NOT EXISTS "supabase_functions"."hooks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "supabase_functions"."hooks_id_seq" OWNER TO "supabase_functions_admin";


ALTER SEQUENCE "supabase_functions"."hooks_id_seq" OWNED BY "supabase_functions"."hooks"."id";



CREATE TABLE IF NOT EXISTS "supabase_functions"."migrations" (
    "version" "text" NOT NULL,
    "inserted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "supabase_functions"."migrations" OWNER TO "supabase_functions_admin";


ALTER TABLE ONLY "supabase_functions"."hooks" ALTER COLUMN "id" SET DEFAULT "nextval"('"supabase_functions"."hooks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_workspace_action_id_key" UNIQUE ("workspace_id", "rev_action_id", "id");



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."business_memory_events"
    ADD CONSTRAINT "business_memory_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_memory_events"
    ADD CONSTRAINT "business_memory_events_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."business_profiles"
    ADD CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("workspace_id");



ALTER TABLE ONLY "public"."business_services"
    ADD CONSTRAINT "business_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_services"
    ADD CONSTRAINT "business_services_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."contact_suppressions"
    ADD CONSTRAINT "contact_suppressions_pkey" PRIMARY KEY ("workspace_id", "contact_id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunities_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."provider_usage_events"
    ADD CONSTRAINT "provider_usage_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_usage_events"
    ADD CONSTRAINT "provider_usage_events_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."provider_usage_events"
    ADD CONSTRAINT "provider_usage_events_workspace_id_provider_key_usage_event_key" UNIQUE ("workspace_id", "provider_key", "usage_event_key");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rev_action_executions"
    ADD CONSTRAINT "rev_action_executions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rev_action_executions"
    ADD CONSTRAINT "rev_action_executions_workspace_id_correlation_id_key" UNIQUE ("workspace_id", "correlation_id");



ALTER TABLE ONLY "public"."rev_action_executions"
    ADD CONSTRAINT "rev_action_executions_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."rev_action_executions"
    ADD CONSTRAINT "rev_action_executions_workspace_id_idempotency_key_key" UNIQUE ("workspace_id", "idempotency_key");



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."workspace_execution_policies"
    ADD CONSTRAINT "workspace_execution_policies_pkey" PRIMARY KEY ("workspace_id");



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id", "user_id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "supabase_functions"."hooks"
    ADD CONSTRAINT "hooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "supabase_functions"."migrations"
    ADD CONSTRAINT "migrations_pkey" PRIMARY KEY ("version");



CREATE INDEX "actions_workspace_idx" ON "public"."rev_actions" USING "btree" ("workspace_id");



CREATE INDEX "audit_workspace_timestamp_idx" ON "public"."audit_log" USING "btree" ("workspace_id", "timestamp" DESC);



CREATE INDEX "contacts_workspace_idx" ON "public"."contacts" USING "btree" ("workspace_id");



CREATE INDEX "goals_workspace_idx" ON "public"."goals" USING "btree" ("workspace_id");



CREATE INDEX "idx_quotes_created_at" ON "public"."quotes" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_quotes_status" ON "public"."quotes" USING "btree" ("status");



CREATE INDEX "memory_workspace_occurred_idx" ON "public"."business_memory_events" USING "btree" ("workspace_id", "occurred_at" DESC);



CREATE INDEX "opportunities_contact_idx" ON "public"."opportunities" USING "btree" ("workspace_id", "contact_id");



CREATE INDEX "opportunities_next_action_idx" ON "public"."opportunities" USING "btree" ("workspace_id", "next_action_at");



CREATE INDEX "opportunities_stage_idx" ON "public"."opportunities" USING "btree" ("workspace_id", "stage");



CREATE INDEX "opportunities_workspace_idx" ON "public"."opportunities" USING "btree" ("workspace_id");



CREATE INDEX "provider_usage_execution_idx" ON "public"."provider_usage_events" USING "btree" ("workspace_id", "execution_id");



CREATE INDEX "provider_usage_workspace_time_idx" ON "public"."provider_usage_events" USING "btree" ("workspace_id", "occurred_at" DESC);



CREATE INDEX "rev_action_executions_action_idx" ON "public"."rev_action_executions" USING "btree" ("workspace_id", "action_id", "created_at" DESC);



CREATE INDEX "rev_action_executions_status_idx" ON "public"."rev_action_executions" USING "btree" ("workspace_id", "status", "created_at");



CREATE INDEX "rev_actions_opportunity_idx" ON "public"."rev_actions" USING "btree" ("workspace_id", "opportunity_id");



CREATE INDEX "supabase_functions_hooks_h_table_id_h_name_idx" ON "supabase_functions"."hooks" USING "btree" ("hook_table_id", "hook_name");



CREATE INDEX "supabase_functions_hooks_request_id_idx" ON "supabase_functions"."hooks" USING "btree" ("request_id");



CREATE OR REPLACE TRIGGER "approvals_decision_immutable" BEFORE DELETE OR UPDATE ON "public"."approvals" FOR EACH ROW WHEN (("old"."decision" IS NOT NULL)) EXECUTE FUNCTION "public"."prevent_append_only_evidence_mutation"();



CREATE OR REPLACE TRIGGER "audit_log_append_only" BEFORE DELETE OR UPDATE ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_evidence_mutation"();



CREATE OR REPLACE TRIGGER "opportunities_identity_immutable" BEFORE UPDATE ON "public"."opportunities" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_opportunity_identity_mutation"();



CREATE OR REPLACE TRIGGER "provider_usage_events_append_only" BEFORE DELETE OR UPDATE ON "public"."provider_usage_events" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_evidence_mutation"();



CREATE OR REPLACE TRIGGER "quotes-telegram-alert" AFTER INSERT ON "public"."quotes" FOR EACH ROW EXECUTE FUNCTION "supabase_functions"."http_request"('https://ntbowgutwyyhhnmkadlv.supabase.co/functions/v1/telegram-alert-ts', 'POST', '{"Content-type":"application/json","Authorization":"Bearer <REDACTED_JWT>"}', '{}', '5000');



CREATE OR REPLACE TRIGGER "rev_actions_material_and_transition_guard" BEFORE UPDATE ON "public"."rev_actions" FOR EACH ROW EXECUTE FUNCTION "public"."protect_rev_action_material_changes"();



CREATE OR REPLACE TRIGGER "workspace_execution_policy_update_guard" BEFORE UPDATE ON "public"."workspace_execution_policies" FOR EACH ROW EXECUTE FUNCTION "public"."protect_workspace_execution_policy"();



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_workspace_id_rev_action_id_fkey" FOREIGN KEY ("workspace_id", "rev_action_id") REFERENCES "public"."rev_actions"("workspace_id", "id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_memory_events"
    ADD CONSTRAINT "business_memory_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_profiles"
    ADD CONSTRAINT "business_profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_services"
    ADD CONSTRAINT "business_services_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_suppressions"
    ADD CONSTRAINT "contact_suppressions_workspace_id_contact_id_fkey" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id");



ALTER TABLE ONLY "public"."contact_suppressions"
    ADD CONSTRAINT "contact_suppressions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunities_workspace_id_contact_id_fkey" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id");



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_usage_events"
    ADD CONSTRAINT "provider_usage_events_workspace_id_execution_id_fkey" FOREIGN KEY ("workspace_id", "execution_id") REFERENCES "public"."rev_action_executions"("workspace_id", "id");



ALTER TABLE ONLY "public"."provider_usage_events"
    ADD CONSTRAINT "provider_usage_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rev_action_executions"
    ADD CONSTRAINT "rev_action_executions_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rev_action_executions"
    ADD CONSTRAINT "rev_action_executions_workspace_id_action_id_approval_id_fkey" FOREIGN KEY ("workspace_id", "action_id", "approval_id") REFERENCES "public"."approvals"("workspace_id", "rev_action_id", "id");



ALTER TABLE ONLY "public"."rev_action_executions"
    ADD CONSTRAINT "rev_action_executions_workspace_id_action_id_fkey" FOREIGN KEY ("workspace_id", "action_id") REFERENCES "public"."rev_actions"("workspace_id", "id");



ALTER TABLE ONLY "public"."rev_action_executions"
    ADD CONSTRAINT "rev_action_executions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_opportunity_fk" FOREIGN KEY ("workspace_id", "opportunity_id") REFERENCES "public"."opportunities"("workspace_id", "id");



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_workspace_id_contact_id_fkey" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id");



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_workspace_id_goal_id_fkey" FOREIGN KEY ("workspace_id", "goal_id") REFERENCES "public"."goals"("workspace_id", "id");



ALTER TABLE ONLY "public"."workspace_execution_policies"
    ADD CONSTRAINT "workspace_execution_policies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."workspace_execution_policies"
    ADD CONSTRAINT "workspace_execution_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



CREATE POLICY "allow authenticated reads" ON "public"."quotes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "allow public inserts" ON "public"."quotes" FOR INSERT TO "anon" WITH CHECK (true);



ALTER TABLE "public"."approvals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "approvals_insert_pending" ON "public"."approvals" FOR INSERT WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]) AND ("decision" IS NULL) AND ("decided_at" IS NULL) AND ("decided_by" IS NULL) AND ("action_version" IS NULL) AND ("action_fingerprint" IS NULL)));



CREATE POLICY "approvals_select" ON "public"."approvals" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_select_owner_admin" ON "public"."audit_log" FOR SELECT USING ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]));



ALTER TABLE "public"."business_memory_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "business_profiles_tenant" ON "public"."business_profiles" USING ("public"."is_active_workspace_member"("workspace_id")) WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."business_services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "business_services_tenant" ON "public"."business_services" USING ("public"."is_active_workspace_member"("workspace_id")) WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."contact_suppressions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_suppressions_tenant" ON "public"."contact_suppressions" USING ("public"."is_active_workspace_member"("workspace_id")) WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_tenant" ON "public"."contacts" USING ("public"."is_active_workspace_member"("workspace_id")) WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "goals_insert" ON "public"."goals" FOR INSERT WITH CHECK ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]));



CREATE POLICY "goals_select" ON "public"."goals" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



CREATE POLICY "goals_update" ON "public"."goals" FOR UPDATE USING ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])) WITH CHECK ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]));



CREATE POLICY "memory_events_insert_user" ON "public"."business_memory_events" FOR INSERT WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]) AND ("created_by_type" = 'user'::"text") AND ("created_by_id" = "auth"."uid"())));



CREATE POLICY "memory_events_select" ON "public"."business_memory_events" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."opportunities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "opportunities_insert_role_safe" ON "public"."opportunities" FOR INSERT WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]) AND ("created_by_type" = 'user'::"text")));



CREATE POLICY "opportunities_select" ON "public"."opportunities" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



CREATE POLICY "opportunities_update_role_safe" ON "public"."opportunities" FOR UPDATE USING ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])) WITH CHECK ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]));



ALTER TABLE "public"."provider_usage_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "provider_usage_events_select" ON "public"."provider_usage_events" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."quotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rev_action_executions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rev_action_executions_select" ON "public"."rev_action_executions" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."rev_actions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rev_actions_insert" ON "public"."rev_actions" FOR INSERT WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]) AND ("status" = ANY (ARRAY['proposed'::"text", 'awaiting_approval'::"text"])) AND ("execution_status" = 'not_executed'::"text") AND ("action_version" = 1) AND ("approved_at" IS NULL) AND ("executed_at" IS NULL) AND ("outcome_summary" IS NULL)));



CREATE POLICY "rev_actions_select" ON "public"."rev_actions" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



CREATE POLICY "rev_actions_update_proposal" ON "public"."rev_actions" FOR UPDATE USING (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]) AND ("status" = ANY (ARRAY['proposed'::"text", 'awaiting_approval'::"text"])) AND ("execution_status" = 'not_executed'::"text"))) WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]) AND ("status" = ANY (ARRAY['proposed'::"text", 'awaiting_approval'::"text", 'cancelled'::"text"])) AND ("execution_status" = 'not_executed'::"text") AND ("approved_at" IS NULL) AND ("executed_at" IS NULL) AND ("outcome_summary" IS NULL)));



ALTER TABLE "public"."workspace_execution_policies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_execution_policies_insert" ON "public"."workspace_execution_policies" FOR INSERT WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]) AND ("updated_by" = "auth"."uid"())));



CREATE POLICY "workspace_execution_policies_select" ON "public"."workspace_execution_policies" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



CREATE POLICY "workspace_execution_policies_update" ON "public"."workspace_execution_policies" FOR UPDATE USING ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"])) WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]) AND ("updated_by" = "auth"."uid"())));



ALTER TABLE "public"."workspace_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_members_select" ON "public"."workspace_members" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspaces_select" ON "public"."workspaces" FOR SELECT USING ("public"."is_active_workspace_member"("id"));



CREATE POLICY "workspaces_update" ON "public"."workspaces" FOR UPDATE USING ("public"."has_workspace_role"("id", ARRAY['owner'::"text", 'admin'::"text"]));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT USAGE ON SCHEMA "supabase_functions" TO "postgres";
GRANT USAGE ON SCHEMA "supabase_functions" TO "anon";
GRANT USAGE ON SCHEMA "supabase_functions" TO "authenticated";
GRANT USAGE ON SCHEMA "supabase_functions" TO "service_role";
GRANT ALL ON SCHEMA "supabase_functions" TO "supabase_functions_admin";



REVOKE ALL ON FUNCTION "public"."create_workspace_with_owner"("workspace_name" "text", "workspace_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_workspace_with_owner"("workspace_name" "text", "workspace_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_workspace_with_owner"("workspace_name" "text", "workspace_slug" "text") TO "service_role";



GRANT ALL ON TABLE "public"."approvals" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."approvals" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_rev_action_approval"("target_approval_id" "uuid", "expected_action_version" bigint, "expected_action_fingerprint" "text", "approval_decision" "text", "decision_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_rev_action_approval"("target_approval_id" "uuid", "expected_action_version" bigint, "expected_action_fingerprint" "text", "approval_decision" "text", "decision_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decide_rev_action_approval"("target_approval_id" "uuid", "expected_action_version" bigint, "expected_action_fingerprint" "text", "approval_decision" "text", "decision_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_active_workspace_member"("target_workspace_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_workspace_member"("target_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_workspace_member"("target_workspace_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."rev_action_executions" TO "service_role";
GRANT SELECT ON TABLE "public"."rev_action_executions" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."prepare_rev_action_execution"("target_workspace_id" "uuid", "target_action_id" "uuid", "target_idempotency_key" "text", "target_request_fingerprint" "text", "target_correlation_id" "uuid", "target_capability" "text", "target_risk_class" "text", "target_jurisdiction" "text", "target_estimated_provider_cost" numeric, "target_provider_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_rev_action_execution"("target_workspace_id" "uuid", "target_action_id" "uuid", "target_idempotency_key" "text", "target_request_fingerprint" "text", "target_correlation_id" "uuid", "target_capability" "text", "target_risk_class" "text", "target_jurisdiction" "text", "target_estimated_provider_cost" numeric, "target_provider_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_rev_action_execution"("target_workspace_id" "uuid", "target_action_id" "uuid", "target_idempotency_key" "text", "target_request_fingerprint" "text", "target_correlation_id" "uuid", "target_capability" "text", "target_risk_class" "text", "target_jurisdiction" "text", "target_estimated_provider_cost" numeric, "target_provider_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_append_only_evidence_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_append_only_evidence_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_opportunity_identity_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_opportunity_identity_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."protect_rev_action_material_changes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protect_rev_action_material_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."protect_workspace_execution_policy"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protect_workspace_execution_policy"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_rev_action_execution_result"("target_execution_id" "uuid", "target_status" "text", "target_result_summary" "text", "target_failure_code" "text", "usage_events" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_rev_action_execution_result"("target_execution_id" "uuid", "target_status" "text", "target_result_summary" "text", "target_failure_code" "text", "usage_events" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."rev_actions" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."rev_actions" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rev_action_material_fingerprint"("target_action" "public"."rev_actions") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rev_action_material_fingerprint"("target_action" "public"."rev_actions") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "supabase_functions"."http_request"() FROM PUBLIC;
GRANT ALL ON FUNCTION "supabase_functions"."http_request"() TO "postgres";
GRANT ALL ON FUNCTION "supabase_functions"."http_request"() TO "anon";
GRANT ALL ON FUNCTION "supabase_functions"."http_request"() TO "authenticated";
GRANT ALL ON FUNCTION "supabase_functions"."http_request"() TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "service_role";
GRANT SELECT ON TABLE "public"."audit_log" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."business_memory_events" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."business_memory_events" TO "authenticated";
GRANT ALL ON TABLE "public"."business_memory_events" TO "service_role";



GRANT ALL ON TABLE "public"."business_profiles" TO "anon";
GRANT ALL ON TABLE "public"."business_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."business_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."business_services" TO "anon";
GRANT ALL ON TABLE "public"."business_services" TO "authenticated";
GRANT ALL ON TABLE "public"."business_services" TO "service_role";



GRANT ALL ON TABLE "public"."contact_suppressions" TO "anon";
GRANT ALL ON TABLE "public"."contact_suppressions" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_suppressions" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."goals" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."goals" TO "authenticated";
GRANT ALL ON TABLE "public"."goals" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."opportunities" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."opportunities" TO "service_role";



GRANT ALL ON TABLE "public"."provider_usage_events" TO "service_role";
GRANT SELECT ON TABLE "public"."provider_usage_events" TO "authenticated";



GRANT ALL ON TABLE "public"."quotes" TO "anon";
GRANT ALL ON TABLE "public"."quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."quotes" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_execution_policies" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."workspace_execution_policies" TO "authenticated";



GRANT ALL ON TABLE "public"."workspace_members" TO "anon";
GRANT ALL ON TABLE "public"."workspace_members" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_members" TO "service_role";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";



GRANT ALL ON TABLE "supabase_functions"."hooks" TO "postgres";
GRANT ALL ON TABLE "supabase_functions"."hooks" TO "anon";
GRANT ALL ON TABLE "supabase_functions"."hooks" TO "authenticated";
GRANT ALL ON TABLE "supabase_functions"."hooks" TO "service_role";



GRANT ALL ON SEQUENCE "supabase_functions"."hooks_id_seq" TO "postgres";
GRANT ALL ON SEQUENCE "supabase_functions"."hooks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "supabase_functions"."hooks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "supabase_functions"."hooks_id_seq" TO "service_role";



GRANT ALL ON TABLE "supabase_functions"."migrations" TO "postgres";
GRANT ALL ON TABLE "supabase_functions"."migrations" TO "anon";
GRANT ALL ON TABLE "supabase_functions"."migrations" TO "authenticated";
GRANT ALL ON TABLE "supabase_functions"."migrations" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































