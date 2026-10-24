-- REV local vocational assessment schema parity. Extracted from user-provided remote public pg_dump.
-- Install ONLY in local development; DO NOT push to remote.
-- Contains no participant records.


CREATE TABLE IF NOT EXISTS "public"."programme_hub_vocational_assessments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "programme_id" "uuid" NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "template_version_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "version" bigint DEFAULT 1 NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "updated_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "programme_hub_vocational_assessments_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'completed'::"text", 'void'::"text"]))),
    CONSTRAINT "programme_hub_vocational_assessments_version_check" CHECK (("version" > 0)),
    CONSTRAINT "rev_assessment_completion_consistency" CHECK (((("status" = 'completed'::"text") AND ("completed_at" IS NOT NULL)) OR (("status" <> 'completed'::"text") AND ("completed_at" IS NULL))))
);


ALTER TABLE "public"."programme_hub_vocational_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programme_hub_vocational_assessment_answers" (
    "assessment_id" "uuid" NOT NULL,
    "question_id" "text" NOT NULL,
    "answer" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "programme_hub_vocational_assessment_answers_question_id_check" CHECK ((("length"("question_id") >= 1) AND ("length"("question_id") <= 120)))
);


ALTER TABLE "public"."programme_hub_vocational_assessment_answers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programme_hub_vocational_assessment_audit" (
    "id" bigint NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "assessment_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "changed_question_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "programme_hub_vocational_assessment_audit_action_check" CHECK (("action" = ANY (ARRAY['created'::"text", 'read'::"text", 'saved'::"text"])))
);


ALTER TABLE "public"."programme_hub_vocational_assessment_audit" OWNER TO "postgres";


ALTER TABLE "public"."programme_hub_vocational_assessment_audit" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."programme_hub_vocational_assessment_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."programme_hub_vocational_restricted_answers" (
    "assessment_id" "uuid" NOT NULL,
    "question_id" "text" NOT NULL,
    "answer" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "programme_hub_vocational_restricted_answers_question_id_check" CHECK ((("length"("question_id") >= 1) AND ("length"("question_id") <= 120)))
);


ALTER TABLE "public"."programme_hub_vocational_restricted_answers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programme_hub_vocational_status_events" (
    "id" bigint NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "assessment_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "programme_hub_vocational_status_events_action_check" CHECK (("action" = 'completed'::"text"))
);


ALTER TABLE "public"."programme_hub_vocational_status_events" OWNER TO "postgres";


ALTER TABLE "public"."programme_hub_vocational_status_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."programme_hub_vocational_status_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


ALTER TABLE ONLY "public"."programme_hub_vocational_assessment_answers"
    ADD CONSTRAINT "programme_hub_vocational_assessment_answers_pkey" PRIMARY KEY ("assessment_id", "question_id");


ALTER TABLE ONLY "public"."programme_hub_vocational_assessment_audit"
    ADD CONSTRAINT "programme_hub_vocational_assessment_audit_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."programme_hub_vocational_assessments"
    ADD CONSTRAINT "programme_hub_vocational_assessments_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."programme_hub_vocational_assessments"
    ADD CONSTRAINT "programme_hub_vocational_assessments_workspace_id_id_key" UNIQUE ("workspace_id", "id");


ALTER TABLE ONLY "public"."programme_hub_vocational_restricted_answers"
    ADD CONSTRAINT "programme_hub_vocational_restricted_answers_pkey" PRIMARY KEY ("assessment_id", "question_id");


ALTER TABLE ONLY "public"."programme_hub_vocational_status_events"
    ADD CONSTRAINT "programme_hub_vocational_status_events_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."programme_hub_vocational_assessments"
    ADD CONSTRAINT "programme_hub_vocational_asse_workspace_id_created_by_user_fkey" FOREIGN KEY ("workspace_id", "created_by_user_id") REFERENCES "public"."workspace_members"("workspace_id", "user_id");


