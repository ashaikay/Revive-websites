export interface SchedulingParentState {busy:boolean;pendingWorkerSave:boolean;storageBlocked:boolean;ready:boolean;}
export interface SchedulingParentLock {editsBlocked:boolean;retriesBlocked:boolean;reason:string;}

export function schedulingParentLock(state:SchedulingParentState):SchedulingParentLock{
 if(state.busy)return{editsBlocked:true,retriesBlocked:true,reason:'A worker profile save is in progress. Wait for its result.'};
 if(state.storageBlocked)return{editsBlocked:true,retriesBlocked:true,reason:'Pending worker-save details cannot be read. Contact support before changing Scheduling.'};
 if(!state.ready)return{editsBlocked:true,retriesBlocked:true,reason:'Scheduling records are still loading. Refresh the page if loading does not finish.'};
 if(state.pendingWorkerSave)return{editsBlocked:true,retriesBlocked:false,reason:'A worker profile save is unconfirmed. Recover it with RETRY SAME SAVE at the top of Scheduling. Existing pattern or leave retries remain available.'};
 return{editsBlocked:false,retriesBlocked:false,reason:''};
}

export function schedulingPanelAccess(parent:SchedulingParentLock,ownPending:boolean){return{editsBlocked:parent.editsBlocked||ownPending,retryBlocked:parent.retriesBlocked};}