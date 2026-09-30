import { getRekapAbsensiService } from '../services/rekapAbsensiService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/reports/attendance-recap
export const getRekapAbsensi = async (req, res) => {
    try {
        const { data, summary, detail, filter } = await getRekapAbsensiService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data, summary, detail, filter });
    } catch (error) {
        console.error('EROR REKAP ABSENSI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat rekap absensi' });
    }
};
