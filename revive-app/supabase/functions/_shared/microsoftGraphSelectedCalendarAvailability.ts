import { MicrosoftGraphAvailabilityError, type MicrosoftGraphAvailabilityRequest, type BusyInterval } from './microsoftGraphAvailability.ts';
const graphOrigin='https://graph.microsoft.com';
function invalidPayload():never{throw new MicrosoftGraphAvailabilityError('invalid_payload','Selected calendar response is incomplete.');}
function utc(value:unknown):string|null{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value))return null;
 const parsed=Date.parse(value);if(!Number.isFinite(parsed))return null;
 const normalized=new Date(parsed).toISOString();return normalized.slice(0,19)===value.slice(0,19)?normalized:null;
}
function dateTime(value:unknown):string|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const row=value as Record<string,unknown>;
 if(row.timeZone!=='UTC'||typeof row.dateTime!=='string')return null;
 return utc(row.dateTime.endsWith('Z')?row.dateTime:`${row.dateTime}Z`);
}
function interval(value:unknown):BusyInterval|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalidPayload();const row=value as Record<string,unknown>;
 if(typeof row.isCancelled!=='boolean')return invalidPayload();
 if(row.isCancelled)return null;
 if(typeof row.showAs!=='string'||!['free','tentative','busy','oof','workingElsewhere'].includes(row.showAs))return invalidPayload();
 const startAt=dateTime(row.start),endAt=dateTime(row.end);
 if(!startAt||!endAt||Date.parse(startAt)>=Date.parse(endAt))return invalidPayload();
 return row.showAs==='free'?null:{startAt,endAt};
}
/** Delegated GET of one server-selected calendar, including recurring occurrences via calendarView. */
export async function readMicrosoftGraphSelectedCalendarAvailability(request:MicrosoftGraphAvailabilityRequest,fetchImpl:typeof fetch=fetch):Promise<BusyInterval[]>{
 const calendar=request.selectedCalendar,start=utc(request.searchStartAt),end=utc(request.searchEndAt);
 if(!request.accessToken?.trim()||/[\r\n]/.test(request.accessToken)||!calendar||calendar.workspaceId!==request.workspaceId||calendar.id!==request.selectedCalendarId||!calendar.connectionId||calendar.provider!=='microsoft_graph'||!calendar.providerCalendarReference?.trim()||calendar.providerCalendarReference.length>2048||request.timezone!==calendar.timezone||!start||!end||Date.parse(start)>=Date.parse(end)||Date.parse(end)-Date.parse(start)>7*86400000)throw new MicrosoftGraphAvailabilityError('invalid_request','Selected calendar request is invalid.');
 try{new Intl.DateTimeFormat('en-GB',{timeZone:request.timezone});}catch{throw new MicrosoftGraphAvailabilityError('invalid_request','Selected calendar timezone is invalid.');}
 const path=`/v1.0/me/calendars/${encodeURIComponent(calendar.providerCalendarReference)}/calendarView`;
 const initial=new URL(graphOrigin+path);initial.search=new URLSearchParams({startDateTime:start,endDateTime:end,'$select':'start,end,showAs,isCancelled','$top':'100'}).toString();
 const visited=new Set<string>(),busy:BusyInterval[]=[];let next:string|null=initial.href;
 for(let page=0;next!==null;page++){
  if(page>=20)return invalidPayload();
  let url:URL;try{url=new URL(next);}catch{return invalidPayload();}
  if(url.origin!==graphOrigin||url.pathname!==path||url.username||url.password||url.hash||visited.has(url.href))return invalidPayload();
  for(const key of url.searchParams.keys())if(!['startDateTime','endDateTime','$select','$top','$skip','$skiptoken'].includes(key))return invalidPayload();
  if(url.searchParams.has('startDateTime')&&utc(url.searchParams.get('startDateTime'))!==start)return invalidPayload();
  if(url.searchParams.has('endDateTime')&&utc(url.searchParams.get('endDateTime'))!==end)return invalidPayload();
  visited.add(url.href);
  let response:Response;
  try{response=await fetchImpl(url.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${request.accessToken}`,Accept:'application/json',Prefer:'outlook.timezone="UTC"'}});}catch{throw new MicrosoftGraphAvailabilityError('read_outcome_unknown','Selected calendar read outcome is unknown.');}
  if(!response.ok)throw new MicrosoftGraphAvailabilityError(response.status===429?'rate_limited':'provider_rejected','Selected calendar read was refused.',response.status);
  let result:unknown;try{result=await response.json();}catch{return invalidPayload();}
  if(!result||typeof result!=='object'||Array.isArray(result))return invalidPayload();const payload=result as Record<string,unknown>;
  if(!Array.isArray(payload.value)||payload.value.length>100)return invalidPayload();
  for(const event of payload.value){const entry=interval(event);if(entry)busy.push(entry);}
  const link=payload['@odata.nextLink'];if(link!==undefined&&(typeof link!=='string'||!link))return invalidPayload();next=link===undefined?null:link as string;
 }
 return busy;
}
