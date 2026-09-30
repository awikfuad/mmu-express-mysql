import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { saveLocalUpload } from '../config/upload.js';

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

export const KATEGORI_RAPAT = ['RAPAT_GURU', 'RAPAT_PENGURUS', 'RAPAT_WALI_MURID', 'RAPAT_PIMPINAN'];
export const STATUS_NOTULEN = ['DRAFT', 'SELESAI'];
export const KEHADIRAN_PESERTA = ['HADIR', 'IZIN', 'SAKIT', 'ALPA'];
export const STATUS_TINDAK_LANJUT = ['MENUNGGU', 'BERJALAN', 'SELESAI'];

const toUpper = (v) => (v ? String(v).toUpperCase() : null);
const toClean = (v) => (v !== undefined && v !== null ? String(v).trim() : null);

const isValidDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// Cek keberadaan & scope notulen (untuk operasi anak tabel)
const getScopedNotulen = async (id, ctx) => {
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `SELECT id, judul FROM notulen_rapat WHERE ${whereClause}`,
        args
    });
    return result.rows[0] || null;
};

// List rapat & notulen (filter kategori/status/rentang/cari, terscope lembaga) + ringkasan status
export const getNotulenService = async ({ kategori, status, tanggal_mulai, tanggal_selesai, search }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (kategori) {
        const kategoriFinal = toUpper(kategori);
        if (!KATEGORI_RAPAT.includes(kategoriFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_RAPAT.join(', ')}`);
        conditions.push('nr.kategori = ?');
        args.push(kategoriFinal);
    }
    if (status) {
        const statusFinal = toUpper(status);
        if (!STATUS_NOTULEN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_NOTULEN.join(', ')}`);
        conditions.push('nr.status = ?');
        args.push(statusFinal);
    }
    if (tanggal_mulai) {
        if (!isValidDate(tanggal_mulai)) throw new Error('Format tanggal_mulai harus YYYY-MM-DD');
        conditions.push('nr.tanggal >= ?');
        args.push(tanggal_mulai);
    }
    if (tanggal_selesai) {
        if (!isValidDate(tanggal_selesai)) throw new Error('Format tanggal_selesai harus YYYY-MM-DD');
        conditions.push('nr.tanggal <= ?');
        args.push(tanggal_selesai);
    }
    if (search && String(search).trim()) {
        const like = `%${String(search).trim()}%`;
        conditions.push('(nr.judul LIKE ? OR nr.agenda LIKE ? OR nr.tempat LIKE ? OR nr.pimpinan LIKE ? OR nr.notulis LIKE ?)');
        args.push(like, like, like, like, like);
    }
    if (!ctx.isAll) {
        conditions.push('nr.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT nr.id, nr.judul, nr.agenda, nr.kategori, nr.tanggal, nr.waktu_mulai, nr.waktu_selesai,
               nr.tempat, nr.pimpinan, nr.notulis, nr.status, nr.lembaga, nr.dibuat_oleh,
               nr.created_at, nr.updated_at,
               (SELECT COUNT(*) FROM notulen_peserta np WHERE np.notulen_id = nr.id) AS total_peserta,
               (SELECT COUNT(*) FROM notulen_peserta np WHERE np.notulen_id = nr.id AND np.kehadiran = 'HADIR') AS hadir,
               (SELECT COUNT(*) FROM notulen_tindak_lanjut tl WHERE tl.notulen_id = nr.id AND tl.status != 'SELESAI') AS tindak_lanjut_open
        FROM notulen_rapat nr
        ${whereClause}
        ORDER BY nr.tanggal DESC, nr.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    const data = result.rows;

    // Ringkasan status utk tab Daftar Rapat
    const summaryResult = await db.execute({
        sql: `
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN nr.status = 'DRAFT' THEN 1 ELSE 0 END) AS draft,
                   SUM(CASE WHEN nr.status = 'SELESAI' THEN 1 ELSE 0 END) AS selesai
            FROM notulen_rapat nr
            ${whereClause}
        `,
        args
    });
    const s = summaryResult.rows[0] || {};
    return {
        data,
        summary: {
            total: Number(s.total || 0),
            draft: Number(s.draft || 0),
            selesai: Number(s.selesai || 0)
        }
    };
};

// Detail lengkap (header + peserta + pembahasan/keputusan + tindak lanjut + lampiran)
export const getNotulenDetailService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];

    const header = await db.execute({
        sql: `SELECT * FROM notulen_rapat WHERE ${whereClause}`,
        args
    });
    if (!header.rows[0]) return null;

    const [peserta, pembahasan, tindakLanjut, lampiran] = await Promise.all([
        db.execute({
            sql: `SELECT id, notulen_id, teacher_id, nama, kehadiran, keterangan, lembaga, created_at
                  FROM notulen_peserta WHERE notulen_id = ? ORDER BY kehadiran != 'HADIR', id ASC`,
            args: [Number(id)]
        }),
        db.execute({
            sql: `SELECT id, notulen_id, poin, isi, is_keputusan, lembaga, created_at
                  FROM notulen_pembahasan WHERE notulen_id = ? ORDER BY is_keputusan ASC, id ASC`,
            args: [Number(id)]
        }),
        db.execute({
            sql: `SELECT id, notulen_id, deskripsi, pic, teacher_id, deadline, status, catatan, lembaga, created_at, updated_at
                  FROM notulen_tindak_lanjut WHERE notulen_id = ? ORDER BY (deadline IS NULL OR deadline = ''), deadline ASC, id DESC`,
            args: [Number(id)]
        }),
        db.execute({
            sql: `SELECT id, notulen_id, nama_asli, path_file, tipe, lembaga, created_at
                  FROM notulen_lampiran WHERE notulen_id = ? ORDER BY id DESC`,
            args: [Number(id)]
        })
    ]);

    const detail = header.rows[0];
    const listPeserta = peserta.rows;
    const hadirCount = listPeserta.filter((p) => p.kehadiran === 'HADIR').length;
    detail.peserta = listPeserta;
    detail.pembahasan = pembahasan.rows;
    detail.tindak_lanjut = tindakLanjut.rows;
    detail.lampiran = lampiran.rows;
    detail.total_peserta = listPeserta.length;
    detail.hadir = hadirCount;
    return detail;
};

