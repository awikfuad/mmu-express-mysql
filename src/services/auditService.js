import db from '../config/db.js';

const SENSITIVE_FIELDS = ['password', 'refreshToken', 'transfer_proof', 'transferProof'];

const sanitizePayload = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const copy = { ...obj };
    for (const key of Object.keys(copy)) {
        const lower = key.toLowerCase();
        if (SENSITIVE_FIELDS.some((f) => lower.includes(f))) {
            copy[key] = '[REDACTED]';
        } else if (typeof copy[key] === 'string' && copy[key].length > 500) {
            copy[key] = `${copy[key].slice(0, 500)}…`;
        }
    }
    return copy;
};

// Catat satu entri log audit. Aman dipanggil kapanpun (never throw ke pemanggil).
export const logAudit = async ({ lembaga, actor_role, actor_id, actor_name, action, module, target_id, detail, ip }) => {
    try {
        await db.execute({
            sql: `INSERT INTO audit_logs (lembaga, actor_role, actor_id, actor_name, action, module, target_id, detail, ip)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                lembaga || 'ALL',
                actor_role || null,
                actor_id ?? null,
                actor_name || null,
                action || 'UNKNOWN',
                module || 'SISTEM',
                target_id != null ? String(target_id) : null,
                typeof detail === 'object' ? JSON.stringify(sanitizePayload(detail)) : (detail || null),
                ip || null
            ]
        });
    } catch (error) {
        console.error('❌ GAGAL MENULIS AUDIT LOG:', error.message);
    }
};

// Ambil log audit dengan filter & paginasi, terscope lembaga pemanggil.
// Super Admin (ALL) melihat semua; admin scoped melihat lembaganya + lembaga 'ALL'.
export const getAuditLogsService = async ({ lembaga, module, action, actor_name, date_from, date_to, limit, offset }) => {
    const scoped = (lembaga || 'ALL').toUpperCase();
    const where = [];
    const args = [];

    if (scoped !== 'ALL') {
        where.push('lembaga IN (?, ?)');
        args.push(scoped, 'ALL');
    }
    if (module) {
        where.push('LOWER(module) = LOWER(?)');
        args.push(module);
    }
    if (action) {
        where.push('LOWER(action) = LOWER(?)');
        args.push(action);
    }
    if (actor_name) {
        where.push('LOWER(actor_name) LIKE LOWER(?)');
        args.push(`%${actor_name}%`);
    }
    if (date_from) {
        where.push('date(created_at) >= ?');
        args.push(date_from);
    }
    if (date_to) {
        where.push('date(created_at) <= ?');
        args.push(date_to);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    const [countResult, listResult] = await Promise.all([
        db.execute({ sql: `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`, args }),
        db.execute({
            sql: `SELECT id, lembaga, actor_role, actor_id, actor_name, action, module, target_id, detail, ip, created_at
                  FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
            args: [...args, lim, off]
        })
    ]);

    return {
        total: Number(countResult.rows[0]?.total || 0),
        limit: lim,
        offset: off,
        data: listResult.rows
    };
};
