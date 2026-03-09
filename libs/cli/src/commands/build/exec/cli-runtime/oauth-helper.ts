/**
 * OAuth helper for CLI executables.
 * Generates runtime module code for OAuth login/logout flows:
 * PKCE S256, ephemeral callback server, browser launch, token exchange.
 */

/**
 * Generate the oauth-helper runtime module source for embedding in CLI bundle.
 */
export function generateOAuthHelperSource(appName: string): string {
  return `
'use strict';

var crypto = require('crypto');
var http = require('http');
var url = require('url');
var childProcess = require('child_process');
var net = require('net');

var APP_NAME = ${JSON.stringify(appName)};

function findAvailablePort(startPort, endPort) {
  return new Promise(function(resolve, reject) {
    var port = startPort;
    function tryPort() {
      if (port > endPort) {
        reject(new Error('No available port in range ' + startPort + '-' + endPort));
        return;
      }
      var server = net.createServer();
      server.once('error', function() { port++; tryPort(); });
      server.once('listening', function() { server.close(function() { resolve(port); }); });
      server.listen(port, '127.0.0.1');
    }
    tryPort();
  });
}

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function startCallbackServer(port, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      server.close();
      reject(new Error('OAuth callback timed out after ' + (timeoutMs / 1000) + 's'));
    }, timeoutMs);

    var server = http.createServer(function(req, res) {
      var parsed = url.parse(req.url, true);
      if (parsed.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      var code = parsed.query.code;
      var state = parsed.query.state;
      var error = parsed.query.error;

      clearTimeout(timer);

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authentication Failed</h2><p>' + error + '</p><p>You can close this window.</p></body></html>');
        server.close();
        reject(new Error('OAuth error: ' + error));
        return;
      }

      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authentication Failed</h2><p>No authorization code received.</p><p>You can close this window.</p></body></html>');
        server.close();
        reject(new Error('No authorization code received'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Authentication Successful</h2><p>You can close this window and return to the terminal.</p></body></html>');
      server.close();
      resolve({ code: code, state: state });
    });

    server.listen(port, '127.0.0.1');
  });
}

function exchangeCodeForToken(serverUrl, code, codeVerifier, redirectUri, clientId) {
  return new Promise(function(resolve, reject) {
    var tokenUrl = serverUrl.replace(/\\/$/, '') + '/oauth/token';
    var parsed = url.parse(tokenUrl);
    var body = 'grant_type=authorization_code'
      + '&code=' + encodeURIComponent(code)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&client_id=' + encodeURIComponent(clientId)
      + '&code_verifier=' + encodeURIComponent(codeVerifier);

    var options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    var proto = parsed.protocol === 'https:' ? require('https') : http;
    var req = proto.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.error) {
            reject(new Error('Token exchange failed: ' + (json.error_description || json.error)));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error('Invalid token response'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function openBrowser(targetUrl) {
  var platform = process.platform;
  var cmd, args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [targetUrl];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', targetUrl];
  } else {
    cmd = 'xdg-open';
    args = [targetUrl];
  }
  var child = childProcess.spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function startOAuthLogin(options) {
  var serverUrl = options.serverUrl;
  var clientId = options.clientId || APP_NAME;
  var scope = options.scope || '';
  var portStart = options.portStart || 17830;
  var portEnd = options.portEnd || 17850;
  var timeout = options.timeout || 120000;
  var noBrowser = options.noBrowser || false;

  var port = await findAvailablePort(portStart, portEnd);
  var redirectUri = 'http://127.0.0.1:' + port + '/callback';

  var verifier = generateCodeVerifier();
  var challenge = generateCodeChallenge(verifier);
  var state = crypto.randomBytes(16).toString('hex');

  var authorizeUrl = serverUrl.replace(/\\/$/, '') + '/oauth/authorize'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&code_challenge=' + encodeURIComponent(challenge)
    + '&code_challenge_method=S256'
    + '&state=' + encodeURIComponent(state)
    + (scope ? '&scope=' + encodeURIComponent(scope) : '');

  var callbackPromise = startCallbackServer(port, timeout);

  if (noBrowser) {
    console.log('Open this URL in your browser:\\n');
    console.log('  ' + authorizeUrl + '\\n');
  } else {
    console.log('Opening browser for authentication...');
    openBrowser(authorizeUrl);
    console.log('If the browser did not open, visit:\\n  ' + authorizeUrl + '\\n');
  }
  console.log('Waiting for callback on port ' + port + '...');

  var callback = await callbackPromise;

  if (callback.state !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  console.log('Authorization code received. Exchanging for token...');
  var tokenResponse = await exchangeCodeForToken(serverUrl, callback.code, verifier, redirectUri, clientId);

  return {
    token: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : undefined,
    user: tokenResponse.user || undefined,
    metadata: { scope: scope, serverUrl: serverUrl }
  };
}

module.exports = {
  findAvailablePort: findAvailablePort,
  generateCodeVerifier: generateCodeVerifier,
  generateCodeChallenge: generateCodeChallenge,
  startCallbackServer: startCallbackServer,
  exchangeCodeForToken: exchangeCodeForToken,
  openBrowser: openBrowser,
  startOAuthLogin: startOAuthLogin
};
`.trim();
}
