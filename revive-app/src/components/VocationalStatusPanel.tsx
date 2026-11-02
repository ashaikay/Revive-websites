import { useEffect, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
type Questionnaire = { templateVersionId: string; title: string; version: number };
export type VocationalStatus = { status: 'not_started' | 'in_progress' | 'completed'; answered: number; total: number; assessmentId: string | null; templateVersionId?: string | null; version?: number; updatedAt: string | null; completedAt: string | null; updatedByUserId: string | null; questionnaire?: Questionnaire | null; earlierCompletedAssessment?: { assessmentId: string; templateVersionId: string; questionnaireTitle: string; questionnaireVersion: number; completedAt: string } | null };
export const statusText = (status: VocationalStatus['status']) => status === 'completed' ? 'Completed' : status === 'in_progress' ? 'In progress' : 'Not started';
export function VocationalStatusPanel({workspaceId, programmeId, participantId, refresh = 0, compact = false, assessmentId, questionnaire}: {workspaceId:string; programmeId:string; participantId:string; refresh?:number; compact?:boolean; assessmentId?:string; questionnaire?: Questionnaire & { isCurrent: boolean }}) {
  const [value,setValue]=useState<VocationalStatus|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{let live=true;setValue(null);setError('');
    if (!supabaseClient) {setError('Database unavailable');return;}
    void Promise.resolve(supabaseClient.rpc(assessmentId ? 'rev_voc_assessment_selected_status' : 'rev_voc_assessment_status',{target_workspace_id:workspaceId,target_programme_id:programmeId,target_participant_id:participantId,...(assessmentId ? {target_assessment_id:assessmentId} : {})})).then(({data,error})=>{
      if(!live)return;
      if(error)setError('Status unavailable');
      else if (assessmentId && (data?.assessmentId !== assessmentId || (questionnaire && data?.templateVersionId !== questionnaire.templateVersionId))) setError('Saved status for this questionnaire could not be verified. Your answers remain on screen.');
      else if (!assessmentId && (!data || !Object.prototype.hasOwnProperty.call(data, 'questionnaire'))) setError('Current questionnaire status could not be verified.');
      else setValue(data as VocationalStatus);
    }).catch(() => { if (live) setError('Status unavailable'); });return()=>{live=false;};
  },[workspaceId,programmeId,participantId,refresh,assessmentId,questionnaire?.templateVersionId]);
  if(error)return <span className="text-xs text-amber-700" role="status">{error}</span>;
  if(!value)return <span className="text-xs text-neutral-500">Loading vocational status...</span>;
  const progress=value.total>0?Math.round(100*value.answered/value.total):0;
  const displayedQuestionnaire = assessmentId ? questionnaire : value.questionnaire;
  const label = !assessmentId || questionnaire?.isCurrent ? 'Current questionnaire' : questionnaire ? 'Earlier questionnaire' : 'Selected questionnaire';
  const earlierCompletion = !assessmentId ? value.earlierCompletedAssessment : null;
  return <div className={compact?'text-base text-neutral-700':'rounded-lg border border-neutral-200 p-4 text-base'} aria-label="Vocational profile status">
    <p className="font-medium">{label}: {!assessmentId && !value.questionnaire ? 'Not available' : statusText(value.status)}</p>
    {displayedQuestionnaire && <p>{displayedQuestionnaire.title} - version {displayedQuestionnaire.version}</p>}
    {earlierCompletion && <p>Earlier completed assessment: {earlierCompletion.questionnaireTitle} - version {earlierCompletion.questionnaireVersion}. Completed: {new Date(earlierCompletion.completedAt).toLocaleString('en-GB')}. This does not complete the current questionnaire.</p>}
    {!compact && value.total === 0 && questionnaire?.isCurrent !== false && <p>Core questionnaire not available. Programme setup needs review.</p>}
    {!compact && value.total > 0 && <><p>{value.answered} of {value.total} questions answered ({progress}%)</p><div className="mt-2 h-2 overflow-hidden rounded bg-neutral-200"><div className="h-full bg-emerald-600" style={{width:`${progress}%`}} /></div>
      <p className="mt-2">Last updated: {value.updatedAt?new Date(value.updatedAt).toLocaleString('en-GB'):'Not started'}</p>
      <p>Completed: {value.completedAt?new Date(value.completedAt).toLocaleString('en-GB'):'Not completed'}</p></>}
  </div>;
}
