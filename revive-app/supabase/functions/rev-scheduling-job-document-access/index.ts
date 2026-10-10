import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {handleJobDocumentAccess} from './jobDocumentAccessBoundary.ts';

const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const caller=(authorization:string)=>createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(request=>handleJobDocumentAccess(request,{
 allowedOrigin:Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),
 getUserId:async authorization=>{const {data,error}=await caller(authorization).auth.getUser();return error?null:data.user?.id??null;},
 canManage:async(authorization,workspaceId,userId)=>{const {data,error}=await caller(authorization).from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();return !error&&data?.status==='active'&&['owner','admin'].includes(data.role);},
 load:async(workspaceId,jobId,documentId)=>{const {data,error}=await service.from('scheduling_job_documents').select('id,workspace_id,job_id,original_name,mime_type,size_bytes,storage_path,status,version').eq('workspace_id',workspaceId).eq('job_id',jobId).eq('id',documentId).maybeSingle();if(error||!data)return null;return{documentId:data.id,workspaceId:data.workspace_id,jobId:data.job_id,originalName:data.original_name,mimeType:data.mime_type,sizeBytes:data.size_bytes,storagePath:data.storage_path,status:data.status,version:data.version};},
 sign:async(path,expiresInSeconds,downloadName)=>{const {data,error}=await service.storage.from('rev-scheduling-job-documents').createSignedUrl(path,expiresInSeconds,downloadName?{download:downloadName}:undefined);if(error||!data?.signedUrl)throw Error('Signing unavailable');return data.signedUrl;},
}));
