import * as yearClosingService from '../services/yearClosingService.js';

// Preview sebelum tutup buku — terscope lembaga
export const getClosingPreview = async (req, res) => {
    const { year_id } = req.params;
    const lembaga = req.user?.lembaga || 'ALL';
    try {
        const preview = await yearClosingService.getClosingPreviewService(year_id, lembaga);
        return res.json({ success: true, data: preview });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Eksekusi tutup buku — hanya Super Admin (ALL)
export const closeYear = async (req, res) => {
    const { year_id } = req.params;
    const lembaga = req.user?.lembaga || 'ALL';
    if (lembaga.toUpperCase() !== 'ALL') {
        return res.status(403).json({
            success: false,
            message: 'Hanya Super Admin (ALL) yang dapat menutup buku tahunan. Hubungi Super Admin.'
        });
    }
    try {
        const actorName = req.user?.username || req.user?.name || 'admin';
        const actorId = req.user?.id || null;
        const result = await yearClosingService.closeYearService(year_id, actorName, actorId, lembaga);
        return res.json({
            success: true,
            message: `Tahun ajaran ${result.closed_year.year_name} berhasil ditutup. Tahun baru ${result.new_year.year_name} telah diaktifkan.`,
            data: result
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Laporan tutup buku — terscope lembaga
export const getClosingReport = async (req, res) => {
    const { year_id } = req.params;
    const lembaga = req.user?.lembaga || 'ALL';
    try {
        const report = await yearClosingService.getClosingReportService(year_id, lembaga);
        return res.json({ success: true, data: report });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Riwayat tutup buku — terscope lembaga
export const getClosingHistory = async (req, res) => {
    const lembaga = req.user?.lembaga || 'ALL';
    try {
        const history = await yearClosingService.getClosingHistoryService(lembaga);
        return res.json({ success: true, data: history });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
