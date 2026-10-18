import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleWorkerSave,WorkerSaveRefusal } from './workerSaveBoundary.ts';
const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const caller = (authorization: string) => createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve((request) => handleWorkerSave(request,{
  allowedOrigin:Deno.env.get('REV_SCHEDULING_ALLOWED_ORIGINS') ?? Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
  getUserId:async(authorization)=>{const {data,error}=await caller(authorization).auth.getUser();return error?null:data.user?.id??null;},
  canManage: async (authorization, workspaceId, userId) => { const { data, error } = await caller(authorization).rpc('get_rev_scheduling_management', { target_workspace_id: workspaceId, target_user_id: userId }); return !error && data?.workspaceId === workspaceId && data?.userId === userId && data?.canManage === true; },
  save:async(input)=>{
    const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await service.rpc('save_rev_scheduling_worker',input);const row=data;
    if(error){if(error.message==='Cancel affected assignments before changing worker')throw new WorkerSaveRefusal('active_assignments');if(error.message==='Worker unavailable or changed')throw new WorkerSaveRefusal('stale_worker');throw new Error('Worker save unavailable');}if(!row)throw new Error('Worker save unavailable');return row;
  },
}));