ALTER TABLE ONLY "public"."programme_hub_vocational_assessments"
    ADD CONSTRAINT "programme_hub_vocational_asse_workspace_id_updated_by_user_fkey" FOREIGN KEY ("workspace_id", "updated_by_user_id") REFERENCES "public"."workspace_members"("workspace_id", "user_id");


ALTER TABLE ONLY "public"."programme_hub_vocational_assessment_answers"
    ADD CONSTRAINT "programme_hub_vocational_assessment_answers_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."programme_hub_vocational_assessments"("id");


ALTER TABLE ONLY "public"."programme_hub_vocational_assessment_audit"
    ADD CONSTRAINT "programme_hub_vocational_assessment_audit_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."programme_hub_vocational_assessments"("id");


ALTER TABLE ONLY "public"."programme_hub_vocational_assessments"
    ADD CONSTRAINT "programme_hub_vocational_assessments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."programme_hub_participants"("id");


ALTER TABLE ONLY "public"."programme_hub_vocational_assessments"
    ADD CONSTRAINT "programme_hub_vocational_assessments_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "public"."programme_hub_vocational_template_versions"("id");


ALTER TABLE ONLY "public"."programme_hub_vocational_restricted_answers"
    ADD CONSTRAINT "programme_hub_vocational_restricted_answers_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."programme_hub_vocational_assessments"("id");


ALTER TABLE ONLY "public"."programme_hub_vocational_status_events"
    ADD CONSTRAINT "programme_hub_vocational_status_events_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."programme_hub_vocational_assessments"("id");


CREATE INDEX "rev_assessments_participant_idx" ON "public"."programme_hub_vocational_assessments" USING "btree" ("workspace_id", "programme_id", "participant_id");


CREATE INDEX "rev_voc_assessment_audit_idx" ON "public"."programme_hub_vocational_assessment_audit" USING "btree" ("workspace_id", "assessment_id", "occurred_at" DESC);


CREATE INDEX "rev_voc_status_events_assessment_idx" ON "public"."programme_hub_vocational_status_events" USING "btree" ("workspace_id", "assessment_id", "occurred_at" DESC);


CREATE OR REPLACE FUNCTION "public"."rev_assessment_validate_links"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare p record; v record; t record;
begin
  select workspace_id,programme_id into p from public.programme_hub_participants where id = new.participant_id;
  if not found or p.workspace_id is distinct from new.workspace_id
    or p.programme_id is distinct from new.programme_id then
    raise exception 'Assessment participant/programme mismatch' using errcode='23514';
  end if;
  select workspace_id,template_id into v from public.programme_hub_vocational_template_versions where id = new.template_version_id;
  if not found or v.workspace_id is distinct from new.workspace_id then
    raise exception 'Assessment template workspace mismatch' using errcode='23514';
  end if;
  select programme_id into t from public.programme_hub_vocational_templates
    where id = v.template_id and workspace_id = new.workspace_id;
  if not found or (t.programme_id is not null and t.programme_id is distinct from new.programme_id) then
    raise exception 'Assessment template programme mismatch' using errcode='23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.workspace_id is distinct from old.workspace_id or
    new.programme_id is distinct from old.programme_id or
    new.participant_id is distinct from old.participant_id or
    new.template_version_id is distinct from old.template_version_id or
    new.created_by_user_id is distinct from old.created_by_user_id
  ) then
    raise exception 'Assessment identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."rev_assessment_validate_links"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rev_voc_assessment_authorised"("p_workspace" "uuid", "p_programme" "uuid", "p_participant" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor uuid := auth.uid();
begin
  if actor is null or not public.can_use_rev_module(p_workspace,'programme')
    or not public.can_access_rev_programme(p_workspace,p_programme) then return false; end if;
  if not exists (
    select 1 from public.programme_hub_participants p
    where p.id=p_participant and p.workspace_id=p_workspace and p.programme_id=p_programme
  ) then return false; end if;
  return public.has_workspace_role(p_workspace,array['owner','admin'])
    or exists (
      select 1 from public.programme_hub_participant_advisers a
      where a.workspace_id=p_workspace and a.programme_id=p_programme
        and a.participant_id=p_participant and a.adviser_user_id=actor and a.active=true
    );
