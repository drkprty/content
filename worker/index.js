const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, service: 'drkprty-content' }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/asset/')) {
        const rawPath = decodeURIComponent(url.pathname.slice('/asset/'.length));
        const path = assertAllowedPath(rawPath, env);
        return serveAsset(path, request, env, cors);
      }

      if (request.method === 'POST' && url.pathname === '/upload') {
        await requireFirebaseUser(request, env);
        const workId = sanitizeSegment(url.searchParams.get('workId') || 'work');
        const filename = sanitizeFilename(url.searchParams.get('filename') || 'artwork.jpg');
        const contentType = request.headers.get('content-type') || 'application/octet-stream';
        assertImageType(contentType);

        const bytes = await request.arrayBuffer();
        if (!bytes.byteLength) throw httpError(400, 'Empty upload.');
        if (bytes.byteLength > 20 * 1024 * 1024) throw httpError(413, 'Maximum image size is 20 MB.');

        const ext = extensionFor(contentType, filename);
        const root = contentRoot(env);
        const path = `${root}/${workId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        await putGitHubFile(path, bytes, contentType, env);

        const publicUrl = `${url.origin}/asset/${encodePath(path)}`;
        return json({ ok: true, path, url: publicUrl }, 200, cors);
      }

      if (request.method === 'DELETE' && url.pathname === '/file') {
        await requireFirebaseUser(request, env);
        const path = assertAllowedPath(url.searchParams.get('path') || '', env);
        await deleteGitHubFile(path, env);
        return json({ ok: true, path }, 200, cors);
      }

      return json({ error: 'Not found.' }, 404, cors);
    } catch (error) {
      const status = Number(error?.status) || 500;
      console.error(error);
      return json({ error: status === 500 ? 'Unexpected server error.' : error.message }, status, cors);
    }
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map(v => v.trim()).filter(Boolean);
  const allowOrigin = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0] || 'null');
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'Authorization,Content-Type',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function contentRoot(env) {
  return String(env.CONTENT_ROOT || 'drkprty/works').replace(/^\/+|\/+$/g, '');
}

function assertAllowedPath(path, env) {
  const clean = String(path || '').replace(/^\/+/, '');
  const root = contentRoot(env);
  if (!clean || clean.includes('..') || !(clean === root || clean.startsWith(root + '/'))) {
    throw httpError(400, 'Invalid content path.');
  }
  return clean;
}

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'work';
}

function sanitizeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase().slice(0, 180) || 'artwork.jpg';
}

function assertImageType(contentType) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw httpError(415, 'Only JPG, PNG and WebP images are allowed.');
  }
}

function extensionFor(contentType, filename) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/jpeg') return /\.jpeg$/i.test(filename) ? 'jpeg' : 'jpg';
  return 'bin';
}

async function requireFirebaseUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) throw httpError(401, 'Authentication required.');
  const idToken = auth.slice(7).trim();
  if (!idToken) throw httpError(401, 'Authentication required.');
  if (!env.FIREBASE_WEB_API_KEY) throw httpError(500, 'Firebase validation is not configured.');

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  if (!response.ok) throw httpError(401, 'Invalid or expired Firebase session.');
  const data = await response.json();
  const user = data.users?.[0];
  if (!user?.localId) throw httpError(401, 'Invalid Firebase session.');

  if (env.ADMIN_EMAILS) {
    const admins = String(env.ADMIN_EMAILS).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(String(user.email || '').toLowerCase())) throw httpError(403, 'This account is not allowed to manage content.');
  }
  return user;
}

function githubHeaders(env, accept = 'application/vnd.github+json') {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) throw httpError(500, 'GitHub is not configured.');
  return {
    'authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'accept': accept,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'drkprty-content-worker'
  };
}

function githubContentsUrl(path, env) {
  return `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${encodePath(path)}`;
}

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

async function putGitHubFile(path, arrayBuffer, contentType, env) {
  const branch = env.GITHUB_BRANCH || 'main';
  const response = await fetch(githubContentsUrl(path, env), {
    method: 'PUT',
    headers: { ...githubHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `DRKPRTY ART: upload ${path.split('/').pop()}`,
      content: arrayBufferToBase64(arrayBuffer),
      branch
    })
  });
  if (!response.ok) {
    const detail = await safeJson(response);
    throw httpError(response.status, `GitHub upload failed: ${detail.message || response.statusText}`);
  }
}

async function getGitHubFileMeta(path, env) {
  const branch = env.GITHUB_BRANCH || 'main';
  const response = await fetch(`${githubContentsUrl(path, env)}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(env)
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await safeJson(response);
    throw httpError(response.status, `GitHub lookup failed: ${detail.message || response.statusText}`);
  }
  return response.json();
}

async function deleteGitHubFile(path, env) {
  const meta = await getGitHubFileMeta(path, env);
  if (!meta) return;
  const branch = env.GITHUB_BRANCH || 'main';
  const response = await fetch(githubContentsUrl(path, env), {
    method: 'DELETE',
    headers: { ...githubHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `DRKPRTY ART: delete ${path.split('/').pop()}`,
      sha: meta.sha,
      branch
    })
  });
  if (!response.ok) {
    const detail = await safeJson(response);
    throw httpError(response.status, `GitHub delete failed: ${detail.message || response.statusText}`);
  }
}

async function serveAsset(path, request, env, cors) {
  const branch = env.GITHUB_BRANCH || 'main';
  const response = await fetch(`${githubContentsUrl(path, env)}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(env, 'application/vnd.github.raw')
  });
  if (!response.ok) {
    if (response.status === 404) return new Response('Not found', { status: 404, headers: cors });
    return new Response('Asset unavailable', { status: 502, headers: cors });
  }
  const headers = new Headers(cors);
  headers.set('content-type', response.headers.get('content-type') || 'application/octet-stream');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('etag', response.headers.get('etag') || '');
  return new Response(response.body, { status: 200, headers });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function safeJson(response) {
  try { return await response.json(); } catch { return {}; }
}
