import { runSelectedCalendarAvailability, type SelectedCalendarCredential, type SelectedAvailabilityQuery, type SelectedAvailabilityDependencies } from './selectedCalendarAvailabilityWorkflow.ts';

export interface SelectedCalendarRpcClient {
  rpc(name:string,body:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;
}
export interface SelectedCalendarServiceDependencies {
  client:SelectedCalendarRpcClient;
  refresh:SelectedAvailabilityDependencies['refresh'];
  read:SelectedAvailabilityDependencies['read'];
  businessWindows(timezone:string,startAt:string,endAt:string):Array<{startAt:string;endAt:string}>;
}
async function one(client:SelectedCalendarRpcClient,name:string,body:Record<string,unknown>):Promise<Record<string,unknown>>{
  const {data,error}=await client.rpc(name,body);
  if(error||!Array.isArray(data)||data.length!==1||!data[0]||typeof data[0]!=='object')throw new Error('Selected calendar unavailable.');
  return data[0] as Record<string,unknown>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function snapshot(row:Record<string,unknown>,timezone:string):SelectedCalendarCredential{
  if(!['calendar_id','connection_id','credential_reference'].every(key=>typeof row[key]==='string'&&uuid.test(row[key] as string))||
    typeof row.provider_calendar_reference!=='string'||!row.provider_calendar_reference.trim()||row.provider_calendar_reference.length>2048||
    typeof row.provider_account_reference!=='string'||!row.provider_account_reference.includes('@')||row.timezone!==timezone||
    !Number.isSafeInteger(row.revision)||(row.revision as number)<1||typeof row.refresh_token!=='string'||!row.refresh_token.trim()||row.refresh_token.length>32768)throw new Error('Selected calendar unavailable.');
  return row as unknown as SelectedCalendarCredential;
}
export function createSelectedCalendarAvailabilityService(deps:SelectedCalendarServiceDependencies){
 return async(query:SelectedAvailabilityQuery)=>{
  const load=async(workspaceId:string,userId:string)=>snapshot(await one(deps.client,'load_rev_selected_calendar_credential',{target_workspace_id:workspaceId,requesting_user_id:userId}),query.timezone);
  const initial=await load(query.workspaceId,query.userId);
  const windows=deps.businessWindows(initial.timezone,query.searchStartAt,query.searchEndAt);
  const policy={minimumNoticeMinutes:0,beforeBufferMinutes:0,afterBufferMinutes:0,availabilityWindows:windows};
  const selectedCalendar={id:initial.calendar_id,workspaceId:query.workspaceId,connectionId:initial.connection_id,provider:'microsoft_graph' as const,providerCalendarReference:initial.provider_calendar_reference,timezone:initial.timezone};
  if(windows.length===0)return{selectedCalendar,policy,busyIntervals:[]};
  // Seed the workflow with the same selection used to build the policy; later loads recheck it.
  let seeded=true;
  const busyIntervals=await runSelectedCalendarAvailability(query,{
   load:async(w,u)=>{if(seeded){seeded=false;return initial;}return load(w,u);},
   refresh:deps.refresh,
   rotate:async(w,u,s,refreshToken)=>{
    const row=await one(deps.client,'rotate_rev_selected_calendar_credential',{target_workspace_id:w,requesting_user_id:u,target_calendar_id:s.calendar_id,target_connection_id:s.connection_id,target_credential_reference:s.credential_reference,expected_revision:s.revision,refresh_token:refreshToken});
    return{credential_reference:row.credential_reference as string,revision:row.revision as number};
   },read:deps.read
  });
  return{selectedCalendar,policy,busyIntervals};
 };
}
