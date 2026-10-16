import { WorkspaceModuleAccessPanel } from '@/components/WorkspaceModuleAccessPanel';
import { useEffect, useRef, useState } from 'react';
import { invitationLink, loadWorkspaceTeam, submitTeamAttempt, TeamRejectedError, teamId, type TeamAttempt, type TeamDirectory, type TeamMember } from '@/services/workspaceTeam';

export function WorkspaceTeamPanel({ workspaceId, userId, onChanged, onLocked }: { workspaceId: string; userId: string; onChanged: () => Promise<void>; onLocked: (locked: boolean) => void }) {
  const [directory, setDirectory] = useState<TeamDirectory | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [accessLocked, setAccessLocked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<TeamAttempt | null>(null);
  const [displayName, setDisplayName] = useState(''), [email, setEmail] = useState('');
  const [editMember, setEditMember] = useState<TeamMember | null>(null), [memberName, setMemberName] = useState('');
  const [confirm, setConfirm] = useState<{ member: TeamMember; operation: 'suspend' | 'restore' } | null>(null);
  const [link, setLink] = useState(''), [refresh, setRefresh] = useState(0);
  const alive = useRef(true), inFlight = useRef(false), context = useRef(`${workspaceId}:${userId}`);
  context.current = `${workspaceId}:${userId}`;
  const key = `rev-team-attempt:${workspaceId}:${userId}`;
  useEffect(() => { onLocked(busy || !!pending || blocked || accessLocked); }, [busy, pending, blocked, accessLocked, onLocked]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onLocked(false); }; }, [onLocked]);
  useEffect(() => {
    let current = true; setDirectory(null); setError('');
    void loadWorkspaceTeam(workspaceId).then((data) => { if (current) setDirectory(data); }).catch((failure: unknown) => { if (current) setError(failure instanceof Error ? failure.message : 'Team unavailable.'); });
    return () => { current = false; };
  }, [workspaceId, userId, refresh]);
  useEffect(() => {
    setBlocked(false); setPending(null); setLink(''); setMessage(''); setDisplayName(''); setEmail(''); setEditMember(null); setConfirm(null);
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as TeamAttempt;
      if (saved.workspaceId !== workspaceId || !teamId.test(saved.requestId) || !['invite','rename','revoke_invite','suspend','restore'].includes(saved.operation) || !saved.payload || typeof saved.payload !== 'object') throw new Error();
      setPending(saved);
    } catch { setBlocked(true); setError('A retained team change could not be read. Contact your organisation owner before making another change.'); }
  }, [key, workspaceId]);
  const save = async (attempt: TeamAttempt) => {
    if (inFlight.current) return;
    inFlight.current = true; const captured = context.current;
    setBusy(true); setError(''); setMessage('');
    try {
      window.sessionStorage.setItem(key, JSON.stringify(attempt)); setPending(attempt);
      const result = await submitTeamAttempt(attempt);
      if (!alive.current || context.current !== captured) return;
      window.sessionStorage.removeItem(key); setPending(null); setEditMember(null); setConfirm(null);
      if (attempt.operation === 'invite') { setLink(invitationLink(String(result.invitationId), window.location)); setDisplayName(''); setEmail(''); setMessage('Invitation link ready. Share it privately with the invited person.'); }
      else setMessage(attempt.operation === 'rename' ? 'Team name saved.' : attempt.operation === 'revoke_invite' ? 'Invitation revoked.' : attempt.operation === 'suspend' ? 'Staff access suspended.' : 'Staff access restored.');
      setRefresh((value) => value + 1); await onChanged().catch(() => { if (alive.current && context.current === captured) setError('Team change saved. Refresh Programme Hub to update the team lists.'); });
    } catch (failure: unknown) {
      if (!alive.current || context.current !== captured) return;
      if (failure instanceof TeamRejectedError) { window.sessionStorage.removeItem(key); setPending(null); }
      setError(failure instanceof Error ? failure.message : 'Save outcome is unknown. Retry the same change.');
    } finally { inFlight.current = false; if (alive.current && context.current === captured) setBusy(false); }
  };
  const act = (operation: TeamAttempt['operation'], payload: TeamAttempt['payload']) => void save({ workspaceId, operation, requestId: crypto.randomUUID(), payload });
  const locked = busy || !!pending || blocked || accessLocked;
  const actor = directory?.members.find((member) => member.userId === userId);
  return <section className="mt-4 rounded-lg border border-neutral-200 p-4" aria-label="Organisation team">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Organisation team</h3>{directory && <button type="button" className="btn-secondary" disabled={locked} onClick={() => { setRefresh((value) => value + 1); void onChanged().catch(() => setError('Refresh Programme Hub to reload the team lists.')); }}>Refresh team</button>}</div>
    <p className="mt-1 text-sm text-neutral-600">Invite staff first, then add them as an ES to the selected programme after they accept.</p>
    {error && <p className="mt-3 text-sm" role="alert">{error}</p>}{message && <p className="mt-3 text-sm" role="status">{message}</p>}
    {pending && !busy && <button type="button" className="btn-secondary mt-3" onClick={() => void save(pending)}>Retry same team change</button>}
    {busy && <p className="mt-2 text-sm" role="status">Saving team change...</p>}
    {!directory ? <button type="button" className="btn-secondary mt-3" disabled={locked} onClick={() => setRefresh((value) => value + 1)}>Reload team</button> : <>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (locked) return; if (!displayName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter the staff member’s name and email address.'); return; } act('invite', { displayName: displayName.trim(), email: email.trim().toLowerCase() }); }}>
        <label className="text-sm font-medium">Staff name<input required maxLength={120} className="mt-1 w-full rounded border p-2" value={displayName} disabled={locked} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label className="text-sm font-medium">Staff email<input required type="email" maxLength={320} className="mt-1 w-full rounded border p-2" value={email} disabled={locked} onChange={(event) => setEmail(event.target.value)} /></label>
        <button className="btn-primary" disabled={locked}>Create invitation link</button>
      </form>
      {link && <label className="mt-3 block text-sm font-medium">Invitation link<input readOnly className="mt-1 w-full rounded border p-2" value={link} onFocus={(event) => event.currentTarget.select()} /></label>}
      {link && ['localhost','127.0.0.1'].includes(window.location.hostname) && <p className="mt-2 text-sm">This is a local testing link. Staff need a publicly accessible REV address to use it on another computer.</p>}
      <ul className="mt-4 divide-y" aria-label="Staff accounts">{directory.members.map((member) => <li key={member.userId} className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{member.displayName ?? (member.userId === userId ? 'You' : `Account ending ${member.userId.slice(-6)}`)}</p><p className="text-sm text-neutral-600">{member.role} · {member.status}</p></div><div className="flex gap-2">
          {(actor?.role === 'owner' || member.userId === userId || !['owner','admin'].includes(member.role)) && <button type="button" className="btn-secondary" disabled={locked} onClick={() => { setEditMember(member); setMemberName(member.displayName ?? ''); }}>Edit team name</button>}
          {['member','viewer'].includes(member.role) && member.userId !== userId && ['active','suspended'].includes(member.status) && <button type="button" className="btn-secondary" disabled={locked} onClick={() => setConfirm({ member, operation: member.status === 'active' ? 'suspend' : 'restore' })}>{member.status === 'active' ? 'Suspend access' : 'Restore access'}</button>}
        </div></div>
        {editMember?.userId === member.userId && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (!locked && memberName.trim()) act('rename', { userId: member.userId, displayName: memberName.trim(), expectedVersion: editMember.nameVersion }); }}><label className="text-sm">Name shown in team<input required maxLength={120} className="ml-2 rounded border p-2" value={memberName} disabled={locked} onChange={(event) => setMemberName(event.target.value)} /></label><button className="btn-primary" disabled={locked}>Save team name</button><button type="button" className="btn-secondary" disabled={locked} onClick={() => setEditMember(null)}>Cancel name edit</button></form>}
        {confirm?.member.userId === member.userId && <div className="mt-3 rounded border p-3 text-sm" role="group" aria-label="Confirm staff access change"><p>{confirm.operation === 'suspend' ? 'Suspend this person’s organisation access? Their case records remain saved.' : 'Restore this person’s access, including their existing programme registrations and caseload permissions?'}</p><button type="button" className="btn-primary mt-2" disabled={locked} onClick={() => act(confirm.operation, { userId: member.userId, expectedStatus: confirm.member.status })}>Confirm {confirm.operation === 'suspend' ? 'suspension' : 'restoration'}</button><button type="button" className="btn-secondary ml-2" disabled={locked} onClick={() => setConfirm(null)}>Keep current access</button></div>}
      </li>)}</ul>
      <details className="mt-4"><summary className="cursor-pointer font-medium">Recent invitations</summary><ul className="mt-2 divide-y">{directory.invitations.map((invite) => <li key={invite.id} className="py-2 text-sm"><p>{invite.displayName} · {invite.email} · {invite.status}</p><p>Expires: {new Date(invite.expiresAt).toLocaleString('en-GB')}</p>{invite.status === 'pending' && <div className="mt-2 flex gap-2"><button type="button" className="btn-secondary" disabled={locked} onClick={() => setLink(invitationLink(invite.id, window.location))}>Show invitation link</button><button type="button" className="btn-secondary" disabled={locked} onClick={() => act('revoke_invite', { invitationId: invite.id })}>Revoke invitation</button></div>}</li>)}</ul>{directory.invitations.length === 0 && <p className="mt-2 text-sm">No recent invitations.</p>}</details>
    </>}
    <WorkspaceModuleAccessPanel key={`${workspaceId}:${userId}`} workspaceId={workspaceId} actorId={userId} members={directory?.members ?? []} externalLocked={busy || !!pending || blocked} onLocked={setAccessLocked} />
  </section>;
}