end;
$$;


ALTER FUNCTION "public"."rev_voc_assessment_authorised"("p_workspace" "uuid", "p_programme" "uuid", "p_participant" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rev_voc_assessment_complete"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_assessment_id" "uuid", "expected_version" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  actor uuid := auth.uid();
  a public.programme_hub_vocational_assessments%ROWTYPE;
  v record;
  missing_count integer;
BEGIN
  IF actor IS NULL OR NOT public.rev_voc_assessment_authorised(target_workspace_id,target_programme_id,target_participant_id) THEN
    RAISE EXCEPTION 'Not authorised for participant assessment' USING ERRCODE='42501';
  END IF;
  SELECT * INTO a FROM public.programme_hub_vocational_assessments
  WHERE id=target_assessment_id AND workspace_id=target_workspace_id
    AND programme_id=target_programme_id AND participant_id=target_participant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment not found' USING ERRCODE='22023'; END IF;
  IF a.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft can be completed' USING ERRCODE='22023'; END IF;
  IF expected_version IS NULL OR expected_version <> a.version THEN
    RAISE EXCEPTION 'Assessment changed; reload before completing' USING ERRCODE='40001';
  END IF;
  SELECT sections INTO v FROM public.programme_hub_vocational_template_versions
    WHERE id=a.template_version_id AND workspace_id=target_workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment snapshot missing' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO missing_count
  FROM pg_catalog.jsonb_array_elements(v.sections) AS s(section)
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
    CASE WHEN pg_catalog.jsonb_typeof(s.section->'questions')='array' THEN s.section->'questions' ELSE '[]'::jsonb END
  ) AS q(question)
  WHERE public.rev_voc_is_ordinary_question(s.section,q.question)
    AND coalesce((q.question->>'required')::boolean,false)=true
    AND NOT EXISTS (
      SELECT 1 FROM public.programme_hub_vocational_assessment_answers ans
      WHERE ans.assessment_id=a.id AND ans.question_id=q.question->>'id'
        AND ans.answer NOT IN ('null'::jsonb,'""'::jsonb,'[]'::jsonb)
    );
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v.sections) AS sec(section)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(sec.section->'questions')='array'
        THEN sec.section->'questions' ELSE '[]'::jsonb END
    ) AS item(question)
    JOIN public.programme_hub_vocational_assessment_answers ans
      ON ans.assessment_id=a.id AND ans.question_id=item.question->>'id'
    WHERE public.rev_voc_is_ordinary_question(sec.section,item.question)
      AND ans.answer NOT IN ('null'::jsonb,'""'::jsonb,'[]'::jsonb)
  ) THEN
    RAISE EXCEPTION 'Answer at least one ordinary question before completing' USING ERRCODE='22023';
  END IF;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Complete % required ordinary questions before marking complete',missing_count USING ERRCODE='22023';
  END IF;
  UPDATE public.programme_hub_vocational_assessments
  SET status='completed',completed_at=now(),updated_at=now(),updated_by_user_id=actor,version=version+1
  WHERE id=a.id RETURNING * INTO a;
  INSERT INTO public.programme_hub_vocational_status_events(workspace_id,assessment_id,actor_user_id,action)
  VALUES(target_workspace_id,a.id,actor,'completed');
  RETURN pg_catalog.jsonb_build_object('status','completed','assessmentId',a.id,
    'version',a.version,'completedAt',a.completed_at,'updatedByUserId',actor);
END;
$$;


