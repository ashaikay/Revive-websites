import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleWorkerUnavailabilitySave,WorkerUnavailabilityRefusal } from './workerUnavailabilityBoundary.ts';
const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const caller = (authorization: string) => createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve((request) => handleWorkerUnavailabilitySave(request,{
  allowedOrigin:Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  getUserId:async(authorization)=>{const {data,error}=await caller(authorization).auth.getUser();return error?null:data.user?.id??null;},
  canManage:async(authorization,workspaceId,userId)=>{const {data,error}=await caller(authorization).from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();return !error&&data?.status==='active'&&['owner','admin'].includes(data.role);},
  getWorkspaceTimezone:async(authorization,workspaceId)=>{const {data,error}=await caller(authorization).from('workspace_calendar_business_hours').select('timezone').eq('workspace_id',workspaceId).maybeSingle();if(error)return null;return data?.timezone??'Europe/London';},
  save:async(input)=>{
    const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await service.rpc('save_rev_worker_unavailability',input);const row=data;
    if(error){if(error.message==='Cancel affected assignments before adding unavailability')throw new WorkerUnavailabilityRefusal('assignment_conflict');if(error.message==='Unavailable period changed')throw new WorkerUnavailabilityRefusal('stale_period');if(error.message==='Unavailable period already cancelled')throw new WorkerUnavailabilityRefusal('already_cancelled');if(error.message==='Worker unavailable')throw new WorkerUnavailabilityRefusal('inactive_worker');throw new Error('Worker unavailability unavailable');}if(!row)throw new Error('Worker unavailability unavailable');return row;
  },
}));
