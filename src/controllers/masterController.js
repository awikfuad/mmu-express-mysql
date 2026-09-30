import {
    getAllAcademicYearsService,
    createAcademicYearService,
    updateAcademicYearService,
    activateAcademicYearService,
    deleteAcademicYearService,
    getAllJenjangService,
    createJenjangService,
    updateJenjangService,
    deleteJenjangService,
    getAllRombelService,
    createRombelService,
    updateRombelService,
    deleteRombelService,
    getAllSubjectsService,
    createSubjectService,
    updateSubjectService,
    deleteSubjectService
} from '../services/masterService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

const isSuperAdmin = (req) => getLembaga(req) === 'ALL';

const handle = (fn) => async (req, res) => {
    try {
        const data = await fn(req);
        return res.json({ success: true, data });
    } catch (error) {
        console.error('EROR MASTER:', error);
        return res.status(400).json({ success: false, message: error.message || 'Terjadi kesalahan' });
    }
};

// ============ TAHUN AJARAN (CRUD hanya Super Admin) ============
export const requireSuperAdmin = (fn, message) => async (req, res) => {
    if (!isSuperAdmin(req)) {
        return res.status(403).json({ success: false, message: message || 'Hanya Super Admin yang dapat melakukan operasi ini.' });
    }
    return fn(req, res);
};
export const getAllAcademicYears = async (req, res) => {
    try {
        const data = await getAllAcademicYearsService();
        return res.json({ success: true, data });
    } catch (error) {
        console.error('EROR GET ACADEMIC YEARS:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat tahun ajaran' });
    }
};
export const createAcademicYear = requireSuperAdmin(async (req, res) => {
    try {
        const data = await createAcademicYearService(req.body);
        return res.status(201).json({ success: true, data, message: 'Tahun ajaran berhasil ditambahkan' });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
});
export const updateAcademicYear = requireSuperAdmin(async (req, res) => {
    try {
        await updateAcademicYearService(req.params.id, req.body);
        return res.json({ success: true, message: 'Tahun ajaran berhasil diubah' });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
});
export const activateAcademicYear = requireSuperAdmin(async (req, res) => {
    try {
        await activateAcademicYearService(req.params.id);
        return res.json({ success: true, message: 'Tahun ajaran berhasil diaktifkan' });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
});
export const deleteAcademicYear = requireSuperAdmin(async (req, res) => {
    try {
        const ok = await deleteAcademicYearService(req.params.id);
        if (!ok) return res.status(404).json({ success: false, message: 'Tahun ajaran tidak ditemukan' });
        return res.json({ success: true, message: 'Tahun ajaran berhasil dihapus' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Gagal menghapus tahun ajaran' });
    }
});

// ============ JENJANG ============
export const getAllJenjang = async (req, res) => {
    try {
        const data = await getAllJenjangService(getLembaga(req));
        return res.json({ success: true, data });
    } catch (error) {
        console.error('EROR GET JENJANG:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat jenjang' });
    }
};
export const createJenjang = handle(async (req) => createJenjangService(req.body, getLembaga(req)));
export const updateJenjang = handle(async (req) => updateJenjangService(req.params.id, req.body, getLembaga(req)));
export const deleteJenjang = handle(async (req) => deleteJenjangService(req.params.id, getLembaga(req)));

// ============ ROMBEL ============
export const getAllRombel = async (req, res) => {
    try {
        const data = await getAllRombelService(getLembaga(req));
        return res.json({ success: true, data });
    } catch (error) {
        console.error('EROR GET ROMBEL:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat rombel' });
    }
};
export const createRombel = handle(async (req) => createRombelService(req.body, getLembaga(req)));
export const updateRombel = handle(async (req) => updateRombelService(req.params.id, req.body, getLembaga(req)));
export const deleteRombel = handle(async (req) => deleteRombelService(req.params.id, getLembaga(req)));

// ============ SUBJEK ============
export const getAllSubjects = async (req, res) => {
    try {
        const data = await getAllSubjectsService(getLembaga(req));
        return res.json({ success: true, data });
    } catch (error) {
        console.error('EROR GET SUBJECTS:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat mata pelajaran' });
    }
};
export const createSubject = handle(async (req) => createSubjectService(req.body, getLembaga(req)));
export const updateSubject = handle(async (req) => updateSubjectService(req.params.id, req.body, getLembaga(req)));
export const deleteSubject = handle(async (req) => deleteSubjectService(req.params.id, getLembaga(req)));
