import { previewSantriSyncService, commitSantriSyncService } from '../services/santriSyncService.js';
import { getLembaga } from '../utils/lembagaHelper.js';

// GET /sync-santri/preview — analisis ketidaksesuaian (read-only, admin only)
export const previewSantriSync = async (req, res) => {
    try {
        const lembaga = getLembaga(req);
        const result = await previewSantriSyncService(lembaga);
        return res.json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /sync-santri/commit — terapkan perbaikan atomik (admin only)
export const commitSantriSync = async (req, res) => {
    try {
        const lembaga = getLembaga(req);
        const result = await commitSantriSyncService(lembaga);
        return res.json({
            success: true,
            data: result,
            message: result.total_diperbaiki > 0
                ? `Sinkronisasi selesai: ${result.total_diperbaiki} item data diperbaiki.`
                : 'Semua data santri sudah sinkron. Tidak ada yang perlu diperbaiki.'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};