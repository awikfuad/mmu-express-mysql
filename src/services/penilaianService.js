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

// Scope WHERE berdasarkan lembaga: Super Admin (ALL) melihat semua, scoped hanya lembaganya.
const scopeWhere = (ctx, alias = '') => {
    const a = alias ? `${alias}.` : '';
    return ctx.isAll ? '' : `WHERE ${a}lembaga = ?`;
};

// Validasi murid_id milik lembaga pemanggil (scoped). Super Admin bebas.
const validateMuridScope = async (ctx, muridIds) => {
    if (ctx.isAll || !muridIds || muridIds.length === 0) return;
    const placeholders = muridIds.map(() => '?').join(',');
    const found = await db.execute({
        sql: `SELECT id FROM santri_penempatan WHERE id IN (${placeholders}) AND sumber = ?`,
        args: [...muridIds, ctx.sumber]
    });
    const foundSet = new Set(found.rows.map((r) => Number(r.id)));
    const missing = muridIds.filter((id) => !foundSet.has(Number(id)));
    if (missing.length) throw new Error(`Murid ID ${missing.join(', ')} bukan milik lembaga Anda.`);
};

// Ambil nama murid dari tabel penempatan gabungan (fallback ke students / data induk)
const nameExpr = (alias) => `
    COALESCE(
        (SELECT name FROM santri_penempatan WHERE nim = ${alias}.nim LIMIT 1),
        (SELECT name FROM students WHERE nim = ${alias}.nim LIMIT 1)
    ) AS student_name
`;

const classExpr = (alias) => `
    (SELECT c.class_name FROM santri_penempatan sp JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber WHERE sp.nim = ${alias}.nim LIMIT 1) AS class_name
`;

// ============================================================================
// NILAI HARIAN
// ============================================================================

