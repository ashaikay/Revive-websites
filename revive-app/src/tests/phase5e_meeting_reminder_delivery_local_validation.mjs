import {randomBytes,randomUUID} from 'node:crypto';

const baseUrl='http://127.0.0.1:55321';
const anonKey=process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const serviceKey=process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if(!anonKey||!serviceKey)throw new Error('Local Supabase test keys are required.');
let failures=0;
const check=(name,condition)=>{console.log(`${name}=${condition?'PASS':'FAIL'}`);if(!condition)failures+=1;};
async function request(token,method,path,body){
 const response=await fetch(baseUrl+path,{method,headers:{apikey:anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
 const payload=await response.json().catch(()=>null);
 return{status:response.status,payload,rows:Array.isArray(payload)?payload:[]};
}
const rpc=(token,name,body)=>request(token,'POST',`/rest/v1/rpc/${name}`,body);
async function identity(label){
 const email=`phase5e-delivery-${Date.now()}-${label}-${randomBytes(4).toString('hex')}@example.test`;
 const password=`Local-${randomBytes(18).toString('base64url')}`;
 const created=await request(serviceKey,'POST','/auth/v1/admin/users',{email,password,email_confirm:true});
 if(created.status!==200)throw new Error(`Identity creation failed: ${label}`);
 const login=await request(anonKey,'POST','/auth/v1/token?grant_type=password',{email,password});
 if(login.status!==200)throw new Error(`Identity login failed: ${label}`);
 return{id:created.payload.id,token:login.payload.access_token};
}
const owner=await identity('owner'),admin=await identity('admin'),member=await identity('member'),inactive=await identity('inactive'),outsider=await identity('outsider');
const workspace=await rpc(owner.token,'create_workspace_with_owner',{workspace_name:`Reminder Delivery ${Date.now()}`,workspace_slug:`reminder-delivery-${Date.now()}-${randomBytes(4).toString('hex')}`});
const otherWorkspace=await rpc(outsider.token,'create_workspace_with_owner',{workspace_name:`Reminder Delivery Other ${Date.now()}`,workspace_slug:`reminder-delivery-other-${Date.now()}-${randomBytes(4).toString('hex')}`});
const workspaceId=workspace.payload?.[0]?.created_workspace_id,otherWorkspaceId=otherWorkspace.payload?.[0]?.created_workspace_id;
if(!workspaceId||!otherWorkspaceId)throw new Error('Workspace setup failed.');
for(const [actor,role,status] of [[admin,'admin','active'],[member,'member','active'],[inactive,'admin','suspended']]){
 const saved=await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:workspaceId,user_id:actor.id,role,status});
 if(saved.status!==201)throw new Error(`Membership setup failed: ${role}/${status}`);
}

async function fixture(targetWorkspaceId,actor,suffix,{accepted=true,startAt='2099-10-10T09:00:00.000Z'}={}){
 const action=await request(serviceKey,'POST','/rest/v1/rev_actions',{workspace_id:targetWorkspaceId,action_type:'meeting_proposal',title:`Reminder ${suffix}`,description:'Meeting proposal.',requires_approval:true,status:'completed',execution_status:'succeeded',action_version:1});
 const actionId=action.rows[0]?.id;
 const approval=await request(serviceKey,'POST','/rest/v1/approvals',{workspace_id:targetWorkspaceId,rev_action_id:actionId,decision:'approved'});
 const proposal=await request(serviceKey,'POST','/rest/v1/meeting_proposals',{workspace_id:targetWorkspaceId,rev_action_id:actionId,approval_id:approval.rows[0]?.id,submitted_by:actor,proposal_version:1,semantic_fingerprint:randomBytes(32).toString('hex'),proposal_payload:{version:1,title:`Reminder ${suffix}`,attendeeEmail:'customer@example.test',startAt,endAt:new Date(Date.parse(startAt)+1800000).toISOString(),timezone:'Europe/London',meetingMethod:'online',locationDetails:'',notes:''}});
 const proposalId=proposal.rows[0]?.id;
 if(accepted){
  const execution=await request(serviceKey,'POST','/rest/v1/rev_action_executions',{workspace_id:targetWorkspaceId,action_id:actionId,approval_id:approval.rows[0]?.id,requested_by:actor,capability:'CREATE_APPROVED_MEETING_EVENT',risk_class:'external_communication',mode:'live',status:'succeeded',idempotency_key:`delivery-${randomUUID()}`,request_fingerprint:randomBytes(32).toString('hex'),action_version:1,workspace_policy_version:1,provider_key:'microsoft_graph',started_at:'2026-10-09T09:00:00.000Z',completed_at:'2026-10-09T09:00:01.000Z',result_summary:'Accepted fixture.',failure_code:null,provider_outcome:'accepted_by_provider'});
  if(execution.status!==201)throw new Error(`Execution setup failed: ${JSON.stringify(execution.payload)}`);
 }
 const draft=await rpc(serviceKey,'save_rev_meeting_reminder_draft',{target_workspace_id:targetWorkspaceId,initiating_user_id:actor,target_request_id:randomUUID(),target_meeting_proposal_id:proposalId,target_body:`Please remember ${suffix}.`,expected_version:0});
 if(draft.status!==200)throw new Error(`Draft setup failed: ${JSON.stringify(draft.payload)}`);
 return{actionId,proposalId,draft};
}
const eligible=await fixture(workspaceId,owner.id,'eligible');
const second=await fixture(workspaceId,owner.id,'second');
const noBooking=await fixture(workspaceId,owner.id,'no-booking',{accepted:false});
const other=await fixture(otherWorkspaceId,outsider.id,'other');

const approve=(meetingProposalId=eligible.proposalId,actor=owner.id,requestId=randomUUID(),targetWorkspaceId=workspaceId)=>rpc(serviceKey,'approve_rev_meeting_reminder_delivery',{target_workspace_id:targetWorkspaceId,initiating_user_id:actor,target_request_id:requestId,target_meeting_proposal_id:meetingProposalId});
const approvalRequest=randomUUID();
const approved=await approve(eligible.proposalId,owner.id,approvalRequest);
check('OWNER_APPROVAL',approved.status===200&&approved.payload?.status==='approved_not_sent'&&approved.payload?.approved_draft_version===1);
const approvalReplay=await approve(eligible.proposalId,owner.id,approvalRequest);
check('APPROVAL_EXACT_REPLAY',approvalReplay.status===200&&approvalReplay.payload?.id===approved.payload?.id&&approvalReplay.payload?.version===approved.payload?.version);
check('ADMIN_APPROVAL', (await approve(eligible.proposalId,admin.id)).status===200);
check('MEMBER_DENIED', (await approve(eligible.proposalId,member.id)).status!==200);
check('INACTIVE_DENIED', (await approve(eligible.proposalId,inactive.id)).status!==200);
check('OUTSIDER_DENIED', (await approve(eligible.proposalId,outsider.id)).status!==200);
check('CROSS_WORKSPACE_DENIED', (await approve(other.proposalId,owner.id,randomUUID(),otherWorkspaceId)).status!==200);
check('UNBOOKED_MEETING_DENIED', (await approve(noBooking.proposalId)).status!==200);
check('DIRECT_BROWSER_APPROVAL_RPC_DENIED',(await rpc(owner.token,'approve_rev_meeting_reminder_delivery',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_meeting_proposal_id:eligible.proposalId})).status!==200);

