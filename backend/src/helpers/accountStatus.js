// Import-free, like permissionCatalog: userModel needs these constants, and the
// auth middleware needs them too, so this must not reach back into either.

/*
 * Whether an account may be used at all.
 *
 * This sits in front of roles and permissions rather than beside them. A denied
 * account is not an account with nothing granted to it — it is one that cannot
 * sign in, and whose existing session stops working on its next request.
 *
 * 'pending' is what registration produces. It is deliberately distinct from
 * 'denied': the first means nobody has looked yet, the second means somebody
 * looked and said no, and an administrator reviewing a list needs to tell those
 * two apart.
 */
export const ACCOUNT_STATUSES = ['pending', 'allowed', 'denied'];

export const DEFAULT_ACCOUNT_STATUS = 'pending';

export const isUsableAccount = (user) => user?.status === 'allowed';

/**
 * Why a sign-in was refused, in words meant for the person reading them.
 *
 * Deliberately specific. "Access denied" for an account still awaiting review
 * tells somebody they have been rejected when they have not, and they will ask
 * an administrator about a decision nobody made.
 */
export const statusRefusal = (status) => {
  if (status === 'pending') {
    return 'Your account is waiting for an administrator to approve it. You will be able to sign in once they do.';
  }
  if (status === 'denied') {
    return 'Access to this account has been denied. Contact an administrator if you think that is a mistake.';
  }
  return 'This account cannot be used.';
};
