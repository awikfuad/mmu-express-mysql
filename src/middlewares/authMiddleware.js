import { response } from 'express';
import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
    // 1. Ambil token dari header 'Authorization'
    const authHeader = req.headers['authorization'];

    // Format header biasanya: "Bearer <token_rahasia_disini>"
    const token = authHeader && authHeader.split(' ')[1];

    // Jika token tidak disertakan
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Akses ditolak! Token autentikasi tidak ditemukan.'
        });
    }

    try {
        // 2. Verifikasi token digital menggunakan Secret Key di .env
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3. Simpan data user yang login (id, role, name) ke dalam objek 'req'
        // Supaya controller di baris berikutnya bisa tahu siapa yang sedang mengakses
        req.user = decoded;

        // 4. Lolos pengecekan! Lanjut ke controller/proses berikutnya
        next();
    } catch (error) {
        // Jika token kedaluwarsa atau dimanipulasi
        return res.status(403)
            .json({ success: false, message: 'Token tidak valid atau sudah kedaluwarsa. Silakan login ulang.' });
    }
}