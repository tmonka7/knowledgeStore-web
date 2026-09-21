import { User } from '../models/userModel.js';
import { runOnce } from '../models/migrationModel.js';
import { ACCOUNT_STATUSES } from './accountStatus.js';

/*
 * Approves every account that existed before approval did.
 *
 * This is not a nicety. Mongoose applies a schema default to a path that is
 * missing from a document it loads, so the moment `status` was added to the
 * schema every account already in the database began reading as 'pending' —
 * which is to say every single person, administrators included, would be
 * locked out by the upgrade alone. They were using the system yesterday; that
 * is the approval.
 *
 * Marker-guarded like the permission backfill, so an account an administrator
 * denies afterwards stays denied rather than being re-approved on every boot.
 */
const MIGRATION_ID = 'approve-pre-existing-accounts-2026-09';

export const backfillAccountStatus = async () => {
  const outcome = await runOnce(
    MIGRATION_ID,
    'Accounts that predate the pending/allowed/denied field are treated as already approved.',
    () => User.updateMany(
      // Missing, null, or somehow not one of the three known values. The last
      // case is defensive: a document hand-edited into a state the enum does
      // not allow would otherwise be unable to sign in and give no clue why.
      { $or: [{ status: { $exists: false } }, { status: { $nin: ACCOUNT_STATUSES } }] },
      { $set: { status: 'allowed' } },
    ),
  );

  if (outcome.applied) {
    console.log(`Account status backfill: approved ${outcome.result?.modifiedCount || 0} pre-existing account(s).`);
  }

  return outcome;
};
