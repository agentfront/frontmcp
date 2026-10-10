// A CommonJS project that pins the machine id with create({ machineId }) and reads it back.
require('reflect-metadata');
const { create, LogLevel } = require('@frontmcp/sdk');
const { getMachineId } = require('@frontmcp/utils');

(async () => {
  const server = await create({
    info: { name: 'machine-id-cjs', version: '1.0.0' },
    machineId: process.argv[2],
    logging: { level: LogLevel.Off },
  });
  process.stdout.write(JSON.stringify({ machineId: getMachineId() }));
  await server.dispose();
})();