const ownerRead=await request(owner.token,'GET',`/rest/v1/meeting_reminder_deliveries?workspace_id=eq.${workspaceId}`);
const memberRead=await request(member.token,'GET',`/rest/v1/meeting_reminder_deliveries?workspace_id=eq.${workspaceId}`);
const crossRead=await request(outsider.token,'GET',`/rest/v1/meeting_reminder_deliveries?workspace_id=eq.${workspaceId}`);
check('OWNER_READ_ALLOWED',ownerRead.status===200&&ownerRead.rows.some(row=>row.id===approved.payload?.id));
check('MEMBER_READ_DENIED',memberRead.status===200&&memberRead.rows.length===0);
check('CROSS_WORKSPACE_READ_DENIED',crossRead.status===200&&crossRead.rows.length===0);
check('DIRECT_BROWSER_WRITE_DENIED',(await request(owner.token,'PATCH',`/rest/v1/meeting_reminder_deliveries?id=eq.${approved.payload?.id}`,{status:'accepted_by_provider'})).status!==200);

const corrected=await rpc(serviceKey,'save_rev_meeting_reminder_draft',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_meeting_proposal_id:eligible.proposalId,target_body:'Please remember the corrected meeting details.',expected_version:1});
check('DRAFT_CORRECTION_SAVED',corrected.status===200&&corrected.payload?.version===2);
const claim=(meetingProposalId=eligible.proposalId,actor=owner.id,requestId=randomUUID(),consent=true)=>rpc(serviceKey,'claim_rev_meeting_reminder_delivery',{target_workspace_id:workspaceId,initiating_user_id:actor,target_request_id:requestId,target_meeting_proposal_id:meetingProposalId,target_send_consent:consent});
check('STALE_APPROVAL_INVALIDATED',(await claim()).status!==200);
const reapproved=await approve();
check('CORRECTED_DRAFT_REAPPROVED',reapproved.status===200&&reapproved.payload?.approved_draft_version===2&&reapproved.payload?.version===2);
check('SEND_CONSENT_REQUIRED',(await claim(eligible.proposalId,owner.id,randomUUID(),false)).status!==200);
check('CAPABILITY_DEFAULT_DISABLED',(await claim()).status!==200);
const existingPolicy=await request(serviceKey,'GET',`/rest/v1/workspace_execution_policies?workspace_id=eq.${workspaceId}`);
const policyBody={workspace_id:workspaceId,execution_enabled:true,autonomy_mode:'always_ask',per_attempt_provider_cost_ceiling:0,monthly_provider_cost_ceiling:0,approval_cost_threshold:0,disabled_capabilities:[],updated_by:owner.id};
const policy=existingPolicy.rows.length
 ?await request(serviceKey,'PATCH',`/rest/v1/workspace_execution_policies?workspace_id=eq.${workspaceId}`,policyBody)
 :await request(serviceKey,'POST','/rest/v1/workspace_execution_policies',policyBody);
