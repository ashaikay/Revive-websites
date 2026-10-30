// Local Supabase only. Synthetic fixtures; never accepts a remote URL.
import {randomBytes,randomUUID} from 'node:crypto';
const baseUrl='http://127.0.0.1:55321',anonKey=process.env.REV_LOCAL_SUPABASE_ANON_KEY,serviceKey=process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if(!anonKey||!serviceKey)throw Error('Local Supabase test keys are required.');
let failures=0;const check=(name,value)=>{console.log(`${name}=${value?'PASS':'FAIL'}`);if(!value)failures++;};
async function request(token,method,path,body){const response=await fetch(baseUrl+path,{method,headers:{apikey:anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});const payload=await response.json().catch(()=>null);return{status:response.status,payload,rows:Array.isArray(payload)?payload:[]};}
const rpc=(token,name,body)=>request(token,'POST',`/rest/v1/rpc/${name}`,body);
async function identity(label){const email=`job-import-${Date.now()}-${label}-${randomBytes(4).toString('hex')}@example.test`,password=`Local-${randomBytes(24).toString('base64url')}`;const created=await request(serviceKey,'POST','/auth/v1/admin/users',{email,password,email_confirm:true});const login=await request(anonKey,'POST','/auth/v1/token?grant_type=password',{email,password});return{id:created.payload.id,token:login.payload.access_token};}
async function workspace(owner,label){const stamp=`${Date.now()}-${randomBytes(4).toString('hex')}`,created=await rpc(owner.token,'create_workspace_with_owner',{workspace_name:`${label} ${stamp}`,workspace_slug:`${label}-${stamp}`.toLowerCase()});return created.payload[0].created_workspace_id;}
const owner=await identity('owner'),member=await identity('member'),outsider=await identity('outsider'),workspaceId=await workspace(owner,'job-import'),otherWorkspaceId=await workspace(outsider,'other-import');
await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:workspaceId,user_id:member.id,role:'member',status:'active'});
const row=requestId=>({request_id:requestId,title:'Imported shift',start_at:'2026-10-12T08:00:00.000Z',end_at:'2026-10-12T16:00:00.000Z',timezone:'Europe/London',location:'Office',required_skills:['Admin'],skill_requirement_mode:'all',staffing_count:1});
const save=(actor,workspace,batch,rows,token=serviceKey)=>rpc(token,'import_rev_scheduling_jobs',{target_workspace_id:workspace,initiating_user_id:actor,target_batch_request_id:batch,target_rows:rows});
const batch=randomUUID(),rowId=randomUUID(),created=await Promise.all([save(owner.id,workspaceId,batch,[row(rowId)]),save(owner.id,workspaceId,batch,[row(rowId)])]);
check('JOB_IMPORT_EXACT_REPLAY_ONE_BATCH',created.every(value=>value.status===200)&&created[0].payload?.jobs?.[0]?.job_id===created[1].payload?.jobs?.[0]?.job_id);
check('JOB_IMPORT_CHANGED_REPLAY_DENIED',(await save(owner.id,workspaceId,batch,[{...row(rowId),title:'Changed'}])).status>=400);
check('JOB_IMPORT_EXISTING_DUPLICATE_DENIED',(await save(owner.id,workspaceId,randomUUID(),[row(randomUUID())])).status>=400);
check('JOB_IMPORT_IN_FILE_DUPLICATE_DENIED',(await save(owner.id,workspaceId,randomUUID(),[{...row(randomUUID()),title:'Second'}, {...row(randomUUID()),title:'Second'}])).status>=400);
check('JOB_IMPORT_MEMBER_DENIED',(await save(member.id,workspaceId,randomUUID(),[{...row(randomUUID()),title:'Member'}])).status>=400);
check('JOB_IMPORT_CROSS_WORKSPACE_DENIED',(await save(owner.id,otherWorkspaceId,randomUUID(),[{...row(randomUUID()),title:'Cross workspace'}])).status>=400);
check('JOB_IMPORT_AUTHENTICATED_RPC_DENIED',(await save(owner.id,workspaceId,randomUUID(),[{...row(randomUUID()),title:'Direct'}],owner.token)).status>=400);
const jobs=await request(owner.token,'GET',`/rest/v1/scheduling_jobs?workspace_id=eq.${workspaceId}&select=title`);
check('JOB_IMPORT_ONE_DURABLE_ROW',jobs.rows.length===1&&jobs.rows[0].title==='Imported shift');
if(failures)throw Error(`${failures} scheduling job import check(s) failed.`);
console.log('SCHEDULING_JOB_IMPORT_LOCAL_VALIDATION=PASS');
