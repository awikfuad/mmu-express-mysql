import {
    getPengumumanService,
    createPengumumanService,
    updatePengumumanService,
    setPublishPengumumanService,
    deletePengumumanService,
    getPublishedPengumumanService
} from '../services/pengumumanService.js';

// GET /pengumuman — daftar pengumuman (admin/teacher, terscope lembaga)
export const getPengumuman = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const rows = await getPengumumanService(req.query, lembaga);
        return res.json({ success: true, data: rows });
    } catch (error) {
        if (error.message && /tidak valid/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// GET /pengumuman/published — papan pengumuman yang sedang tayang (semua role)
export const getPublishedPengumuman = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const limit = req.query.limit || 20;
        const rows = await getPublishedPengumumanService(lembaga, limit);
        return res.json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /pengumuman — simpan pengumuman (admin/teacher)
export const createPengumuman = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const result = await createPengumumanService(req.body, lembaga, req.user?.name);
        return res.status(201).json({ success: true, id: result.id, message: 'Pengumuman berhasil disimpan' });
    } catch (error) {
        if (error.message && /tidak valid|wajib|tidak boleh/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// PUT /pengumuman/:id — ubah pengumuman (admin/teacher)
export const updatePengumuman = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const ok = await updatePengumumanService(req.params.id, req.body, lembaga, req.user?.name);
        if (!ok) {
            return res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan atau bukan milik lembaga Anda' });
        }
        return res.json({ success: true, message: 'Pengumuman berhasil diubah' });
    } catch (error) {
        if (error.message && /tidak valid|wajib|tidak boleh/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// PUT /pengumuman/:id/publish — publish/unpublish cepat
export const publishPengumuman = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const ok = await setPublishPengumumanService(req.params.id, req.body.is_published, lembaga);
        if (!ok) {
            return res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan atau bukan milik lembaga Anda' });
        }
        return res.json({ success: true, message: req.body.is_published ? 'Pengumuman ditayangkan' : 'Pengumuman dijadikan draf' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE /pengumuman/:id — hapus pengumuman (admin)
export const deletePengumuman = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const ok = await deletePengumumanService(req.params.id, lembaga);
        if (!ok) {
            return res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan atau bukan milik lembaga Anda' });
        }
        return res.json({ success: true, message: 'Pengumuman berhasil dihapus' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
