import { getAnalyticsService } from '../services/analyticsService.js';
import { getLembagaByKodeService } from '../services/lembagaService.js';

// GET /api/analytics/summary — Rekap Analitik & Grafik (E.3), terscope lembaga.
// Super Admin (ALL) boleh memilih lembaga via ?lembaga=<kode> (divalidasi ke tabel master);
// admin scoped selalu dipaksa ke lembaganya sendiri.
export const getAnalytics = async (req, res) => {
    try {
        const callerLembaga = String(req.user?.lembaga || 'ALL').toUpperCase();
        let lembaga = callerLembaga;
        if (callerLembaga === 'ALL' && req.query.lembaga) {
            const q = String(req.query.lembaga).toUpperCase();
            const found = await getLembagaByKodeService(q);
            if (found && found.aktif !== 0) lembaga = q;
        }
        const data = await getAnalyticsService(lembaga);
        return res.status(200).json({
            success: true,
            message: 'Data analitik berhasil dimuat',
            lembaga,
            data
        });
    } catch (error) {
        console.error('GAGAL MENGAMBIL DATA ANALITIK:', error.message);
        return res.status(400).json({
            success: false,
            message: error.message || 'Gagal mengambil data analitik'
        });
    }
};
