import test from 'node:test';
import assert from 'node:assert/strict';
import {bankHolidaySource, fetchOfficialHolidays, handleBankHolidayImport, ImportRefusal, ukRegions, validateOfficialHolidays, type ImportDependencies} from './bankHolidayImportBoundary.ts';
const workspaceId='11111111-1111-4111-8111-111111111111',workerId='22222222-2222-4222-8222-222222222222',userId='33333333-3333-4333-8333-333333333333',previewId='44444444-4444-4444-8444-444444444444',requestId='55555555-5555-4555-8555-555555555555';
const event={date:'2026-01-01',title:"New Year's Day",notes:'',bunting:true};
const feed=(region:string,events:unknown[]=[event])=>({[region]:{division:region,events}});
const body={action:'preview',workspaceId,workerId,calendarId:null,region:'england-and-wales',calendarYear:2026};
const request=(value:unknown,origin='http://localhost:5180')=>new Request('https://example.test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(value)});
function fixture(){
 const calls:Record<string,unknown>[]=[];let fetches=0;
 const deps:ImportDependencies={
  allowedOrigin:'http://localhost:5180',
  getUserId:async()=>userId,canManage:async()=>true,now:()=> '2026-10-07T09:00:00.000Z',
  fetchOfficial:async()=>{fetches++;return feed('england-and-wales');},
  execute:async input=>{calls.push(input);return input.target_action==='preview'?
   {action:'preview',workspaceId,workerId,previewId,region:input.target_region,calendarYear:input.target_year,holidays:input.target_events,conflicts:[],preserved:[],additions:1,existing:0,source:bankHolidaySource,fetchedAt:input.target_fetched_at}:
   {action:'confirm',workspaceId,workerId,previewId,requestId,calendarId:previewId,revision:1,confirmedRevision:1,source:bankHolidaySource,fetchedAt:'2026-10-07T09:00:00Z'};},
 };
 return{deps,calls,fetches:()=>fetches};
}
test('all UK regions use only official events, including one-off holidays and no inferred counts',()=>{
 for(const region of ukRegions){
  const events=[event,{...event,date:'2026-07-07',title:'Official one-off holiday'}, {...event,date:'2027-01-01'}];
  assert.deepEqual(validateOfficialHolidays(feed(region,events),region,2026),events.slice(0,2).map(({date,title})=>({date,title})));
 }
});
test('malformed, duplicate, impossible dates and missing years are refused',()=>{
 for(const value of[null,{},feed('england-and-wales',[]),feed('england-and-wales',[{...event,date:'2026-02-30'}]),feed('england-and-wales',[event,event]),feed('england-and-wales',[{...event,title:' '}]),feed('england-and-wales',[{...event,bunting:'true'}]),feed('england-and-wales',[{...event,date:'2027-01-01'}])]){
  assert.throws(()=>validateOfficialHolidays(value,'england-and-wales',2026));
 }
});
test('authenticated preview sends validated server dates and fetch time, not client dates',async()=>{
 const f=fixture();assert.equal((await handleBankHolidayImport(request(body),f.deps)).status,200);
 assert.equal(f.fetches(),1);assert.deepEqual(f.calls[0].target_events,[{date:event.date,title:event.title}]);
 assert.equal(f.calls[0].target_fetched_at,f.deps.now());assert.equal(f.calls[0].initiating_user_id,userId);
 for(const patch of[{source:'https://evil.test'}, {events:[event]}, {region:'uk'}, {calendarYear:2026.5}, {calendarId:'bad'}]){
  const invalid=fixture();assert.equal((await handleBankHolidayImport(request({...body,...patch}),invalid.deps)).status,400);assert.equal(invalid.fetches(),0);assert.equal(invalid.calls.length,0);
 }
});
test('auth, permissions, origins and upstream failures leave authority untouched',async()=>{
 for(const kind of['user','permission','origin','upstream','malformed','year']){
  const f=fixture();
  if(kind==='user')f.deps.getUserId=async()=>null;
  if(kind==='permission')f.deps.canManage=async()=>false;
  if(kind==='upstream')f.deps.fetchOfficial=async()=>{throw Error('Timeout');};
  if(kind==='malformed')f.deps.fetchOfficial=async()=>({events:[]});
  const response=await handleBankHolidayImport(request({...body,calendarYear:kind==='year'?2039:2026},kind==='origin'?'https://evil.test':'http://localhost:5180'),f.deps);
  assert.ok(response.status>=400);assert.equal(f.calls.length,0);
  if(['user','permission','origin'].includes(kind))assert.equal(f.fetches(),0);
 }
});
test('official fetch uses a fixed URL, timeout and no redirects; rejects HTTP, content type, oversized and broken JSON responses',async()=>{
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async(url,options)=>{
   assert.equal(url,bankHolidaySource);assert.equal(options?.redirect,'error');assert.ok(options?.signal);
   return new Response(JSON.stringify(feed('england-and-wales')),{headers:{'Content-Type':'application/json'}});
  };
  assert.deepEqual(await fetchOfficialHolidays(),feed('england-and-wales'));
  for(const response of[
   new Response('Unavailable',{status:503}),
   new Response('{}',{headers:{'Content-Type':'text/html'}}),
   new Response('invalid',{headers:{'Content-Type':'application/json'}}),
   new Response('x'.repeat(1024*1024+1),{headers:{'Content-Type':'application/json'}}),
  ]){
   globalThis.fetch=async()=>response;
   await assert.rejects(fetchOfficialHolidays());
  }
  globalThis.fetch=async()=>{throw Error('Timeout');};
  await assert.rejects(fetchOfficialHolidays());
 } finally {globalThis.fetch=original;}
});
test('confirmation and exact retry do not re-fetch, and refusals are request-bound',async()=>{
 const confirm={action:'confirm',workspaceId,workerId,previewId,requestId};
 const f=fixture();
 for(let i=0;i<2;i++)assert.equal((await handleBankHolidayImport(request(confirm),f.deps)).status,200);
 assert.equal(f.fetches(),0);assert.deepEqual(f.calls[0],f.calls[1]);
 for(const code of['stale_import','import_conflict','request_conflict']){
  f.deps.execute=async()=>{throw new ImportRefusal(code);};
  const response=await handleBankHolidayImport(request(confirm),f.deps);
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{status:'refused',code,requestId});
 }
 f.deps.execute=async()=>({action:'confirm',workspaceId,workerId});
 assert.equal((await handleBankHolidayImport(request(confirm),f.deps)).status,503);
});
