import {
    getPiketGuruService,
    savePiketGuruSlotService,
    deletePiketGuruService
} from '../services/piketGuruService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/piket-guru
export const getPiketGuru = async (req, res) => {
    try {
        const data = await getPiketGuruService(getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET JADWAL PIKET GURU:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat jadwal piket guru' });
    }
};

// POST /api/piket-guru — simpan/replace satu slot (hari+jam) dgn satu baris per guru piket
export const savePiketGuruSlot = async (req, res) => {
    try {
        const result = await savePiketGuruSlotService(req.body, getLembaga(req));
        const msg = result.count > 0
            ? `Jadwal piket guru ${result.day_of_week} ${result.start_time}-${result.end_time} berhasil disimpan (${result.count} guru)`
            : `Slot piket ${result.day_of_week} ${result.start_time}-${result.end_time} telah dikosongkan`;
        return res.status(200).json({ success: true, data: result, message: msg });
    } catch (error) {
        console.error('EROR SIMPAN JADWAL PIKET GURU:', error);
        return res.status(error.status || 400).json({ success: false, message: error.message || 'Gagal menyimpan jadwal piket guru' });
    }
};

// DELETE /api/piket-guru/:id — hapus satu baris (satu guru dari slot)
export const deletePiketGuruRow = async (req, res) => {
    try {
        const ok = await deletePiketGuruService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Baris piket guru tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Baris piket guru berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE JADWAL PIKET GURU:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus baris piket guru' });
    }
};