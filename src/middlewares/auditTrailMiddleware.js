import { logAudit } from '../services/auditService.js';

// Middleware audit untuk semua route tulis (POST/PUT/DELETE) yang sudah berhasil (2xx/3xx).
// Dipasang SEBELUM route terproteksi; req.user tersedia saat res 'finish' (setelah handler jalan).
const MODULE_BY_PATH = (path) => {
    const seg = path.split('/').filter(Boolean);
    return seg[0]?.toUpperCase() || 'SISTEM';
};

export const auditTrailMiddleware = (req, res, next) => {
    res.on('finish', () => {
        // Hanya aksi tulis; GET murni (tanpa body) tidak perlu dicatat
        if (req.method === 'GET') return;
        const user = req.user || null;
        const success = res.statusCode >= 200 && res.statusCode < 400;

        const action = success
            ? (req.method === 'POST' ? 'CREATE' : req.method === 'PUT' || req.method === 'PATCH' ? 'UPDATE' : 'DELETE')
            : 'FAILED';

        logAudit({
            lembaga: user?.lembaga || 'ALL',
            actor_role: user?.role || null,
            actor_id: user?.id ?? null,
            actor_name: user?.name || user?.username || null,
            action,
            module: MODULE_BY_PATH(req.path),
            target_id: req.params && Object.values(req.params).length > 0 ? Object.values(req.params)[0] : null,
            detail: success ? (req.body || {}) : `HTTP ${res.statusCode}`,
            ip: req.ip
        }).catch(() => {});
    });
    next();
};