// Buat notulen baru (header)
export const createNotulenService = async ({ judul, agenda, kategori, tanggal, waktu_mulai, waktu_selesai, tempat, pimpinan, notulis, status }, lembaga = 'ALL', dibuatOleh = null) => {
    const ctx = getContext(lembaga);
    const judulFinal = toClean(judul);
    if (!judulFinal) throw new Error('Judul/agenda rapat wajib diisi');

    const kategoriFinal = kategori ? toUpper(kategori) : 'RAPAT_GURU';
    if (!KATEGORI_RAPAT.includes(kategoriFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_RAPAT.join(', ')}`);

    const tanggalFinal = toClean(tanggal);
    if (!tanggalFinal || !isValidDate(tanggalFinal)) throw new Error('Tanggal wajib diisi dengan format YYYY-MM-DD');

    const statusFinal = status ? toUpper(status) : 'DRAFT';
    if (!STATUS_NOTULEN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_NOTULEN.join(', ')}`);

    const result = await db.execute({
        sql: `
            INSERT INTO notulen_rapat (judul, agenda, kategori, tanggal, waktu_mulai, waktu_selesai, tempat, pimpinan, notulis, status, lembaga, dibuat_oleh)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            judulFinal,
            agenda || null,
            kategoriFinal,
            tanggalFinal,
            waktu_mulai ? toClean(waktu_mulai) : null,
            waktu_selesai ? toClean(waktu_selesai) : null,
            tempat ? toClean(tempat) : null,
            pimpinan ? toClean(pimpinan) : null,
            notulis ? toClean(notulis) : null,
            statusFinal,
            ctx.lembaga,
            dibuatOleh
        ]
    });
    return { id: Number(result.lastInsertRowid) };
};

// Ubah header notulen (admin/teacher, terscope lembaga)
export const updateNotulenService = async (id, { judul, agenda, kategori, tanggal, waktu_mulai, waktu_selesai, tempat, pimpinan, notulis, status }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];

    if (judul !== undefined) {
        const judulFinal = toClean(judul);
        if (!judulFinal) throw new Error('Judul/agenda rapat wajib diisi');
        updates.push('judul = ?');
        args.push(judulFinal);
    }
    if (agenda !== undefined) {
        updates.push('agenda = ?');
        args.push(agenda ? String(agenda).trim() : null);
    }
    if (kategori !== undefined) {
        const kategoriFinal = toUpper(kategori);
        if (!KATEGORI_RAPAT.includes(kategoriFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_RAPAT.join(', ')}`);
        updates.push('kategori = ?');
        args.push(kategoriFinal);
    }
    if (tanggal !== undefined) {
        const tanggalFinal = toClean(tanggal);
        if (!tanggalFinal || !isValidDate(tanggalFinal)) throw new Error('Tanggal wajib diisi dengan format YYYY-MM-DD');
        updates.push('tanggal = ?');
        args.push(tanggalFinal);
    }
    if (waktu_mulai !== undefined) {
        updates.push('waktu_mulai = ?');
        args.push(waktu_mulai ? toClean(waktu_mulai) : null);
    }
    if (waktu_selesai !== undefined) {
        updates.push('waktu_selesai = ?');
        args.push(waktu_selesai ? toClean(waktu_selesai) : null);
    }
    if (tempat !== undefined) {
        updates.push('tempat = ?');
        args.push(tempat ? toClean(tempat) : null);
    }
    if (pimpinan !== undefined) {
        updates.push('pimpinan = ?');
        args.push(pimpinan ? toClean(pimpinan) : null);
    }
    if (notulis !== undefined) {
        updates.push('notulis = ?');
        args.push(notulis ? toClean(notulis) : null);
    }
    if (status !== undefined) {
        const statusFinal = toUpper(status);
        if (!STATUS_NOTULEN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_NOTULEN.join(', ')}`);
        updates.push('status = ?');
        args.push(statusFinal);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    updates.push('updated_at = CURRENT_TIMESTAMP');
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE notulen_rapat SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Ubah status cepat (DRAFT/SELESAI — admin)
export const setStatusNotulenService = async (id, status, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const statusFinal = toUpper(status);
    if (!STATUS_NOTULEN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_NOTULEN.join(', ')}`);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [statusFinal, Number(id)] : [statusFinal, Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `UPDATE notulen_rapat SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus notulen (cascade menghapus peserta/pembahasan/tindak lanjut/lampiran via FK)
export const deleteNotulenService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM notulen_rapat WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Simpan daftar kehadiran (ganti total — atomik db.batch). items: [{teacher_id?, nama, kehadiran, keterangan}]
export const savePesertaService = async (notulenId, items, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const notulen = await getScopedNotulen(notulenId, ctx);
    if (!notulen) throw new Error('Notulen tidak ditemukan');

    const normalized = [];
    for (const item of Array.isArray(items) ? items : []) {
        const nama = toClean(item.nama) || (item.teacher_id ? undefined : null);
        if (!nama) throw new Error('Nama peserta wajib diisi');
        const kehadiran = item.kehadiran ? toUpper(item.kehadiran) : 'HADIR';
        if (!KEHADIRAN_PESERTA.includes(kehadiran)) throw new Error(`Kehadiran tidak valid! Pilih: ${KEHADIRAN_PESERTA.join(', ')}`);
        normalized.push({
            teacher_id: item.teacher_id ? Number(item.teacher_id) : null,
            nama,
            kehadiran,
            keterangan: item.keterangan ? toClean(item.keterangan) : null
        });
    }

    const ops = [
        { sql: 'DELETE FROM notulen_peserta WHERE notulen_id = ?', args: [Number(notulenId)] },
        ...normalized.map((p) => ({
            sql: `
                INSERT INTO notulen_peserta (notulen_id, teacher_id, nama, kehadiran, keterangan, lembaga)
                VALUES (?, ?, ?, ?, ?, ?)
            `,
            args: [Number(notulenId), p.teacher_id, p.nama, p.kehadiran, p.keterangan, ctx.lembaga]
        }))
    ];
    await db.batch(ops, 'write');
    return { count: normalized.length };
};

// Tambah poin pembahasan / keputusan
export const createPembahasanService = async (notulenId, { poin, isi, is_keputusan }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const notulen = await getScopedNotulen(notulenId, ctx);
    if (!notulen) throw new Error('Notulen tidak ditemukan');

    const poinFinal = toClean(poin);
    if (!poinFinal) throw new Error('Poin pembahasan wajib diisi');
    const isKeputusan = is_keputusan ? 1 : 0;

    const result = await db.execute({
        sql: `
            INSERT INTO notulen_pembahasan (notulen_id, poin, isi, is_keputusan, lembaga)
            VALUES (?, ?, ?, ?, ?)
        `,
        args: [Number(notulenId), poinFinal, isi ? String(isi) : null, isKeputusan, ctx.lembaga]
    });
    return { id: Number(result.lastInsertRowid) };
};

export const updatePembahasanService = async (id, { poin, isi, is_keputusan }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];

    if (poin !== undefined) {
        const poinFinal = toClean(poin);
        if (!poinFinal) throw new Error('Poin pembahasan wajib diisi');
        updates.push('poin = ?');
        args.push(poinFinal);
    }
    if (isi !== undefined) {
        updates.push('isi = ?');
        args.push(isi ? String(isi) : null);
    }
    if (is_keputusan !== undefined) {
        updates.push('is_keputusan = ?');
        args.push(is_keputusan ? 1 : 0);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `UPDATE notulen_pembahasan SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

export const deletePembahasanService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM notulen_pembahasan WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Tambah tindak lanjut / action item
export const createTindakLanjutService = async (notulenId, { deskripsi, pic, teacher_id, deadline, status, catatan }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const notulen = await getScopedNotulen(notulenId, ctx);
    if (!notulen) throw new Error('Notulen tidak ditemukan');

    const deskripsiFinal = toClean(deskripsi);
    if (!deskripsiFinal) throw new Error('Deskripsi tugas wajib diisi');

    let deadlineFinal = deadline ? toClean(deadline) : null;
    if (deadlineFinal && !isValidDate(deadlineFinal)) throw new Error('Format deadline harus YYYY-MM-DD');

    const statusFinal = status ? toUpper(status) : 'MENUNGGU';
    if (!STATUS_TINDAK_LANJUT.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_TINDAK_LANJUT.join(', ')}`);

    const picFinal = toClean(pic) || null;
    const teacherIdFinal = teacher_id ? Number(teacher_id) : null;

    const result = await db.execute({
        sql: `
            INSERT INTO notulen_tindak_lanjut (notulen_id, deskripsi, pic, teacher_id, deadline, status, catatan, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [Number(notulenId), deskripsiFinal, picFinal, teacherIdFinal, deadlineFinal, statusFinal, catatan ? toClean(catatan) : null, ctx.lembaga]
    });
    return { id: Number(result.lastInsertRowid) };
};

export const updateTindakLanjutService = async (id, { deskripsi, pic, teacher_id, deadline, status, catatan }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];

    if (deskripsi !== undefined) {
        const deskripsiFinal = toClean(deskripsi);
        if (!deskripsiFinal) throw new Error('Deskripsi tugas wajib diisi');
        updates.push('deskripsi = ?');
        args.push(deskripsiFinal);
    }
    if (pic !== undefined) {
        updates.push('pic = ?');
        args.push(pic ? toClean(pic) : null);
    }
    if (teacher_id !== undefined) {
        updates.push('teacher_id = ?');
        args.push(teacher_id ? Number(teacher_id) : null);
    }
    if (deadline !== undefined) {
        let deadlineFinal = deadline ? toClean(deadline) : null;
        if (deadlineFinal && !isValidDate(deadlineFinal)) throw new Error('Format deadline harus YYYY-MM-DD');
        updates.push('deadline = ?');
        args.push(deadlineFinal);
    }
    if (status !== undefined) {
        const statusFinal = toUpper(status);
        if (!STATUS_TINDAK_LANJUT.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_TINDAK_LANJUT.join(', ')}`);
        updates.push('status = ?');
        args.push(statusFinal);
    }
    if (catatan !== undefined) {
        updates.push('catatan = ?');
        args.push(catatan ? toClean(catatan) : null);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    updates.push('updated_at = CURRENT_TIMESTAMP');
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `UPDATE notulen_tindak_lanjut SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

export const deleteTindakLanjutService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM notulen_tindak_lanjut WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Tracker global tindak lanjut (semua rapat) utk tab Tindak Lanjut
export const getTindakLanjutService = async ({ status, notulen_id, deadline_from, deadline_to, search }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (status) {
        const statusFinal = toUpper(status);
        if (!STATUS_TINDAK_LANJUT.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_TINDAK_LANJUT.join(', ')}`);
        conditions.push('tl.status = ?');
        args.push(statusFinal);
    }
    if (notulen_id) {
        conditions.push('tl.notulen_id = ?');
        args.push(Number(notulen_id));
    }
    if (deadline_from) {
        if (!isValidDate(deadline_from)) throw new Error('Format deadline_from harus YYYY-MM-DD');
        conditions.push('(tl.deadline IS NOT NULL AND tl.deadline != \'\' AND tl.deadline >= ?)');
        args.push(deadline_from);
    }
    if (deadline_to) {
        if (!isValidDate(deadline_to)) throw new Error('Format deadline_to harus YYYY-MM-DD');
        conditions.push('(tl.deadline IS NOT NULL AND tl.deadline != \'\' AND tl.deadline <= ?)');
        args.push(deadline_to);
    }
    if (search && String(search).trim()) {
        const like = `%${String(search).trim()}%`;
        conditions.push('(tl.deskripsi LIKE ? OR tl.pic LIKE ? OR nr.judul LIKE ?)');
        args.push(like, like, like);
    }
    if (!ctx.isAll) {
        conditions.push('tl.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT tl.id, tl.notulen_id, tl.deskripsi, tl.pic, tl.teacher_id, tl.deadline, tl.status, tl.catatan,
               tl.lembaga, tl.created_at, tl.updated_at,
               nr.judul AS rapat_judul, nr.tanggal AS rapat_tanggal, nr.kategori AS rapat_kategori
        FROM notulen_tindak_lanjut tl
        JOIN notulen_rapat nr ON nr.id = tl.notulen_id
        ${whereClause}
        ORDER BY (tl.deadline IS NULL OR tl.deadline = ''), tl.deadline ASC, tl.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    const data = result.rows;

    // Ringkasan per status utk kartu tracker (EXCLUDE filter tl.status → args diselaraskan)
    const summaryConditions = [];
    const summaryArgs = [];
    conditions.forEach((cond, i) => {
        if (cond.includes('tl.status')) return;
        summaryConditions.push(cond);
        const argIdx = args.slice(0, i + 1).reduce((acc, a) => acc + (Array.isArray(a) ? a.length : 1), 0);
        const arg = args.slice(argIdx - (Array.isArray(args[i]) ? args[i].length : 1), argIdx);
        summaryArgs.push(...arg);
    });
    const summaryWhere = summaryConditions.length ? `WHERE ${summaryConditions.join(' AND ')}` : '';
    const summaryResult = await db.execute({
        sql: `
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN tl.status = 'MENUNGGU' THEN 1 ELSE 0 END) AS menunggu,
                   SUM(CASE WHEN tl.status = 'BERJALAN' THEN 1 ELSE 0 END) AS berjalan,
                   SUM(CASE WHEN tl.status = 'SELESAI' THEN 1 ELSE 0 END) AS selesai
            FROM notulen_tindak_lanjut tl
            JOIN notulen_rapat nr ON nr.id = tl.notulen_id
            ${summaryWhere}
        `,
        args: summaryArgs
    });
    const sm = summaryResult.rows[0] || {};
    return {
        data,
        summary: {
            total: Number(sm.total || 0),
            menunggu: Number(sm.menunggu || 0),
            berjalan: Number(sm.berjalan || 0),
            selesai: Number(sm.selesai || 0)
        }
    };
};

// Upload lampiran (foto/slide/dokumen) — memory storage → lokal/Cloudinary
export const createLampiranService = async (notulenId, file, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const notulen = await getScopedNotulen(notulenId, ctx);
    if (!notulen) throw new Error('Notulen tidak ditemukan');
    if (!file || !file.buffer) throw new Error('Berkas wajib diunggah');

    const path_file = await saveLocalUpload(file.buffer, file.originalname || 'lampiran.png', 'lampiran');
    const tipe = /^image\//.test(file.mimetype || '') ? 'GAMBAR' : 'PDF';

    const result = await db.execute({
        sql: `
            INSERT INTO notulen_lampiran (notulen_id, nama_asli, path_file, tipe, lembaga)
            VALUES (?, ?, ?, ?, ?)
        `,
        args: [Number(notulenId), file.originalname || null, path_file, tipe, ctx.lembaga]
    });
    return { id: Number(result.lastInsertRowid), path_file, tipe };
};

export const deleteLampiranService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM notulen_lampiran WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};