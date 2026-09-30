import db from '../config/db.js';

// =============================================================================
// PENGATURAN MODUL (menu yang aktif + lembaga yang boleh akses tiap modul)
// Hanya Super Admin (lembaga 'ALL') yang mengubah konfigurasi.
// =============================================================================

// Kunci modul yang tidak boleh dinonaktifkan — mencegah Super Admin terkunci diri sendiri.
const PROTECTED_KEYS = ['modul-setting', 'home'];

export const parseLembagaAccess = (raw) => {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map((k) => String(k).toUpperCase()).filter(Boolean) : [];
    } catch {
        return [];
    }
};

// Ambil seluruh baris konfigurasi modul (url katalog default bila tabel masih kosong).
export const getAllModulSettingsService = async () => {
    const result = await db.execute({
        sql: "SELECT modul_key, nama, icon, grup, grup_title, is_active, lembaga_access FROM modul_settings ORDER BY grup ASC, id ASC",
        args: []
    });
    return (result.rows || []).map((r) => ({
        modul_key: r.modul_key,
        nama: r.nama,
        icon: r.icon || 'mdi-circle-outline',
        grup: r.grup || '',
        grup_title: r.grup_title || '',
        is_active: Number(r.is_active) === 1 ? 1 : 0,
        lembaga_access: parseLembagaAccess(r.lembaga_access)
    }));
};

// Perbarui konfigurasi satu modul (Super Admin).
// { is_active?: 1|0, lembaga_access?: string[] } — kirim lembaga_access []/null = semua lembaga boleh akses.
export const updateModulSettingService = async (modulKey, { is_active, lembaga_access }) => {
    const key = String(modulKey || '').trim();
    if (!key) throw new Error('Kunci modul wajib diisi.');

    const existing = await db.execute({
        sql: "SELECT modul_key FROM modul_settings WHERE modul_key = ?",
        args: [key]
    });
    if (!existing.rows || existing.rows.length === 0) {
        throw new Error(`Modul "${key}" tidak ditemukan di katalog.`);
    }

    if (PROTECTED_KEYS.includes(key) && is_active !== undefined && Number(is_active) === 0) {
        throw new Error(`Modul "${key}" tidak boleh dinonaktifkan.`);
    }

    const sets = [];
    const args = [];
    if (is_active !== undefined && is_active !== null && is_active !== '') {
        sets.push('is_active = ?');
        args.push(Number(is_active) ? 1 : 0);
    }
    if (lembaga_access !== undefined) {
        const arr = Array.isArray(lembaga_access) ? lembaga_access.map((k) => String(k).trim().toUpperCase()).filter(Boolean) : [];
        sets.push('lembaga_access = ?');
        args.push(arr.length ? JSON.stringify([...new Set(arr)]) : null);
    }
    if (sets.length === 0) {
        throw new Error('Tidak ada field yang dikirim untuk diperbarui.');
    }

    sets.push('updated_at = CURRENT_TIMESTAMP');
    args.push(key);
    await db.execute({
        sql: `UPDATE modul_settings SET ${sets.join(', ')} WHERE modul_key = ?`,
        args
    });
    return { modul_key: key };
};

// Daftar modul yang boleh dilihat user (berdasar lembaga user).
// - configured_keys: seluruh kunci yang terdaftar di tabel (subset sidebar utk filtering)
// - active_keys     : kunci yang aktif DAN diizinkan utk lembaga user
//   Semantik:
//   * is_active = 0        → disembunyikan utk semua
//   * lembaga_access kosong → semua lembaga boleh akses
//   * lembaga_access terisi → hanya lembaga tsb (Super Admin 'ALL' tetap boleh)
export const getActiveModulKeysService = async (userLembaga) => {
    const rows = await getAllModulSettingsService();
    const lembaga = String(userLembaga || 'ALL').toUpperCase();
    const active = rows
        .filter((r) => {
            if (Number(r.is_active) !== 1) return false;
            if (r.lembaga_access.length === 0) return true;
            if (lembaga === 'ALL') return true;
            return r.lembaga_access.includes(lembaga);
        })
        .map((r) => r.modul_key);
    return {
        configured_keys: rows.map((r) => r.modul_key),
        active_keys: active
    };
};