const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStoreFile() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { version: 0, data: {}, updatedAt: new Date().toISOString() };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeStoreFile(store) {
  ensureDataDir();
  store.updatedAt = new Date().toISOString();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

async function supabaseRequest(method, query, body) {
  const url = `${SUPABASE_URL}/rest/v1/rebate_store?${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'PATCH' ? 'return=representation' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function readStoreSupabase() {
  const rows = await supabaseRequest('GET', 'id=eq.main&select=version,data,updated_at');
  if (!rows || rows.length === 0) {
    await supabaseRequest('POST', '', { id: 'main', version: 0, data: {} });
    return { version: 0, data: {}, updatedAt: new Date().toISOString() };
  }
  const row = rows[0];
  return {
    version: row.version,
    data: row.data || {},
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

async function writeStoreSupabase(store) {
  const updatedAt = new Date().toISOString();
  const rows = await supabaseRequest('PATCH', 'id=eq.main', {
    version: store.version,
    data: store.data,
    updated_at: updatedAt,
  });
  const row = rows[0];
  return {
    version: row.version,
    updatedAt: row.updated_at,
  };
}

async function readStore() {
  if (USE_SUPABASE) return readStoreSupabase();
  return readStoreFile();
}

async function writeStore(store) {
  if (USE_SUPABASE) return writeStoreSupabase(store);
  writeStoreFile(store);
  return { version: store.version, updatedAt: store.updatedAt };
}

function checkAuth(req, res) {
  if (!ACCESS_KEY) return true;
  const key = req.headers['x-access-key'] || req.query.key;
  if (key !== ACCESS_KEY) {
    res.status(401).json({ error: '访问密钥无效，请联系管理员获取' });
    return false;
  }
  return true;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    authRequired: Boolean(ACCESS_KEY),
    storage: USE_SUPABASE ? 'supabase' : 'file',
  });
});

app.get('/api/data', async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const store = await readStore();
    res.json({
      version: store.version,
      data: store.data,
      updatedAt: store.updatedAt,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '读取数据失败' });
  }
});

app.put('/api/data', async (req, res) => {
  if (!checkAuth(req, res)) return;

  const { version, data } = req.body;
  if (typeof version !== 'number' || !data || typeof data !== 'object') {
    return res.status(400).json({ error: '请求格式错误' });
  }

  try {
    const store = await readStore();
    if (version !== store.version) {
      return res.status(409).json({
        error: '数据已被其他人更新，请刷新后重试',
        version: store.version,
        data: store.data,
        updatedAt: store.updatedAt,
      });
    }

    store.version += 1;
    store.data = data;
    const saved = await writeStore(store);

    res.json({
      version: saved.version,
      updatedAt: saved.updatedAt,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '保存数据失败' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`返点管理工具已启动: http://localhost:${PORT}`);
  console.log(`数据存储: ${USE_SUPABASE ? 'Supabase（云端持久化）' : '本地文件'}`);
  if (ACCESS_KEY) {
    console.log('已启用访问密钥保护');
  } else {
    console.log('警告: 未设置 ACCESS_KEY，任何人可读写数据。生产环境请设置环境变量 ACCESS_KEY');
  }
  if (!USE_SUPABASE && process.env.NODE_ENV === 'production') {
    console.log('警告: 生产环境未配置 Supabase，重启后数据可能丢失。请设置 SUPABASE_URL 和 SUPABASE_SERVICE_KEY');
  }
});