// List catatan nilai harian (filter subject_id / tanggal / classroom_id, terscope lembaga)
export const getNilaiHarianService = async ({ subject_id, tanggal, classroom_id }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (subject_id) {
        conditions.push('n.subject_id = ?');
        args.push(Number(subject_id));
    }
    if (tanggal) {
        conditions.push('n.tanggal = ?');
        args.push(tanggal);
    }
    if (classroom_id) {
        conditions.push('n.classroom_id = ?');
        args.push(Number(classroom_id));
    }
    if (!ctx.isAll) {
        conditions.push('n.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT n.id, n.academic_year_id, n.jenjang_id, n.classroom_id, n.murid_id, n.sumber,
               n.nim, n.subject_id, n.tanggal, n.nilai, n.keterangan, n.lembaga, n.created_at,
               ${nameExpr('n')},
               ${classExpr('n')},
               s.subject_name, s.subject_code
        FROM nilai_harian n
        LEFT JOIN subjects s ON s.id = n.subject_id
        ${whereClause}
        ORDER BY n.tanggal DESC, n.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Simpan nilai harian massal (UPSERT per murid per mapel per tanggal). Atomik via db.batch.
export const saveNilaiHarianBulkService = async ({ academic_year_id, jenjang_id, classroom_id, subject_id, tanggal, items }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const subjectId = Number(subject_id);
    const tgl = String(tanggal || '').trim();
    if (!Number.isFinite(subjectId) || subjectId <= 0) throw new Error('Mata pelajaran wajib dipilih');
    if (!tgl) throw new Error('Tanggal wajib diisi');

    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Tidak ada data nilai yang dikirim');
    }

    // Validasi ownership & paksa sumber untuk scoped
    await validateMuridScope(ctx, items.map((it) => Number(it.murid_id)).filter(Boolean));

    const ops = [];
    let count = 0;
    for (const item of items) {
        const nilai = Number(item.nilai);
        if (!Number.isFinite(nilai) || nilai < 0 || nilai > 100) {
            throw new Error(`Nilai murid "${item.name || item.nim || item.murid_id}" harus angka 0 - 100`);
        }
        if (!item.murid_id) throw new Error('ID murid wajib diisi');

        ops.push({
            sql: `
                INSERT INTO nilai_harian
                    (academic_year_id, jenjang_id, classroom_id, murid_id, sumber, nim, subject_id, tanggal, nilai, keterangan, lembaga)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    nilai = VALUES(nilai),
                    keterangan = VALUES(keterangan),
                    classroom_id = VALUES(classroom_id),
                    jenjang_id = VALUES(jenjang_id),
                    academic_year_id = VALUES(academic_year_id)
            `,
            args: [
                academic_year_id ? Number(academic_year_id) : null,
                jenjang_id ? Number(jenjang_id) : null,
                classroom_id ? Number(classroom_id) : null,
                Number(item.murid_id),
                ctx.isAll ? (item.sumber || ctx.sumber) : ctx.sumber,
                String(item.nim || ''),
                subjectId,
                tgl,
                nilai,
                item.keterangan || null,
                ctx.lembaga
            ]
        });
        count += 1;
    }

    await db.batch(ops, 'write');
    return { saved: count, subject_id: subjectId, tanggal: tgl };
};

// Hapus catatan nilai (hanya admin, terscope lembaga)
export const deleteNilaiHarianService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM nilai_harian WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// ============================================================================
// PERILAKU MURID
// ============================================================================

export const KATEGORI_PERILAKU = [
    'DISIPLIN', 'TANGGUNG_JAWAB', 'SOPAN_SANTUN', 'KEJUJURAN',
    'IBADAH', 'KEBERSIHAN', 'KERJASAMA', 'LAINNYA'
];

export const PREDIKAT_PERILAKU = ['SANGAT_BAIK', 'BAIK', 'CUKUP', 'KURANG'];

// Aspek penilaian perilaku: 1 baris per murid per tanggal dengan 3 kolom
export const KOLOM_PERILAKU = ['kerajinan', 'kedisiplinan', 'kebersihan'];
export const KOLOM_PERILAKU_LABEL = {
    kerajinan: 'Kerajinan',
    kedisiplinan: 'Kedisiplinan',
    kebersihan: 'Kebersihan'
};

const toUpper = (v) => (v ? String(v).toUpperCase() : null);
const validPredikat = (v) => (!v || PREDIKAT_PERILAKU.includes(v));

// List catatan perilaku (filter tanggal / kategori(legacy) / classroom_id, terscope lembaga)
export const getPerilakuMuridService = async ({ tanggal, kategori, classroom_id }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (tanggal) {
        conditions.push('p.tanggal = ?');
        args.push(tanggal);
    }
    if (kategori) {
        conditions.push('p.kategori = ?');
        args.push(kategori);
    }
    if (classroom_id) {
        conditions.push('p.classroom_id = ?');
        args.push(Number(classroom_id));
    }
    if (!ctx.isAll) {
        conditions.push('p.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT p.id, p.academic_year_id, p.jenjang_id, p.classroom_id, p.murid_id, p.sumber,
               p.nim, p.kategori, p.predikat, p.kerajinan, p.kedisiplinan, p.kebersihan,
               p.catatan, p.tanggal, p.lembaga, p.created_at,
               ${nameExpr('p')},
               ${classExpr('p')}
        FROM perilaku_murid p
        ${whereClause}
        ORDER BY p.tanggal DESC, p.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Simpan perilaku murid massal (1 baris per murid per tanggal, 3 kolom aspek).
// Baris lama (per-kategori) dihapus lalu diganti baris gabungan. Atomik via db.batch.
export const savePerilakuMuridBulkService = async ({ academic_year_id, jenjang_id, classroom_id, tanggal, items }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const tgl = String(tanggal || '').trim();
    if (!tgl) throw new Error('Tanggal wajib diisi');
    if (!Array.isArray(items) || items.length === 0) throw new Error('Tidak ada data perilaku yang dikirim');

    // Validasi ownership & paksa sumber untuk scoped
    await validateMuridScope(ctx, items.map((it) => Number(it.murid_id)).filter(Boolean));

    const ops = [];
    let count = 0;
    for (const item of items) {
        if (!item.murid_id) throw new Error('ID murid wajib diisi');

        const kerajinan = toUpper(item.kerajinan);
        const kedisiplinan = toUpper(item.kedisiplinan);
        const kebersihan = toUpper(item.kebersihan);
        for (const v of [kerajinan, kedisiplinan, kebersihan]) {
            if (!validPredikat(v)) throw new Error(`Predikat tidak valid! Pilih: ${PREDIKAT_PERILAKU.join(', ')}`);
        }
        // Lewati murid tanpa penilaian sama sekali
        if (!kerajinan && !kedisiplinan && !kebersihan) continue;

        const muridId = Number(item.murid_id);
        const sumber = ctx.isAll ? (item.sumber || ctx.sumber) : ctx.sumber;

        // Hapus baris lama murid ini pada tanggal tsb (legacy per-kategori / simpan ulang), lalu insert 1 baris gabungan
        ops.push({
            sql: 'DELETE FROM perilaku_murid WHERE murid_id = ? AND sumber = ? AND tanggal = ?',
            args: [muridId, sumber, tgl]
        });
        ops.push({
            sql: `
                INSERT INTO perilaku_murid
                    (academic_year_id, jenjang_id, classroom_id, murid_id, sumber, nim, kategori, predikat,
                     kerajinan, kedisiplinan, kebersihan, catatan, tanggal, lembaga)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
                academic_year_id ? Number(academic_year_id) : null,
                jenjang_id ? Number(jenjang_id) : null,
                classroom_id ? Number(classroom_id) : null,
                muridId,
                sumber,
                String(item.nim || ''),
                'PERILAKU',
                kerajinan || kedisiplinan || kebersihan || 'BAIK',
                kerajinan,
                kedisiplinan,
                kebersihan,
                item.catatan || null,
                tgl,
                ctx.lembaga
            ]
        });
        count += 1;
    }

    if (count === 0) throw new Error('Tidak ada data perilaku yang valid dikirim');

    await db.batch(ops, 'write');
    return { saved: count, tanggal: tgl };
};

// Ubah catatan perilaku (admin/teacher) — update aspek 3 kolom
export const updatePerilakuMuridService = async (id, { kerajinan, kedisiplinan, kebersihan, catatan }, lembaga = 'ALL') => {
    const kerajinanF = toUpper(kerajinan);
    const kedisiplinanF = toUpper(kedisiplinan);
    const kebersihanF = toUpper(kebersihan);
    for (const v of [kerajinanF, kedisiplinanF, kebersihanF]) {
        if (!validPredikat(v)) throw new Error(`Predikat tidak valid! Pilih: ${PREDIKAT_PERILAKU.join(', ')}`);
    }

    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];
    const aspek = { kerajinan: kerajinanF, kedisiplinan: kedisiplinanF, kebersihan: kebersihanF };
    let aspekChanged = false;
    for (const [col, val] of Object.entries(aspek)) {
        if (val !== null) {
            updates.push(`${col} = ?`);
            args.push(val);
            aspekChanged = true;
        }
    }
    if (catatan !== undefined) {
        updates.push('catatan = ?');
        args.push(catatan || null);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');
    if (aspekChanged) {
        // Predikat legacy tetap representatif = predikat terisi pertama
        updates.push("predikat = COALESCE(kerajinan, kedisiplinan, kebersihan, 'BAIK')");
    }

    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE perilaku_murid SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus catatan perilaku (admin, terscope lembaga)
export const deletePerilakuMuridService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM perilaku_murid WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};
