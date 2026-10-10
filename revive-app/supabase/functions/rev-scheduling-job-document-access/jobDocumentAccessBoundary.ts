import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';

export interface AccessDocument{documentId:string;workspaceId:string;jobId:string;originalName:string;mimeType:'application/pdf'|'text/plain';sizeBytes:number;storagePath:string;status:'stored';version:1;}
export interface JobDocumentAccessDependencies{
 allowedOrigin?:string;
 getUserId(authorization:string):Promise<string|null>;
 canManage(authorization:string,workspaceId:string,userId:string):Promise<boolean>;
 load(workspaceId:string,jobId:string,documentId:string):Promise<AccessDocument|null>;
 sign(path:string,expiresInSeconds:number,downloadName:string|null):Promise<string>;
 now?():number;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
export async function handleJobDocumentAccess(request:Request,deps:JobDocumentAccessDependencies):Promise<Response>{
 const origin=resolveAnnualLeaveOrigin(request.headers.get('Origin'),deps.allowedOrigin);if(!origin)return new Response(null,{status:403});
 const headers={'Access-Control-Allow-Origin':origin,Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json'},reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')??'';if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:'Authentication required.'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'JSON required.'});
 let body:Record<string,unknown>;try{const raw=await request.text();if(raw.length>1024)return reply(400,{error:'Valid document access request required.'});body=JSON.parse(raw);}catch{return reply(400,{error:'Valid document access request required.'});}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='action,documentId,jobId,workspaceId'||!id(body.workspaceId)||!id(body.jobId)||!id(body.documentId)||(body.action!=='open'&&body.action!=='download'))return reply(400,{error:'Valid document access request required.'});
 const userId=await deps.getUserId(authorization);if(!id(userId))return reply(401,{error:'Authentication required.'});
 if(!await deps.canManage(authorization,body.workspaceId as string,userId))return reply(403,{error:'Job document access denied.'});
 const document=await deps.load(body.workspaceId as string,body.jobId as string,body.documentId as string);
 if(!document||document.workspaceId!==body.workspaceId||document.jobId!==body.jobId||document.documentId!==body.documentId||document.status!=='stored'||document.version!==1)return reply(404,{error:'Job document unavailable.'});
 try{
  const expiresInSeconds=60,url=await deps.sign(document.storagePath,expiresInSeconds,body.action==='download'?document.originalName:null);
  if(typeof url!=='string'||!/^https?:\/\//.test(url))throw Error('Invalid signed URL');
  return reply(200,{workspaceId:document.workspaceId,jobId:document.jobId,documentId:document.documentId,originalName:document.originalName,mimeType:document.mimeType,sizeBytes:document.sizeBytes,action:body.action,url,expiresAt:new Date((deps.now?.()??Date.now())+expiresInSeconds*1000).toISOString()});
 }catch{return reply(503,{error:'A temporary document link could not be created.'});}
}
