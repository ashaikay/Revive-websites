// Isolated local Supabase only. No hosted project, real staff or external messages.
import { randomUUID } from 'node:crypto';
const base = process.env.REV_LOCAL_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const parsed = new URL(base);
if (!['127.0.0.1','localhost'].includes(parsed.hostname) || parsed.port !== '55321' || parsed.protocol !== 'http:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('Local Supabase required.');
const anon = process.env.REV_LOCAL_SUPABASE_ANON_KEY, service = process.env.REV_LOCAL_SUPABASE_SERVICE_KEY ?? process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!anon || !service) throw new Error('Local fixture keys required.');
const call = async (path, body, token = service, method = 'POST') => {
  const response = await fetch(parsed.origin + path, { method, redirect: 'error', headers: { apikey: token === service ? service : anon, Authorization: `Bearer ${token}`, 'Content-Type':'application/json', Prefer:'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status:response.status, data:await response.json().catch(()=>null) };
};
const rpc = (fn,body,token) => call('/rest/v1/rpc/'+fn,body,token);
const pass = (label,condition) => { console.log(label+'='+(condition?'PASS':'FAIL')); if(!condition)throw new Error(label+' failed'); };
const tag = 'rev-module-test-'+randomUUID();
const makeUser = async (label) => {
  const email=`${tag}-${label}@example.test`, password='Local-test-'+randomUUID()+'!';
  const created=await call('/auth/v1/admin/users',{email,password,email_confirm:true});
  pass('TEAM_FIXTURE_'+label.toUpperCase(),created.status<300&&typeof created.data?.id==='string');
  const login=await call('/auth/v1/token?grant_type=password',{email,password},anon);
  pass('TEAM_LOGIN_'+label.toUpperCase(),login.status===200&&typeof login.data?.access_token==='string');
  return {id:created.data.id,email,token:login.data.access_token};
};
const [owner,es,outsider]=await Promise.all(['owner','es','outsider'].map(makeUser));
const boot=await rpc('create_workspace_with_owner',{workspace_name:tag,workspace_slug:tag},owner.token);
const ws=boot.data?.[0]?.created_workspace_id;pass('MODULE_WORKSPACE_CREATED',boot.status===200&&typeof ws==='string');
const invitation=await rpc('manage_rev_workspace_team',{target_workspace_id:ws,target_operation:'invite',target_request_id:randomUUID(),target_payload:{email:es.email,displayName:'Test ES'}},owner.token);
pass('MODULE_INVITATION_CREATED',invitation.status===200&&typeof invitation.data?.invitationId==='string');
pass('MODULE_INVITATION_ACCEPTED',(await rpc('accept_rev_workspace_invitation',{target_invitation_id:invitation.data.invitationId},es.token)).status===200);
const readAccess=(user,subject=user)=>rpc('get_rev_workspace_module_access',{target_workspace_id:ws,target_user_id:subject.id},user.token);
const initial=await readAccess(es);pass('MODULE_INVITE_OUTCOMES_ONLY',initial.status===200&&JSON.stringify(initial.data?.modules)===JSON.stringify(['programme'])&&initial.data.version===1);
pass('MODULE_MEMBER_CANNOT_READ_OTHER_ACCESS',(await readAccess(es,owner)).status===403);
pass('MODULE_OUTSIDER_ACCESS_DENIED',(await readAccess(outsider,es)).status===403);
const programmeId=randomUUID();
const programme={id:programmeId,workspace_id:ws,name:'Module fixture',timezone:'Europe/London',created_by_user_id:owner.id,updated_by_user_id:owner.id};
pass('MODULE_PROGRAMME_FIXTURE',(await call('/rest/v1/programme_hub_programmes',programme)).status<300);
pass('MODULE_ADVISER_FIXTURE',(await call('/rest/v1/programme_hub_advisers',{workspace_id:ws,programme_id:programmeId,user_id:es.id,created_by_user_id:owner.id,updated_by_user_id:owner.id})).status<300);
// Constrained records must use the same trusted writers as the application.
// The service role does not receive execution rights on private CHECK helpers.
const personFixture=await rpc('save_rev_programme_hub_record',{
 target_operation:'participant',target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),
 target_programme_id:programmeId,target_record_id:null,expected_version:0,
 target_payload:{participantKey:'TEST',preferredName:'Fixture person',caseReference:'CASE',desiredRoleKeys:[],skillKeys:[],vacancySearchGeographyKeys:[],residencyEvidenceReference:'',active:true}
});
if(personFixture.status!==200)console.error('MODULE_PERSON_FIXTURE_DIAGNOSTICS='+JSON.stringify({status:personFixture.status,errorCode:typeof personFixture.data?.code==='string'&&/^[A-Z0-9_]{1,20}$/.test(personFixture.data.code)?personFixture.data.code:null}));
const personId=personFixture.data?.record_id;
pass('MODULE_PERSON_FIXTURE',personFixture.status===200&&typeof personId==='string'&&/^[0-9a-f-]{36}$/i.test(personId));
pass('MODULE_ASSIGNMENT_FIXTURE',(await call('/rest/v1/programme_hub_participant_advisers',{workspace_id:ws,programme_id:programmeId,participant_id:personId,adviser_user_id:es.id,created_by_user_id:owner.id,updated_by_user_id:owner.id})).status<300);
for(const [table,record] of [['business_profiles',{workspace_id:ws,business_name:'Private business fixture'}],['contacts',{workspace_id:ws,lifecycle:'lead',name:'Private commercial fixture'}],['scheduling_workers',{workspace_id:ws,display_name:'Private worker fixture',created_by_user_id:owner.id,updated_by_user_id:owner.id}]]){
 const seeded=table==='scheduling_workers' ? await rpc('save_rev_scheduling_worker',{
  target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:null,
  target_display_name:'Private worker fixture',target_role_labels:[],target_skill_tags:[],target_active:true,expected_version:0
 }) : await call('/rest/v1/'+table,record);
 if(seeded.status>=300)console.error('MODULE_SEED_DIAGNOSTICS='+JSON.stringify({table,status:seeded.status,errorCode:typeof seeded.data?.code==='string'&&/^[A-Z0-9_]{1,20}$/.test(seeded.data.code)?seeded.data.code:null}));
 pass('MODULE_SEED_'+table.toUpperCase(),seeded.status>=200&&seeded.status<300);
 const denied=await call('/rest/v1/'+table+'?workspace_id=eq.'+ws+'&select=workspace_id',undefined,es.token,'GET');
 pass('MODULE_ES_CANNOT_READ_'+table.toUpperCase(),denied.status===200&&Array.isArray(denied.data)&&denied.data.length===0);
}
const readPerson=()=>call('/rest/v1/programme_hub_participants?workspace_id=eq.'+ws+'&id=eq.'+personId+'&select=id',undefined,es.token,'GET');
pass('MODULE_ASSIGNED_ES_READS_PERSON',(await readPerson()).data?.length===1);
const save=(user,modules,version,requestId=randomUUID(),subject=es)=>rpc('save_rev_workspace_module_access',{target_workspace_id:ws,target_user_id:subject.id,target_modules:modules,expected_version:version,target_request_id:requestId},user.token);
pass('MODULE_ES_CANNOT_GRANT_SELF',(await save(es,['programme','business'],1)).status===403);
pass('MODULE_DIRECT_ACCESS_INSERT_DENIED',(await call('/rest/v1/workspace_module_access',{workspace_id:ws,user_id:es.id,modules:['business']},es.token)).status>=400);
const requestId=randomUUID();const changes=await Promise.all([save(owner,[],1,requestId),save(owner,[],1,requestId)]);
pass('MODULE_CONCURRENT_EXACT_REPLAY',changes.every(v=>v.status===200&&v.data?.version===2&&v.data?.modules?.length===0));
const changedRetry=await save(owner,['programme'],1,requestId);
pass('MODULE_CHANGED_RETRY_DENIED',changedRetry.status===500&&changedRetry.data?.code==='40001');
const staleVersion=await save(owner,['programme'],1);
pass('MODULE_STALE_VERSION_DENIED',staleVersion.status===500&&staleVersion.data?.code==='40001');
pass('MODULE_REVOKED_CASELOAD_READ_DENIED',(await readPerson()).data?.length===0);
const rejected=await rpc('save_rev_programme_hub_participant_note',{target_workspace_id:ws,initiating_user_id:es.id,target_request_id:randomUUID(),target_programme_id:programmeId,target_participant_id:personId,note_body:'Must not be written after module revocation.'});
pass('MODULE_REVOKED_TRUSTED_NOTE_DENIED',rejected.status===403);
pass('MODULE_INVALID_NAME_DENIED',(await save(owner,['unknown'],2)).status===400);
pass('MODULE_MANAGER_ACCESS_PROTECTED',(await save(owner,['programme'],0,randomUUID(),owner)).status===403);
pass('MODULE_RESTORE_OUTCOMES',(await save(owner,['programme'],2)).status===200);
pass('MODULE_EXISTING_CASELOAD_RESTORED',(await readPerson()).data?.length===1);
pass('MODULE_SUSPEND_ES',(await rpc('manage_rev_workspace_team',{target_workspace_id:ws,target_operation:'suspend',target_request_id:randomUUID(),target_payload:{userId:es.id,expectedStatus:'active'}},owner.token)).status===200);
pass('MODULE_SUSPENSION_OVERRIDES_ACCESS',(await readAccess(es)).status===403&&(await readPerson()).data?.length===0);
pass('MODULE_MANAGER_REMAINS_FULL',(await readAccess(owner)).data?.modules?.length===6);
pass('MODULE_LEGACY_MEMBER_FIXTURE',(await call('/rest/v1/workspace_members',{workspace_id:ws,user_id:outsider.id,role:'member',status:'active'})).status<300);
pass('MODULE_EXISTING_MEMBERSHIP_PRESERVED',(await readAccess(outsider)).data?.modules?.length===6);
pass('MODULE_MANAGER_CAN_RESTRICT_LEGACY',(await save(owner,['programme'],0,randomUUID(),outsider)).status===200);
pass('MODULE_LEGACY_RESTRICTION_CONFIRMED',JSON.stringify((await readAccess(outsider)).data?.modules)===JSON.stringify(['programme']));
console.log('WORKSPACE_MODULE_ACCESS_LOCAL_VALIDATION=PASS');
