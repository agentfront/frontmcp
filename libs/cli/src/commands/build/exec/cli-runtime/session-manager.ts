/**
 * Session manager for CLI executables.
 * Generates runtime module code for managing named sessions
 * stored in ~/.frontmcp/apps/{appName}/sessions/.
 */

export interface SessionInfo {
  name: string;
  user?: string;
  createdAt: string;
  lastUsedAt: string;
  isActive: boolean;
}

/**
 * Generate the session-manager runtime module source for embedding in CLI bundle.
 */
export function generateSessionManagerSource(appName: string): string {
  return `
'use strict';

var os = require('os');
var path = require('path');
var fs = require('fs');

var APP_NAME = ${JSON.stringify(appName)};
var SESSION_DIR = path.join(os.homedir(), '.frontmcp', 'apps', APP_NAME, 'sessions');
var ACTIVE_FILE = path.join(SESSION_DIR, '.active');

function ensureSessionDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function sessionPath(name) {
  return path.join(SESSION_DIR, name + '.json');
}

function readSession(name) {
  try {
    var data = fs.readFileSync(sessionPath(name), 'utf8');
    return JSON.parse(data);
  } catch (_) { return null; }
}

function writeSession(session) {
  ensureSessionDir();
  fs.writeFileSync(sessionPath(session.name), JSON.stringify(session, null, 2), { mode: 0o600 });
}

function getActiveSessionName() {
  try {
    return fs.readFileSync(ACTIVE_FILE, 'utf8').trim() || 'default';
  } catch (_) { return 'default'; }
}

function setActiveSession(name) {
  ensureSessionDir();
  fs.writeFileSync(ACTIVE_FILE, name, { mode: 0o600 });
}

function getOrCreateSession(name) {
  name = name || getActiveSessionName();
  var session = readSession(name);
  if (!session) {
    session = {
      name: name,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      isActive: true
    };
    writeSession(session);
    if (name === 'default' || !fs.existsSync(ACTIVE_FILE)) {
      setActiveSession(name);
    }
  }
  return session;
}

function touchSession(name) {
  var session = readSession(name);
  if (session) {
    session.lastUsedAt = new Date().toISOString();
    writeSession(session);
  }
}

function listSessions() {
  ensureSessionDir();
  var active = getActiveSessionName();
  try {
    return fs.readdirSync(SESSION_DIR)
      .filter(function(f) { return f.endsWith('.json'); })
      .map(function(f) {
        var name = f.replace(/\\.json$/, '');
        var session = readSession(name);
        return session ? Object.assign({}, session, { isActive: name === active }) : null;
      })
      .filter(Boolean);
  } catch (_) { return []; }
}

function deleteSession(name) {
  try {
    fs.unlinkSync(sessionPath(name));
    if (getActiveSessionName() === name) {
      setActiveSession('default');
    }
    return true;
  } catch (_) { return false; }
}

function switchSession(name) {
  var session = getOrCreateSession(name);
  setActiveSession(name);
  return session;
}

module.exports = {
  getOrCreateSession: getOrCreateSession,
  touchSession: touchSession,
  listSessions: listSessions,
  deleteSession: deleteSession,
  switchSession: switchSession,
  getActiveSessionName: getActiveSessionName
};
`.trim();
}
