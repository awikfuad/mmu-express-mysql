import { getAuditLogsService } from '../services/auditService.js';

// GET /api/audit-logs — Riwayat aktivitas (terscope lembaga, admin saja)
export const getAuditLogs = async (req, res) => {
    try {
        const result = await getAuditLogsService({
            lembaga: req.user?.lembaga,
            module: req.query.module,
            action: req.query.action,
            actor_name: req.query.actor_name,
            date_from: req.query.date_from,
            date_to: req.query.date_to,
            limit: req.query.limit,
            offset: req.query.offset
        });

        return res.status(200).json({
            success: true,
            message: 'Berhasil memuat log aktivitas',
            ...result
        });
    } catch (error) {
        console.error('❌ LOG EROR GET AUDIT LOGS:', error);
        return res.status(500).json({
            success: false,
            message: 'Gagal memuat log aktivitas karena gangguan server internal',
            error: error.message
        });
    }
};
