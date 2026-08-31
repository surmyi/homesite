type AccessState = {
  email: string;
  role: 'admin' | 'viewer';
  status: 'active' | 'disabled';
};

function emailKey(email: string) {
  return email.trim().toLowerCase();
}

export function isOwnAccessRecord(actorUserId: string, targetUserId: string) {
  return actorUserId === targetUserId;
}

export function wouldRevokeOwnAdminAccess(
  actorUserId: string,
  targetUserId: string,
  current: AccessState,
  next: AccessState,
) {
  if (!isOwnAccessRecord(actorUserId, targetUserId) || current.role !== 'admin')
    return false;
  return (
    next.role !== 'admin' ||
    next.status !== 'active' ||
    emailKey(next.email) !== emailKey(current.email)
  );
}
