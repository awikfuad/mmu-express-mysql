import {
    getKelulusanService,
    getKelulusanRosterService,
    createKelulusanService,
    updateKelulusanService,
    deleteKelulusanService,
    getAlumniService,
    updateAlumniService,
    deleteAlumniService,
    JENIS_KELULUSAN
} from '../services/kelulusanService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();
const getActor = (req) => (req.user?.name || req.user?.username || '');

// ============ KELULUSAN / MUTASI ============

export const getKelulusan = async (req, res) => {
    try {
        const data = await getKelulusanService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET KELULUSAN:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data kelulusan' });
    }
};

export const getKelulusanRoster = async (req, res) => {
    try {
        const data = await getKelulusanRosterService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET KELULUSAN ROSTER:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat roster santri' });
    }
};

export const createKelulusan = async (req, res) => {
    try {
        const result = await createKelulusanService(req.body, getLembaga(req), getActor(req));
        return res.status(201).json({ success: true, data: result, message: 'Status kelulusan/mutasi tersimpan' });
    } catch (error) {
        console.error('EROR CREATE KELULUSAN:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan status kelulusan' });
    }
};

export const updateKelulusan = async (req, res) => {
    try {
        const ok = await updateKelulusanService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Catatan tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Catatan kelulusan diubah' });
    } catch (error) {
        console.error('EROR UPDATE KELULUSAN:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah catatan' });
    }
};

export const deleteKelulusan = async (req, res) => {
    try {
        const ok = await deleteKelulusanService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Catatan tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Catatan dihapus & status santri dipulihkan' });
    } catch (error) {
        console.error('EROR DELETE KELULUSAN:', error.message);
        return res.status(500).json({ success: false, message: 'Gagal menghapus catatan' });
    }
};

// ============ ALUMNI ============

export const getAlumni = async (req, res) => {
    try {
        const data = await getAlumniService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET ALUMNI:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data alumni' });
    }
};

export const updateAlumni = async (req, res) => {
    try {
        const ok = await updateAlumniService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Alumni tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Data alumni diubah' });
    } catch (error) {
        console.error('EROR UPDATE ALUMNI:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah data alumni' });
    }
};

export const deleteAlumni = async (req, res) => {
    try {
        const ok = await deleteAlumniService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Alumni tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Alumni dihapus' });
    } catch (error) {
        console.error('EROR DELETE ALUMNI:', error.message);
        return res.status(500).json({ success: false, message: 'Gagal menghapus alumni' });
    }
};

export { JENIS_KELULUSAN };