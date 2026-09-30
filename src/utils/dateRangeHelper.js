// Bantu resolusi & validasi rentang tanggal (YYYY-MM-DD) untuk laporan/filter.
// Mengembalikan null bila tidak ada rentang diminta (pakai fallback bulan). Tidak boleh mengubah properti lain.

const isDateValid = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

// Validasi & resolve `{tanggal_mulai, tanggal_selesai}`.
export const resolveDateRange = ({ tanggal_mulai, tanggal_selesai }) => {
    const mulai = tanggal_mulai ? String(tanggal_mulai).trim() : null;
    const selesai = tanggal_selesai ? String(tanggal_selesai).trim() : null;

    if (!mulai && !selesai) return null;
    if (!mulai || !selesai) throw new Error('Tentukan tanggal mulai DAN tanggal akhir bersamaan');
    if (!isDateValid(mulai) || !isDateValid(selesai)) {
        throw new Error('Format tanggal tidak valid! Gunakan YYYY-MM-DD (rentang 2000-2100)');
    }
    if (mulai > selesai) throw new Error('Tanggal mulai tidak boleh lewat dari tanggal akhir');

    return { tanggal_mulai: mulai, tanggal_selesai: selesai };
};

// Label ringkas untuk tampilan "dari ... s/d ..."
export const formatRangeLabel = (range) =>
    range ? `${range.tanggal_mulai} s/d ${range.tanggal_selesai}` : null;

// Tambah 1 hari pada format YYYY-MM-DD (aritmetika UTC murni agar tidak tergeser zona
// waktu mesin — parse lokal + toISOString bisa membuat tanggal tidak maju di UTC+7)
export const nextDayISO = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};