import { getTunggakanIuranService, BULAN_NAMES } from '../services/tunggakanIuranService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/reports/iuran-recap
export const getTunggakanIuran = async (req, res) => {
    try {
        const { data, summary } = await getTunggakanIuranService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data, summary });
    } catch (error) {
        console.error('EROR REKAP IURAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat rekap iuran' });
    }
};

export { BULAN_NAMES };
