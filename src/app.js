import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import 'dotenv/config';
import apiRouter from './routes/api.js';
import inputLogger from './middlewares/inputLogger.js';
import env from './config/env.js';

// Global BigInt serialization helper
BigInt.prototype.toJSON = function () {
    return Number(this);
};

const app = express();

// Aktifkan trust proxy hanya jika berada di belakang Nginx/Cloudflare/Vercel
if (env.trustProxy) {
    app.set('trust proxy', 1);
}

// 1. PENGATURAN KEAMANAN (Taruh paling atas)
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

// KONFIGURASI RATE LIMITING YANG AMAN UNTUK PRESENSI MASSAL
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    // Dinaikkan menjadi 3000 agar komputer operator/kasir di pondok
    // bebas melakukan scan ratusan/ribuan santri tanpa terblokir sistem.
    max: 3000,
    message: {
        success: false,
        message: "Aktivitas perangkat terlalu padat, silakan jeda beberapa saat."
    },
    standardHeaders: true, // Kembalikan info rate-limit di headers `RateLimit-*`
    legacyHeaders: false,  // Nonaktifkan headers `X-RateLimit-*` lama
});
app.use(limiter);

// Konfigurasi Gerbang CORS (default buka untuk Vue web & Flutter mobile)
const corsOrigin = env.corsOrigin === '*'
    ? '*'
    : env.corsOrigin.split(',').map((s) => s.trim());
app.use(cors({
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// 2. PEMBACA DATA (MIDDLEWARE DATA parsing)
app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(inputLogger); // Log payload request & respon (aktif)

// 3. JALUR UTAMA API
app.use('/api', apiRouter);
app.use(express.static('public'));

// 4. ROUTE TIDAK DIKENALI (404)
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Endpoint '${req.method} ${req.originalUrl}' tidak ditemukan.`
    });
});

// 5. ERROR HANDLER TERPUSAT
app.use((err, req, res, next) => {
    // Error dari Multer (upload file)
    if (err instanceof multer.MulterError) {
        const limitMap = {
            'LIMIT_FILE_SIZE': err.limit ? `Ukuran file melebihi batas maksimal ${Math.round(err.limit / (1024*1024))}MB.` : 'Ukuran file melebihi batas maksimal.'
        };
        const message = limitMap[err.code] || `Gagal mengunggah file: ${err.message}`;
        // Fallback spesifik untuk backup (50MB) vs lainnya
        const fallback = err.code === 'LIMIT_FILE_SIZE'
            ? (req.path.includes('upload-restore') ? 'Ukuran file melebihi batas maksimal 50MB.' : req.path.includes('import') ? 'Ukuran file melebihi batas maksimal 5MB.' : 'Ukuran file melebihi batas maksimal 2MB.')
            : `Gagal mengunggah file: ${err.message}`;
        return res.status(400).json({ success: false, message: limitMap[err.code] || fallback });
    }

    // Error custom dari upload.js (fileFilter)
    if (err && err.message && err.message.startsWith('Hanya diperbolehkan')) {
        return res.status(400).json({ success: false, message: err.message });
    }

    console.error('❌ UNCAUGHT ERROR:', err);
    return res.status(500).json({
        success: false,
        message: env.isProduction
            ? 'Terjadi kesalahan pada server.'
            : `Terjadi kesalahan pada server: ${err.message}`
    });
});

export default app;
