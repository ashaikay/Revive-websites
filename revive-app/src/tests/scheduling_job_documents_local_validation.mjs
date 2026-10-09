// Local Supabase only. Creates synthetic fixtures and never accepts a remote URL.
import {randomBytes,randomUUID} from 'node:crypto';
const base='http://127.0.0.1:55321',anon=process.env.REV_LOCAL_SUPABASE_ANON_KEY,service=process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if(!anon||!service)throw Error('Local Supabase test keys are required.');
const users=[],workspaces=[];let failures=0;
const check=(name,value)=>{console.log(`${name}=${value?'PASS':'FAIL'}`);if(!value)failures++;};
async function request(token,method,path,body){
 const response=await fetch(base+path,{method,headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
 const payload=await response.json().catch(()=>null);return{status:response.status,payload,rows:Array.isArray(payload)?payload:[]};
}
const rpc=(token,name,body)=>request(token,'POST',`/rest/v1/rpc/${name}`,body);
const id=value=>{if(typeof value!=='string'||!/^[0-9a-f-]{36}$/i.test(value))throw Error('Invalid local fixture identifier.');return value;};
async function identity(label){
 const email=`job-document-${Date.now()}-${label}-${randomBytes(4).toString('hex')}@example.test`,password=`Local-${randomBytes(32).toString('base64url')}`;
 const created=await request(service,'POST','/auth/v1/admin/users',{email,password,email_confirm:true});if(created.status!==200)throw Error('Local user fixture failed.');
 users.push(id(created.payload.id));const login=await request(anon,'POST','/auth/v1/token?grant_type=password',{email,password});if(login.status!==200||!login.payload?.access_token)throw Error('Local login fixture failed.');
 return{id:created.payload.id,token:login.payload.access_token};
}
async function workspace(owner){
 const stamp=`${Date.now()}-${randomBytes(4).toString('hex')}`,created=await rpc(owner.token,'create_workspace_with_owner',{workspace_name:`Job document ${stamp}`,workspace_slug:`job-document-${stamp}`});
 const workspaceId=id(created.payload?.[0]?.created_workspace_id);workspaces.push(workspaceId);return workspaceId;
}
try{
 const owner=await identity('owner'),member=await identity('member'),outsider=await identity('outsider'),workspaceId=await workspace(owner),otherWorkspace=await workspace(outsider);
 if((await request(service,'POST','/rest/v1/workspace_members',{workspace_id:workspaceId,user_id:member.id,role:'member',status:'active'})).status!==201)throw Error('Member fixture failed.');
 const jobRequest=randomUUID(),job=await rpc(service,'save_rev_scheduling_job',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:jobRequest,target_job_id:null,target_title:'Document test job',target_start_at:'2026-10-12T08:00:00.000Z',target_end_at:'2026-10-12T16:00:00.000Z',target_timezone:'Europe/London',target_location:'Office',target_required_skills:[],target_staffing_count:1,target_status:'open',expected_version:0,target_skill_requirement_mode:'all'});
 if(job.status!==200)throw Error('Job fixture failed.');const jobId=id(job.payload.job_id),requestId=randomUUID(),sha='a'.repeat(64),path=`${workspaceId}/${jobId}/${requestId}/${requestId}.txt`;
 const input={target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:requestId,target_job_id:jobId,target_original_name:'brief.txt',target_mime_type:'text/plain',target_size_bytes:10,target_sha256:sha,target_storage_path:path};
 const save=(patch={})=>rpc(service,'save_rev_scheduling_job_document',{...input,...patch});
 const concurrent=await Promise.all([save(),save()]);
 check('JOB_DOCUMENT_EXACT_CONCURRENT_REPLAY',concurrent.every(value=>value.status===200)&&concurrent[0].payload.document_id===concurrent[1].payload.document_id);
 check('JOB_DOCUMENT_CHANGED_RETRY_DENIED',(await save({target_original_name:'changed.txt'})).status>=400);
 const memberRequest=randomUUID();
 check('JOB_DOCUMENT_MEMBER_SAVE_DENIED',(await save({target_request_id:memberRequest,initiating_user_id:member.id,target_storage_path:`${workspaceId}/${jobId}/${memberRequest}/brief.txt`})).status>=400);
 const crossRequest=randomUUID();
 check('JOB_DOCUMENT_CROSS_WORKSPACE_SAVE_DENIED',(await save({target_request_id:crossRequest,target_workspace_id:otherWorkspace,target_storage_path:`${otherWorkspace}/${jobId}/${crossRequest}/brief.txt`})).status>=400);
 const read=token=>request(token,'GET',`/rest/v1/scheduling_job_documents?workspace_id=eq.${workspaceId}&select=id,workspace_id,job_id`);
 check('JOB_DOCUMENT_OWNER_READ',(await read(owner.token)).rows.length===1);
 check('JOB_DOCUMENT_MEMBER_READ_DENIED',(await read(member.token)).status===200&&(await read(member.token)).rows.length===0);
 check('JOB_DOCUMENT_OUTSIDER_READ_DENIED',(await read(outsider.token)).status===200&&(await read(outsider.token)).rows.length===0);
 check('JOB_DOCUMENT_SINGLE_AUDIT',(await request(service,'GET',`/rest/v1/audit_log?workspace_id=eq.${workspaceId}&action=eq.scheduling.job_document.uploaded&resource_id=eq.${requestId}&select=id`)).rows.length===1);
 const requirements={tasks:[{value:'Support customers',references:[{page:1,section:null}]}],requiredSkills:[{value:'First aid',references:[{page:1,section:'Requirements'}]}],qualifications:[],location:null,dates:[],duration:null,missingInformation:['Duration'],ambiguities:[]};
 const analysisId=randomUUID(),claimInput={target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:analysisId,target_job_id:jobId,target_document_id:requestId,expected_document_version:1,expected_job_version:job.payload.version};
 const claim=(patch={})=>rpc(service,'claim_rev_scheduling_job_document_analysis',{...claimInput,...patch});
 const claims=await Promise.all([claim(),claim()]);
 check('JOB_DOCUMENT_ANALYSIS_SINGLE_CLAIM',claims.every(value=>value.status===200)&&claims.filter(value=>value.payload.should_attempt===true).length===1&&claims[0].payload.analysis_id===claims[1].payload.analysis_id);
 check('JOB_DOCUMENT_ANALYSIS_CHANGED_RETRY_DENIED',(await claim({expected_job_version:job.payload.version+1})).status>=400);
 check('JOB_DOCUMENT_ANALYSIS_MEMBER_DENIED',(await claim({target_request_id:randomUUID(),initiating_user_id:member.id})).status>=400);
 check('JOB_DOCUMENT_ANALYSIS_CROSS_WORKSPACE_DENIED',(await claim({target_request_id:randomUUID(),target_workspace_id:otherWorkspace})).status>=400);
 const completionInput={target_workspace_id:workspaceId,initiating_user_id:owner.id,target_analysis_id:analysisId,target_status:'succeeded',target_extraction:requirements,target_error_code:null,target_provider_response_id:'fixture-response',target_input_tokens:100,target_output_tokens:50};
 const completed=await rpc(service,'complete_rev_scheduling_job_document_analysis',completionInput);
 check('JOB_DOCUMENT_ANALYSIS_COMPLETES',completed.status===200&&completed.payload.status==='succeeded'&&completed.payload.version===2);
 const completedReplay=await rpc(service,'complete_rev_scheduling_job_document_analysis',completionInput);
 check('JOB_DOCUMENT_ANALYSIS_COMPLETION_REPLAY',completedReplay.status===200&&completedReplay.payload.analysis_id===analysisId&&completedReplay.payload.status==='succeeded');
 const invalidAnalysisId=randomUUID(),invalidClaim=await claim({target_request_id:invalidAnalysisId});
 const invalidComplete=await rpc(service,'complete_rev_scheduling_job_document_analysis',{...completionInput,target_analysis_id:invalidAnalysisId,target_extraction:{...requirements,requiredSkills:[{value:'First aid',references:[{page:'one',section:null}]}]}});
 check('JOB_DOCUMENT_ANALYSIS_INVALID_EVIDENCE_DENIED',invalidClaim.status===200&&invalidComplete.status>=400);
 const reviewId=randomUUID(),reviewInput={target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:reviewId,target_job_id:jobId,target_analysis_id:analysisId,expected_analysis_version:2,target_requirements:requirements,expected_current_review_id:null,expected_current_revision:0};
 const reviews=await Promise.all([rpc(service,'confirm_rev_scheduling_job_requirements',reviewInput),rpc(service,'confirm_rev_scheduling_job_requirements',reviewInput)]);
 check('JOB_REQUIREMENTS_EXACT_CONCURRENT_REPLAY',reviews.every(value=>value.status===200)&&reviews[0].payload.review_id===reviews[1].payload.review_id&&reviews[0].payload.job_version===job.payload.version+1);
 check('JOB_REQUIREMENTS_CHANGED_RETRY_DENIED',(await rpc(service,'confirm_rev_scheduling_job_requirements',{...reviewInput,target_requirements:{...requirements,missingInformation:[]}})).status>=400);
 check('JOB_REQUIREMENTS_MEMBER_DENIED',(await rpc(service,'confirm_rev_scheduling_job_requirements',{...reviewInput,target_request_id:randomUUID(),initiating_user_id:member.id,expected_current_review_id:reviewId,expected_current_revision:1})).status>=400);
 check('JOB_REQUIREMENTS_CROSS_WORKSPACE_DENIED',(await rpc(service,'confirm_rev_scheduling_job_requirements',{...reviewInput,target_request_id:randomUUID(),target_workspace_id:otherWorkspace})).status>=400);
 const ownerAnalyses=await request(owner.token,'GET',`/rest/v1/scheduling_job_document_analyses?workspace_id=eq.${workspaceId}&select=id`),memberAnalyses=await request(member.token,'GET',`/rest/v1/scheduling_job_document_analyses?workspace_id=eq.${workspaceId}&select=id`),ownerReviews=await request(owner.token,'GET',`/rest/v1/scheduling_job_requirement_reviews?workspace_id=eq.${workspaceId}&select=id,current`),memberReviews=await request(member.token,'GET',`/rest/v1/scheduling_job_requirement_reviews?workspace_id=eq.${workspaceId}&select=id`);
 check('JOB_DOCUMENT_ANALYSIS_OWNER_READ',ownerAnalyses.rows.length===2);
 check('JOB_DOCUMENT_ANALYSIS_MEMBER_READ_DENIED',memberAnalyses.status===200&&memberAnalyses.rows.length===0);
 check('JOB_REQUIREMENTS_OWNER_READ',ownerReviews.rows.length===1&&ownerReviews.rows[0].current===true);
 check('JOB_REQUIREMENTS_MEMBER_READ_DENIED',memberReviews.status===200&&memberReviews.rows.length===0);
 check('JOB_REQUIREMENTS_SINGLE_AUDIT',(await request(service,'GET',`/rest/v1/audit_log?workspace_id=eq.${workspaceId}&action=eq.scheduling.job_requirements.confirmed&resource_id=eq.${reviewId}&select=id`)).rows.length===1);
 const qualificationRequirements={...requirements,qualifications:[{value:'Level 3 certificate',references:[{page:2,section:'Qualifications'}]}]},qualificationAnalysisId=randomUUID();
 const qualificationClaim=await claim({target_request_id:qualificationAnalysisId,expected_job_version:reviews[0].payload.job_version});
 const qualificationComplete=await rpc(service,'complete_rev_scheduling_job_document_analysis',{...completionInput,target_analysis_id:qualificationAnalysisId,target_extraction:qualificationRequirements});
 const qualificationReviewId=randomUUID(),qualificationReview=await rpc(service,'confirm_rev_scheduling_job_requirements',{...reviewInput,target_request_id:qualificationReviewId,target_analysis_id:qualificationAnalysisId,target_requirements:qualificationRequirements,expected_current_review_id:reviewId,expected_current_revision:1});
 const worker=await rpc(service,'save_rev_scheduling_worker',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:null,target_display_name:'Qualification unknown worker',target_role_labels:[],target_skill_tags:['First aid'],target_active:true,expected_version:0});
 const workerId=id(worker.payload?.worker_id),pattern=await rpc(service,'save_rev_worker_working_pattern',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:workerId,target_timezone:'Europe/London',target_working_days:[1,2,3,4,5],target_start_local:'09:00',target_end_local:'17:00',target_effective_from:'2026-10-01',target_effective_until:'2026-12-31',expected_version:0});
 const qualificationAssignment=await rpc(service,'save_rev_scheduling_assignment',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_assignment_id:null,target_worker_id:workerId,target_job_id:jobId,target_status:'active',expected_version:0,expected_worker_version:1,expected_job_version:qualificationReview.payload?.job_version,expected_pattern_version:1});
 check('JOB_QUALIFICATION_UNKNOWN_BLOCKS_ASSIGNMENT',qualificationClaim.status===200&&qualificationComplete.status===200&&qualificationReview.status===200&&worker.status===200&&pattern.status===200&&qualificationAssignment.status>=400&&qualificationAssignment.payload?.message==='Worker qualification evidence required');
 const staleAnalysisId=randomUUID(),staleClaim=await claim({target_request_id:staleAnalysisId,expected_job_version:reviews[0].payload.job_version});
 const staleComplete=await rpc(service,'complete_rev_scheduling_job_document_analysis',{...completionInput,target_analysis_id:staleAnalysisId});
 const changedJob=await rpc(service,'save_rev_scheduling_job',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_job_id:jobId,target_title:'Document test job',target_start_at:'2026-10-12T08:00:00.000Z',target_end_at:'2026-10-12T16:00:00.000Z',target_timezone:'Europe/London',target_location:'Changed office',target_required_skills:['First aid'],target_staffing_count:1,target_status:'open',expected_version:reviews[0].payload.job_version,target_skill_requirement_mode:'all'});
 const staleReview=await rpc(service,'confirm_rev_scheduling_job_requirements',{...reviewInput,target_request_id:randomUUID(),target_analysis_id:staleAnalysisId,expected_current_review_id:qualificationReviewId,expected_current_revision:2});
 const currentAfterChange=await request(owner.token,'GET',`/rest/v1/scheduling_job_requirement_reviews?workspace_id=eq.${workspaceId}&job_id=eq.${jobId}&current=eq.true&select=id`);
 check('JOB_REQUIREMENTS_STALE_ANALYSIS_DENIED',staleClaim.status===200&&staleComplete.status===200&&changedJob.status===200&&staleReview.status>=400);
 check('JOB_REQUIREMENTS_JOB_CHANGE_INVALIDATES_CURRENT',currentAfterChange.status===200&&currentAfterChange.rows.length===0);
}finally{
 for(const workspaceId of workspaces)await request(service,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}`,{status:'suspended'});
 for(const userId of users)await request(service,'PUT',`/auth/v1/admin/users/${userId}`,{ban_duration:'87600h'});
}
if(failures)throw Error(`${failures} local job-document checks failed.`);
console.log('SCHEDULING_JOB_DOCUMENTS_LOCAL=PASS');
