import { previewImportService, commitImportService, buildTemplateService } from '../services/importService.js';

// GET /import/template — unduh template Excel
export const importTemplate = async (req, res) => {
    try {
        const buffer = buildTemplateService();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="template-import-santri.xlsx"');
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

// POST /import/preview — parse + validasi per baris (belum disimpan)
export const previewImport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'File Excel/CSV wajib diunggah.' });
        const lembaga = resolveLembaga(req);
        const params = {
            academicYearId: req.body?.academic_year_id ? Number(req.body.academic_year_id) : null,
            jenjang_id: req.body?.jenjang_id ? Number(req.body.jenjang_id) : null,
            classroom_id: req.body?.classroom_id ? Number(req.body.classroom_id) : null,
            rombel_id: req.body?.rombel_id ? Number(req.body.rombel_id) : null
        };
        const result = await previewImportService(req.file.buffer, params, lembaga);
        return res.json({ success: true, data: result });
    } catch (error) {
        if (error.message && /wajib|tidak|kosong|header|dikenal/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /import/commit — simpan baris valid secara atomik
export const commitImport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'File Excel/CSV wajib diunggah.' });
        const lembaga = resolveLembaga(req);
        const params = {
            academicYearId: req.body?.academic_year_id ? Number(req.body.academic_year_id) : null,
            jenjang_id: req.body?.jenjang_id ? Number(req.body.jenjang_id) : null,
            classroom_id: req.body?.classroom_id ? Number(req.body.classroom_id) : null,
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
        const result = await commitImportService(req.file.buffer, params, lembaga, selectedIndices);
        return res.json({ success: true, data: result, message: `Berhasil mengimpor ${result.imported} baris data santri.` });
    } catch (error) {
        if (error.message && /wajib|tidak|kosong|header|dikenal|duplicate|unique/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};
