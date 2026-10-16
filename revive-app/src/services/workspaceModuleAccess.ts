import { supabaseClient } from '@/data/supabaseClient';
import { teamId } from '@/services/workspaceTeam';
export const moduleLabels = { programme: 'Outcomes', scheduling: 'Scheduling', rev: 'REV', customers: 'Customers', growth: 'Growth', business: 'Business' } as const;
export type RevModule = keyof typeof moduleLabels;
export const revModules = Object.keys(moduleLabels) as RevModule[];
export type ModuleAccess = { workspaceId: string; userId: string; modules: RevModule[]; version: number; managed: boolean };
export type ModuleAttempt = { workspaceId: string; userId: string; modules: RevModule[]; expectedVersion: number; requestId: string };
export class ModuleAccessRejected extends Error {}
export function validModules(value: unknown): value is RevModule[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(moduleLabels,v)) && new Set(value).size === value.length;
}
export function parseModuleAccess(value: unknown, workspaceId: string, userId: string): ModuleAccess {
  const row = value as ModuleAccess | null;
  if (!row || row.workspaceId !== workspaceId || row.userId !== userId || !validModules(row.modules) || !Number.isSafeInteger(row.version) || row.version < 0 || typeof row.managed !== 'boolean') throw new Error('Section access could not be verified.');
  return row;
}
export function parseModuleAttempt(value: unknown, workspaceId: string): ModuleAttempt {
  const row = value as ModuleAttempt | null;
  if (!row || row.workspaceId !== workspaceId || !teamId.test(row.userId) || !teamId.test(row.requestId) || !validModules(row.modules) || !Number.isSafeInteger(row.expectedVersion) || row.expectedVersion < 0) throw new Error('Retained access change could not be verified.');
  return row;
}
export async function loadModuleAccess(workspaceId: string, userId: string): Promise<ModuleAccess> {
  if (!supabaseClient || !teamId.test(workspaceId) || !teamId.test(userId)) throw new Error('Section access is unavailable.');
  const {data,error} = await supabaseClient.rpc('get_rev_workspace_module_access', {target_workspace_id:workspaceId,target_user_id:userId});
  if (error) throw new Error('Section access is unavailable. Check the connection or contact your organisation owner.');
  return parseModuleAccess(data,workspaceId,userId);
}
export async function saveModuleAccess(attempt: ModuleAttempt): Promise<ModuleAccess> {
  parseModuleAttempt(attempt,attempt.workspaceId);
  if (!supabaseClient) throw new Error('Save not confirmed. Retry the same change.');
  const {data,error} = await supabaseClient.rpc('save_rev_workspace_module_access', {target_workspace_id:attempt.workspaceId,target_user_id:attempt.userId,target_modules:attempt.modules,expected_version:attempt.expectedVersion,target_request_id:attempt.requestId});
  if (error) {
    if (['22023','22P02','23502','23503','23505','23514','40001','42501'].includes(error.code)) throw new ModuleAccessRejected(error.code === '40001' ? 'Access changed. Reload access before trying again.' : 'Access change was not accepted. Contact your organisation owner.');
    throw new Error('Save not confirmed. Retry the same change.');
  }
  const result=parseModuleAccess(data,attempt.workspaceId,attempt.userId);
  if (result.version!==attempt.expectedVersion+1 || result.managed || JSON.stringify([...result.modules].sort())!==JSON.stringify([...attempt.modules].sort())) throw new Error('Save not confirmed. Retry the same change.');
  return result;
}
export function accessPages(modules: RevModule[]): string[] {
  return modules.length===revModules.length ? ['home',...revModules] : [...modules];
}
