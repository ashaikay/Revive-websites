import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulingParentLock,schedulingPanelAccess} from '../services/schedulingRecovery.ts';

test('pending parent worker save blocks child edits but permits each retained child retry',()=>{
 const parent=schedulingParentLock({busy:false,pendingWorkerSave:true,storageBlocked:false,ready:true});
 assert.equal(parent.editsBlocked,true);
 assert.equal(parent.retriesBlocked,false);
 assert.match(parent.reason,/worker profile save is unconfirmed/i);
 assert.match(parent.reason,/RETRY SAME SAVE at the top of Scheduling/);
 assert.deepEqual(schedulingPanelAccess(parent,true),{editsBlocked:true,retryBlocked:false});
});

test('loading, click lock and unreadable storage block retries with specific recovery',()=>{
 const busy=schedulingParentLock({busy:true,pendingWorkerSave:true,storageBlocked:false,ready:true});
 assert.deepEqual(schedulingPanelAccess(busy,true),{editsBlocked:true,retryBlocked:true});
 assert.match(busy.reason,/in progress/);
 const loading=schedulingParentLock({busy:false,pendingWorkerSave:false,storageBlocked:false,ready:false});
 assert.equal(loading.retriesBlocked,true);
 assert.match(loading.reason,/still loading/);
 const storage=schedulingParentLock({busy:false,pendingWorkerSave:true,storageBlocked:true,ready:true});
 assert.equal(storage.retriesBlocked,true);
 assert.match(storage.reason,/Contact support/);
});

test('resolved parent and child requests restore editing',()=>{
 const parent=schedulingParentLock({busy:false,pendingWorkerSave:false,storageBlocked:false,ready:true});
 assert.deepEqual(parent,{editsBlocked:false,retriesBlocked:false,reason:''});
 assert.deepEqual(schedulingPanelAccess(parent,false),{editsBlocked:false,retryBlocked:false});
});