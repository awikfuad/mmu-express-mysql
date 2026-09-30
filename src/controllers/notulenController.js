import {
    getNotulenService,
    getNotulenDetailService,
    createNotulenService,
    updateNotulenService,
    setStatusNotulenService,
    deleteNotulenService,
    savePesertaService,
    createPembahasanService,
    updatePembahasanService,
    deletePembahasanService,
    createTindakLanjutService,
    updateTindakLanjutService,
    deleteTindakLanjutService,
    getTindakLanjutService,
    createLampiranService,
    deleteLampiranService,
    KATEGORI_RAPAT,
    STATUS_NOTULEN,
    KEHADIRAN_PESERTA,
    STATUS_TINDAK_LANJUT
} from '../services/notulenService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();
const getActorName = (req) => req.user?.name || req.user?.username || null;

// GET /api/notulen
export const getNotulen = async (req, res) => {
    try {
        const data = await getNotulenService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, ...data });
    } catch (error) {
        console.error('EROR GET NOTULEN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data notulen' });
    }
};

// GET /api/notulen/:id
export const getNotulenDetail = async (req, res) => {
    try {
        const data = await getNotulenDetailService(req.params.id, getLembaga(req));
        if (!data) return res.status(404).json({ success: false, message: 'Notulen tidak ditemukan' });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET NOTULEN DETAIL:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat detail notulen' });
    }
};

// POST /api/notulen
export const createNotulen = async (req, res) => {
    try {
        const result = await createNotulenService(req.body, getLembaga(req), getActorName(req));
        return res.status(201).json({ success: true, data: result, message: 'Notulen rapat berhasil dibuat' });
    } catch (error) {
        console.error('EROR CREATE NOTULEN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal membuat notulen' });
    }
};

// PUT /api/notulen/:id
export const updateNotulen = async (req, res) => {
    try {
        const ok = await updateNotulenService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Notulen tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Notulen berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE NOTULEN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah notulen' });
    }
};

// PUT /api/notulen/:id/status
export const setNotulenStatus = async (req, res) => {
    try {
        const ok = await setStatusNotulenService(req.params.id, req.body.status, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Notulen tidak ditemukan' });
        return res.status(200).json({ success: true, message: `Status notulen menjadi ${req.body.status}` });
    } catch (error) {
        console.error('EROR SET STATUS NOTULEN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah status notulen' });
    }
};

// DELETE /api/notulen/:id
export const deleteNotulen = async (req, res) => {
    try {
        const ok = await deleteNotulenService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Notulen tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Notulen berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE NOTULEN:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus notulen' });
    }
};

// POST /api/notulen/:id/peserta — simpan daftar kehadiran (ganti total)
export const savePeserta = async (req, res) => {
    try {
        const result = await savePesertaService(req.params.id, req.body.items, getLembaga(req));
        return res.status(200).json({ success: true, data: result, message: `Kehadiran tersimpan (${result.count} peserta)` });
    } catch (error) {
        console.error('EROR SAVE PESERTA:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan daftar kehadiran' });
    }
};

// POST /api/notulen/:id/pembahasan
export const createPembahasan = async (req, res) => {
    try {
        const result = await createPembahasanService(req.params.id, req.body, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Poin pembahasan ditambahkan' });
    } catch (error) {
        console.error('EROR CREATE PEMBAHASAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan poin pembahasan' });
    }
};

// PUT /api/notulen/pembahasan/:id
export const updatePembahasan = async (req, res) => {
    try {
        const ok = await updatePembahasanService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Poin pembahasan tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Poin pembahasan diubah' });
    } catch (error) {
        console.error('EROR UPDATE PEMBAHASAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah poin pembahasan' });
    }
};

// DELETE /api/notulen/pembahasan/:id
export const deletePembahasan = async (req, res) => {
    try {
        const ok = await deletePembahasanService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Poin pembahasan tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Poin pembahasan dihapus' });
    } catch (error) {
        console.error('EROR DELETE PEMBAHASAN:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus poin pembahasan' });
    }
};

// POST /api/notulen/:id/tindak-lanjut
export const createTindakLanjut = async (req, res) => {
    try {
        const result = await createTindakLanjutService(req.params.id, req.body, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Tindak lanjut ditambahkan' });
    } catch (error) {
        console.error('EROR CREATE TINDAK LANJUT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan tindak lanjut' });
    }
};

// PUT /api/notulen/tindak-lanjut/:id
export const updateTindakLanjut = async (req, res) => {
    try {
        const ok = await updateTindakLanjutService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Tindak lanjut tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Tindak lanjut diubah' });
    } catch (error) {
        console.error('EROR UPDATE TINDAK LANJUT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah tindak lanjut' });
    }
};

// DELETE /api/notulen/tindak-lanjut/:id
export const deleteTindakLanjut = async (req, res) => {
    try {
        const ok = await deleteTindakLanjutService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Tindak lanjut tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Tindak lanjut dihapus' });
    } catch (error) {
        console.error('EROR DELETE TINDAK LANJUT:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus tindak lanjut' });
    }
};

// GET /api/notulen/tindak-lanjut — tracker global
export const getTindakLanjut = async (req, res) => {
    try {
        const data = await getTindakLanjutService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, ...data });
    } catch (error) {
        console.error('EROR GET TINDAK LANJUT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data tindak lanjut' });
    }
};

// POST /api/notulen/:id/lampiran — upload berkas (multer single 'file')
export const createLampiran = async (req, res) => {
    try {
        const result = await createLampiranService(req.params.id, req.file, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Lampiran terunggah' });
    } catch (error) {
        console.error('EROR CREATE LAMPIRAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengunggah lampiran' });
    }
};

// DELETE /api/notulen/lampiran/:id
export const deleteLampiran = async (req, res) => {
    try {
        const ok = await deleteLampiranService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Lampiran tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Lampiran dihapus' });
    } catch (error) {
        console.error('EROR DELETE LAMPIRAN:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus lampiran' });
    }
};

export { KATEGORI_RAPAT, STATUS_NOTULEN, KEHADIRAN_PESERTA, STATUS_TINDAK_LANJUT };