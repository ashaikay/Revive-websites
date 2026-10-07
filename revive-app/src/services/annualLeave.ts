export const annualLeaveColumns={
 annual_leave_policies:'id,workspace_id,worker_id,version,effective_from_leave_year,allowance_input_unit,allowance_input_value,allowance_minutes,hours_per_day_minutes,leave_year_start_month,leave_year_start_day,bank_holiday_treatment',
 annual_leave_accounts:'id,workspace_id,worker_id,leave_year_start,leave_year_end_exclusive,configured_allowance_minutes,hours_per_day_minutes,bank_holiday_treatment,adjustment_total_minutes,recorded_leave_minutes,version',
 annual_leave_adjustments:'id,workspace_id,account_id,worker_id,adjustment_minutes,reason,account_version,created_at',
 annual_leave_postings:'id,workspace_id,absence_id,account_id,posting_kind,minutes,account_version,created_at',
 annual_leave_absences:'id,workspace_id,worker_id,unavailability_id,start_at,end_at,timezone,total_deduction_minutes,status,version,created_at,cancelled_at',
 annual_leave_calculation_segments:'id,workspace_id,absence_id,worker_id,account_id,local_date,deduction_minutes',
 annual_leave_calendars:'id,workspace_id,name,region_code,status,version',
 annual_leave_worker_calendars:'workspace_id,worker_id,calendar_id,version',
 annual_leave_calendar_years:'workspace_id,calendar_id,calendar_year,revision,confirmed_revision,confirmed_at',
 workspace_bank_holidays:'id,workspace_id,calendar_id,holiday_date,name,status,version',
 scheduling_worker_patterns:'id,workspace_id,worker_id,timezone,effective_from,effective_until,version',
 scheduling_worker_unavailability:'id,workspace_id,worker_id,start_at,end_at,category,status,version',
} as const;
export type AnnualLeaveTable=keyof typeof annualLeaveColumns;
export type AnnualLeaveRead=(table:AnnualLeaveTable,columns:string,workspaceId:string,workerId:string,accountIds?:string[])=>Promise<unknown>;
export const annualLeaveReadLimit=1000;
export const annualLeavePageSize=250;
export const annualLeaveOrderColumns:Record<AnnualLeaveTable,readonly string[]>={
 annual_leave_policies:['id'],
 annual_leave_accounts:['id'],
 annual_leave_adjustments:['id'],
 annual_leave_postings:['id'],
 annual_leave_absences:['id'],
 annual_leave_calculation_segments:['id'],
 annual_leave_calendars:['id'],
 annual_leave_worker_calendars:['workspace_id','worker_id'],
 annual_leave_calendar_years:['workspace_id','calendar_id','calendar_year'],
 workspace_bank_holidays:['id'],
 scheduling_worker_patterns:['id'],
 scheduling_worker_unavailability:['id'],
};
export async function loadAnnualLeavePages(table:AnnualLeaveTable,fetchPage:(from:number,to:number,orderColumns:readonly string[])=>Promise<unknown>){
 const result:unknown[]=[];
 for(let from=0;from<=annualLeaveReadLimit;from+=annualLeavePageSize){
  const value=await fetchPage(from,from+annualLeavePageSize-1,annualLeaveOrderColumns[table]);
  if(!Array.isArray(value)||value.length>annualLeavePageSize)throw Error('Annual leave page unavailable; no partial data shown.');
  if(from===annualLeaveReadLimit){if(value.length>0)throw Error(`Annual leave data exceeds the ${annualLeaveReadLimit.toLocaleString('en-GB')}-row safety limit; no partial data shown.`);return result;}
  result.push(...value);
  if(value.length<annualLeavePageSize)return result;
 }
 throw Error(`Annual leave data exceeds the ${annualLeaveReadLimit.toLocaleString('en-GB')}-row safety limit; no partial data shown.`);
}
export interface AnnualLeavePolicy {policyId:string;workerId:string|null;version:number;effectiveFromLeaveYear:number;allowanceInputUnit:'hours'|'days';allowanceInputValue:number;allowanceMinutes:number;hoursPerDayMinutes:number;leaveYearStartMonth:number;leaveYearStartDay:number;bankHolidayTreatment:'included'|'additional';}
export interface AnnualLeaveAccount {accountId:string;workerId:string;leaveYearStart:string;leaveYearEndExclusive:string;configuredAllowanceMinutes:number;adjustmentTotalMinutes:number;recordedLeaveMinutes:number;remainingMinutes:number;hoursPerDayMinutes:number;bankHolidayTreatment:'included'|'additional';version:number;}
export interface AnnualLeaveAdjustment {adjustmentId:string;accountId:string;minutes:number;reason:string;accountVersion:number;createdAt:string;}
export interface AnnualLeaveAbsence {absenceId:string;unavailabilityId:string;workerId:string;startAt:string;endAt:string;timezone:string;totalDeductionMinutes:number;status:'confirmed'|'cancelled';version:number;accountIds:string[];createdAt:string;cancelledAt:string|null;}
export interface LegacyAnnualLeave {unavailabilityId:string;workerId:string;startAt:string;endAt:string;status:'active'|'cancelled';version:number;}
export interface AnnualLeaveCalendar {calendarId:string;name:string;regionCode:string;status:'active'|'inactive';version:number;}
export interface AnnualLeaveCalendarYear {calendarId:string;calendarYear:number;revision:number;confirmedRevision:number|null;confirmedAt:string|null;}
export interface AnnualLeaveHoliday {holidayId:string;calendarId:string;holidayDate:string;name:string;status:'active'|'cancelled';version:number;}
export interface AnnualLeaveWorkspaceModel {workspaceId:string;workerId:string;timezone:string|null;policies:AnnualLeavePolicy[];accounts:AnnualLeaveAccount[];adjustments:AnnualLeaveAdjustment[];absences:AnnualLeaveAbsence[];legacyLeave:LegacyAnnualLeave[];calendars:AnnualLeaveCalendar[];assignedCalendarId:string|null;assignmentVersion:number;calendarYears:AnnualLeaveCalendarYear[];holidays:AnnualLeaveHoliday[];}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
const integer=(value:unknown,min=0)=>Number.isSafeInteger(value)&&(value as number)>=min&&(value as number)<Number.MAX_SAFE_INTEGER;
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Annual leave data unavailable');return value as Record<string,unknown>;}
function rows(value:unknown,columns:string){if(!Array.isArray(value))throw Error('Annual leave data unavailable');if(value.length>annualLeaveReadLimit)throw Error(`Annual leave data exceeds the ${annualLeaveReadLimit.toLocaleString('en-GB')}-row safety limit; no partial data shown.`);const expected=columns.split(',').sort().join(',');return value.map(item=>{const row=object(item);if(Object.keys(row).sort().join(',')!==expected)throw Error('Annual leave data unavailable');return row;});}
function instant(value:unknown):string{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw Error('Annual leave data unavailable');return new Date(value).toISOString();}
function scoped(row:Record<string,unknown>,workspaceId:string){if(row.workspace_id!==workspaceId)throw Error('Annual leave scope unavailable');}
function unique(values:string[]){return new Set(values).size===values.length;}
export async function loadAnnualLeaveWorkspace(workspaceId:string,workerId:string,read:AnnualLeaveRead):Promise<AnnualLeaveWorkspaceModel>{
 if(!id(workspaceId)||!id(workerId))throw Error('Workspace and worker required');
 const tables=Object.keys(annualLeaveColumns) as AnnualLeaveTable[];
 const accountRows=rows(await read('annual_leave_accounts',annualLeaveColumns.annual_leave_accounts,workspaceId,workerId),annualLeaveColumns.annual_leave_accounts);
 const raw=await Promise.all(tables.filter(table=>table!=='annual_leave_accounts').map(table=>read(table,annualLeaveColumns[table],workspaceId,workerId,table==='annual_leave_postings'?accountRows.map(row=>String(row.id)):undefined)));
 const byTable=Object.fromEntries(tables.filter(table=>table!=='annual_leave_accounts').map((table,index)=>[table,rows(raw[index],annualLeaveColumns[table])])) as Record<AnnualLeaveTable,Record<string,unknown>[]>;
 byTable.annual_leave_accounts=accountRows;
 for(const table of tables)for(const row of byTable[table])scoped(row,workspaceId);
 const accountIds=new Set<string>();
 const rawAccounts=byTable.annual_leave_accounts.map(row=>{
  if(!id(row.id)||row.worker_id!==workerId||!date(row.leave_year_start)||!date(row.leave_year_end_exclusive)||!integer(row.configured_allowance_minutes)||!integer(row.hours_per_day_minutes,1)||!['included','additional'].includes(row.bank_holiday_treatment as string)||!Number.isSafeInteger(row.adjustment_total_minutes)||!integer(row.recorded_leave_minutes)||!integer(row.version,1)||accountIds.has(row.id))throw Error('Annual leave accounts unavailable');
  accountIds.add(row.id);return row;
 });
 const adjustments=byTable.annual_leave_adjustments.map(row=>{if(!id(row.id)||!id(row.account_id)||!accountIds.has(row.account_id)||row.worker_id!==workerId||!Number.isSafeInteger(row.adjustment_minutes)||row.adjustment_minutes===0||typeof row.reason!=='string'||!row.reason.trim()||!integer(row.account_version,2))throw Error('Annual leave adjustments unavailable');return{adjustmentId:row.id,accountId:row.account_id,minutes:row.adjustment_minutes,reason:row.reason,accountVersion:row.account_version,createdAt:instant(row.created_at)} as AnnualLeaveAdjustment;});
 if(!unique(adjustments.map(value=>value.adjustmentId)))throw Error('Annual leave adjustments unavailable');
 const postingTotals=new Map<string,number>();
 for(const row of byTable.annual_leave_postings){const invalidSign=row.posting_kind==='deduction'?(row.minutes as number)<=0:(row.minutes as number)>=0;if(!id(row.id)||!id(row.account_id)||!accountIds.has(row.account_id)||!id(row.absence_id)||!['deduction','reversal'].includes(row.posting_kind as string)||!Number.isSafeInteger(row.minutes)||invalidSign)throw Error('Annual leave postings unavailable');postingTotals.set(row.account_id,(postingTotals.get(row.account_id)??0)+(row.minutes as number));}
 const accounts=rawAccounts.map(row=>{
  const adjustmentTotal=adjustments.filter(item=>item.accountId===row.id).reduce((sum,item)=>sum+item.minutes,0),recordedTotal=postingTotals.get(row.id as string)??0;
  if(adjustmentTotal!==row.adjustment_total_minutes||recordedTotal!==row.recorded_leave_minutes)throw Error('Annual leave account evidence does not reconcile');
  const remaining=(row.configured_allowance_minutes as number)+adjustmentTotal-recordedTotal;
  if(!Number.isSafeInteger(remaining)||remaining<0)throw Error('Annual leave balance unavailable');
  return{accountId:row.id,workerId,leaveYearStart:row.leave_year_start,leaveYearEndExclusive:row.leave_year_end_exclusive,configuredAllowanceMinutes:row.configured_allowance_minutes,adjustmentTotalMinutes:adjustmentTotal,recordedLeaveMinutes:recordedTotal,remainingMinutes:remaining,hoursPerDayMinutes:row.hours_per_day_minutes,bankHolidayTreatment:row.bank_holiday_treatment,version:row.version} as AnnualLeaveAccount;
 }).sort((a,b)=>b.leaveYearStart.localeCompare(a.leaveYearStart));
 const policies=byTable.annual_leave_policies.map(row=>{if(!id(row.id)||(row.worker_id!==null&&row.worker_id!==workerId)||!integer(row.version,1)||!integer(row.effective_from_leave_year,1900)||!['hours','days'].includes(row.allowance_input_unit as string)||typeof row.allowance_input_value!=='number'||!Number.isFinite(row.allowance_input_value)||!integer(row.allowance_minutes)||!integer(row.hours_per_day_minutes,1)||!integer(row.leave_year_start_month,1)||!integer(row.leave_year_start_day,1)||!['included','additional'].includes(row.bank_holiday_treatment as string))throw Error('Annual leave policies unavailable');return{policyId:row.id,workerId:row.worker_id,version:row.version,effectiveFromLeaveYear:row.effective_from_leave_year,allowanceInputUnit:row.allowance_input_unit,allowanceInputValue:row.allowance_input_value,allowanceMinutes:row.allowance_minutes,hoursPerDayMinutes:row.hours_per_day_minutes,leaveYearStartMonth:row.leave_year_start_month,leaveYearStartDay:row.leave_year_start_day,bankHolidayTreatment:row.bank_holiday_treatment} as AnnualLeavePolicy;});
 const segmentsByAbsence=new Map<string,Set<string>>();
 for(const row of byTable.annual_leave_calculation_segments){if(!id(row.id)||row.worker_id!==workerId||!id(row.absence_id)||!id(row.account_id)||!accountIds.has(row.account_id)||!date(row.local_date)||!integer(row.deduction_minutes))throw Error('Annual leave calculation evidence unavailable');const current=segmentsByAbsence.get(row.absence_id)??new Set<string>();current.add(row.account_id);segmentsByAbsence.set(row.absence_id,current);}
 const accountedUnavailability=new Set<string>();
 const absences=byTable.annual_leave_absences.map(row=>{if(!id(row.id)||row.worker_id!==workerId||!id(row.unavailability_id)||accountedUnavailability.has(row.unavailability_id)||!['confirmed','cancelled'].includes(row.status as string)||!integer(row.total_deduction_minutes)||!integer(row.version,1))throw Error('Annual leave history unavailable');accountedUnavailability.add(row.unavailability_id);const accountList=[...(segmentsByAbsence.get(row.id)??[])].sort();if(accountList.length<1)throw Error('Annual leave calculation evidence unavailable');return{absenceId:row.id,unavailabilityId:row.unavailability_id,workerId,startAt:instant(row.start_at),endAt:instant(row.end_at),timezone:typeof row.timezone==='string'?row.timezone:'',totalDeductionMinutes:row.total_deduction_minutes,status:row.status,version:row.version,accountIds:accountList,createdAt:instant(row.created_at),cancelledAt:row.cancelled_at===null?null:instant(row.cancelled_at)} as AnnualLeaveAbsence;}).sort((a,b)=>b.startAt.localeCompare(a.startAt));
 const legacyLeave=byTable.scheduling_worker_unavailability.filter(row=>row.category==='leave'&&!accountedUnavailability.has(row.id as string)).map(row=>{if(!id(row.id)||row.worker_id!==workerId||!['active','cancelled'].includes(row.status as string)||!integer(row.version,1))throw Error('Historical leave unavailable');return{unavailabilityId:row.id,workerId,startAt:instant(row.start_at),endAt:instant(row.end_at),status:row.status,version:row.version} as LegacyAnnualLeave;}).sort((a,b)=>b.startAt.localeCompare(a.startAt));
 const calendars=byTable.annual_leave_calendars.map(row=>{if(!id(row.id)||typeof row.name!=='string'||!row.name.trim()||typeof row.region_code!=='string'||!['active','inactive'].includes(row.status as string)||!integer(row.version,1))throw Error('Annual leave calendars unavailable');return{calendarId:row.id,name:row.name,regionCode:row.region_code,status:row.status,version:row.version} as AnnualLeaveCalendar;});
 const assignments=byTable.annual_leave_worker_calendars;
 if(assignments.length>1)throw Error('Worker calendar unavailable');
 const assignment=assignments[0];if(assignment&&(!id(assignment.calendar_id)||assignment.worker_id!==workerId||!calendars.some(calendar=>calendar.calendarId===assignment.calendar_id)||!integer(assignment.version,1)))throw Error('Worker calendar unavailable');
 const calendarYears=byTable.annual_leave_calendar_years.map(row=>{if(!id(row.calendar_id)||!calendars.some(calendar=>calendar.calendarId===row.calendar_id)||!integer(row.calendar_year,1000)||!integer(row.revision,1)||(row.confirmed_revision!==null&&!integer(row.confirmed_revision,1))||(row.confirmed_revision===null)!=(row.confirmed_at===null))throw Error('Calendar years unavailable');return{calendarId:row.calendar_id,calendarYear:row.calendar_year,revision:row.revision,confirmedRevision:row.confirmed_revision,confirmedAt:row.confirmed_at===null?null:instant(row.confirmed_at)} as AnnualLeaveCalendarYear;});
 const holidays=byTable.workspace_bank_holidays.map(row=>{if(!id(row.id)||!id(row.calendar_id)||!calendars.some(calendar=>calendar.calendarId===row.calendar_id)||!date(row.holiday_date)||typeof row.name!=='string'||!row.name.trim()||!['active','cancelled'].includes(row.status as string)||!integer(row.version,1))throw Error('Bank holidays unavailable');return{holidayId:row.id,calendarId:row.calendar_id,holidayDate:row.holiday_date,name:row.name,status:row.status,version:row.version} as AnnualLeaveHoliday;}).sort((a,b)=>a.holidayDate.localeCompare(b.holidayDate));
 const patterns=byTable.scheduling_worker_patterns;
 if(patterns.length>1)throw Error('Working pattern unavailable');
 let timezone:string|null=null;if(patterns[0]){const row=patterns[0];if(row.worker_id!==workerId||typeof row.timezone!=='string'||!row.timezone||!date(row.effective_from)||(row.effective_until!==null&&!date(row.effective_until))||!integer(row.version,1))throw Error('Working pattern unavailable');new Intl.DateTimeFormat('en-GB',{timeZone:row.timezone});timezone=row.timezone;}
 return{workspaceId,workerId,timezone,policies,accounts,adjustments,absences,legacyLeave,calendars,assignedCalendarId:assignment?.calendar_id as string|null??null,assignmentVersion:assignment?.version as number??0,calendarYears,holidays};
}
export function formatLeaveMinutes(minutes:number){if(!Number.isSafeInteger(minutes))throw Error('Minutes required');const sign=minutes<0?'-':'',absolute=Math.abs(minutes),hours=Math.floor(absolute/60),remainder=absolute%60;return `${sign}${hours}h ${String(remainder).padStart(2,'0')}m`;}
export function formatLeaveDays(minutes:number,hoursPerDayMinutes:number){if(!Number.isSafeInteger(minutes)||!integer(hoursPerDayMinutes,1))throw Error('Conversion unavailable');const days=minutes/hoursPerDayMinutes;return `${Number.isInteger(days)?days:days.toFixed(2)} days at ${formatLeaveMinutes(hoursPerDayMinutes)} per day`;}
export function formatAnnualLeaveInstant(value:string,timezone:string){const milliseconds=Date.parse(value);if(!Number.isFinite(milliseconds)||typeof timezone!=='string'||!timezone)throw Error('Leave history time unavailable');let parts:Intl.DateTimeFormatPart[];try{parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(milliseconds));}catch{throw Error('Leave history time unavailable');}const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(value=>value.type===type)?.value;if(!part('day')||!part('month')||!part('year')||!part('hour')||!part('minute'))throw Error('Leave history time unavailable');return `${part('day')}/${part('month')}/${part('year')}, ${part('hour')}:${part('minute')}`;}
export interface AnnualLeaveScopeToken {scope:string;generation:number;}
export function createAnnualLeaveScopeGuard(initialScope:string){
 let scope=initialScope,generation=0,mounted=true;
 return{
  activate(){mounted=true;generation++;return{scope,generation};},
  deactivate(){mounted=false;generation++;},
  update(nextScope:string){if(nextScope!==scope){scope=nextScope;generation++;}return{scope,generation};},
  capture():AnnualLeaveScopeToken{return{scope,generation};},
  isCurrent(token:AnnualLeaveScopeToken){return mounted&&token.scope===scope&&token.generation===generation;},
 };
}
export function expectedAccountsForDates(model:AnnualLeaveWorkspaceModel,startDate:string,endDate:string){if(!date(startDate)||!date(endDate)||startDate>endDate)throw Error('Valid leave dates required');const expected=model.accounts.filter(account=>account.leaveYearStart<=endDate&&startDate<account.leaveYearEndExclusive).sort((a,b)=>a.accountId.localeCompare(b.accountId));if(expected.length<1||expected.length>4)throw Error('Required leave account unavailable');for(let current=startDate;current<=endDate;){if(!expected.some(account=>account.leaveYearStart<=current&&current<account.leaveYearEndExclusive))throw Error('Required leave account unavailable');current=new Date(Date.parse(current+'T12:00:00Z')+86400000).toISOString().slice(0,10);}return expected.map(account=>({accountId:account.accountId,version:account.version}));}
export type AnnualLeaveOperation='policy'|'account'|'adjustment'|'calendar'|'holiday'|'import'|'record'|'cancel'|'legacy_cancel';
export interface AnnualLeaveAttempt {operation:AnnualLeaveOperation;workspaceId:string;workerId:string;requestId:string;body:Record<string,unknown>;}
export type AnnualLeaveInvoke=(name:string,body:Record<string,unknown>)=>Promise<{status:number;data:unknown}>;
const endpoints:Record<AnnualLeaveOperation,string>={policy:'rev-annual-leave-policy-save',account:'rev-annual-leave-account-open',adjustment:'rev-annual-leave-adjustment-save',calendar:'rev-annual-leave-calendar-configure',holiday:'rev-workspace-bank-holiday-save',import:'rev-annual-leave-bank-holiday-import',record:'rev-annual-leave-record',cancel:'rev-annual-leave-cancel',legacy_cancel:'rev-legacy-annual-leave-cancel'};
export const annualLeaveRefusalMessages:Record<string,string>={stale_policy:'The leave settings changed. Refresh and review them.',account_exists:'Leave is already set up for that year.',policy_date_mismatch:'The leave-year start does not match the saved settings.',account_overlap:'That leave year overlaps an existing leave year.',stale_account:'The balance changed. Refresh before trying again.',calendar_exists:'That holiday calendar already exists.',stale_calendar:'The holiday calendar changed. Refresh before trying again.',stale_assignment:'The worker holiday calendar changed. Refresh before trying again.',stale_year:'The holiday list changed. Review it before confirming the year again.',missing_calendar:'Assign a holiday calendar to this worker before adding leave.',stale_holiday:'The holiday changed. Refresh before trying again.',date_conflict:'A holiday is already saved on this date.',missing_pattern:"Set this worker's working hours before adding leave.",ambiguous_pattern_time:'The saved working hours cannot be used safely across a clock change.',calendar_year_unconfirmed:'Review and confirm every affected holiday year before adding leave.',missing_account:'Set up every affected leave year before adding leave.',insufficient_balance:'There is not enough remaining leave for these dates.',assignment_conflict:'This leave overlaps assigned work. Resolve the assignment first.',overlap:'This leave overlaps leave that is already recorded.',inactive_worker:'The selected worker must be active.',stale_absence:'This leave changed. Refresh before cancelling it.',already_cancelled:'This leave is already cancelled.',stale_legacy_leave:'This older leave changed. Refresh before cancelling it.',accounted_leave:'Use the normal Cancel leave action for this entry.',request_conflict:'This saved retry no longer matches the original change.'};
export class AnnualLeaveRefused extends Error{readonly code:string;constructor(code:string){super(annualLeaveRefusalMessages[code]??'Annual leave change refused.');this.code=code;}}
annualLeaveRefusalMessages.stale_import='The holiday calendar or worker assignment changed. Load official dates again and review the new list.';
annualLeaveRefusalMessages.import_conflict='Existing holiday entries conflict with official dates. Nothing was imported or confirmed. Resolve the conflicts and load again.';
export function validateAnnualLeaveAttempt(value:unknown):AnnualLeaveAttempt{const attempt=object(value);if(Object.keys(attempt).sort().join(',')!=='body,operation,requestId,workerId,workspaceId'||!Object.prototype.hasOwnProperty.call(endpoints,attempt.operation as string)||!id(attempt.workspaceId)||!id(attempt.workerId)||!id(attempt.requestId)||!attempt.body||typeof attempt.body!=='object'||Array.isArray(attempt.body))throw Error('Pending annual leave request unavailable');const body=attempt.body as Record<string,unknown>,workspacePolicy=attempt.operation==='policy'&&body.workerId===null;if(body.workspaceId!==attempt.workspaceId||body.requestId!==attempt.requestId||(body.workerId!==undefined&&!workspacePolicy&&body.workerId!==attempt.workerId))throw Error('Pending annual leave request unavailable');return attempt as unknown as AnnualLeaveAttempt;}
export function invalidAnnualLeaveAttemptMessage(value:AnnualLeaveAttempt){const attempt=validateAnnualLeaveAttempt(value),body=attempt.body;if(attempt.operation==='calendar'&&body.action==='save_calendar'&&body.calendarId===null&&typeof body.name==='string'&&body.name.trim()==='')return'Enter a calendar name.';return null;}
function requireResult(attempt:AnnualLeaveAttempt,data:unknown){const row=object(data),body=attempt.body;if(row.workspaceId!==attempt.workspaceId)throw Error('Annual leave outcome unconfirmed');
 if(attempt.operation==='import'&&(row.action!=='confirm'||row.workerId!==attempt.workerId||row.previewId!==body.previewId||row.requestId!==attempt.requestId||!id(row.calendarId)||!integer(row.revision,1)||row.confirmedRevision!==row.revision||row.source!=='https://www.gov.uk/bank-holidays.json'||typeof row.fetchedAt!=='string'||!Number.isFinite(Date.parse(row.fetchedAt))))throw Error('Annual leave outcome unconfirmed');
 if(attempt.operation==='policy'&&(row.workerId!==body.workerId||row.version!==(body.expectedVersion as number)+1))throw Error('Annual leave outcome unconfirmed');
 if(attempt.operation==='account'&&(row.workerId!==attempt.workerId||row.leaveYearStart!==body.leaveYearStart||row.version!==1))throw Error('Annual leave outcome unconfirmed');
 if(attempt.operation==='adjustment'&&(row.accountId!==body.accountId||row.accountVersion!==(body.expectedVersion as number)+1))throw Error('Annual leave outcome unconfirmed');
 if(attempt.operation==='calendar'&&(row.action!==body.action||(body.action==='assign_worker'&&row.workerId!==attempt.workerId)||(body.action==='confirm_year'&&row.confirmedRevision!==row.revision)))throw Error('Annual leave outcome unconfirmed');
 if(attempt.operation==='holiday'&&(row.calendarId!==body.calendarId||row.holidayDate!==body.holidayDate||row.version!==(body.expectedVersion as number)+1))throw Error('Annual leave outcome unconfirmed');
 if(attempt.operation==='record'&&(row.workerId!==attempt.workerId||row.status!=='confirmed'||row.startAt!==body.startAt||row.endAt!==body.endAt||!id(row.absenceId)))throw Error('Annual leave outcome unconfirmed');
 if(attempt.operation==='cancel'&&(row.absenceId!==body.absenceId||row.status!=='cancelled'||row.version!==(body.expectedVersion as number)+1))throw Error('Annual leave outcome unconfirmed');
 if(attempt.operation==='legacy_cancel'&&(row.workerId!==attempt.workerId||row.unavailabilityId!==body.unavailabilityId||row.status!=='cancelled'||row.version!==(body.expectedVersion as number)+1))throw Error('Annual leave outcome unconfirmed');
 return row;
}
export async function submitAnnualLeaveAttempt(value:AnnualLeaveAttempt,invoke:AnnualLeaveInvoke){const attempt=validateAnnualLeaveAttempt(value),response=await invoke(endpoints[attempt.operation],attempt.body);if(response.status===409){const refusal=object(response.data);if(refusal.status==='refused'&&refusal.requestId===attempt.requestId&&typeof refusal.code==='string'&&Object.prototype.hasOwnProperty.call(annualLeaveRefusalMessages,refusal.code))throw new AnnualLeaveRefused(refusal.code);throw Error('Annual leave outcome unconfirmed');}if(response.status!==200)throw Error('Annual leave outcome unconfirmed');return requireResult(attempt,response.data);}
interface Storage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}
function storageKey(workspaceId:string,userId:string){if(!id(workspaceId)||!id(userId))throw Error('Annual leave scope required');return `rev-annual-leave:${workspaceId}:${userId}`;}
export function rememberAnnualLeaveAttempt(storage:Storage,userId:string,value:AnnualLeaveAttempt){const attempt=validateAnnualLeaveAttempt(value);storage.setItem(storageKey(attempt.workspaceId,userId),JSON.stringify(attempt));}
export function restoreAnnualLeaveAttempt(storage:Storage,workspaceId:string,userId:string){const raw=storage.getItem(storageKey(workspaceId,userId));if(raw===null)return null;const attempt=validateAnnualLeaveAttempt(JSON.parse(raw));if(attempt.workspaceId!==workspaceId)throw Error('Pending annual leave request unavailable');return attempt;}
export function clearAnnualLeaveAttempt(storage:Storage,workspaceId:string,userId:string){storage.removeItem(storageKey(workspaceId,userId));}
