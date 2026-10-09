import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {handleJobDocumentUpload} from './jobDocumentUploadBoundary.ts';

const url=Deno.env.get('SUPABASE_URL')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const caller=(authorization:string)=>createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(bytes:Uint8Array)=>{const copy=Uint8Array.from(bytes);return[...new Uint8Array(await crypto.subtle.digest('SHA-256',copy.buffer))].map(value=>value.toString(16).padStart(2,'0')).join('');};

Deno.serve(request=>handleJobDocumentUpload(request,{
 allowedOrigin:Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
 getUserId:async authorization=>{const {data,error}=await caller(authorization).auth.getUser();return error?null:data.user?.id??null;},
 canManage:async(authorization,workspaceId,userId)=>{const {data,error}=await caller(authorization).from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();return !error&&data?.status==='active'&&['owner','admin'].includes(data.role);},
 store:async(path,bytes,mimeType,expectedHash)=>{
  const bucket=service.storage.from('rev-scheduling-job-documents');
  const {error}=await bucket.upload(path,bytes,{contentType:mimeType,upsert:false});
  if(!error)return;
  const {data:existing,error:downloadError}=await bucket.download(path);if(downloadError||!existing)throw Error('Storage unavailable');
  if(await hash(new Uint8Array(await existing.arrayBuffer()))!==expectedHash)throw Error('Stored document differs');
 },
 save:async input=>{const {data,error}=await service.rpc('save_rev_scheduling_job_document',input);if(error||!data)throw Error('Job document unavailable');return data;},
}));
