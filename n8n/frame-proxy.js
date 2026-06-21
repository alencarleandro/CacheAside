const http = require('node:http');
const net = require('node:net');
const { URL } = require('node:url');

const target = new URL(process.env.N8N_PROXY_TARGET || 'http://127.0.0.1:5680');
const publicPort = Number(process.env.N8N_PROXY_PORT || process.env.PORT || 5678);
const defaultCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://cdn-rs.n8n.io",
  "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://cdn-rs.n8n.io",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'self' https://*.onrender.com https://cacheaside.onrender.com http://localhost:8080 http://127.0.0.1:8080 http://127.0.0.1:8081"
].join(';');

const responseHeaderBlocklist = new Set([
  'content-security-policy',
  'x-frame-options'
]);

function forwardedHeaders(request) {
  return {
    ...request.headers,
    host: request.headers.host,
    'x-forwarded-host': request.headers.host,
    'x-forwarded-proto': 'https',
    'x-forwarded-port': '443'
  };
}

function responseHeaders(headers) {
  const nextHeaders = {};

  for (const [key, value] of Object.entries(headers)) {
    if (responseHeaderBlocklist.has(key.toLowerCase())) continue;

    if (key.toLowerCase() === 'set-cookie') {
      const cookies = Array.isArray(value) ? value : [value];
      nextHeaders[key] = cookies.map((cookie) => {
        const withoutSameSite = cookie.replace(/;\s*SameSite=[^;]+/gi, '');
        const secureCookie = /;\s*Secure/i.test(withoutSameSite)
          ? withoutSameSite
          : `${withoutSameSite}; Secure`;
        const partitionedCookie = /;\s*Partitioned/i.test(secureCookie)
          ? secureCookie
          : `${secureCookie}; Partitioned`;

        return `${partitionedCookie}; SameSite=None`;
      });
      continue;
    }

    nextHeaders[key] = value;
  }

  nextHeaders['content-security-policy'] = process.env.N8N_PROXY_CONTENT_SECURITY_POLICY
    || defaultCsp;

  return nextHeaders;
}

function proxyHttp(request, response) {
  const upstreamRequest = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers: forwardedHeaders(request)
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders(upstreamResponse.headers));
    upstreamResponse.pipe(response);
  });

  upstreamRequest.on('error', (error) => {
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`n8n proxy error: ${error.message}`);
  });

  request.pipe(upstreamRequest);
}

function proxyUpgrade(request, socket, head) {
  const upstreamSocket = net.connect(Number(target.port), target.hostname, () => {
    const headers = forwardedHeaders(request);
    const serializedHeaders = Object.entries(headers)
      .flatMap(([key, value]) => Array.isArray(value)
        ? value.map((item) => `${key}: ${item}`)
        : [`${key}: ${value}`])
      .join('\r\n');

    upstreamSocket.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${serializedHeaders}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket);
    upstreamSocket.pipe(socket);
  });

  upstreamSocket.on('error', () => {
    socket.destroy();
  });
}

const server = http.createServer(proxyHttp);
server.on('upgrade', proxyUpgrade);
server.listen(publicPort, '0.0.0.0', () => {
  console.log(`n8n frame proxy listening on 0.0.0.0:${publicPort}, target ${target.href}`);
});
