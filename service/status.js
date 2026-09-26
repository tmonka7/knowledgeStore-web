'use strict';

/*
 * What the Service Control Manager currently thinks of both services.
 * Needs no elevation.
 */

const path = require('node:path');
const { services, daemonRoot } = require('./definitions');
const { serviceName, state } = require('./lib');

const main = async () => {
  for (const { svc } of services) {
    console.log(`${svc.name.padEnd(20)} ${serviceName(svc).padEnd(24)} ${await state(svc)}`);
  }
  console.log('');
  console.log(`Logs: ${path.join(daemonRoot, 'daemon')}`);
};

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
