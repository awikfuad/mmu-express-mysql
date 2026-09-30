import {
    getNilaiHarianService,
    saveNilaiHarianBulkService,
    deleteNilaiHarianService,
    getPerilakuMuridService,
    savePerilakuMuridBulkService,
    updatePerilakuMuridService,
    deletePerilakuMuridService,
    KATEGORI_PERILAKU,
    PREDIKAT_PERILAKU
} from '../services/penilaianService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// ============================================================================
// NILAI HARIAN
// ============================================================================

// GET /api/nilai-harian
export const getNilaiHarian = async (req, res) => {
    try {
        const data = await getNilaiHarianService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET NILAI HARIAN:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat nilai harian' });
    }
};

// POST /api/nilai-harian/bulk
export const saveNilaiHarianBulk = async (req, res) => {
    try {
        const result = await saveNilaiHarianBulkService(req.body, getLembaga(req));
        return res.status(200).json({ success: true, data: result, message: `${result.saved} nilai berhasil disimpan` });
    } catch (error) {
        console.error('EROR SAVE NILAI HARIAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan nilai harian' });
    }
};

// DELETE /api/nilai-harian/:id
export const deleteNilaiHarian = async (req, res) => {
    try {
        const ok = await deleteNilaiHarianService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Data nilai tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Data nilai berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE NILAI HARIAN:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus nilai harian' });
    }
};

// ============================================================================
// PERILAKU MURID
// ============================================================================

// GET /api/perilaku-murid
export const getPerilakuMurid = async (req, res) => {
    try {
        const data = await getPerilakuMuridService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET PERILAKU MURID:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat data perilaku murid' });
    }
};

// POST /api/perilaku-murid/bulk
export const savePerilakuMuridBulk = async (req, res) => {
    try {
        const result = await savePerilakuMuridBulkService(req.body, getLembaga(req));
        return res.status(200).json({ success: true, data: result, message: `${result.saved} data perilaku berhasil disimpan` });
    } catch (error) {
        console.error('EROR SAVE PERILAKU MURID:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan data perilaku murid' });
    }
};

// PUT /api/perilaku-murid/:id
export const updatePerilakuMurid = async (req, res) => {
    try {
        const ok = await updatePerilakuMuridService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Data perilaku tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Data perilaku berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE PERILAKU MURID:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah data perilaku murid' });
    }
};

// DELETE /api/perilaku-murid/:id
export const deletePerilakuMurid = async (req, res) => {
    try {
        const ok = await deletePerilakuMuridService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Data perilaku tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Data perilaku berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE PERILAKU MURID:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus data perilaku murid' });
    }
};

export { KATEGORI_PERILAKU, PREDIKAT_PERILAKU };
