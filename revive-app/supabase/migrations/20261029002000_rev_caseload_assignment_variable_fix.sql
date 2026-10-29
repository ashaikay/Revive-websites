BEGIN;
-- Preserve the hosted function and its permissions; rename only the local variable
-- that conflicts with programme_hub_participant_advisers.participant_id.
DO $fix$
DECLARE definition text; original text; old_fragment text; new_fragment text; pair text[];
BEGIN
  original := pg_get_functiondef('public.save_rev_programme_hub_record(text,uuid,uuid,uuid,uuid,uuid,bigint,jsonb)'::regprocedure);
  definition := original;
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['  participant_id uuid;', '  caseload_participant_id uuid;'],
    ARRAY['    participant_id = (target_payload->>''participantId'')::uuid;', '    caseload_participant_id = (target_payload->>''participantId'')::uuid;'],
    ARRAY['participant.id = participant_id for share;', 'participant.id = caseload_participant_id for share;'],
    ARRAY['target_workspace_id, target_programme_id, participant_id, target_user_id,', 'target_workspace_id, target_programme_id, caseload_participant_id, target_user_id,'],
    ARRAY['assignment.participant_id = participant_id and assignment.adviser_user_id', 'assignment.participant_id = caseload_participant_id and assignment.adviser_user_id']
  ] LOOP
    old_fragment := pair[1]; new_fragment := pair[2];
    IF strpos(definition,old_fragment)=0 OR (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment) <> 1 THEN
      RAISE EXCEPTION 'Unexpected caseload save definition; correction not applied';
    END IF;
    definition := replace(definition,old_fragment,new_fragment);
  END LOOP;
  EXECUTE definition;
END $fix$;
COMMIT;
