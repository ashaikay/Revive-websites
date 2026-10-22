import {addPlannerDays,type PlannerData} from './schedulingPlanner';
import {localLeaveToUtc} from './workerUnavailability';
import {validateJobAttempt,type JobAttempt,type SchedulingJob} from './schedulingJobs';

export const jobImportHeaders=['title','start_date','start_time','end_date','end_time','timezone','location','required_skills','skill_requirement_mode','staffing_count'] as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDate=/^\d{4}-\d{2}-\d{2}$/;
const localTime=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const csvCell=(value:string)=>/[",\r\n]/.test(value)?`"${value.replace(/"/g,'""')}"`:value;
export const csvText=(rows:string[][])=>rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
export const jobImportTemplate=()=>csvText([
 [...jobImportHeaders],
 ['Example support shift','2026-10-12','09:00','2026-10-12','17:00','Europe/London','Birmingham office','Admin; Phone','all','2'],
]);

function parseCsv(text:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 const source=text.replace(/^\uFEFF/,'');
 for(let index=0;index<source.length;index++){
  const char=source[index];
  if(quoted){
   if(char==='"'&&source[index+1]==='"'){cell+='"';index++;}
   else if(char==='"')quoted=false;
   else cell+=char;
  }else if(char==='"'&&cell==='')quoted=true;
  else if(char===','){row.push(cell);cell='';}
  else if(char==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
  else cell+=char;
 }
 if(quoted)throw Error('The CSV contains an unclosed quoted value.');
 if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
 return rows.filter(value=>value.some(cellValue=>cellValue.trim()!==''));
}

function localParts(value:string,timezone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 const get=(type:string)=>parts.find(part=>part.type===type)?.value??'';
 return{date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};
}

export interface ScheduleExportOptions{startDate:string;endDate:string;timezone:string;assignmentsOnly?:boolean;workerId?:string;location?:string;}
export function scheduleExportRows(data:PlannerData,options:ScheduleExportOptions):string[][]{
 const start=localLeaveToUtc(`${options.startDate}T00:00`,options.timezone);
 const end=localLeaveToUtc(`${addPlannerDays(options.endDate,1)}T00:00`,options.timezone);
 const workers=new Map(data.workers.map(worker=>[worker.id,worker.name]));
 const jobs=new Map(data.jobs.map(job=>[job.id,job]));
 const inRange=(from:string,to:string)=>from<end&&to>start;
 const rows:string[][]=[['record_type','worker','job','date','local_start','local_end','timezone','recorded_status']];
 const assignments=data.assignments
  .filter(item=>inRange(item.startAt,item.endAt)&&(!options.workerId||item.workerId===options.workerId))
  .filter(item=>{const job=jobs.get(item.jobId);return Boolean(job)&&(!options.location||job?.location===options.location);})
  .sort((left,right)=>left.startAt.localeCompare(right.startAt));
 for(const assignment of assignments){
  const job=jobs.get(assignment.jobId)!;const localStart=localParts(assignment.startAt,options.timezone),localEnd=localParts(assignment.endAt,options.timezone);
  rows.push(['Assignment',workers.get(assignment.workerId)??'Unknown worker',job.title,localStart.date,localStart.time,localEnd.time,options.timezone,assignment.status]);
 }
 if(options.assignmentsOnly)return rows;
 const assignedJobIds=new Set(assignments.map(item=>item.jobId));
 for(const job of data.jobs.filter(item=>inRange(item.startAt,item.endAt)&&!assignedJobIds.has(item.id)&&(!options.location||item.location===options.location)).sort((a,b)=>a.startAt.localeCompare(b.startAt))){
  const localStart=localParts(job.startAt,options.timezone),localEnd=localParts(job.endAt,options.timezone);
  rows.push(['Job','',job.title,localStart.date,localStart.time,localEnd.time,options.timezone,job.status]);
 }
 for(const period of data.leave.filter(item=>inRange(item.startAt,item.endAt)&&(!options.workerId||item.workerId===options.workerId)).sort((a,b)=>a.startAt.localeCompare(b.startAt))){
  const localStart=localParts(period.startAt,options.timezone),localEnd=localParts(period.endAt,options.timezone);
  const label=period.category==='leave'?'Leave':period.category==='sickness'?'Sickness':'Unavailable';
  rows.push([label,workers.get(period.workerId)??'Unknown worker','',localStart.date,localStart.time,localEnd.time,options.timezone,period.status]);
 }
 return rows;
}

export interface JobImportPreviewRow{line:number;attempt:JobAttempt|null;errors:string[];warnings:string[];}
export interface JobImportPreview{rows:JobImportPreviewRow[];canConfirm:boolean;}
type JobSlot=Pick<SchedulingJob,'title'|'startAt'|'endAt'|'location'>;
const slot=(value:JobSlot)=>JSON.stringify([value.title,value.startAt,value.endAt,value.location]);
export function previewJobImport(text:string,workspaceId:string,existing:JobSlot[],requestId:()=>string):JobImportPreview{
 if(!uuid.test(workspaceId))throw Error('Workspace required.');
 const parsed=parseCsv(text);if(parsed.length<2)throw Error('The CSV must include the template header and at least one job row.');
 if(parsed.length>101)throw Error('Import no more than 100 job rows at a time.');
 if(parsed[0].map(value=>value.trim()).join(',')!==jobImportHeaders.join(','))throw Error('Use the REV job template without renaming, removing or reordering columns.');
 const seen=new Set<string>(),existingSlots=new Set(existing.map(slot));
 const rows=parsed.slice(1).map((values,index):JobImportPreviewRow=>{
  const errors:string[]=[],warnings:string[]=[];if(values.length!==jobImportHeaders.length)return{line:index+2,attempt:null,errors:['Expected exactly 10 columns.'],warnings};
  const [title,startDate,startTime,endDate,endTime,timezone,location,skillsText,mode,countText]=values.map(value=>value.trim());
  if(!title||title.length>160)errors.push('Title is required and must be 160 characters or fewer.');
  if(!isoDate.test(startDate)||!isoDate.test(endDate)||!localTime.test(startTime)||!localTime.test(endTime))errors.push('Use YYYY-MM-DD dates and 24-hour HH:MM times.');
  try{new Intl.DateTimeFormat('en-GB',{timeZone:timezone});}catch{errors.push('Timezone must be a valid IANA timezone such as Europe/London.');}
  if(!location||location.length>300)errors.push('Location is required and must be 300 characters or fewer.');
  const requiredSkills=[...new Set(skillsText.split(';').map(value=>value.trim()).filter(Boolean))].sort();
  if(requiredSkills.length>30||requiredSkills.some(value=>value.length>80))errors.push('Use at most 30 semicolon-separated skills of 80 characters or fewer.');
  if(mode!=='all'&&mode!=='any')errors.push('Skill requirement mode must be all or any.');
  const staffingCount=Number(countText);if(!Number.isInteger(staffingCount)||staffingCount<1||staffingCount>100)errors.push('Staffing count must be a whole number from 1 to 100.');
  let startAt='',endAt='';if(errors.length===0){try{startAt=localLeaveToUtc(`${startDate}T${startTime}`,timezone);endAt=localLeaveToUtc(`${endDate}T${endTime}`,timezone);if(startAt>=endAt)errors.push('End must be after start.');}catch{errors.push('The local time is invalid or ambiguous for that timezone.');}}
  if(errors.length)return{line:index+2,attempt:null,errors,warnings};
  const attempt=validateJobAttempt({workspaceId,requestId:requestId(),jobId:null,title,startAt,endAt,timezone,location,requiredSkills,skillRequirementMode:mode,staffingCount,status:'open',expectedVersion:0});
  const key=slot(attempt);
  if(seen.has(key))errors.push('Duplicate job row in this file.');
  if(existingSlots.has(key))errors.push('A matching job already exists; it will not be overwritten.');
  if(existing.some(job=>job.location===location&&job.startAt<endAt&&job.endAt>startAt&&!existingSlots.has(key)))warnings.push('Another recorded job overlaps at this location. Review before confirming.');
  seen.add(key);return{line:index+2,attempt,errors,warnings};
 });
 return{rows,canConfirm:rows.length>0&&rows.every(row=>row.attempt&&row.errors.length===0)};
}

export interface JobImportAttempt{workspaceId:string;batchRequestId:string;rows:JobAttempt[];}
export class JobImportRefused extends Error{}
const storageKey=(workspaceId:string,userId:string)=>{if(!uuid.test(workspaceId)||!uuid.test(userId))throw Error('Identity required.');return`rev-job-import:${workspaceId}:${userId}`;};
export function validateJobImportAttempt(value:unknown):JobImportAttempt{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid job import.');
 const raw=value as Record<string,unknown>;if(Object.keys(raw).sort().join(',')!=='batchRequestId,rows,workspaceId'||!uuid.test(String(raw.workspaceId))||!uuid.test(String(raw.batchRequestId))||!Array.isArray(raw.rows)||raw.rows.length<1||raw.rows.length>100)throw Error('Invalid job import.');
 const rows=raw.rows.map(validateJobAttempt);if(rows.some(row=>row.workspaceId!==raw.workspaceId||row.jobId!==null||row.expectedVersion!==0||row.status!=='open')||new Set(rows.map(row=>row.requestId)).size!==rows.length)throw Error('Invalid job import.');
 return{workspaceId:raw.workspaceId as string,batchRequestId:raw.batchRequestId as string,rows};
}
export function rememberJobImport(storage:Storage,userId:string,attempt:JobImportAttempt){const valid=validateJobImportAttempt(attempt);storage.setItem(storageKey(valid.workspaceId,userId),JSON.stringify(valid));}
export function restoreJobImport(storage:Storage,workspaceId:string,userId:string){const raw=storage.getItem(storageKey(workspaceId,userId));return raw===null?null:validateJobImportAttempt(JSON.parse(raw));}
export function clearJobImport(storage:Storage,workspaceId:string,userId:string){storage.removeItem(storageKey(workspaceId,userId));}
export async function submitJobImport(attempt:JobImportAttempt,invoke:(name:string,body:Record<string,unknown>)=>Promise<{status:number;data:unknown}>){
 const valid=validateJobImportAttempt(attempt),response=await invoke('rev-scheduling-job-import',valid as unknown as Record<string,unknown>);
 if(response.status===409){const value=response.data as Record<string,unknown>;if(value?.status==='refused'&&value?.code==='duplicate_jobs'&&value?.batchRequestId===valid.batchRequestId)throw new JobImportRefused('A matching job was recorded before confirmation. Refresh and preview the file again.');throw Error('Import outcome unconfirmed.');}
 if(response.status!==200||!response.data||typeof response.data!=='object'||Array.isArray(response.data))throw Error('Import outcome unconfirmed.');
 const result=response.data as Record<string,unknown>;if(result.workspaceId!==valid.workspaceId||result.batchRequestId!==valid.batchRequestId||result.savedCount!==valid.rows.length||!Array.isArray(result.jobs)||result.jobs.length!==valid.rows.length)throw Error('Import outcome unconfirmed.');
 return{savedCount:result.savedCount as number};
}

interface Storage{getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}
