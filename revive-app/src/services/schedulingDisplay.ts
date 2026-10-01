const isoDate=/^(\d{4})-(\d{2})-(\d{2})$/;

export function formatSchedulingDate(value:string):string{
 const match=isoDate.exec(value);if(!match)throw new Error('Valid ISO date required');
 const parsed=Date.parse(value+'T00:00:00.000Z');if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==value)throw new Error('Valid ISO date required');
 return `${match[3]}/${match[2]}/${match[1]}`;
}

function instantParts(value:string,timezone:string){
 const parsed=Date.parse(value);if(!Number.isFinite(parsed))throw new Error('Valid instant required');
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(parsed));
 const get=(type:string)=>parts.find(part=>part.type===type)?.value;
 return{date:`${get('day')}/${get('month')}/${get('year')}`,time:`${get('hour')}:${get('minute')}`};
}

export function formatSchedulingInstant(value:string,timezone:string):string{const parts=instantParts(value,timezone);return `${parts.date} ${parts.time}`;}
export function formatSchedulingTime(value:string,timezone:string):string{return instantParts(value,timezone).time;}
export function formatSchedulingLocal(value:string):string{if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))throw new Error('Valid local date and time required');return `${formatSchedulingDate(value.slice(0,10))} ${value.slice(11)}`;}