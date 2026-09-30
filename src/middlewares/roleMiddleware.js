import db from '../config/db.js';

export const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        // 1. Pastikan data user dari verifyToken sudah ada
        if (!req.user || !req.user.role) {
            return res.status(401).json({ 
                success: false, 
                message: 'Tidak ada hak akses, autentikasi diperlukan.' 
            });
        }

        // 2. Cek apakah role user saat ini ada di dalam daftar role yang diizinkan
        // req.user.role didapatkan dari payload JWT yang kita decode di verifyToken
        const hasPermission = allowedRoles.includes(req.user.role);

        if (!hasPermission) {
            return res.status(403).json({ 
                success: false, 
                message: `Akses ditolak! Anda login sebagai '${req.user.role}', halaman ini khusus untuk [${allowedRoles.join(', ')}].` 
            });
        }

        // 3. Jika role sesuai, lolos! Lanjut ke proses berikutnya
        next();
    };
};

// Cek apakah guru yang login juga terdaftar sebagai pimpinan aktif (guru merangkap pimpinan).
// Pimpinan diambil dari tabel `pimpinan` yang menunjuk `teachers.id` via kolom teacher_id.
// Mengembalikan objek pimpinan (jabatan dll) bila guru adalah pimpinan aktif, selain itu null.
export const isPimpinanUser = async (req) => {
    if (req.user?.role !== 'teacher' || !req.user?.id) return null;

    const lembaga = (req.user.lembaga || 'ALL').toUpperCase();
    const args = [Number(req.user.id)];
    let scope = '';
    if (lembaga !== 'ALL') {
        scope = ' AND (p.lembaga = ? OR p.lembaga = "ALL")';
        args.push(lembaga);
    }

    const result = await db.execute({
        sql: `SELECT id, nama, jabatan FROM pimpinan p
              WHERE p.teacher_id = ? AND p.aktif = 1${scope} LIMIT 1`,
        args
    });
    return result.rows[0] || null;
};

// Middleware: izinkan admin ATAU guru yang merangkap pimpinan aktif.
// Dipakai untuk fitur pimpinan (izin guru, absen guru KBM, izin murid, pengumuman, kegiatan).
export const authorizeAdminOrPimpinan = async (req, res, next) => {
    if (!req.user || !req.user.role) {
        return res.status(401).json({
            success: false,
            message: 'Tidak ada hak akses, autentikasi diperlukan.'
        });
    }

    if (req.user.role === 'admin') return next();

    if (req.user.role === 'teacher') {
        // 1. Cek flag is_pimpinan dari JWT (sudah diverifikasi saat login/refresh)
        if (req.user.is_pimpinan === true) return next();

        // 2. Fallback: cek DB langsung (untuk kasus JWT belum punya flag tapi DB sudah ada)
        try {
            const pimpinan = await isPimpinanUser(req);
            if (pimpinan) return next();
        } catch (error) {
            console.error('PIMPINAN_CHECK ERROR:', error);
        }
    }

    return res.status(403).json({
        success: false,
        message: 'Akses ditolak! Fitur ini khusus admin / pimpinan madrasah.'
    });
};