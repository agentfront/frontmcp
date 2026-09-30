/**
 * systemd unit + launchd plist generation (user-level, no sudo).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ensurePmDirs } from './paths';
import { readPidFile } from './pidfile';
import { type PidFileData, type ServicePlatform } from './types';

export function detectPlatform(): ServicePlatform {
  if (process.platform === 'win32') {
    throw new Error('Windows is not supported for service management. Use Windows Task Scheduler or NSSM instead.');
  }
  return process.platform === 'darwin' ? 'launchd' : 'systemd';
}

function launchdPlistPath(name: string): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `dev.agentfront.frontmcp.${name}.plist`);
}

function systemdUnitPath(name: string): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', `frontmcp-${name}.service`);
}

/** Arguments of the `frontmcp start` command the service must run (port, socket, db and restart limit included). */
export function buildStartArgs(
  data: Pick<PidFileData, 'name' | 'entry' | 'port' | 'socketPath' | 'dbPath' | 'maxRestarts'>,
): string[] {
  const args = ['start', data.name, '--entry', data.entry];
  if (data.port !== undefined) args.push('--port', String(data.port));
  if (data.socketPath) args.push('--socket', data.socketPath);
  if (data.dbPath) args.push('--db', data.dbPath);
  if (data.maxRestarts !== undefined) args.push('--max-restarts', String(data.maxRestarts));
  return args;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function generateLaunchdPlist(data: Parameters<typeof buildStartArgs>[0]): string {
  const name = data.name;
  const frontmcpBin = process.argv[1] || 'frontmcp';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.agentfront.frontmcp.${name}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${frontmcpBin}</string>
${buildStartArgs(data)
  .map((arg) => `    <string>${xmlEscape(arg)}</string>`)
  .join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), '.frontmcp', 'logs', `${name}.launchd.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), '.frontmcp', 'logs', `${name}.launchd.error.log`)}</string>
</dict>
</plist>`;
}

export function generateSystemdUnit(data: Parameters<typeof buildStartArgs>[0]): string {
  const name = data.name;
  const frontmcpBin = process.argv[1] || 'frontmcp';

  return `[Unit]
Description=FrontMCP Server - ${name}
After=network.target

[Service]
Type=simple
ExecStart="${process.execPath}" "${frontmcpBin}" ${buildStartArgs(data)
    .map((arg) => `"${arg.replace(/(["\\])/g, '\\$1')}"`)
    .join(' ')}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=frontmcp-${name}

[Install]
WantedBy=default.target
`;
}

export function installService(name: string): string {
  const pidData = readPidFile(name);
  if (!pidData) {
    throw new Error(
      `No PID file found for "${name}". Start the server first with: frontmcp start ${name} --entry <path>`,
    );
  }

  ensurePmDirs();
  const platform = detectPlatform();

  if (platform === 'launchd') {
    const plistPath = launchdPlistPath(name);
    const content = generateLaunchdPlist(pidData);
    const dir = path.dirname(plistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(plistPath, content, 'utf-8');
    return plistPath;
  } else {
    const unitPath = systemdUnitPath(name);
    const content = generateSystemdUnit(pidData);
    const dir = path.dirname(unitPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(unitPath, content, 'utf-8');
    return unitPath;
  }
}

export function uninstallService(name: string): string | null {
  const platform = detectPlatform();
  const filePath = platform === 'launchd' ? launchdPlistPath(name) : systemdUnitPath(name);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return filePath;
  }

  return null;
}

export function getServicePath(name: string): string {
  const platform = detectPlatform();
  return platform === 'launchd' ? launchdPlistPath(name) : systemdUnitPath(name);
}
