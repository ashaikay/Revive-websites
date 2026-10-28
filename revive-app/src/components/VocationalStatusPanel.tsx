import { useEffect, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
export type VocationalStatus = { status: 'not_started' | 'in_progress' | 'completed'; answered: number; total: number; assessmentId: string | null; version?: number; updatedAt: string | null; completedAt: string | null; updatedByUserId: string | null };
export const statusText = (status: VocationalStatus['status']) => status === 'completed' ? 'Completed' : status === 'in_progress' ? 'In progress' : 'Not started';
export function VocationalStatusPanel({workspaceId, programmeId, participantId, refresh = 0, compact = false, assessmentId}: {workspaceId:string; programmeId:string; participantId:string; refresh?:number; compact?:boolean; assessmentId?:string}) {
  const [value,setValue]=useState<VocationalStatus|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{let live=true;setValue(null);setError('');
    if (!supabaseClient) {setError('Database unavailable');return;}
    void Promise.resolve(supabaseClient.rpc('rev_voc_assessment_status',{target_workspace_id:workspaceId,target_programme_id:programmeId,target_participant_id:participantId})).then(({data,error})=>{
      if(!live)return;
      if(error)setError('Status unavailable');
      else if (assessmentId && data?.assessmentId !== assessmentId) setError('Saved status for this questionnaire could not be verified. Close and reopen the profile.');
      else setValue(data as VocationalStatus);
    }).catch(() => { if (live) setError('Status unavailable'); });return()=>{live=false;};
  },[workspaceId,programmeId,participantId,refresh,assessmentId]);
  if(error)return <span className="text-xs text-amber-700" role="status">{error}</span>;
  if(!value)return <span className="text-xs text-neutral-500">Loading vocational status...</span>;
  const progress=value.total>0?Math.round(100*value.answered/value.total):0;
  return <div className={compact?'text-base text-neutral-700':'rounded-lg border border-neutral-200 p-4 text-base'} aria-label="Vocational profile status">
    <p className="font-medium">Vocational profile: {statusText(value.status)}</p>
    {!compact && value.total === 0 && <p>Core questionnaire not available. Programme setup needs review.</p>}
    {!compact && value.total > 0 && <><p>{value.answered} of {value.total} questions answered ({progress}%)</p><div className="mt-2 h-2 overflow-hidden rounded bg-neutral-200"><div className="h-full bg-emerald-600" style={{width:`${progress}%`}} /></div>
      <p className="mt-2">Last updated: {value.updatedAt?new Date(value.updatedAt).toLocaleString('en-GB'):'Not started'}</p>
      <p>Completed: {value.completedAt?new Date(value.completedAt).toLocaleString('en-GB'):'Not completed'}</p></>}
  </div>;
}
