import {localLeaveToUtc} from './workerUnavailability.ts';
import {missingSkills,satisfiesSkillRequirement,type SkillRequirementMode} from './skillMatching.ts';

export const plannerColumns={
 scheduling_workers:'id,workspace_id,display_name,role_labels,skill_tags,active,version',
 scheduling_jobs:'id,workspace_id,title,start_at,end_at,timezone,location,required_skills,skill_requirement_mode,staffing_count,status,version',
 scheduling_assignments:'id,workspace_id,worker_id,job_id,start_at,end_at,status,version',
 scheduling_worker_patterns:'id,workspace_id,worker_id,timezone,working_days,start_local,end_local,effective_from,effective_until,version',
 scheduling_worker_unavailability:'id,workspace_id,worker_id,start_at,end_at,category,status,version',
} as const;
export type PlannerTable=keyof typeof plannerColumns;
export type PlannerRead=(table:PlannerTable,columns:string,workspaceId:string,from:number,to:number)=>Promise<unknown>;
export interface PlannerWorker{id:string;name:string;active:boolean;skills:string[];}
export interface PlannerJob{id:string;title:string;startAt:string;endAt:string;timezone:string;location:string;skills:string[];skillRequirementMode:SkillRequirementMode;count:number;status:'open'|'cancelled';}
export interface PlannerAssignment{id:string;workerId:string;jobId:string;startAt:string;endAt:string;status:'active'|'cancelled';}
export interface PlannerPattern{workerId:string;timezone:string;days:number[];startLocal:string;endLocal:string;from:string;until:string|null;}
export interface PlannerLeave{id:string;workerId:string;startAt:string;endAt:string;category:'leave'|'unavailable';status:'active'|'cancelled';}
export interface PlannerData{workers:PlannerWorker[];jobs:PlannerJob[];assignments:PlannerAssignment[];patterns:PlannerPattern[];leave:PlannerLeave[];}
export type WorkerSuitabilityReason='worker_inactive'|'missing_skills'|'no_working_pattern'|'outside_working_availability'|'worker_unavailable'|'overlap'|'capacity_full'|'availability_unchecked';
export interface WorkerSuitability{workerId:string;suitable:boolean;reason:WorkerSuitabilityReason|null;message:string;}
export const workerSuitabilityMessages:Record<WorkerSuitabilityReason,string>={worker_inactive:'Archived or inactive worker.',missing_skills:'Missing required skills.',no_working_pattern:'No working pattern. Set working hours before assigning.',outside_working_availability:'Outside recorded working hours.',worker_unavailable:'Active leave or unavailability overlaps this session.',overlap:'Another assignment overlaps this session.',capacity_full:'Session already full.',availability_unchecked:'Availability could not be checked. Refresh the allocation and review working hours before assigning.'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Planner data unavailable');return v as Record<string,unknown>;}
function text(v:unknown,max:number):string{if(typeof v!=='string'||!v||v!==v.trim()||v.length>max)throw Error('Invalid planner text');return v;}
function tags(v:unknown):string[]{if(!Array.isArray(v)||v.length>30||v.some(t=>typeof t!=='string'||!t||t!==t.trim()||t.length>80)||new Set(v).size!==v.length)throw Error('Invalid skills');return v as string[];}
function zone(v:unknown):string{const z=text(v,100);new Intl.DateTimeFormat('en-GB',{timeZone:z});return z;}
function instant(v:unknown):string{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Invalid interval');return new Date(v).toISOString();}
function interval(r:Record<string,unknown>){const startAt=instant(r.start_at),endAt=instant(r.end_at);if(startAt>=endAt)throw Error('Invalid interval');return {startAt,endAt};}
function date(v:unknown):string{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'1000-01-01'||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('Invalid date');return v;}
function status<T extends string>(v:unknown,allowed:T[]):T{if(typeof v!=='string'||!allowed.includes(v as T))throw Error('Invalid status');return v as T;}
async function readRows(table:PlannerTable,ws:string,read:PlannerRead):Promise<Record<string,unknown>[]>{
 const all:Record<string,unknown>[]=[];const seen=new Set<string>();const size=500;
 for(let page=0;page<10;page++){const raw=await read(table,plannerColumns[table],ws,page*size,page*size+size-1);if(!Array.isArray(raw)||raw.length>size)throw Error('Planner page unavailable');
 for(const v of raw){const r=object(v),keys=Object.keys(r).sort().join(','),expected=plannerColumns[table].split(',').sort().join(','),legacy=table==='scheduling_jobs'?plannerColumns[table].split(',').filter(column=>column!=='skill_requirement_mode').sort().join(','):'';if((keys!==expected&&keys!==legacy)||!id(r.id)||seen.has(r.id)||r.workspace_id!==ws||!Number.isSafeInteger(r.version)||(r.version as number)<1)throw Error('Planner scope or row invalid');seen.add(r.id);all.push(r);}
 if(raw.length<size)return all;
 }throw Error('Planner data exceeds supported limit; no partial schedule shown');
}
export async function loadPlannerData(ws:string,read:PlannerRead):Promise<PlannerData>{
 if(!id(ws))throw Error('Workspace required');
 const [wr,jr,ar,pr,lr]=await Promise.all((Object.keys(plannerColumns) as PlannerTable[]).map(t=>readRows(t,ws,read)));
 const workers=wr.map(r=>{if(typeof r.active!=='boolean')throw Error('Invalid worker');tags(r.role_labels);return {id:r.id as string,name:text(r.display_name,120),active:r.active,skills:tags(r.skill_tags)};});
 const workerIds=new Set(workers.map(w=>w.id));
 const jobs=jr.map(r=>{const mode=r.skill_requirement_mode??'all';if(!Number.isInteger(r.staffing_count)||(r.staffing_count as number)<1||(r.staffing_count as number)>100||!['all','any'].includes(mode as string))throw Error('Invalid staffing');return {id:r.id as string,title:text(r.title,160),...interval(r),timezone:zone(r.timezone),location:text(r.location,300),skills:tags(r.required_skills),skillRequirementMode:mode as SkillRequirementMode,count:r.staffing_count as number,status:status(r.status,['open','cancelled'])};});
 const jobIds=new Set(jobs.map(j=>j.id));
 const assignments=ar.map(r=>{if(!id(r.worker_id)||!workerIds.has(r.worker_id)||!id(r.job_id)||!jobIds.has(r.job_id))throw Error('Orphan assignment');return {id:r.id as string,workerId:r.worker_id,jobId:r.job_id,...interval(r),status:status(r.status,['active','cancelled'])};});
 const patternWorkers=new Set<string>();
 const patterns=pr.map(r=>{if(!id(r.worker_id)||!workerIds.has(r.worker_id)||patternWorkers.has(r.worker_id)||!Array.isArray(r.working_days)||!r.working_days.length||r.working_days.length>7||r.working_days.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(r.working_days).size!==r.working_days.length||typeof r.start_local!=='string'||typeof r.end_local!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start_local)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end_local)||r.start_local>=r.end_local)throw Error('Invalid pattern');patternWorkers.add(r.worker_id);const from=date(r.effective_from),until=r.effective_until===null?null:date(r.effective_until);if(until!==null&&until<from)throw Error('Invalid pattern dates');return {workerId:r.worker_id,timezone:zone(r.timezone),days:r.working_days as number[],startLocal:r.start_local,endLocal:r.end_local,from,until};});
 const leave=lr.map(r=>{if(!id(r.worker_id)||!workerIds.has(r.worker_id))throw Error('Orphan leave');return {id:r.id as string,workerId:r.worker_id,...interval(r),category:status(r.category,['leave','unavailable']),status:status(r.status,['active','cancelled'])};});
 return {workers,jobs,assignments,patterns,leave};
}
export function localPlannerDate(instant:string,timezone:string):string{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));const get=(t:string)=>parts.find(p=>p.type===t)?.value;return `${get('year')}-${get('month')}-${get('day')}`;}
export function addPlannerDays(value:string,days:number):string{date(value);if(!Number.isInteger(days)||Math.abs(days)>3660)throw Error('Invalid date offset');return new Date(Date.parse(value+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function plannerMonday(value:string):string{date(value);const day=new Date(value+'T12:00:00Z').getUTCDay();return addPlannerDays(value,-((day+6)%7));}
export function spansPlannerDay(startAt:string,endAt:string,day:string,timezone:string):boolean{return localPlannerDate(startAt,timezone)<=day&&localPlannerDate(new Date(Date.parse(endAt)-1).toISOString(),timezone)>=day;}
export function jobVacancies(data:PlannerData,job:PlannerJob):number{return job.status==='open'?Math.max(0,job.count-data.assignments.filter(a=>a.status==='active'&&a.jobId===job.id).length):0;}
export function workerSetupIssue(data:PlannerData,workerId:string,week:string):string|null{const p=data.patterns.find(p=>p.workerId===workerId);if(!p)return 'Working hours missing';if(p.from>addPlannerDays(week,6)||(p.until!==null&&p.until<week))return 'Working hours do not cover this week';return null;}
function suitability(workerId:string,reason:WorkerSuitabilityReason|null):WorkerSuitability{return {workerId,suitable:reason===null,reason,message:reason===null?'Appears suitable. Final checks run when saving.':workerSuitabilityMessages[reason]};}
export function workerSuitability(data:PlannerData,job:PlannerJob,worker:PlannerWorker):WorkerSuitability{
 if(!worker.active)return suitability(worker.id,'worker_inactive');
 if(!satisfiesSkillRequirement(job.skills,worker.skills,job.skillRequirementMode)){const missing=missingSkills(job.skills,worker.skills);return {workerId:worker.id,suitable:false,reason:'missing_skills',message:job.skillRequirementMode==='any'?`None of these skills listed: ${job.skills.join(', ')}`:`Required skills not listed: ${missing.join(', ')}`};}
 if(job.status!=='open'||jobVacancies(data,job)===0)return suitability(worker.id,'capacity_full');
 const pattern=data.patterns.find(value=>value.workerId===worker.id);if(!pattern)return suitability(worker.id,'no_working_pattern');
 try{const day=localPlannerDate(job.startAt,pattern.timezone),endDay=localPlannerDate(new Date(Date.parse(job.endAt)-1).toISOString(),pattern.timezone),weekday=((new Date(day+'T12:00:00Z').getUTCDay()+6)%7)+1;
  if(day!==endDay||day<pattern.from||(pattern.until!==null&&day>pattern.until)||!pattern.days.includes(weekday)||job.startAt<localLeaveToUtc(`${day}T${pattern.startLocal}`,pattern.timezone)||job.endAt>localLeaveToUtc(`${day}T${pattern.endLocal}`,pattern.timezone))return suitability(worker.id,'outside_working_availability');
 }catch{return suitability(worker.id,'availability_unchecked');}
 if(data.leave.some(period=>period.status==='active'&&period.workerId===worker.id&&period.startAt<job.endAt&&job.startAt<period.endAt))return suitability(worker.id,'worker_unavailable');
 if(data.assignments.some(assignment=>assignment.status==='active'&&assignment.workerId===worker.id&&assignment.startAt<job.endAt&&job.startAt<assignment.endAt))return suitability(worker.id,'overlap');
 return suitability(worker.id,null);
}
export function assignmentConflict(data:PlannerData,a:PlannerAssignment):boolean{const j=data.jobs.find(j=>j.id===a.jobId),w=data.workers.find(w=>w.id===a.workerId);return !j||!w||!w.active||j.status!=='open'||j.startAt!==a.startAt||j.endAt!==a.endAt||!satisfiesSkillRequirement(j.skills,w.skills,j.skillRequirementMode)||data.leave.some(l=>l.status==='active'&&l.workerId===a.workerId&&l.startAt<a.endAt&&a.startAt<l.endAt)||data.assignments.some(b=>b.id!==a.id&&b.status==='active'&&b.workerId===a.workerId&&b.startAt<a.endAt&&a.startAt<b.endAt)||data.assignments.filter(b=>b.status==='active'&&b.jobId===a.jobId).length>j.count;}
