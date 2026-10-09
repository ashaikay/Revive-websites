import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {handleJobDocumentAnalysis} from './jobDocumentAnalysisBoundary.ts';
import {extractJobDocumentWithOpenAI} from './openAiJobDocumentProvider.ts';

const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),caller=(authorization:string)=>createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
const apiKey=Deno.env.get('OPENAI_API_KEY')?.trim()??'',enabled=Deno.env.get('REV_SCHEDULING_DOCUMENT_AI_ENABLED')?.trim().toLowerCase()==='true';
Deno.serve(request=>handleJobDocumentAnalysis(request,{
 allowedOrigin:Deno.env.get('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN'),providerConfigured:enabled&&Boolean(apiKey),
 getUserId:async authorization=>{const {data,error}=await caller(authorization).auth.getUser();return error?null:data.user?.id??null;},
 canManage:async(authorization,workspaceId,userId)=>{const {data,error}=await caller(authorization).from('workspace_members').select('role,status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();return !error&&data?.status==='active'&&['owner','admin'].includes(data.role);},
 claim:async input=>{const {data,error}=await service.rpc('claim_rev_scheduling_job_document_analysis',input);if(error||!data)throw Error('Claim unavailable');return data;},
 source:async(workspaceId,jobId,documentId)=>{
  const [{data:document,error:documentError},{data:job,error:jobError}]=await Promise.all([
   service.from('scheduling_job_documents').select('original_name,mime_type,storage_path').eq('workspace_id',workspaceId).eq('job_id',jobId).eq('id',documentId).single(),
   service.from('scheduling_jobs').select('title,start_at,end_at,timezone,location,required_skills').eq('workspace_id',workspaceId).eq('id',jobId).single(),
  ]);if(documentError||jobError||!document||!job)throw Error('Source unavailable');
  const {data:file,error:fileError}=await service.storage.from('rev-scheduling-job-documents').download(document.storage_path);if(fileError||!file)throw Error('Source unavailable');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return{filename:document.original_name,mimeType:document.mime_type,base64:btoa(binary),job:{title:job.title,startAt:new Date(job.start_at).toISOString(),endAt:new Date(job.end_at).toISOString(),timezone:job.timezone,location:job.location,requiredSkills:job.required_skills}};
 },
 analyse:source=>extractJobDocumentWithOpenAI({apiKey,document:{filename:source.filename,mimeType:source.mimeType,base64:source.base64},job:source.job}),
 complete:async input=>{const {data,error}=await service.rpc('complete_rev_scheduling_job_document_analysis',input);if(error||!data)throw Error('Completion unavailable');return data;},
}));
