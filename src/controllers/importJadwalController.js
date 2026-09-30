import { previewImportJadwalService, commitImportJadwalService, buildTemplateJadwalService } from '../services/importJadwalService.js';

export const importJadwalTemplate = async (req, res) => {
    try {
        const buffer = buildTemplateJadwalService();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="template-import-jadwal.xlsx"');
        return res.send(buffer);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const resolveLembaga = (req) => {
    const userLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
    if (userLembaga === 'ALL') {
        return (req.body?.lembaga || 'ALL').toUpperCase();
    }
    return userLembaga;
};

export const previewImportJadwal = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'File Excel/CSV wajib diunggah.' });
        const lembaga = resolveLembaga(req);
        const params = {
            academicYearId: req.body?.academic_year_id ? Number(req.body.academic_year_id) : null,
            jenjang_id: req.body?.jenjang_id ? Number(req.body.jenjang_id) : null,
            rombel_id: req.body?.rombel_id ? Number(req.body.rombel_id) : null
        };
        const result = await previewImportJadwalService(req.file.buffer, params, lembaga);
        return res.json({ success: true, data: result });
    } catch (error) {
        if (error.message && /wajib|tidak|kosong|header|dikenal|valid/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const commitImportJadwal = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'File Excel/CSV wajib diunggah.' });
        const lembaga = resolveLembaga(req);
        const params = {
            academicYearId: req.body?.academic_year_id ? Number(req.body.academic_year_id) : null,
            jenjang_id: req.body?.jenjang_id ? Number(req.body.jenjang_id) : null,
            rombel_id: req.body?.rombel_id ? Number(req.body.rombel_id) : null
        };
        let selectedIndices = null;
        if (req.body?.row_indices) {
            try {
                selectedIndices = JSON.parse(req.body.row_indices);
            } catch {
                selectedIndices = String(req.body.row_indices).split(',').map((x) => Number(x.trim()));
            }
        }
        const result = await commitImportJadwalService(req.file.buffer, params, lembaga, selectedIndices);
        const msg = `Berhasil mengimpor ${result.imported} jadwal. ${result.errors?.length ? `${result.errors.length} baris error di-skip.` : ''}`;
        return res.json({ success: true, data: result, message: msg });
    } catch (error) {
        if (error.message && /wajib|tidak|kosong|header|dikenal|valid/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};
