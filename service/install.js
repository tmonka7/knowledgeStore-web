'use strict';

/*
 * Registers the Knowledge Store API and Web services and starts them.
 *
 * Run from an elevated terminal:  npm run service:install
 */

const fs = require('node:fs');
const path = require('node:path');
const { services, daemonRoot, preflight } = require('./definitions');
const { isElevated, sc, settle, serviceName, state } = require('./lib');

const applyDependencies = async (svc, dependsOn) => {
  if (!dependsOn.length) return;
  // sc.exe wants the "depend=" token and its value as separate arguments, and
  // multiple dependencies separated by forward slashes.
  await sc(['config', serviceName(svc), 'depend=', dependsOn.join('/')]);
};

const main = async () => {
  if (!(await isElevated())) {
    console.error('Installing a Windows service needs administrator rights.');
    console.error('Reopen the terminal with "Run as administrator" and try again.');
    process.exitCode = 1;
    return;
  }

  const problems = preflight();
  if (problems.length) {
    problems.forEach((problem) => console.error(`- ${problem}`));
    process.exitCode = 1;
    return;
  }

  // node-windows creates <daemonRoot>/daemon with a non-recursive mkdir, so the
  // parent has to be there already. It is, when this file is, but not when the
  // scripts have been copied somewhere else.
  fs.mkdirSync(daemonRoot, { recursive: true });

  for (const { svc, dependsOn } of services) {
    const name = serviceName(svc);

    const installed = await settle(
      svc,
      { install: 'installed', alreadyinstalled: 'already installed' },
      () => svc.install(),
    );
    console.log(`${svc.name} (${name}): ${installed}`);

    await applyDependencies(svc, dependsOn);

    // Starting an already-running service is an error from NET START rather
    // than a no-op, so ask first.
    if ((await state(svc)) === 'RUNNING') {
      console.log(`${svc.name}: already running`);
      continue;
    }

    await settle(svc, { start: 'started' }, () => svc.start());
    console.log(`${svc.name}: started`);
  }

  console.log('');
  console.log(`Logs: ${path.join(daemonRoot, 'daemon')}`);
  console.log('Status: npm run service:status');
};

main().catch((err) => {
  console.error(err.message || err);
  console.error('');
  console.error(`Check the wrapper log in ${path.join(daemonRoot, 'daemon')} for what the service itself reported.`);
  process.exitCode = 1;
});
