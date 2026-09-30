import {
    getIzinGuruListService,
    getIzinGuruByIdService,
    createIzinGuruService,
    updateIzinGuruService,
    deleteIzinGuruService,
    getAffectedSchedulesService,
    assignSubstituteService,
    finishIzinGuruService
} from '../services/izinGuruService.js';

const handleError = (res, error) => {
    const status = error.status || 500;
    if (status === 500) console.error('❌ izinGuruController:', error);
    res.status(status).json({ success: false, message: error.message || 'Terjadi kesalahan pada server.' });
};

// GET /izin-guru — daftar catatan izin guru (admin, terscope lembaga)
export const getIzinGuru = async (req, res) => {
    try {
        const data = await getIzinGuruListService(req.query || {}, req.user.lembaga);
        res.json({ success: true, message: 'Daftar izin guru', count: data.length, data });
    } catch (error) {
        handleError(res, error);
    }
};

// GET /izin-guru/:id — detail satu catatan
export const getIzinGuruDetail = async (req, res) => {
    try {
        const data = await getIzinGuruByIdService(req.params.id, req.user.lembaga);
        res.json({ success: true, data });
    } catch (error) {
        handleError(res, error);
    }
};

// POST /izin-guru — buat catatan izin guru
export const createIzinGuru = async (req, res) => {
    try {
        const result = await createIzinGuruService(req.body, req.user.lembaga, req.user.name);
        res.status(201).json({ success: true, message: result.message, id: result.id });
    } catch (error) {
        handleError(res, error);
    }
};

// PUT /izin-guru/:id — ubah catatan izin
export const updateIzinGuru = async (req, res) => {
    try {
        const result = await updateIzinGuruService(req.params.id, req.body, req.user.lembaga);
        res.json({ success: true, message: result.message });
    } catch (error) {
        handleError(res, error);
    }
};

// DELETE /izin-guru/:id — hapus catatan izin
export const deleteIzinGuru = async (req, res) => {
    try {
        const result = await deleteIzinGuruService(req.params.id, req.user.lembaga);
        res.json({ success: true, message: result.message });
    } catch (error) {
        handleError(res, error);
    }
};

// GET /izin-guru/:id/jadwal-terdampak — jadwal mengajar guru selama periode izin + status badal
export const getAffectedSchedules = async (req, res) => {
    try {
        const data = await getAffectedSchedulesService(req.params.id, req.user.lembaga);
        res.json({ success: true, ...data });
    } catch (error) {
        handleError(res, error);
    }
};

// POST /izin-guru/:id/pengganti — tunjuk/hapus badal {schedule_id, tanggal, substitute_teacher_id|null}
export const assignSubstitute = async (req, res) => {
    try {
        const result = await assignSubstituteService(req.params.id, req.body, req.user.lembaga);
        res.json({ success: true, message: result.message });
    } catch (error) {
        handleError(res, error);
    }
};

// PUT /izin-guru/:id/selesai — tandai selesai + bersihkan semua badal terkait
export const finishIzinGuru = async (req, res) => {
    try {
        const result = await finishIzinGuruService(req.params.id, req.user.lembaga);
        res.json({ success: true, message: result.message });
    } catch (error) {
        handleError(res, error);
    }
};
