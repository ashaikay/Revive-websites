-- Narrow ACL remediation for REV SECURITY DEFINER helpers.
-- No table, RLS, function-body, quote, Telegram, or secret changes.

revoke all on function public.is_active_workspace_member(uuid) from public;
revoke all on function public.is_active_workspace_member(uuid) from anon;
grant execute on function public.is_active_workspace_member(uuid) to authenticated;

revoke all on function public.has_workspace_role(uuid, text[]) from public;
revoke all on function public.has_workspace_role(uuid, text[]) from anon;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated;

revoke all on function public.create_workspace_with_owner(text, text) from public;
revoke all on function public.create_workspace_with_owner(text, text) from anon;
grant execute on function public.create_workspace_with_owner(text, text) to authenticated;
