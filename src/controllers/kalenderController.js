import {
    getKalenderService,
    createKalenderService,
    updateKalenderService,
    deleteKalenderService,
    getTahunHijriyahService,
    getKalenderGridService
} from '../services/kalenderService.js';

// GET /kalender — daftar agenda kalender pendidikan (terscope lembaga)
export const getKalender = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const rows = await getKalenderService(req.query, lembaga);
        return res.json({ success: true, data: rows });
    } catch (error) {
        if (error.message && /tidak valid/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /kalender — simpan agenda (admin/teacher)
export const createKalender = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const result = await createKalenderService(req.body, lembaga);
        return res.status(201).json({ success: true, id: result.id, message: 'Agenda kalender berhasil disimpan' });
    } catch (error) {
        if (error.message && /tidak valid|wajib|tidak boleh/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// PUT /kalender/:id — ubah agenda (admin/teacher)
export const updateKalender = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const ok = await updateKalenderService(req.params.id, req.body, lembaga);
        if (!ok) {
            return res.status(404).json({ success: false, message: 'Agenda tidak ditemukan atau bukan milik lembaga Anda' });
        }
        return res.json({ success: true, message: 'Agenda kalender berhasil diubah' });
    } catch (error) {
        if (error.message && /tidak valid|wajib|tidak boleh/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE /kalender/:id — hapus agenda (admin)
export const deleteKalender = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const ok = await deleteKalenderService(req.params.id, lembaga);
        if (!ok) {
            return res.status(404).json({ success: false, message: 'Agenda tidak ditemukan atau bukan milik lembaga Anda' });
        }
        return res.json({ success: true, message: 'Agenda kalender berhasil dihapus' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// GET /kalender/tahun-hijriyah?academic_year_id= — label tahun pelajaran Hijriyah
export const getTahunHijriyah = async (req, res) => {
    try {
        const data = await getTahunHijriyahService(req.query.academic_year_id);
        return res.json({ success: true, data });
    } catch (error) {
        if (error.message && /tidak ditemukan/i.test(error.message)) {
            return res.status(404).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// GET /kalender/grid?hijri_year=&hijri_month=&academic_year_id= — grid bulan Hijriyah
export const getKalenderGrid = async (req, res) => {
    try {
        const lembaga = req.user?.lembaga || 'ALL';
        const data = await getKalenderGridService(req.query, lembaga);
        return res.json({ success: true, data });
    } catch (error) {
        if (error.message && /tidak valid/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};
