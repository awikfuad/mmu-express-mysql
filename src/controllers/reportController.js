import * as reportService from '../services/reportService.js';

export const getMonthlyFinanceReport = async (req, res) => {
    const { month, tanggal_mulai, tanggal_selesai } = req.query; // Filter bulan (?month=2026-05) atau rentang tanggal

    try {
        const reportData = await reportService.getFinanceReportService({ month, tanggal_mulai, tanggal_selesai }, req.user?.lembaga);
        return res.json({
            success: true,
            message: `Laporan keuangan periode ${reportData.month} berhasil ditarik.`,
            data: reportData
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};