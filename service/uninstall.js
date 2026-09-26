'use strict';

/*
 * Stops and removes both services. Leaves the app, its data and the logs alone.
 *
 * Run from an elevated terminal:  npm run service:uninstall
 */

const { services } = require('./definitions');
const { isElevated, settle, serviceName, state } = require('./lib');

const main = async () => {
  if (!(await isElevated())) {
    console.error('Removing a Windows service needs administrator rights.');
    console.error('Reopen the terminal with "Run as administrator" and try again.');
    process.exitCode = 1;
    return;
  }

  // Reverse order, so the web service is gone before the API it depends on.
  for (const { svc } of [...services].reverse()) {
    const name = serviceName(svc);

    if ((await state(svc)) === 'NOT INSTALLED') {
      console.log(`${svc.name} (${name}): not installed`);
      continue;
    }

    await settle(svc, { stop: 'stopped', alreadystopped: 'not running' }, () => svc.stop());
    const removed = await settle(
      svc,
      { uninstall: 'removed', alreadyuninstalled: 'not installed' },
      () => svc.uninstall(),
    );
    console.log(`${svc.name} (${name}): ${removed}`);
  }
};

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
