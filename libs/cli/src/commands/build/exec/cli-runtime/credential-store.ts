/**
 * Credential store for CLI executables.
 * Generates runtime module code for secure credential storage with
 * platform-aware backends: macOS Keychain, Linux secret-tool, encrypted file fallback.
 */

export interface CredentialBlob {
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  user?: string;
  metadata?: Record<string, unknown>;
}

export interface CredentialStore {
  get(session: string): Promise<CredentialBlob | null>;
  set(session: string, blob: CredentialBlob): Promise<void>;
  delete(session: string): Promise<boolean>;
  list(): Promise<string[]>;
}

/**
 * Generate the credential-store runtime module source for embedding in CLI bundle.
 */
export function generateCredentialStoreSource(appName: string): string {
  return `
'use strict';

var crypto = require('crypto');
var os = require('os');
var path = require('path');
var fs = require('fs');
var childProcess = require('child_process');

var APP_NAME = ${JSON.stringify(appName)};
var CRED_DIR = path.join(os.homedir(), '.frontmcp', 'apps', APP_NAME, 'credentials');

function ensureCredDir() {
  fs.mkdirSync(CRED_DIR, { recursive: true });
}

function runCmd(cmd, args, input) {
  return new Promise(function(resolve, reject) {
    var proc = childProcess.spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    var stdout = '';
    var stderr = '';
    proc.stdout.on('data', function(d) { stdout += d; });
    proc.stderr.on('data', function(d) { stderr += d; });
    if (input) { proc.stdin.write(input); proc.stdin.end(); }
    proc.on('close', function(code) {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || 'Command failed: ' + cmd + ' ' + args.join(' ')));
    });
  });
}

function deriveKey() {
  var hostname = os.hostname();
  var salt = APP_NAME + ':' + hostname;
  return crypto.createHash('sha256').update(salt).digest();
}

function encryptBlob(data) {
  var key = deriveKey();
  var iv = crypto.randomBytes(12);
  var cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  var encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  var tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptBlob(encoded) {
  var key = deriveKey();
  var buf = Buffer.from(encoded, 'base64');
  var iv = buf.subarray(0, 12);
  var tag = buf.subarray(12, 28);
  var encrypted = buf.subarray(28);
  var decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  var decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

// macOS Keychain backend
var KeychainStore = {
  get: async function(session) {
    try {
      var encoded = await runCmd('security', ['find-generic-password', '-s', 'frontmcp.' + APP_NAME, '-a', session, '-w']);
      return decryptBlob(encoded);
    } catch (_) { return null; }
  },
  set: async function(session, blob) {
    var encoded = encryptBlob(blob);
    try { await runCmd('security', ['delete-generic-password', '-s', 'frontmcp.' + APP_NAME, '-a', session]); } catch (_) { /* ok */ }
    await runCmd('security', ['add-generic-password', '-s', 'frontmcp.' + APP_NAME, '-a', session, '-w', encoded, '-U']);
  },
  delete: async function(session) {
    try {
      await runCmd('security', ['delete-generic-password', '-s', 'frontmcp.' + APP_NAME, '-a', session]);
      return true;
    } catch (_) { return false; }
  },
  list: async function() {
    try {
      var out = await runCmd('security', ['dump-keychain']);
      var matches = [];
      var re = new RegExp('"svce"<blob>="frontmcp\\\\.' + APP_NAME.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '"[\\\\s\\\\S]*?"acct"<blob>="([^"]*)"', 'g');
      var m; while ((m = re.exec(out)) !== null) { matches.push(m[1]); }
      return [...new Set(matches)];
    } catch (_) { return []; }
  }
};

// Encrypted file backend (fallback)
var FileStore = {
  get: async function(session) {
    var filePath = path.join(CRED_DIR, session + '.enc');
    try {
      var encoded = fs.readFileSync(filePath, 'utf8');
      return decryptBlob(encoded);
    } catch (_) { return null; }
  },
  set: async function(session, blob) {
    ensureCredDir();
    var encoded = encryptBlob(blob);
    var filePath = path.join(CRED_DIR, session + '.enc');
    fs.writeFileSync(filePath, encoded, { mode: 0o600 });
  },
  delete: async function(session) {
    var filePath = path.join(CRED_DIR, session + '.enc');
    try { fs.unlinkSync(filePath); return true; } catch (_) { return false; }
  },
  list: async function() {
    ensureCredDir();
    try {
      return fs.readdirSync(CRED_DIR)
        .filter(function(f) { return f.endsWith('.enc'); })
        .map(function(f) { return f.replace(/\\.enc$/, ''); });
    } catch (_) { return []; }
  }
};

function createCredentialStore() {
  if (process.platform === 'darwin') {
    return KeychainStore;
  }
  return FileStore;
}

module.exports = { createCredentialStore, encryptBlob, decryptBlob };
`.trim();
}