ALTER FUNCTION "public"."rev_voc_assessment_complete"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_assessment_id" "uuid", "expected_version" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rev_voc_assessment_draft"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_template_version_id" "uuid", "target_action" "text" DEFAULT 'open'::"text", "target_assessment_id" "uuid" DEFAULT NULL::"uuid", "expected_version" bigint DEFAULT NULL::bigint, "target_answers" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor uuid := auth.uid();
  v record; a public.programme_hub_vocational_assessments%rowtype;
  s jsonb; q jsonb; key text; val jsonb; qtype text; opts jsonb;
  permitted jsonb := '{}'::jsonb; found_question boolean; blocked boolean;
  ids text[] := '{}';
begin
  if actor is null or not public.rev_voc_assessment_authorised(target_workspace_id,target_programme_id,target_participant_id)
  then raise exception 'Not authorised for participant assessment' using errcode='42501'; end if;
  if target_action not in ('open','save') then raise exception 'Unsupported action' using errcode='22023'; end if;
  select v0.id,v0.sections into v
  from public.programme_hub_vocational_template_versions v0
  join public.programme_hub_vocational_templates t
    on t.id=v0.template_id and t.workspace_id=v0.workspace_id
  where v0.id=target_template_version_id and v0.workspace_id=target_workspace_id
    and (t.programme_id=target_programme_id or t.programme_id is null)
    and t.status in ('published','archived');
  if not found then raise exception 'Published questionnaire version not found' using errcode='22023'; end if;

  if target_action='open' and target_assessment_id is null then
    -- Serialise competing creates for this participant/snapshot.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      target_workspace_id::text || ':' || target_participant_id::text || ':' || target_template_version_id::text,0));
    select * into a from public.programme_hub_vocational_assessments
      where workspace_id=target_workspace_id and programme_id=target_programme_id
        and participant_id=target_participant_id and template_version_id=target_template_version_id
        and status='draft' order by created_at desc limit 1 for update;
    if not found then
      insert into public.programme_hub_vocational_assessments
        (workspace_id,programme_id,participant_id,template_version_id,created_by_user_id,updated_by_user_id)
      values (target_workspace_id,target_programme_id,target_participant_id,target_template_version_id,actor,actor)
      returning * into a;
      insert into public.programme_hub_vocational_assessment_audit(workspace_id,assessment_id,actor_user_id,action)
      values (target_workspace_id,a.id,actor,'created');
    end if;
  else
    if target_assessment_id is null then raise exception 'Assessment id required' using errcode='22023'; end if;
    select * into a from public.programme_hub_vocational_assessments
      where id=target_assessment_id and workspace_id=target_workspace_id
        and programme_id=target_programme_id and participant_id=target_participant_id
        and template_version_id=target_template_version_id for update;
    if not found then raise exception 'Assessment not found' using errcode='22023'; end if;
  end if;

  if target_action='save' then
    if a.status <> 'draft' then raise exception 'Assessment is not editable' using errcode='22023'; end if;
    if expected_version is null or expected_version <> a.version then
      raise exception 'Assessment changed; reload before saving' using errcode='40001'; end if;
    if target_answers is null or pg_catalog.jsonb_typeof(target_answers)<>'object'
      or (select count(*) from pg_catalog.jsonb_object_keys(target_answers))>200 then
      raise exception 'Invalid answer payload' using errcode='22023'; end if;
    for key,val in select * from pg_catalog.jsonb_each(target_answers) loop
      found_question := false; blocked := false;
      for s in select value from pg_catalog.jsonb_array_elements(v.sections) loop
        for q in select value from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(s->'questions')='array' then s->'questions' else '[]'::jsonb end
        ) loop
          if q->>'id'=key then
            found_question := true;
            blocked := NOT public.rev_voc_is_ordinary_question(s,q);
            qtype := q->>'type'; opts := q->'options';
            exit;
          end if;
        end loop;
        exit when found_question;
      end loop;
      if not found_question or blocked then raise exception 'Question unavailable for ordinary assessment' using errcode='42501'; end if;
      if val <> 'null'::jsonb then
        if qtype in ('short_text','long_text','date','single_select','yes_no_prefer_not') then
          if pg_catalog.jsonb_typeof(val)<>'string' or length(val #>> '{}')>4000 then
            raise exception 'Invalid text answer' using errcode='22023'; end if;
          if qtype='short_text' and length(val #>> '{}')>500 then raise exception 'Answer too long' using errcode='22023'; end if;
          if qtype='date' and (val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date' using errcode='22023'; end if;
          if qtype='single_select' and not opts @> pg_catalog.jsonb_build_array(val) then raise exception 'Invalid selection' using errcode='22023'; end if;
          if qtype='yes_no_prefer_not' and (val #>> '{}') not in ('yes','no','prefer_not_to_say') then raise exception 'Invalid choice' using errcode='22023'; end if;
        elsif qtype='number' then
          if pg_catalog.jsonb_typeof(val)<>'number' then raise exception 'Invalid number' using errcode='22023'; end if;
        elsif qtype='checkbox' then
          if pg_catalog.jsonb_typeof(val)<>'boolean' then raise exception 'Invalid checkbox' using errcode='22023'; end if;
        elsif qtype='multi_select' then
          if pg_catalog.jsonb_typeof(val)<>'array' or pg_catalog.jsonb_array_length(val)>100
            or exists (select 1 from pg_catalog.jsonb_array_elements(val) x where not opts @> pg_catalog.jsonb_build_array(x.value))
          then raise exception 'Invalid multi-selection' using errcode='22023'; end if;
        else raise exception 'Unsupported question type' using errcode='22023'; end if;
      end if;
      ids := pg_catalog.array_append(ids,key);
      if val='null'::jsonb then
        delete from public.programme_hub_vocational_assessment_answers where assessment_id=a.id and question_id=key;
      else
        insert into public.programme_hub_vocational_assessment_answers(assessment_id,question_id,answer)
        values(a.id,key,val)
        on conflict (assessment_id,question_id) do update set answer=excluded.answer,updated_at=now();
      end if;
    end loop;
    update public.programme_hub_vocational_assessments
      set version=version+1,updated_by_user_id=actor,updated_at=now()
      where id=a.id returning * into a;
    insert into public.programme_hub_vocational_assessment_audit(workspace_id,assessment_id,actor_user_id,action,changed_question_ids)
      values(target_workspace_id,a.id,actor,'saved',ids);
  end if;
  insert into public.programme_hub_vocational_assessment_audit(workspace_id,assessment_id,actor_user_id,action)
    values(target_workspace_id,a.id,actor,'read');
  -- Return only answers to ordinary questions in the selected immutable snapshot.
  SELECT coalesce(pg_catalog.jsonb_object_agg(ans.question_id,ans.answer),'{}'::jsonb)
    INTO permitted
  FROM pg_catalog.jsonb_array_elements(v.sections) AS sec(section)
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
    CASE WHEN pg_catalog.jsonb_typeof(sec.section->'questions')='array'
      THEN sec.section->'questions' ELSE '[]'::jsonb END
  ) AS item(question)
  JOIN public.programme_hub_vocational_assessment_answers ans
    ON ans.assessment_id=a.id AND ans.question_id=item.question->>'id'
  WHERE public.rev_voc_is_ordinary_question(sec.section,item.question);
  return pg_catalog.jsonb_build_object('assessmentId',a.id,'version',a.version,'status',a.status,'answers',permitted);
end;
$_$;


ALTER FUNCTION "public"."rev_voc_assessment_draft"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_template_version_id" "uuid", "target_action" "text", "target_assessment_id" "uuid", "expected_version" bigint, "target_answers" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rev_voc_assessment_status"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  a public.programme_hub_vocational_assessments%ROWTYPE;
  v record;
  total_count integer := 0;
  answered_count integer := 0;
BEGIN
  IF NOT public.rev_voc_assessment_authorised(
    target_workspace_id, target_programme_id, target_participant_id
  ) THEN
    RAISE EXCEPTION 'Not authorised for participant assessment' USING ERRCODE='42501';
  END IF;

  -- Choose the assessment attached to the newest published questionnaire
  -- applicable to this programme, before considering older assessments.
  -- A completed assessment on an older questionnaire does not override
  -- an in-progress assessment on the newly published questionnaire.
  SELECT aa.* INTO a
  FROM public.programme_hub_vocational_assessments aa
  JOIN public.programme_hub_vocational_template_versions tv
    ON tv.id = aa.template_version_id
   AND tv.workspace_id = aa.workspace_id
  JOIN public.programme_hub_vocational_templates t
    ON t.id = tv.template_id
   AND t.workspace_id = tv.workspace_id
  WHERE aa.workspace_id = target_workspace_id
    AND aa.programme_id = target_programme_id
    AND aa.participant_id = target_participant_id
    AND aa.status IN ('draft','completed')
    AND (t.programme_id = target_programme_id OR t.programme_id IS NULL)
  ORDER BY
    CASE WHEN t.status = 'published' THEN 0 ELSE 1 END,
    t.published_at DESC NULLS LAST,
    tv.version DESC,
    CASE WHEN aa.status = 'completed' THEN 0 ELSE 1 END,
    aa.updated_at DESC,
    aa.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status','not_started','answered',0,'total',0,
      'assessmentId',NULL,'updatedAt',NULL,
      'completedAt',NULL,'updatedByUserId',NULL
    );
  END IF;

  SELECT sections INTO v
  FROM public.programme_hub_vocational_template_versions
  WHERE id = a.template_version_id AND workspace_id = target_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assessment snapshot missing' USING ERRCODE='22023';
  END IF;

  SELECT count(*)::integer, count(ans.question_id)::integer
  INTO total_count, answered_count
  FROM pg_catalog.jsonb_array_elements(v.sections) AS s(section)
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
    CASE WHEN pg_catalog.jsonb_typeof(s.section->'questions') = 'array'
      THEN s.section->'questions' ELSE '[]'::jsonb END
  ) AS q(question)
  LEFT JOIN public.programme_hub_vocational_assessment_answers ans
    ON ans.assessment_id = a.id
   AND ans.question_id = q.question->>'id'
   AND ans.answer <> 'null'::jsonb
   AND ans.answer <> '""'::jsonb
   AND ans.answer <> '[]'::jsonb
  WHERE public.rev_voc_is_ordinary_question(s.section, q.question);

  RETURN pg_catalog.jsonb_build_object(
    'status', CASE WHEN a.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
    'answered',answered_count,'total',total_count,
    'assessmentId',a.id,'templateVersionId',a.template_version_id,
    'version',a.version,'updatedAt',a.updated_at,
    'completedAt',a.completed_at,'updatedByUserId',a.updated_by_user_id
  );
END;
$$;


ALTER FUNCTION "public"."rev_voc_assessment_status"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rev_voc_is_ordinary_question"("section_data" "jsonb", "question_data" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
 SELECT coalesce((question_data->>'sensitive')::boolean, true) = false
    AND coalesce(section_data->>'title','') !~* '(conviction|sentenc|offen[cs]e|prison|probation|restricted)'
    AND coalesce(question_data->>'label','') !~* '(conviction|sentenc|offen[cs]e|prison|probation)';
$$;


ALTER FUNCTION "public"."rev_voc_is_ordinary_question"("section_data" "jsonb", "question_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE TRIGGER "rev_assessment_validate_links_trigger" BEFORE INSERT OR UPDATE ON "public"."programme_hub_vocational_assessments" FOR EACH ROW EXECUTE FUNCTION "public"."rev_assessment_validate_links"();


ALTER TABLE "public"."programme_hub_vocational_assessments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."programme_hub_vocational_assessment_answers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."programme_hub_vocational_assessment_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."programme_hub_vocational_restricted_answers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."programme_hub_vocational_status_events" ENABLE ROW LEVEL SECURITY;


REVOKE ALL ON FUNCTION "public"."rev_assessment_validate_links"() FROM PUBLIC;


GRANT ALL ON FUNCTION "public"."rev_assessment_validate_links"() TO "service_role";


REVOKE ALL ON FUNCTION "public"."rev_voc_assessment_authorised"("p_workspace" "uuid", "p_programme" "uuid", "p_participant" "uuid") FROM PUBLIC;


GRANT ALL ON FUNCTION "public"."rev_voc_assessment_authorised"("p_workspace" "uuid", "p_programme" "uuid", "p_participant" "uuid") TO "authenticated";


GRANT ALL ON FUNCTION "public"."rev_voc_assessment_authorised"("p_workspace" "uuid", "p_programme" "uuid", "p_participant" "uuid") TO "service_role";


REVOKE ALL ON FUNCTION "public"."rev_voc_assessment_complete"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_assessment_id" "uuid", "expected_version" bigint) FROM PUBLIC;


GRANT ALL ON FUNCTION "public"."rev_voc_assessment_complete"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_assessment_id" "uuid", "expected_version" bigint) TO "authenticated";


GRANT ALL ON FUNCTION "public"."rev_voc_assessment_complete"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_assessment_id" "uuid", "expected_version" bigint) TO "service_role";


REVOKE ALL ON FUNCTION "public"."rev_voc_assessment_draft"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_template_version_id" "uuid", "target_action" "text", "target_assessment_id" "uuid", "expected_version" bigint, "target_answers" "jsonb") FROM PUBLIC;


GRANT ALL ON FUNCTION "public"."rev_voc_assessment_draft"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_template_version_id" "uuid", "target_action" "text", "target_assessment_id" "uuid", "expected_version" bigint, "target_answers" "jsonb") TO "authenticated";


GRANT ALL ON FUNCTION "public"."rev_voc_assessment_draft"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_template_version_id" "uuid", "target_action" "text", "target_assessment_id" "uuid", "expected_version" bigint, "target_answers" "jsonb") TO "service_role";


REVOKE ALL ON FUNCTION "public"."rev_voc_assessment_status"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid") FROM PUBLIC;


GRANT ALL ON FUNCTION "public"."rev_voc_assessment_status"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid") TO "authenticated";


GRANT ALL ON FUNCTION "public"."rev_voc_assessment_status"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid") TO "service_role";


REVOKE ALL ON FUNCTION "public"."rev_voc_is_ordinary_question"("section_data" "jsonb", "question_data" "jsonb") FROM PUBLIC;


GRANT ALL ON FUNCTION "public"."rev_voc_is_ordinary_question"("section_data" "jsonb", "question_data" "jsonb") TO "service_role";


GRANT ALL ON TABLE "public"."programme_hub_vocational_assessment_answers" TO "service_role";


GRANT ALL ON TABLE "public"."programme_hub_vocational_assessment_audit" TO "service_role";


GRANT ALL ON SEQUENCE "public"."programme_hub_vocational_assessment_audit_id_seq" TO "anon";


GRANT ALL ON SEQUENCE "public"."programme_hub_vocational_assessment_audit_id_seq" TO "authenticated";


GRANT ALL ON SEQUENCE "public"."programme_hub_vocational_assessment_audit_id_seq" TO "service_role";


GRANT ALL ON TABLE "public"."programme_hub_vocational_assessments" TO "service_role";


GRANT ALL ON TABLE "public"."programme_hub_vocational_restricted_answers" TO "service_role";


GRANT ALL ON TABLE "public"."programme_hub_vocational_status_events" TO "service_role";


GRANT ALL ON SEQUENCE "public"."programme_hub_vocational_status_events_id_seq" TO "anon";


GRANT ALL ON SEQUENCE "public"."programme_hub_vocational_status_events_id_seq" TO "authenticated";


GRANT ALL ON SEQUENCE "public"."programme_hub_vocational_status_events_id_seq" TO "service_role";
