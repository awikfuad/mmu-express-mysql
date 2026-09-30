import db from '../config/db.js';
import { setLembagaCache } from '../utils/lembagaHelper.js';

// Reload cache master lembaga agar getSumber() ikut menyesuaikan setelah CRUD.
export const refreshLembagaCache = async () => {
    try {
        const result = await db.execute({
            sql: "SELECT id, kode, nama, sumber, keterangan, urutan, is_system, aktif FROM lembaga ORDER BY id ASC",
            args: []
        });
        setLembagaCache(result.rows || []);
    } catch (e) {
        console.error('❌ Gagal refresh cache lembaga:', e.message);
    }
};

// Fallback statik bila DB belum siap / gagal dibaca — identik dgn seed di db.js.
export const DEFAULT_LEMBAGA = [
    { id: 1, kode: 'ALL', nama: 'Semua Lembaga', sumber: '', keterangan: 'Super Admin — akses lintas lembaga', urutan: 0, is_system: 1, aktif: 1 },
    { id: 2, kode: 'MADRASAH', nama: 'Madrasah', sumber: 'madrasah', keterangan: 'Jenjang Sifir, Ibtidaiyah, Tsanawiyah', urutan: 1, is_system: 1, aktif: 1 },
    { id: 3, kode: 'TPQ', nama: "Taman Pendidikan Al-Qur'an", sumber: 'tpq', keterangan: 'Jenjang MDT TPQ', urutan: 2, is_system: 1, aktif: 1 }
];

// Ambil daftar lembaga dari tabel master (fallback ke DEFAULT_LEMBAGA bila gagal).
export const getAllLembagaService = async (opts = {}) => {
    const { aktif } = opts || {};
    try {
        let sql = "SELECT id, kode, nama, sumber, keterangan, urutan, is_system, aktif FROM lembaga";
        const args = [];
        if (aktif !== undefined && aktif !== null && aktif !== '') {
            sql += " WHERE aktif = ?";
            args.push(Number(aktif) ? 1 : 0);
        }
        sql += " ORDER BY urutan ASC, id ASC";
        const result = await db.execute({ sql, args });
        return result.rows.length ? result.rows : DEFAULT_LEMBAGA;
    } catch (e) {
        console.error('❌ Gagal membaca master lembaga (fallback ke default):', e.message);
        return DEFAULT_LEMBAGA;
    }
};

// Cari lembaga berdasarkan kode (case-insensitive).
export const getLembagaByKodeService = async (kode) => {
    const k = String(kode || '').trim().toUpperCase();
    const all = await getAllLembagaService();
    return all.find((r) => String(r.kode).toUpperCase() === k) || null;
};

// Validasi kode lembaga vs tabel master (dipakai menggantikan daftar hardcoded).
export const isLembagaValidService = async (kode) => !!(await getLembagaByKodeService(kode));

// Tambah lembaga baru (Super Admin).
export const createLembagaService = async ({ kode, nama, sumber = 'madrasah', keterangan = null, urutan = 0, aktif = 1 }) => {
    const k = String(kode || '').trim().toUpperCase();
    if (!k) throw new Error('Kode lembaga wajib diisi.');
    if (!nama || !String(nama).trim()) throw new Error('Nama lembaga wajib diisi.');
    const validSumber = ['', 'madrasah', 'tpq'];
    const s = String(sumber || '').toLowerCase();
    if (!validSumber.includes(s)) {
        // v3.40: izinkan sumber kustom aman utk SQL (mis. 'mmu44', 'mmu200') — validasi alfanumerik/underscore
        if (!/^[a-z0-9_]+$/.test(s)) throw new Error("Sumber data lembaga hanya boleh huruf, angka, atau underscore.");
    }
    if (await getLembagaByKodeService(k)) {
        throw new Error(`Lembaga dengan kode '${k}' sudah ada.`);
    }
    const result = await db.execute({
        sql: "INSERT INTO lembaga (kode, nama, sumber, keterangan, urutan, is_system, aktif) VALUES (?, ?, ?, ?, ?, 0, ?)",
        args: [k, String(nama).trim(), s, keterangan || null, Number(urutan) || 0, aktif ? 1 : 0]
    });
    await refreshLembagaCache();
    return result.lastInsertRowid;
};

