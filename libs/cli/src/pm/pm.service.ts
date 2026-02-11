/**
 * systemd unit + launchd plist generation (user-level, no sudo).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ServicePlatform } from './pm.types';
import { readPidFile } from './pm.pidfile';
import { ensurePmDirs } from './pm.paths';

export function detectPlatform(): ServicePlatform {
  return process.platform === 'darwin' ? 'launchd' : 'systemd';
}

function launchdPlistPath(name: string): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `dev.agentfront.frontmcp.${name}.plist`);
}

function systemdUnitPath(name: string): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', `frontmcp-${name}.service`);
}

function generateLaunchdPlist(name: string, entry: string): string {
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
    <string>start</string>
    <string>${name}</string>
    <string>--entry</string>
    <string>${entry}</string>
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

function generateSystemdUnit(name: string, entry: string): string {
  const frontmcpBin = process.argv[1] || 'frontmcp';

  return `[Unit]
Description=FrontMCP Server - ${name}
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${frontmcpBin} start ${name} --entry ${entry}
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
    const content = generateLaunchdPlist(name, pidData.entry);
    const dir = path.dirname(plistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(plistPath, content, 'utf-8');
    return plistPath;
  } else {
    const unitPath = systemdUnitPath(name);
    const content = generateSystemdUnit(name, pidData.entry);
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
