


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
    CONSTRAINT "approvals_decision_check" CHECK (("decision" = ANY (ARRAY['approved'::"text", 'rejected'::"text", 'edited'::"text"])))
);


ALTER TABLE "public"."approvals" OWNER TO "postgres";


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
    "execution_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "proposed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_at" timestamp with time zone,
    "executed_at" timestamp with time zone,
    "outcome_summary" "text",
    "opportunity_id" "uuid",
    CONSTRAINT "rev_actions_execution_status_check" CHECK (("execution_status" = ANY (ARRAY['not_started'::"text", 'not_executed'::"text", 'in_progress'::"text", 'succeeded'::"text", 'failed'::"text"]))),
    CONSTRAINT "rev_actions_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'awaiting_approval'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."rev_actions" OWNER TO "postgres";


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


ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id", "user_id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_slug_key" UNIQUE ("slug");



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



CREATE INDEX "rev_actions_opportunity_idx" ON "public"."rev_actions" USING "btree" ("workspace_id", "opportunity_id");



CREATE OR REPLACE TRIGGER "opportunities_identity_immutable" BEFORE UPDATE ON "public"."opportunities" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_opportunity_identity_mutation"();



CREATE OR REPLACE TRIGGER "quotes-telegram-alert" AFTER INSERT ON "public"."quotes" FOR EACH ROW EXECUTE FUNCTION "supabase_functions"."http_request"('https://ntbowgutwyyhhnmkadlv.supabase.co/functions/v1/telegram-alert-ts', 'POST', '{"Content-type":"application/json","Authorization":"Bearer <REDACTED_JWT>"}', '{}', '5000');



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



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_opportunity_fk" FOREIGN KEY ("workspace_id", "opportunity_id") REFERENCES "public"."opportunities"("workspace_id", "id");



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_workspace_id_contact_id_fkey" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id");



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rev_actions"
    ADD CONSTRAINT "rev_actions_workspace_id_goal_id_fkey" FOREIGN KEY ("workspace_id", "goal_id") REFERENCES "public"."goals"("workspace_id", "id");



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



CREATE POLICY "allow authenticated reads" ON "public"."quotes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "allow public inserts" ON "public"."quotes" FOR INSERT TO "anon" WITH CHECK (true);



ALTER TABLE "public"."approvals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "approvals_tenant" ON "public"."approvals" USING ("public"."is_active_workspace_member"("workspace_id")) WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_insert" ON "public"."audit_log" FOR INSERT WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



CREATE POLICY "audit_log_select" ON "public"."audit_log" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



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


CREATE POLICY "goals_tenant" ON "public"."goals" USING ("public"."is_active_workspace_member"("workspace_id")) WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



CREATE POLICY "memory_events_tenant" ON "public"."business_memory_events" USING ("public"."is_active_workspace_member"("workspace_id")) WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."opportunities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "opportunities_insert" ON "public"."opportunities" FOR INSERT WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



CREATE POLICY "opportunities_select" ON "public"."opportunities" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



CREATE POLICY "opportunities_update" ON "public"."opportunities" FOR UPDATE USING ("public"."is_active_workspace_member"("workspace_id")) WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."quotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rev_actions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rev_actions_tenant" ON "public"."rev_actions" USING ("public"."is_active_workspace_member"("workspace_id")) WITH CHECK ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."workspace_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_members_select" ON "public"."workspace_members" FOR SELECT USING ("public"."is_active_workspace_member"("workspace_id"));



ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspaces_select" ON "public"."workspaces" FOR SELECT USING ("public"."is_active_workspace_member"("id"));



CREATE POLICY "workspaces_update" ON "public"."workspaces" FOR UPDATE USING ("public"."has_workspace_role"("id", ARRAY['owner'::"text", 'admin'::"text"]));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_workspace_with_owner"("workspace_name" "text", "workspace_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_workspace_with_owner"("workspace_name" "text", "workspace_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_workspace_with_owner"("workspace_name" "text", "workspace_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_active_workspace_member"("target_workspace_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_workspace_member"("target_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_workspace_member"("target_workspace_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_opportunity_identity_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_opportunity_identity_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON TABLE "public"."approvals" TO "anon";
GRANT ALL ON TABLE "public"."approvals" TO "authenticated";
GRANT ALL ON TABLE "public"."approvals" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."business_memory_events" TO "anon";
GRANT ALL ON TABLE "public"."business_memory_events" TO "authenticated";
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



GRANT ALL ON TABLE "public"."goals" TO "anon";
GRANT ALL ON TABLE "public"."goals" TO "authenticated";
GRANT ALL ON TABLE "public"."goals" TO "service_role";



GRANT ALL ON TABLE "public"."opportunities" TO "anon";
GRANT ALL ON TABLE "public"."opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."opportunities" TO "service_role";



GRANT ALL ON TABLE "public"."quotes" TO "anon";
GRANT ALL ON TABLE "public"."quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."quotes" TO "service_role";



GRANT ALL ON TABLE "public"."rev_actions" TO "anon";
GRANT ALL ON TABLE "public"."rev_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."rev_actions" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_members" TO "anon";
GRANT ALL ON TABLE "public"."workspace_members" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_members" TO "service_role";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";



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