// Ubah lembaga. Kode & sumber lembaga sistem tidak boleh diubah (jaga konsistensi 'ALL'/'MADRASAH'/'TPQ').
export const updateLembagaService = async (id, fields = {}) => {
    const lembagaId = Number(id);
    if (!Number.isInteger(lembagaId) || lembagaId <= 0) throw new Error('ID lembaga tidak valid');
    const existing = await db.execute({ sql: 'SELECT * FROM lembaga WHERE id = ?', args: [lembagaId] });
    if (!existing.rows.length) throw new Error('Lembaga tidak ditemukan.');
    const row = existing.rows[0];
    const isSystem = Number(row.is_system) === 1;

    const { kode, nama, sumber, keterangan, urutan, aktif } = fields || {};
    const updates = [];
    const args = [];

    if (kode !== undefined) {
        if (isSystem) throw new Error('Kode lembaga sistem tidak dapat diubah.');
        const k = String(kode).trim().toUpperCase();
        if (!k) throw new Error('Kode lembaga wajib diisi.');
        const dup = await db.execute({ sql: 'SELECT id FROM lembaga WHERE kode = ? AND id != ?', args: [k, lembagaId] });
        if (dup.rows.length) throw new Error(`Kode lembaga '${k}' sudah dipakai lembaga lain.`);
        updates.push('kode = ?');
        args.push(k);
    }
    if (nama !== undefined) {
        if (!String(nama).trim()) throw new Error('Nama lembaga wajib diisi.');
        updates.push('nama = ?');
        args.push(String(nama).trim());
    }
    if (sumber !== undefined) {
        if (isSystem) throw new Error('Sumber data lembaga sistem tidak dapat diubah.');
        const s = String(sumber || '').toLowerCase();
        if (!['', 'madrasah', 'tpq'].includes(s)) {
            // v3.40: izinkan sumber kustom aman utk SQL (mis. 'mmu44', 'mmu200')
            if (!/^[a-z0-9_]+$/.test(s)) throw new Error("Sumber data lembaga hanya boleh huruf, angka, atau underscore.");
        }
        updates.push('sumber = ?');
        args.push(s);
    }
    if (keterangan !== undefined) {
        updates.push('keterangan = ?');
        args.push(keterangan || null);
    }
    if (urutan !== undefined) {
        updates.push('urutan = ?');
        args.push(Number(urutan) || 0);
    }
    if (aktif !== undefined) {
        if (isSystem && row.kode === 'ALL') throw new Error('Lembaga ALL tidak dapat dinonaktifkan.');
        updates.push('aktif = ?');
        args.push(aktif ? 1 : 0);
    }
    if (!updates.length) return true;

    updates.push("updated_at = NOW()");
    args.push(lembagaId);
    await db.execute({ sql: `UPDATE lembaga SET ${updates.join(', ')} WHERE id = ?`, args });
    await refreshLembagaCache();
    return true;
};

// Hapus lembaga (hanya lembaga non-sistem yang tidak dipakai tabel lain).
export const deleteLembagaService = async (id) => {
    const lembagaId = Number(id);
    if (!Number.isInteger(lembagaId) || lembagaId <= 0) throw new Error('ID lembaga tidak valid');
    const existing = await db.execute({ sql: 'SELECT * FROM lembaga WHERE id = ?', args: [lembagaId] });
    if (!existing.rows.length) throw new Error('Lembaga tidak ditemukan.');
    const row = existing.rows[0];
    if (Number(row.is_system) === 1) throw new Error('Lembaga sistem (ALL/MADRASAH/TPQ) tidak dapat dihapus.');

    const tables = ['admins', 'teachers', 'students', 'schedules', 'kegiatan', 'activities', 'payment_settings',
        'accounts', 'transactions', 'salary_tariffs', 'teacher_salaries', 'kalender_pendidikan', 'pengumuman',
        'inventaris_aset', 'wali_murid', 'izin_sakit', 'izin_guru', 'pimpinan', 'piket_pimpinan',
        'piket_guru', 'presensi_pimpinan', 'year_closing_snapshots', 'parent_users', 'audit_logs'];
    const union = tables.map((t) => `SELECT 1 FROM ${t} WHERE lembaga = ?`).join(' UNION ALL ');
    const usageArgs = tables.map(() => row.kode);
    try {
        const usage = await db.execute({ sql: `SELECT COUNT(*) AS c FROM (${union}) AS usage_set`, args: usageArgs });
        if (Number(usage.rows[0]?.c || 0) > 0) {
            throw new Error(`Lembaga '${row.kode}' masih dipakai oleh data lain dan tidak dapat dihapus.`);
        }
    } catch (e) {
        if (e.message.includes('masih dipakai')) throw e;
        console.error('❌ Gagal memeriksa pemakaian lembaga:', e.message);
    }

    await db.execute({ sql: 'DELETE FROM lembaga WHERE id = ?', args: [lembagaId] });
    await refreshLembagaCache();
    return true;
};