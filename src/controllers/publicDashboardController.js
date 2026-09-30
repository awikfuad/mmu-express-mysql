import { getPublicDailyService, resolveLembagaFromGoogleService } from '../services/publicDashboardService.js';

// Endpoint publik dashboard harian (kiosk pre-login) — tanpa token.
// Menerima `?date=YYYY-MM-DD` opsional (tanggal lokal perangkat kiosk)
// agar penentuan hari & filter tanggal konsisten dgn klien (bukan server UTC),
// dan `?lembaga=MADRASAH|TPQ|...` opsional utk scoping per lembaga (default semua).
export const getPublicDaily = async (req, res) => {
    try {
        const data = await getPublicDailyService({ date: req.query.date, lembaga: req.query.lembaga });
        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ Gagal memuat dashboard harian publik:', error.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat memuat dashboard harian' });
    }
};

// Endpoint publik: resolve lembaga kiosk dari idToken Google (v3.36).
// Menerima `{ idToken }` → verifikasi Google → cari akun tertaut (google_sub) →
// kembalikan `{ lembaga, nama, sumber, role, account_id }` utk menentukan
// lembaga yang ditampilkan kiosk. Belum tertaut → 401 { needLink: true }.
export const resolveLembagaGoogle = async (req, res) => {
    try {
        const result = await resolveLembagaFromGoogleService(req.body.idToken);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('❌ Gagal resolve lembaga dari Google:', error.message);
        res.status(error.status || 500).json({
            success: false,
            message: error.message || 'Terjadi kesalahan saat menentukan lembaga',
            ...(error.needLink ? { needLink: true } : {})
        });
    }
};
