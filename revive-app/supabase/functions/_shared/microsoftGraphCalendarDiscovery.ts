export interface DiscoveredOutlookCalendar {
  providerCalendarReference: string;
  displayName: string;
  ownerAddress: string;
  isDefault: boolean;
}
export interface OutlookCalendarDiscovery {
  providerAccountReference: string;
  calendars: DiscoveredOutlookCalendar[];
}
const origin = 'https://graph.microsoft.com';
const fields = 'id,name,owner';
function object(value: unknown): Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Calendar discovery unavailable');return value as Record<string,unknown>;
}
function calendar(value: unknown, defaultId: string): DiscoveredOutlookCalendar {
  const row=object(value), owner=object(row.owner);
  if(typeof row.id!=='string'||!row.id.trim()||row.id.length>2048||typeof row.name!=='string'||!row.name.trim()||row.name.length>240||typeof owner.address!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.address)||owner.address.length>320)throw new Error('Calendar discovery unavailable');
  return{providerCalendarReference:row.id,displayName:row.name,ownerAddress:owner.address.toLowerCase(),isDefault:row.id===defaultId};
}
function pageUrl(value: string): string {
  const url=new URL(value);
  if(url.origin!==origin||url.username||url.password||url.hash||url.pathname!=='/v1.0/me/calendars')throw new Error('Calendar discovery unavailable');
  for(const key of url.searchParams.keys())if(!['$select','$top','$skip','$skiptoken'].includes(key))throw new Error('Calendar discovery unavailable');
  return url.href;
}
/** Read-only delegated adapter. No database writes, automatic selection or event creation. */
export async function discoverMicrosoftGraphCalendars(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<OutlookCalendarDiscovery> {
  if(typeof accessToken!=='string'||!accessToken.trim()||/[\r\n]/.test(accessToken))throw new Error('Calendar discovery unavailable');
  const get=async(url:string):Promise<unknown>=>{
    const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'}});
    if(!response.ok)throw new Error('Calendar discovery unavailable');
    return response.json();
  };
  try {
    const primary=calendar(await get(`${origin}/v1.0/me/calendar?$select=${fields}`),'');primary.isDefault=true;
    const calendars=new Map<string,DiscoveredOutlookCalendar>();calendars.set(primary.providerCalendarReference,primary);
    const visited=new Set<string>();let next:string|null=`${origin}/v1.0/me/calendars?$select=${fields}&$top=100`;
    for(let page=0;next!==null;page++){
      if(page>=10)throw new Error('Calendar discovery unavailable');
      const url=pageUrl(next);if(visited.has(url))throw new Error('Calendar discovery unavailable');visited.add(url);
      const result=object(await get(url));if(!Array.isArray(result.value)||result.value.length>100)throw new Error('Calendar discovery unavailable');
      for(const value of result.value){
        const entry=calendar(value,primary.providerCalendarReference);
        // Shared calendars from other owners are outside this initial account-owned slice.
        if(entry.ownerAddress!==primary.ownerAddress)continue;
        const previous=calendars.get(entry.providerCalendarReference);
        if(previous&&(previous.displayName!==entry.displayName||previous.ownerAddress!==entry.ownerAddress))throw new Error('Calendar discovery unavailable');
        calendars.set(entry.providerCalendarReference,entry);
      }
      const link=result['@odata.nextLink'];
      if(link!==undefined&&(typeof link!=='string'||!link))throw new Error('Calendar discovery unavailable');
      next=link===undefined?null:pageUrl(link as string);
    }
    return{providerAccountReference:primary.ownerAddress,calendars:[...calendars.values()]};
  } catch {throw new Error('Calendar discovery unavailable');}
}
