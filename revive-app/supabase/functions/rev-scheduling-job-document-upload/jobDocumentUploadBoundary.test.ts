import test from 'node:test';
import assert from 'node:assert/strict';
import {handleJobDocumentUpload} from './jobDocumentUploadBoundary.ts';

const workspaceId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333',userId='44444444-4444-4444-8444-444444444444';
const bytes=new TextEncoder().encode('Job brief text'),base64=btoa(String.fromCharCode(...bytes));
const digest=async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
const request=async(body:Record<string,unknown>)=>new Request('https://example.test/functions/v1/rev-scheduling-job-document-upload',{method:'POST',headers:{Origin:'http://localhost:5180',Authorization:'Bearer token','Content-Type':'application/json'},body:JSON.stringify(body)});
const body=async()=>({workspaceId,jobId,requestId,originalName:'brief.txt',mimeType:'text/plain',sizeBytes:bytes.length,sha256:await digest(),base64});
const saved=async()=>({document_id:requestId,workspace_id:workspaceId,job_id:jobId,original_name:'brief.txt',mime_type:'text/plain',size_bytes:bytes.length,sha256:await digest(),status:'stored',version:1,created_at:'2026-10-09T20:00:00Z'});

test('manager upload binds actor, storage path and analysis-unavailable status',async()=>{
 let stored:unknown[],input:unknown;
 const response=await handleJobDocumentUpload(await request(await body()),{allowedOrigin:'http://localhost:5180',getUserId:async()=>userId,canManage:async()=>true,store:async(...args)=>{stored=args;},save:async value=>{input=value;return saved();}});
 assert.equal(response.status,200);assert.deepEqual(stored?.slice(1),[bytes,'text/plain',await digest()]);
 assert.deepEqual(input,{target_workspace_id:workspaceId,initiating_user_id:userId,target_request_id:requestId,target_job_id:jobId,target_original_name:'brief.txt',target_mime_type:'text/plain',target_size_bytes:bytes.length,target_sha256:await digest(),target_storage_path:`${workspaceId}/${jobId}/${requestId}/${requestId}.txt`});
 assert.deepEqual(await response.json(),{documentId:requestId,workspaceId,jobId,originalName:'brief.txt',mimeType:'text/plain',sizeBytes:bytes.length,sha256:await digest(),status:'stored',version:1,createdAt:'2026-10-09T20:00:00.000Z',analysisAvailable:false});
});
test('denies unauthorised users before storage',async()=>{
 let stored=false;const response=await handleJobDocumentUpload(await request(await body()),{allowedOrigin:'http://localhost:5180',getUserId:async()=>userId,canManage:async()=>false,store:async()=>{stored=true;},save:async()=>saved()});
 assert.equal(response.status,403);assert.equal(stored,false);
});
test('rejects unreadable content and preserves unknown storage outcomes',async()=>{
 const malformed={...await body(),base64:btoa('binary\u0000data'),sizeBytes:11,sha256:'0'.repeat(64)};
 assert.equal((await handleJobDocumentUpload(await request(malformed),{allowedOrigin:'http://localhost:5180',getUserId:async()=>userId,canManage:async()=>true,store:async()=>{},save:async()=>saved()})).status,400);
 const uncertain=await handleJobDocumentUpload(await request(await body()),{allowedOrigin:'http://localhost:5180',getUserId:async()=>userId,canManage:async()=>true,store:async()=>{throw Error('unknown');},save:async()=>saved()});
 assert.equal(uncertain.status,503);assert.deepEqual(await uncertain.json(),{error:'Upload outcome could not be confirmed.',code:'outcome_unknown'});
});
