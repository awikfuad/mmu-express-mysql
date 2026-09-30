// src/middlewares/inputLogger.js

const SENSITIVE_FIELDS = ['password', 'refreshToken', 'token', 'authorization'];

const redact = (value) => {
  if (typeof value !== 'object' || value === null) return value;
  const copy = { ...value };
  for (const key of Object.keys(copy)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      copy[key] = '[REDACTED]';
    } else if (typeof copy[key] === 'object') {
      copy[key] = redact(copy[key]);
    }
  }
  return copy;
};

const inputLogger = (req, res, next) => {
  const startTime = Date.now();
  const tgl = new Date().toISOString();
  
  console.log(`\n╔═══════════════════ [ REQUEST MASUK: ${tgl} ] ═══════════════════`);
  console.log(`🚀 METHOD : ${req.method}`);
  console.log(`🔗 URL    : ${req.originalUrl}`);
  
  // PERBAIKAN: Menambahkan fallback '|| {}' agar Object.keys tidak membaca undefined/null
  const params = req.params || {};
  const query = req.query || {};
  const body = redact(req.body || {});

  if (Object.keys(params).length > 0) console.log('📍 [PATH PARAMS] :', JSON.stringify(params));
  if (Object.keys(query).length > 0)  console.log('🔍 [QUERY PARAMS]:', JSON.stringify(query));
  if (Object.keys(body).length > 0)   console.log('📦 [BODY PAYLOAD]:', JSON.stringify(body));
  console.log(`╚═════════════════════════════════════════════════════════════════`);

  // Interseptor untuk membaca data body respon
  const oldSend = res.send;
  let responseBody = null;

  res.send = function (data) {
    try {
      responseBody = JSON.parse(data);
    } catch (e) {
      responseBody = data;
    }
    oldSend.apply(res, arguments);
  };

  const logResponse = () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    
    let statusLabel = '🟢 SUCCESS';
    if (statusCode >= 400) {
      statusLabel = '🔴 ERROR / FAILED';
    } else if (statusCode >= 300) {
      statusLabel = '🟡 REDIRECT';
    }

    console.log(`┌─────────────────── [ RESPON SERVER ] ───────────────────`);
    console.log(`📢 STATUS  : ${statusLabel} (${statusCode})`);
    console.log(`⏱️ DURASI  : ${duration}ms`);
    
    if (statusCode >= 400) {
      console.log(`⚠️  [DETAIL ERROR]:`);
      if (typeof responseBody === 'object' && responseBody !== null) {
        console.dir(responseBody, { depth: null, colors: true });
      } else {
        console.log(`   Message: ${responseBody || 'Tidak ada pesan error spesifik.'}`);
      }
    }
    
    console.log(`└─────────────────────────────────────────────────────────\n`);
    
    res.removeListener('finish', logResponse);
    res.removeListener('close', logResponse);
  };

  res.on('finish', logResponse);
  res.on('close', logResponse);

  next();
};

export default inputLogger;