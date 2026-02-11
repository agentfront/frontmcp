import { ParsedArgs } from '../args';
import { c } from '../colors';
import { installService, uninstallService, detectPlatform, getServicePath } from '../pm';

export async function runService(opts: ParsedArgs): Promise<void> {
  const action = opts._[1]; // 'install' or 'uninstall'
  const name = opts._[2];

  if (!action || !name) {
    throw new Error('Usage: frontmcp service <install|uninstall> <name>');
  }

  const platform = detectPlatform();

  switch (action) {
    case 'install': {
      console.log(`${c('cyan', '[service]')} generating ${platform} service for "${name}"...`);
      const filePath = installService(name);
      console.log(`${c('green', '[service]')} service file created: ${filePath}`);

      if (platform === 'launchd') {
        console.log(`\n${c('bold', 'To load the service:')}`);
        console.log(`  launchctl load ${filePath}`);
        console.log(`\n${c('bold', 'To start:')}`);
        console.log(`  launchctl start dev.agentfront.frontmcp.${name}`);
      } else {
        console.log(`\n${c('bold', 'To enable and start:')}`);
        console.log(`  systemctl --user daemon-reload`);
        console.log(`  systemctl --user enable frontmcp-${name}`);
        console.log(`  systemctl --user start frontmcp-${name}`);
      }
      break;
    }

    case 'uninstall': {
      console.log(`${c('cyan', '[service]')} removing service for "${name}"...`);

      if (platform === 'launchd') {
        const servicePath = getServicePath(name);
        console.log(c('yellow', `hint: run 'launchctl unload ${servicePath}' first if the service is loaded`));
      } else {
        console.log(c('yellow', `hint: run 'systemctl --user stop frontmcp-${name}' first if the service is running`));
      }

      const removed = uninstallService(name);
      if (removed) {
        console.log(`${c('green', '[service]')} service file removed: ${removed}`);
      } else {
        console.log(`${c('yellow', '[service]')} no service file found for "${name}".`);
      }
      break;
    }

    default:
      throw new Error(`Unknown service action: "${action}". Use "install" or "uninstall".`);
  }
}
