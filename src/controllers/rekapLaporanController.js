import { getRekapLaporanService } from '../services/rekapLaporanService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/reports/rekap — Rekap Laporan Terpadu (E.2)
export const getRekapLaporan = async (req, res) => {
    try {
        const data = await getRekapLaporanService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR REKAP LAPORAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat rekap laporan' });
    }
};
