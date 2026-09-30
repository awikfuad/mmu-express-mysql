// Helper lembaga: memetakan lembaga user ke sumber tabel data via master `lembaga` table.
// v3.40: sumber di-resolve dari cache master lembaga (bukan hardcode 'madrasah'/'tpq').
// Cache diisi saat startup (db.js) & diperbarui saat CRUD lembaga (lembagaService).

export const LEMBAGA = {
    ALL: 'ALL',
    MADRASAH: 'MADRASAH',
    TPQ: 'TPQ'
};

// --- In-memory cache: kode (UPPERCASE) → { id, kode, sumber, nama, ... } ---
// Diisi dari tabel `lembaga` saat startup, diperbarui saat CRUD.
let _lembagaCache = []; // array of rows dari SELECT * FROM lembaga
let _lembagaMap = new Map(); // kode(UPPER) → row

export const setLembagaCache = (rows) => {
    _lembagaCache = rows || [];
    _lembagaMap.clear();
    for (const row of _lembagaCache) {
        if (row && row.kode) _lembagaMap.set(String(row.kode).toUpperCase(), row);
    }
};

export const getLembagaCache = () => _lembagaCache;

// Reverse lookup: dari nilai kolom `sumber` → kode lembaga (mis. 'mmu44' → 'MMU44', 'tpq' → 'TPQ').
// Fallback legacy bila cache belum memuat sumber tsb.
export const getLembagaKodeBySumber = (sumber) => {
    const src = String(sumber || '').toLowerCase();
    if (!src) return null;
    const row = _lembagaCache.find((r) => String(r.sumber || '').toLowerCase() === src);
    if (row && row.kode) return String(row.kode).toUpperCase();
    if (src === 'tpq') return LEMBAGA.TPQ;
    if (src === 'madrasah') return LEMBAGA.MADRASAH;
    return null;
};

// Cek apakah user diperbolehkan melihat data lembaga tertentu
export const canAccessLembaga = (userLembaga, targetLembaga) => {
    const lembaga = (userLembaga || 'ALL').toUpperCase();
    if (lembaga === LEMBAGA.ALL) return true;
    return lembaga === targetLembaga;
};

// Ambil lembaga dari req.user
export const getLembaga = (req) => (req.user && req.user.lembaga ? req.user.lembaga.toUpperCase() : LEMBAGA.ALL);

// Resolve sumber dari master lembaga cache berdasarkan kode (case-insensitive).
// Fallback ke hardcode lama jika cache belum terisi / kode tak dikenal.
const resolveSumber = (kode) => {
    const k = String(kode || '').toUpperCase();
    const row = _lembagaMap.get(k);
    if (row && row.sumber != null && row.sumber !== '') return String(row.sumber).toLowerCase();
    // Fallback legacy: TPQ → 'tpq', lainnya → 'madrasah'
    return k === LEMBAGA.TPQ ? 'tpq' : 'madrasah';
};

// Konfigurasi sumber tabel per lembaga (nama tabel & alias yang dipakai di query)
// v3.0: tabel penempatan & biodata santri kini TUNGGAL (santri_penempatan / santri_biodata),
// dibedakan lewat kolom `sumber` — resolves dari master `lembaga` table (v3.40).
export const getSumber = (lembaga) => {
    const l = (lembaga || 'ALL').toUpperCase();
    const isAll = l === LEMBAGA.ALL;
    const sumber = isAll ? '' : resolveSumber(l);
    const isTpq = sumber === 'tpq';
    return {
        lembaga: l,
        isAll,
        isTpq,
        // Nilai kolom sumber utk INSERT/scope (ALL → default 'madrasah' backward-compat)
        sumber: isAll ? 'madrasah' : sumber,
        // Tabel master santri (penempatan kelas) — gabungan semua lembaga
        santriTable: 'santri_penempatan',
        // Tabel data induk santri — gabungan
        masterTable: 'santri_biodata',
        // v3.1: tabel kelas & rombel kini TUNGGAL (classes / rombels), dibedakan via kolom `sumber`.
        kelasTable: 'classes',
        rombelTable: 'rombels',
        // Ekspresi scope kolom `sumber` utk tabel classes/rombels ('' bila ALL).
        kelasFilter: isAll ? '' : `sumber = '${sumber}'`,
        rombelFilter: isAll ? '' : `sumber = '${sumber}'`,
        // Ekspresi SQL utk membatasi ke lembaga scoped ('' bila ALL).
        sumberFilter: isAll ? '' : `sumber = '${sumber}'`
    };
};

// Bangun klausa sumber dengan alias opsional, misal sumberWhere(s, 'sp') → "sp.sumber = 'mmu44'"
export const sumberWhere = (s, alias = '') => {
    if (!s || s.isAll || !s.sumber) return '';
    const a = alias ? `${alias}.` : '';
    return `${a}sumber = '${s.sumber}'`;
};
