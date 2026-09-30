import * as dashboardService from '../services/dashboardService.js';
import { getLembagaByKodeService } from '../services/lembagaService.js';

// Super Admin (lembaga 'ALL') boleh memilih lembaga via ?lembaga=<kode>
// (VALIDASI terhadap tabel master lembaga; kode invalid → fallback ke lembaga pengguna).
// Admin scoped selalu dipaksa ke lembaganya sendiri (tidak bisa intip lembaga lain).
export const getDashboardStats = async (req, res) => {
    try {
        const callerLembaga = String(req.user?.lembaga || 'ALL').toUpperCase();
        let lembaga = callerLembaga;

        // Hanya Super Admin (callerLembaga === 'ALL') yang bisa menggunakan filter query lembaga
        if (callerLembaga === 'ALL' && req.query.lembaga) {
            const requestedLembaga = String(req.query.lembaga).toUpperCase().trim();

            if (requestedLembaga === 'ALL') {
                lembaga = 'ALL';
            } else {
                // Validasi kode lembaga ke master database
                const found = await getLembagaByKodeService(requestedLembaga);
                if (found && Number(found.aktif) !== 0) {
                    lembaga = requestedLembaga;
                }
            }
        }

        const data = await dashboardService.getDashboardStatsService(lembaga);
        return res.json({ success: true, lembaga, data });
    } catch (error) {
        console.error('Error pada dashboard stats:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};