if(![200,201,204].includes(policy.status))throw new Error(`Execution policy setup failed: ${JSON.stringify(policy.payload)}`);
check('DIRECT_BROWSER_CLAIM_RPC_DENIED',(await rpc(owner.token,'claim_rev_meeting_reminder_delivery',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:randomUUID(),target_meeting_proposal_id:eligible.proposalId,target_send_consent:true})).status!==200);

const sendRequest=randomUUID();
const [claimA,claimB]=await Promise.all([claim(eligible.proposalId,owner.id,sendRequest),claim(eligible.proposalId,admin.id,randomUUID())]);
const claims=[claimA,claimB],successfulClaims=claims.filter(value=>value.status===200);
check('AT_MOST_ONE_CONCURRENT_CLAIM',successfulClaims.length===1&&claims.filter(value=>value.status!==200).length===1);
const firstClaim=successfulClaims[0];
check('SERVER_DERIVED_EMAIL',firstClaim.payload?.recipient==='customer@example.test'&&firstClaim.payload?.subject==='Reminder: Reminder eligible'&&firstClaim.payload?.body==='Please remember the corrected meeting details.'&&firstClaim.payload?.replayed===false);
const replayClaim=await claim(eligible.proposalId,owner.id,sendRequest);
check('CLAIM_EXACT_REPLAY_NO_NEW_ATTEMPT',replayClaim.status===200&&replayClaim.payload?.replayed===true&&replayClaim.payload?.id===firstClaim.payload?.id);

const record=(deliveryId,fingerprint,outcome,summary,failureCode)=>rpc(serviceKey,'record_rev_meeting_reminder_delivery_result',{target_delivery_id:deliveryId,expected_request_fingerprint:fingerprint,target_provider_outcome:outcome,target_result_summary:summary,target_failure_code:failureCode,target_provider_reference:null});
const unknownResult=await record(firstClaim.payload?.id,firstClaim.payload?.request_fingerprint,'provider_outcome_unknown','Provider outcome unknown; automatic retry prohibited.','MICROSOFT_GRAPH_OUTCOME_UNKNOWN');
check('UNKNOWN_OUTCOME_RECORDED',unknownResult.status===200&&unknownResult.payload?.status==='provider_outcome_unknown');
const unknownReplay=await record(firstClaim.payload?.id,firstClaim.payload?.request_fingerprint,'provider_outcome_unknown','Provider outcome unknown; automatic retry prohibited.','MICROSOFT_GRAPH_OUTCOME_UNKNOWN');
check('RESULT_IDEMPOTENT',unknownReplay.status===200&&unknownReplay.payload?.version===unknownResult.payload?.version);
check('NO_RESEND_AFTER_UNKNOWN',(await claim()).status!==200);

const secondApproval=await approve(second.proposalId);
const secondClaim=await claim(second.proposalId);
const accepted=await record(secondClaim.payload?.id,secondClaim.payload?.request_fingerprint,'accepted_by_provider','Accepted by provider; delivery remains unknown.',null);
check('PROVIDER_ACCEPTANCE_NOT_DELIVERY',secondApproval.status===200&&secondClaim.status===200&&accepted.status===200&&accepted.payload?.status==='accepted_by_provider'&&accepted.payload?.result_summary.includes('delivery remains unknown'));
check('NO_SECOND_PROVIDER_ATTEMPT',(await claim(second.proposalId)).status!==200);

const audit=await request(serviceKey,'GET',`/rest/v1/audit_log?workspace_id=eq.${workspaceId}&resource_type=eq.meeting_reminder_delivery`);
const actions=audit.rows.map(row=>row.action);
check('AUDIT_EVIDENCE',audit.status===200&&actions.includes('meeting_reminder_delivery.approved')&&actions.includes('meeting_reminder_delivery.reapproved')&&actions.filter(value=>value==='meeting_reminder_delivery.send_authorized').length===2&&actions.filter(value=>value==='meeting_reminder_delivery.provider_attempt_claimed').length===2&&actions.includes('meeting_reminder_delivery.provider_outcome_unknown')&&actions.includes('meeting_reminder_delivery.accepted_by_provider'));
check('AUDIT_MINIMIZES_PII',audit.rows.every(row=>!JSON.stringify(row.metadata).includes('customer@example.test')&&!JSON.stringify(row.metadata).includes('Please remember')));

console.log(`REMINDER_DELIVERY_VALIDATION_FAILURES=${failures}`);
if(failures)process.exit(1);
console.log('REMINDER_DELIVERY_VALIDATION=PASS');
