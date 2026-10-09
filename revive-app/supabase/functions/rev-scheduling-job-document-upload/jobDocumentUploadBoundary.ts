import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';

export interface JobDocumentSaveInput{target_workspace_id:string;initiating_user_id:string;target_request_id:string;target_job_id:string;target_original_name:string;target_mime_type:string;target_size_bytes:number;target_sha256:string;target_storage_path:string;}
export interface JobDocumentUploadDependencies{
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 store(path:string,bytes:Uint8Array,mimeType:string,sha256:string):Promise<void>;
 save(input:JobDocumentSaveInput):Promise<unknown>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=/^[0-9a-f]{64}$/;
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
const name=(value:unknown):value is string=>typeof value==='string'&&value===value.trim()&&value.length>=1&&value.length<=180&&!/[\\/\u0000-\u001f\u007f]/.test(value);
async function digest(bytes:Uint8Array){const copy=Uint8Array.from(bytes);return[...new Uint8Array(await crypto.subtle.digest('SHA-256',copy.buffer))].map(value=>value.toString(16).padStart(2,'0')).join('');}
function bytesFromBase64(value:string){if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length%4!==0)throw Error('Invalid base64');const binary=atob(value),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);return bytes;}
function validFile(bytes:Uint8Array,mimeType:string){
 if(mimeType==='application/pdf'){
  if(bytes.length<10||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-'||!new TextDecoder().decode(bytes.slice(Math.max(0,bytes.length-1024))).includes('%%EOF'))throw Error('Invalid PDF');
 }else if(mimeType==='text/plain'){
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Invalid text');}if(text.includes('\u0000'))throw Error('Invalid text');
 }else throw Error('Invalid type');
}
function result(value:unknown,body:Record<string,unknown>){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid result');const row=value as Record<string,unknown>;
 const createdAt=typeof row.created_at==='string'&&Number.isFinite(Date.parse(row.created_at))?new Date(row.created_at).toISOString():null;
 if(!id(row.document_id)||row.document_id!==body.requestId||row.workspace_id!==body.workspaceId||row.job_id!==body.jobId||row.original_name!==body.originalName||row.mime_type!==body.mimeType||row.size_bytes!==body.sizeBytes||row.sha256!==body.sha256||row.status!=='stored'||row.version!==1||!createdAt)throw Error('Invalid result');
 return{documentId:row.document_id,workspaceId:row.workspace_id,jobId:row.job_id,originalName:row.original_name,mimeType:row.mime_type,sizeBytes:row.size_bytes,sha256:row.sha256,status:row.status,version:row.version,createdAt,analysisAvailable:false};
}
export async function handleJobDocumentUpload(request:Request,deps:JobDocumentUploadDependencies):Promise<Response>{
 const origin=resolveAnnualLeaveOrigin(request.headers.get('Origin'),deps.allowedOrigin);if(!origin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':origin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 try{
  const raw=await request.text();if(raw.length>2_900_000)return reply(400,{error:'Job document request is too large.'});
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return reply(400,{error:'Valid job document required.'});}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='base64,jobId,mimeType,originalName,requestId,sha256,sizeBytes,workspaceId'||!id(body.workspaceId)||!id(body.jobId)||!id(body.requestId)||!name(body.originalName)||(body.mimeType!=='application/pdf'&&body.mimeType!=='text/plain')||!Number.isInteger(body.sizeBytes)||(body.sizeBytes as number)<1||(body.sizeBytes as number)>2097152||typeof body.sha256!=='string'||!sha.test(body.sha256)||typeof body.base64!=='string'||body.base64.length<1||body.base64.length>2_800_000)return reply(400,{error:'Valid job document required.'});
  const extension=(body.originalName as string).toLowerCase().split('.').pop();if((body.mimeType==='application/pdf'&&extension!=='pdf')||(body.mimeType==='text/plain'&&extension!=='txt'))return reply(400,{error:'File name and type do not match.'});
  let bytes:Uint8Array;try{bytes=bytesFromBase64(body.base64 as string);validFile(bytes,body.mimeType as string);}catch{return reply(400,{error:'The document is unreadable or unsupported.'});}
  if(bytes.length!==body.sizeBytes||await digest(bytes)!==body.sha256)return reply(400,{error:'Document content does not match its retained request.'});
  const userId=await deps.getUserId(authorization);if(!id(userId))return reply(401,{error:'Authentication required.'});
  if(!await deps.canManage(authorization,body.workspaceId as string,userId))return reply(403,{error:'Job document could not be uploaded.'});
  const path=`${body.workspaceId}/${body.jobId}/${body.requestId}/${body.requestId}.${extension}`;
  await deps.store(path,bytes,body.mimeType as string,body.sha256 as string);
  const saved=await deps.save({target_workspace_id:body.workspaceId as string,initiating_user_id:userId,target_request_id:body.requestId as string,target_job_id:body.jobId as string,target_original_name:body.originalName as string,target_mime_type:body.mimeType as string,target_size_bytes:body.sizeBytes as number,target_sha256:body.sha256 as string,target_storage_path:path});
  return reply(200,result(saved,body));
 }catch{return reply(503,{error:'Upload outcome could not be confirmed.',code:'outcome_unknown'});}
}
