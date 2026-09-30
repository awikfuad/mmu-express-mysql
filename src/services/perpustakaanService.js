import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Ambil lembaga & sumber tabel (madrasah/tpq)
const getContext = (lembaga) => {
    const s = getSumber(lembaga);
    return {
        lembaga: s.lembaga,
        isAll: s.isAll,
        isTpq: s.isTpq,
        sumber: s.sumber
    };
};

export const KATEGORI_BUKU = [
    'KITAB', 'FIQIH', 'HADITS', 'AQIDAH', 'AKHLAK', 'SEJARAH', 'BAHASA', 'UMUM', 'LAINNYA'
];

export const ANGGOTA_TYPE = ['SANTRI', 'GURU', 'TAMU'];

export const STATUS_SIRKULASI = ['DIPINJAM', 'DIKEMBALIKAN'];

export const STATUS_DENDA = ['BELUM_LUNAS', 'LUNAS'];

const toUpper = (v) => (v ? String(v).toUpperCase() : null);

const toClean = (v) => (v === undefined || v === null ? null : String(v).trim() || null);

const isValidDate = (v) => {
    const s = String(v || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00`);
    return !Number.isNaN(d.getTime());
};

const pad2 = (n) => String(n).padStart(2, '0');

const todayLocalISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// Tambah N hari ke tanggal 'YYYY-MM-DD' (aritmetika lokal aman zona waktu)
const addDays = (dateStr, days) => {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

// Selisih hari (to - from) berbasis UTC tengah hari
const daysBetween = (from, to) => {
    const f = new Date(`${from}T12:00:00`);
    const t = new Date(`${to}T12:00:00`);
    return Math.round((t - f) / 86400000);
};

// Resolve setting perpustakaan: lembaga -> ALL -> default (1000/hari, 7 hari)
const getSettings = async (ctx) => {
    const result = await db.execute({
        sql: ctx.isAll
            ? `SELECT tarif_denda_harian, lama_pinjam_hari FROM perpus_settings ORDER BY lembaga = ? DESC, id ASC LIMIT 1`
            : `SELECT tarif_denda_harian, lama_pinjam_hari FROM perpus_settings WHERE lembaga IN (?, ?) ORDER BY lembaga = ? DESC, id ASC LIMIT 1`,
        args: ctx.isAll ? [ctx.lembaga] : [ctx.lembaga, 'ALL', ctx.lembaga]
    });
    const row = result.rows[0];
    return {
        tarif_denda_harian: row && row.tarif_denda_harian != null ? Number(row.tarif_denda_harian) : 1000,
        lama_pinjam_hari: row && row.lama_pinjam_hari != null ? Number(row.lama_pinjam_hari) : 7
    };
};

// ==================== KATALOG BUKU / KITAB ====================

// List katalog (filter kategori/cari/tersedia, terscope lembaga)
export const getKatalogService = async ({ kategori, search, tersedia }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (kategori) {
        const kategoriFinal = toUpper(kategori);
        if (!KATEGORI_BUKU.includes(kategoriFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_BUKU.join(', ')}`);
        conditions.push('bk.kategori_buku = ?');
        args.push(kategoriFinal);
    }
    if (search && String(search).trim()) {
        conditions.push('(bk.judul LIKE ? OR bk.penulis LIKE ? OR bk.kode_buku LIKE ? OR bk.penerbit LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like, like, like);
    }
    if (!ctx.isAll) {
        conditions.push('bk.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT bk.id, bk.kode_buku, bk.judul, bk.penulis, bk.penerbit, bk.tahun_terbit,
               bk.kategori_buku, bk.nomor_rak, bk.bahasa, bk.jumlah, bk.keterangan,
               bk.lembaga, bk.created_at,
               COUNT(CASE WHEN sp.status = 'DIPINJAM' THEN 1 END) AS terpinjam,
               GREATEST(bk.jumlah - COUNT(CASE WHEN sp.status = 'DIPINJAM' THEN 1 END), 0) AS tersedia
        FROM buku_katalog bk
        LEFT JOIN sirkulasi_peminjaman sp ON sp.buku_id = bk.id
        ${whereClause}
        GROUP BY bk.id
        ORDER BY bk.created_at DESC, bk.id DESC
    `;
    const result = await db.execute({ sql: query, args });

    let rows = result.rows;
    if (tersedia !== undefined && tersedia !== null && tersedia !== '') {
        const filterTersedia = Number(tersedia) === 1;
        rows = rows.filter((r) => (Number(r.tersedia) > 0) === filterTersedia);
    }

    const summary = {
        total_judul: rows.length,
        total_eksemplar: rows.reduce((acc, r) => acc + (Number(r.jumlah) || 0), 0),
        total_terpinjam: rows.reduce((acc, r) => acc + (Number(r.terpinjam) || 0), 0),
        total_tersedia: rows.reduce((acc, r) => acc + (Number(r.tersedia) || 0), 0)
    };
    return { data: rows, summary };
};

// Opsi buku untuk dropdown peminjaman (terscope lembaga)
export const getBukuOptionsService = async (lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? '' : 'WHERE lembaga = ?';
    const args = ctx.isAll ? [] : [ctx.lembaga];
    const result = await db.execute({
        sql: `SELECT id, kode_buku, judul, penulis, jumlah FROM buku_katalog ${whereClause} ORDER BY judul ASC`,
        args
    });
    return result.rows;
};

// Tambah buku (admin)
export const createKatalogService = async ({ kode_buku, judul, penulis, penerbit, tahun_terbit, kategori_buku, nomor_rak, bahasa, jumlah, keterangan }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const judulFinal = toClean(judul);
    if (!judulFinal) throw new Error('Judul buku wajib diisi');

    const kategoriFinal = kategori_buku ? toUpper(kategori_buku) : 'UMUM';
    if (!KATEGORI_BUKU.includes(kategoriFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_BUKU.join(', ')}`);

    const jumlahFinal = (jumlah !== undefined && jumlah !== null && jumlah !== '') ? Number(jumlah) : 0;
    if (!Number.isInteger(jumlahFinal) || jumlahFinal < 0) throw new Error('Jumlah harus angka bulat >= 0');

    let tahunFinal = null;
    if (tahun_terbit && String(tahun_terbit).trim()) {
        const t = String(tahun_terbit).trim();
        if (!/^\d{4}$/.test(t)) throw new Error('Tahun terbit harus 4 digit (mis. 2024)');
        tahunFinal = t;
    }

    const kodeFinal = kode_buku ? toClean(kode_buku) : null;
    if (kodeFinal) {
        const existing = await db.execute({
            sql: ctx.isAll ? 'SELECT id FROM buku_katalog WHERE kode_buku = ?' : 'SELECT id FROM buku_katalog WHERE kode_buku = ? AND lembaga = ?',
            args: ctx.isAll ? [kodeFinal] : [kodeFinal, ctx.lembaga]
        });
        if (existing.rows.length > 0) throw new Error('Kode buku sudah digunakan');
    }

    const result = await db.execute({
        sql: `
            INSERT INTO buku_katalog (kode_buku, judul, penulis, penerbit, tahun_terbit, kategori_buku, nomor_rak, bahasa, jumlah, keterangan, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            kodeFinal, judulFinal, toClean(penulis), toClean(penerbit), tahunFinal,
            kategoriFinal, toClean(nomor_rak), toClean(bahasa), jumlahFinal, keterangan || null, ctx.lembaga
        ]
    });
    return { id: Number(result.lastInsertRowid) };
};

// Ubah buku (admin, SET dinamis, terscope)
export const updateKatalogService = async (id, fields = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];

    if (fields.kode_buku !== undefined) {
        const kodeFinal = fields.kode_buku ? toClean(fields.kode_buku) : null;
        if (kodeFinal) {
            const existing = await db.execute({
                sql: ctx.isAll
                    ? 'SELECT id FROM buku_katalog WHERE kode_buku = ? AND id != ?'
                    : 'SELECT id FROM buku_katalog WHERE kode_buku = ? AND id != ? AND lembaga = ?',
                args: ctx.isAll ? [kodeFinal, Number(id)] : [kodeFinal, Number(id), ctx.lembaga]
            });
            if (existing.rows.length > 0) throw new Error('Kode buku sudah digunakan');
        }
        updates.push('kode_buku = ?');
        args.push(kodeFinal);
    }
    if (fields.judul !== undefined) {
        const judulFinal = toClean(fields.judul);
        if (!judulFinal) throw new Error('Judul buku wajib diisi');
        updates.push('judul = ?');
        args.push(judulFinal);
    }
    if (fields.penulis !== undefined) {
        updates.push('penulis = ?');
        args.push(toClean(fields.penulis));
    }
    if (fields.penerbit !== undefined) {
        updates.push('penerbit = ?');
        args.push(toClean(fields.penerbit));
    }
    if (fields.tahun_terbit !== undefined) {
        let tahunFinal = null;
        if (fields.tahun_terbit && String(fields.tahun_terbit).trim()) {
            const t = String(fields.tahun_terbit).trim();
            if (!/^\d{4}$/.test(t)) throw new Error('Tahun terbit harus 4 digit (mis. 2024)');
            tahunFinal = t;
        }
        updates.push('tahun_terbit = ?');
        args.push(tahunFinal);
    }
    if (fields.kategori_buku !== undefined) {
        const kategoriFinal = fields.kategori_buku ? toUpper(fields.kategori_buku) : 'UMUM';
        if (!KATEGORI_BUKU.includes(kategoriFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_BUKU.join(', ')}`);
        updates.push('kategori_buku = ?');
        args.push(kategoriFinal);
    }
    if (fields.nomor_rak !== undefined) {
        updates.push('nomor_rak = ?');
        args.push(toClean(fields.nomor_rak));
    }
    if (fields.bahasa !== undefined) {
        updates.push('bahasa = ?');
        args.push(toClean(fields.bahasa));
    }
    if (fields.jumlah !== undefined) {
        const jumlahFinal = (fields.jumlah !== null && fields.jumlah !== '') ? Number(fields.jumlah) : 0;
        if (!Number.isInteger(jumlahFinal) || jumlahFinal < 0) throw new Error('Jumlah harus angka bulat >= 0');
        updates.push('jumlah = ?');
        args.push(jumlahFinal);
    }
    if (fields.keterangan !== undefined) {
        updates.push('keterangan = ?');
        args.push(fields.keterangan || null);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE buku_katalog SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus buku (admin, terscope) — tolak bila masih ada peminjaman aktif
export const deleteKatalogService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];

    const aktif = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM sirkulasi_peminjaman WHERE buku_id = ? AND status = 'DIPINJAM'`,
        args: [Number(id)]
    });
    if (Number(aktif.rows[0].n) > 0) throw new Error('Buku masih dipinjam, tidak bisa dihapus');

    const result = await db.execute({
        sql: `DELETE FROM buku_katalog WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// ==================== SIRKULASI PEMINJAMAN & PENGEMBALIAN ====================

// Ambil satu peminjaman (terscope lembaga)
const getScopedSirkulasi = async (ctx, id) => {
    const whereClause = ctx.isAll ? 'sp.id = ?' : 'sp.id = ? AND sp.lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `SELECT sp.*, bk.kode_buku, bk.judul
              FROM sirkulasi_peminjaman sp
              LEFT JOIN buku_katalog bk ON bk.id = sp.buku_id
              WHERE ${whereClause}`,
        args
    });
    return result.rows[0] || null;
};

// List transaksi peminjaman (filter status/tipe anggota/cari/tanggal, terscope)
export const getSirkulasiService = async ({ status, anggota_type, search, tanggal }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const today = todayLocalISO();
    const conditions = [];
    const args = [];

    if (status) {
        const statusFinal = toUpper(status);
        if (!STATUS_SIRKULASI.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_SIRKULASI.join(', ')}`);
        conditions.push('sp.status = ?');
        args.push(statusFinal);
    }
    if (anggota_type) {
        const anggotaFinal = toUpper(anggota_type);
        if (!ANGGOTA_TYPE.includes(anggotaFinal)) throw new Error(`Tipe anggota tidak valid! Pilih: ${ANGGOTA_TYPE.join(', ')}`);
        conditions.push('sp.anggota_type = ?');
        args.push(anggotaFinal);
    }
    if (search && String(search).trim()) {
        conditions.push('(sp.nama_anggota LIKE ? OR sp.nim LIKE ? OR bk.judul LIKE ? OR sp.kode_peminjaman LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like, like, like);
    }
    if (tanggal && isValidDate(tanggal)) {
        conditions.push('sp.tanggal_pinjam = ?');
        args.push(String(tanggal).trim());
    }
    if (!ctx.isAll) {
        conditions.push('sp.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT sp.id, sp.kode_peminjaman, sp.buku_id, bk.kode_buku, bk.judul,
               sp.anggota_type, sp.nama_anggota, sp.nim,
               sp.tanggal_pinjam, sp.tanggal_batas, sp.tanggal_kembali, sp.status,
               CASE
                 WHEN sp.status = 'DIPINJAM' AND sp.tanggal_batas IS NOT NULL AND sp.tanggal_batas < ? THEN DATEDIFF(?, sp.tanggal_batas)
                 WHEN sp.status = 'DIKEMBALIKAN' AND sp.tanggal_kembali IS NOT NULL AND sp.tanggal_batas IS NOT NULL AND sp.tanggal_kembali > sp.tanggal_batas THEN DATEDIFF(sp.tanggal_kembali, sp.tanggal_batas)
                 ELSE 0
               END AS hari_terlambat,
               sp.keterangan, sp.lembaga, sp.created_at
        FROM sirkulasi_peminjaman sp
        LEFT JOIN buku_katalog bk ON bk.id = sp.buku_id
        ${whereClause}
        ORDER BY sp.created_at DESC, sp.id DESC
    `;
    const argsAll = [...args, today, today];
    const result = await db.execute({ sql: query, args: argsAll });

    const rows = result.rows;
    const summary = {
        total: rows.length,
        dipinjam: rows.filter((r) => r.status === 'DIPINJAM').length,
        dikembalikan: rows.filter((r) => r.status === 'DIKEMBALIKAN').length,
        terlambat: rows.filter((r) => Number(r.hari_terlambat) > 0).length
    };
    return { data: rows, summary };
};

// Catat peminjaman (admin/teacher) — cek stok, tanggal_batas default dari setting
export const createSirkulasiService = async ({ buku_id, anggota_type, nama_anggota, nim, tanggal_pinjam, tanggal_batas, keterangan }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const settings = await getSettings(ctx);

    if (!buku_id) throw new Error('Pilih buku terlebih dahulu');
    const idBuku = Number(buku_id);
    const buku = await db.execute({
        sql: ctx.isAll ? 'SELECT id, judul, jumlah FROM buku_katalog WHERE id = ?' : 'SELECT id, judul, jumlah FROM buku_katalog WHERE id = ? AND lembaga = ?',
        args: ctx.isAll ? [idBuku] : [idBuku, ctx.lembaga]
    });
    const bukuRow = buku.rows[0];
    if (!bukuRow) throw new Error('Buku tidak ditemukan atau di luar lingkup lembaga');

    const anggotaFinal = anggota_type ? toUpper(anggota_type) : 'SANTRI';
    if (!ANGGOTA_TYPE.includes(anggotaFinal)) throw new Error(`Tipe anggota tidak valid! Pilih: ${ANGGOTA_TYPE.join(', ')}`);

    const namaFinal = toClean(nama_anggota);
    if (!namaFinal) throw new Error('Nama anggota wajib diisi');

    const tglPinjam = tanggal_pinjam && isValidDate(tanggal_pinjam) ? String(tanggal_pinjam).trim() : todayLocalISO();
    let tglBatas;
    if (tanggal_batas && isValidDate(tanggal_batas)) {
        tglBatas = String(tanggal_batas).trim();
    } else {
        tglBatas = addDays(tglPinjam, Number(settings.lama_pinjam_hari));
    }
    if (daysBetween(tglPinjam, tglBatas) < 0) throw new Error('Tanggal batas tidak boleh sebelum tanggal pinjam');

    const terpinjam = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM sirkulasi_peminjaman WHERE buku_id = ? AND status = 'DIPINJAM'`,
        args: [idBuku]
    });
    if (Number(terpinjam.rows[0].n) >= Number(bukuRow.jumlah)) throw new Error('Stok buku tidak mencukupi untuk dipinjam');

    const kodePeminjaman = `PJM-${Date.now().toString(36).toUpperCase()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

    const result = await db.execute({
        sql: `
            INSERT INTO sirkulasi_peminjaman (kode_peminjaman, buku_id, anggota_type, nama_anggota, nim, tanggal_pinjam, tanggal_batas, status, keterangan, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'DIPINJAM', ?, ?)
        `,
        args: [kodePeminjaman, idBuku, anggotaFinal, namaFinal, nim ? toClean(nim) : null, tglPinjam, tglBatas, keterangan || null, ctx.lembaga]
    });
    return { id: Number(result.lastInsertRowid), kode_peminjaman: kodePeminjaman };
};

// Ubah peminjaman (admin, terscope)
export const updateSirkulasiService = async (id, fields = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const existing = await getScopedSirkulasi(ctx, id);
    if (!existing) throw new Error('Peminjaman tidak ditemukan');

    const updates = [];
    const args = [];

    if (fields.buku_id !== undefined) {
        const idBuku = Number(fields.buku_id);
        const buku = await db.execute({
            sql: ctx.isAll ? 'SELECT id, jumlah FROM buku_katalog WHERE id = ?' : 'SELECT id, jumlah FROM buku_katalog WHERE id = ? AND lembaga = ?',
            args: ctx.isAll ? [idBuku] : [idBuku, ctx.lembaga]
        });
        if (buku.rows.length === 0) throw new Error('Buku tidak ditemukan atau di luar lingkup lembaga');
        if (existing.status === 'DIPINJAM') {
            const terpinjam = await db.execute({
                sql: `SELECT COUNT(*) AS n FROM sirkulasi_peminjaman WHERE buku_id = ? AND status = 'DIPINJAM' AND id != ?`,
                args: [idBuku, Number(id)]
            });
            if (Number(terpinjam.rows[0].n) >= Number(buku.rows[0].jumlah)) throw new Error('Stok buku tidak mencukupi untuk dipinjam');
        }
        updates.push('buku_id = ?');
        args.push(idBuku);
    }
    if (fields.anggota_type !== undefined) {
        const anggotaFinal = fields.anggota_type ? toUpper(fields.anggota_type) : 'SANTRI';
        if (!ANGGOTA_TYPE.includes(anggotaFinal)) throw new Error(`Tipe anggota tidak valid! Pilih: ${ANGGOTA_TYPE.join(', ')}`);
        updates.push('anggota_type = ?');
        args.push(anggotaFinal);
    }
    if (fields.nama_anggota !== undefined) {
        const namaFinal = toClean(fields.nama_anggota);
        if (!namaFinal) throw new Error('Nama anggota wajib diisi');
        updates.push('nama_anggota = ?');
        args.push(namaFinal);
    }
    if (fields.nim !== undefined) {
        updates.push('nim = ?');
        args.push(toClean(fields.nim));
    }
    if (fields.tanggal_pinjam !== undefined && fields.tanggal_pinjam) {
        if (!isValidDate(fields.tanggal_pinjam)) throw new Error('Format tanggal pinjam tidak valid (YYYY-MM-DD)');
        updates.push('tanggal_pinjam = ?');
        args.push(String(fields.tanggal_pinjam).trim());
    }
    if (fields.tanggal_batas !== undefined && fields.tanggal_batas) {
        if (!isValidDate(fields.tanggal_batas)) throw new Error('Format tanggal batas tidak valid (YYYY-MM-DD)');
        const tglPinjam = fields.tanggal_pinjam && isValidDate(fields.tanggal_pinjam) ? String(fields.tanggal_pinjam).trim() : existing.tanggal_pinjam;
        if (daysBetween(tglPinjam, String(fields.tanggal_batas).trim()) < 0) throw new Error('Tanggal batas tidak boleh sebelum tanggal pinjam');
        updates.push('tanggal_batas = ?');
        args.push(String(fields.tanggal_batas).trim());
    }
    if (fields.keterangan !== undefined) {
        updates.push('keterangan = ?');
        args.push(fields.keterangan || null);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE sirkulasi_peminjaman SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Pengembalian buku — otomatis hitung & catat denda bila terlambat (atomik)
export const kembalikanService = async (id, { tanggal_kembali, catatan } = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const existing = await getScopedSirkulasi(ctx, id);
    if (!existing) throw new Error('Peminjaman tidak ditemukan');
    if (existing.status === 'DIKEMBALIKAN') throw new Error('Peminjaman ini sudah dikembalikan');

    const tglKembali = tanggal_kembali && isValidDate(tanggal_kembali) ? String(tanggal_kembali).trim() : todayLocalISO();
    const hariTelat = Math.max(0, existing.tanggal_batas ? daysBetween(existing.tanggal_batas, tglKembali) : 0);

    const ops = [];
    ops.push({
        sql: `UPDATE sirkulasi_peminjaman SET status = 'DIKEMBALIKAN', tanggal_kembali = ?, keterangan = COALESCE(?, keterangan), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [tglKembali, catatan ? toClean(catatan) : null, Number(id)]
    });

    let dendaInfo = null;
    if (hariTelat > 0) {
        const settings = await getSettings(ctx);
        const total = hariTelat * Number(settings.tarif_denda_harian || 0);
        const existingDenda = await db.execute({
            sql: `SELECT id FROM denda_perpustakaan WHERE peminjaman_id = ?`,
            args: [Number(id)]
        });
        if (existingDenda.rows.length > 0) {
            ops.push({
                sql: `UPDATE denda_perpustakaan SET tarif_per_hari = ?, jumlah_hari = ?, total = ?, status = 'BELUM_LUNAS', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                args: [Number(settings.tarif_denda_harian), hariTelat, total, Number(existingDenda.rows[0].id)]
            });
        } else {
            ops.push({
                sql: `INSERT INTO denda_perpustakaan (peminjaman_id, buku_id, tarif_per_hari, jumlah_hari, total, status, lembaga) VALUES (?, ?, ?, ?, ?, 'BELUM_LUNAS', ?)`,
                args: [Number(id), Number(existing.buku_id), Number(settings.tarif_denda_harian), hariTelat, total, ctx.lembaga]
            });
        }
        dendaInfo = { jumlah_hari: hariTelat, tarif_per_hari: Number(settings.tarif_denda_harian), total };
    }

    await db.batch(ops);
    return { tanggal_kembali: tglKembali, denda: dendaInfo };
};

// Hapus peminjaman (admin, terscope) — tolak bila ada denda terkait
export const deleteSirkulasiService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const existing = await getScopedSirkulasi(ctx, id);
    if (!existing) throw new Error('Peminjaman tidak ditemukan');

    const denda = await db.execute({
        sql: `SELECT id FROM denda_perpustakaan WHERE peminjaman_id = ?`,
        args: [Number(id)]
    });
    if (denda.rows.length > 0) throw new Error('Hapus denda terkait peminjaman ini terlebih dahulu');

    const result = await db.execute({
        sql: ctx.isAll ? 'DELETE FROM sirkulasi_peminjaman WHERE id = ?' : 'DELETE FROM sirkulasi_peminjaman WHERE id = ? AND lembaga = ?',
        args: ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga]
    });
    return result.rowsAffected > 0;
};

// ==================== DENDA & KETERLAMBATAN ====================

// List denda (filter status/cari, terscope) — yang belum lunas tampil lebih dulu
export const getDendaService = async ({ status, search }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (status) {
        const statusFinal = toUpper(status);
        if (!STATUS_DENDA.includes(statusFinal)) throw new Error(`Status denda tidak valid! Pilih: ${STATUS_DENDA.join(', ')}`);
        conditions.push('dp.status = ?');
        args.push(statusFinal);
    }
    if (search && String(search).trim()) {
        conditions.push('(sp.nama_anggota LIKE ? OR sp.nim LIKE ? OR bk.judul LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like, like);
    }
    if (!ctx.isAll) {
        conditions.push('dp.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT dp.id, dp.peminjaman_id, dp.buku_id, dp.tarif_per_hari, dp.jumlah_hari, dp.total,
               dp.status, dp.tanggal_bayar, dp.catatan, dp.lembaga, dp.created_at,
               sp.kode_peminjaman, sp.nama_anggota, sp.nim, sp.tanggal_pinjam, sp.tanggal_batas, sp.tanggal_kembali,
               bk.kode_buku, bk.judul
        FROM denda_perpustakaan dp
        LEFT JOIN sirkulasi_peminjaman sp ON sp.id = dp.peminjaman_id
        LEFT JOIN buku_katalog bk ON bk.id = dp.buku_id
        ${whereClause}
        ORDER BY dp.status = 'LUNAS', dp.created_at DESC, dp.id DESC
    `;
    const result = await db.execute({ sql: query, args });

    const rows = result.rows;
    const summary = {
        total: rows.length,
        belum_lunas: rows.filter((r) => r.status === 'BELUM_LUNAS').length,
        lunas: rows.filter((r) => r.status === 'LUNAS').length,
        total_nominal: rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0),
        nominal_belum_lunas: rows.filter((r) => r.status === 'BELUM_LUNAS').reduce((acc, r) => acc + (Number(r.total) || 0), 0)
    };
    return { data: rows, summary };
};

// Catat pembayaran denda (admin, terscope)
export const bayarDendaService = async (id, { tanggal_bayar, catatan } = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];

    const cek = await db.execute({
        sql: `SELECT id, status FROM denda_perpustakaan WHERE ${whereClause}`,
        args
    });
    if (cek.rows.length === 0) throw new Error('Denda tidak ditemukan');
    if (cek.rows[0].status === 'LUNAS') throw new Error('Denda ini sudah lunas');

    const tglBayar = tanggal_bayar && isValidDate(tanggal_bayar) ? String(tanggal_bayar).trim() : todayLocalISO();
    const result = await db.execute({
        sql: `UPDATE denda_perpustakaan SET status = 'LUNAS', tanggal_bayar = ?, catatan = ?, updated_at = CURRENT_TIMESTAMP WHERE ${whereClause} AND status != 'LUNAS'`,
        args: [tglBayar, catatan ? toClean(catatan) : null, ...args]
    });
    return result.rowsAffected > 0;
};

// ==================== SETTING PERPUSTAKAAN ====================

// GET setting — resolve lembaga -> ALL -> default (1000/hari, 7 hari)
export const getPerpusSettingsService = async (lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const st = await getSettings(ctx);
    return {
        lembaga: ctx.lembaga,
        tarif_denda_harian: Number(st.tarif_denda_harian),
        lama_pinjam_hari: Number(st.lama_pinjam_hari)
    };
};

// PUT setting — upsert per lembaga (admin)
export const updatePerpusSettingsService = async ({ tarif_denda_harian, lama_pinjam_hari }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const tarif = (tarif_denda_harian !== undefined && tarif_denda_harian !== null && tarif_denda_harian !== '') ? Number(tarif_denda_harian) : null;
    if (tarif !== null && (!Number.isFinite(tarif) || tarif < 0)) throw new Error('Tarif denda harus angka >= 0');

    const lama = (lama_pinjam_hari !== undefined && lama_pinjam_hari !== null && lama_pinjam_hari !== '') ? Number(lama_pinjam_hari) : null;
    if (lama !== null && (!Number.isInteger(lama) || lama <= 0)) throw new Error('Lama pinjam harus angka bulat > 0');

    if (tarif === null && lama === null) throw new Error('Tidak ada data yang diubah');

    const existing = await db.execute({
        sql: 'SELECT id FROM perpus_settings WHERE lembaga = ?',
        args: [ctx.lembaga]
    });

    if (existing.rows.length > 0) {
        const sets = [];
        const setArgs = [];
        if (tarif !== null) { sets.push('tarif_denda_harian = ?'); setArgs.push(tarif); }
        if (lama !== null) { sets.push('lama_pinjam_hari = ?'); setArgs.push(lama); }
        setArgs.push(existing.rows[0].id);
        await db.execute({
            sql: `UPDATE perpus_settings SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            args: setArgs
        });
    } else {
        const current = await getSettings(ctx);
        await db.execute({
            sql: 'INSERT INTO perpus_settings (lembaga, tarif_denda_harian, lama_pinjam_hari) VALUES (?, ?, ?)',
            args: [ctx.lembaga, tarif !== null ? tarif : current.tarif_denda_harian, lama !== null ? lama : current.lama_pinjam_hari]
        });
    }
    return getPerpusSettingsService(ctx.lembaga);
};