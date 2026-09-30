import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import XLSX from 'xlsx';

// ============================================================
// BANK SOAL & UJIAN / CBT
// — bank_soal, ujian, ujian_soal, ujian_peserta
// ============================================================

export const TIPE_SOAL = ['PG', 'ESAI'];
export const JENIS_UJIAN = ['ULANGAN', 'UTS', 'UAS', 'TRYOUT', 'LAINNYA'];
export const MODE_UJIAN = ['ONLINE', 'CETAK'];
export const STATUS_UJIAN = ['DRAFT', 'TERBIT', 'ARSIP'];
export const STATUS_PESERTA = ['BELUM', 'MENGERJAKAN', 'SELESAI'];
export const IMDA_LIST = ['IMDA 1', 'IMDA 2', 'IMDA 3'];

const KUNCI_OPSI = ['A', 'B', 'C', 'D', 'E'];

// Normalisasi nilai IMDA: kosong → null; nilai tak dikenal → throw
const normalizeImda = (raw) => {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const imdaFinal = toUpper(raw);
    if (!IMDA_LIST.includes(imdaFinal)) {
        throw new Error(`IMDA tidak valid! Pilih: ${IMDA_LIST.join(', ')}`);
    }
    return imdaFinal;
};

const getContext = (lembaga) => {
    const s = getSumber(String(lembaga || 'ALL').toUpperCase());
    return { lembaga: s.lembaga, isAll: s.isAll, sumber: s.sumber };
};

const toUpper = (v) => (v ? String(v).toUpperCase() : null);
// Ubah nilai query (string "1,2", JSON array "[1,2]", atau array asli) menjadi array id
const parseIdList = (v) => {
    if (v === undefined || v === null || v === '') return [];
    let arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [v];
    return arr.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
};
const randomKode = (len = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
};

// Scope WHERE helper untuk kolom `lembaga`
const scopeClause = (ctx, alias) => {
    if (ctx.isAll) return '';
    return ` AND ${alias}.lembaga = ?`;
};

// ============ BANK SOAL ============

export const getBankSoalService = async (filters = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (filters.subject_id) {
        conditions.push('b.subject_id = ?');
        args.push(Number(filters.subject_id));
    }
    if (filters.jenjang_id) {
        conditions.push('b.jenjang_id = ?');
        args.push(Number(filters.jenjang_id));
    }
    if (filters.classroom_id) {
        conditions.push('b.classroom_id = ?');
        args.push(Number(filters.classroom_id));
    }
    // Filter imda sasaran: soal tanpa imda (NULL = berlaku semua) ikut tampil
    if (filters.imda) {
        conditions.push('(b.imda IS NULL OR b.imda = ?)');
        args.push(normalizeImda(filters.imda));
    }
    // Filter multi id sasaran ujian: soal tanpa jenjang/kelas (NULL = berlaku semua) ikut tampil
    const jenjangIds = parseIdList(filters.jenjang_ids || filters.jenjangIds);
    if (jenjangIds.length) {
        conditions.push(`(b.jenjang_id IS NULL OR b.jenjang_id IN (${jenjangIds.map(() => '?').join(',')}))`);
        args.push(...jenjangIds);
    }
    const kelasIds = parseIdList(filters.kelas_ids || filters.kelasIds || filters.classroom_ids);
    if (kelasIds.length) {
        conditions.push(`(b.classroom_id IS NULL OR b.classroom_id IN (${kelasIds.map(() => '?').join(',')}))`);
        args.push(...kelasIds);
    }
    if (filters.tipe) {
        const tipeFinal = toUpper(filters.tipe);
        if (!TIPE_SOAL.includes(tipeFinal)) throw new Error(`Tipe soal tidak valid! Pilih: ${TIPE_SOAL.join(', ')}`);
        conditions.push('b.tipe = ?');
        args.push(tipeFinal);
    }
    if (filters.search && String(filters.search).trim()) {
        conditions.push('(b.pertanyaan LIKE ? OR s.subject_name LIKE ?)');
        const like = `%${String(filters.search).trim()}%`;
        args.push(like, like);
    }
    const scope = scopeClause(ctx, 'b');
    if (scope) args.push(ctx.lembaga);

    const query = `
        SELECT b.id, b.subject_id, s.subject_name, b.jenjang_id, j.nama_jenjang,
               b.classroom_id, c.class_name, b.imda, b.tipe,
               b.pertanyaan, b.opsi_a, b.opsi_b, b.opsi_c, b.opsi_d, b.opsi_e,
               b.kunci, b.pembahasan, b.gambar, b.bobot, b.lembaga, b.created_at, b.updated_at
        FROM bank_soal b
        LEFT JOIN subjects s ON b.subject_id = s.id
        LEFT JOIN jenjang j ON b.jenjang_id = j.id
        LEFT JOIN classes c ON b.classroom_id = c.id
        WHERE 1=1 ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}${scope}
        ORDER BY b.created_at DESC, b.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

export const createBankSoalService = async (data, lembaga = 'ALL', actorName = '') => {
    const ctx = getContext(lembaga);
    const tipeFinal = toUpper(data.tipe || 'PG');
    if (!TIPE_SOAL.includes(tipeFinal)) throw new Error(`Tipe soal tidak valid! Pilih: ${TIPE_SOAL.join(', ')}`);

    const pertanyaan = String(data.pertanyaan || '').trim();
    if (!pertanyaan) throw new Error('Pertanyaan wajib diisi');

    let kunciFinal = null;
    if (tipeFinal === 'PG') {
        kunciFinal = toUpper(data.kunci);
        if (!kunciFinal || !KUNCI_OPSI.includes(kunciFinal)) {
            throw new Error(`Kunci jawaban tidak valid! Pilih: ${KUNCI_OPSI.join(', ')}`);
        }
    } else {
        kunciFinal = null;
    }

    const bobot = (data.bobot !== undefined && data.bobot !== null && data.bobot !== '') ? Number(data.bobot) : 1;
    if (!Number.isFinite(bobot) || bobot <= 0) throw new Error('Bobot soal harus angka > 0');

    const result = await db.execute({
        sql: `
            INSERT INTO bank_soal (subject_id, jenjang_id, classroom_id, imda, tipe, pertanyaan, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, kunci, pembahasan, gambar, bobot, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            data.subject_id || null,
            data.jenjang_id || null,
            data.classroom_id || null,
            normalizeImda(data.imda),
            tipeFinal,
            pertanyaan,
            data.opsi_a || null, data.opsi_b || null, data.opsi_c || null, data.opsi_d || null, data.opsi_e || null,
            kunciFinal,
            data.pembahasan || null,
            data.gambar || null,
            bobot,
            ctx.lembaga
        ]
    });
    return { id: Number(result.lastInsertRowid) };
};

export const updateBankSoalService = async (id, data, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];

    const push = (field, value) => { updates.push(`${field} = ?`); args.push(value); };

    if (data.subject_id !== undefined) push('subject_id', data.subject_id || null);
    if (data.jenjang_id !== undefined) push('jenjang_id', data.jenjang_id || null);
    if (data.classroom_id !== undefined) push('classroom_id', data.classroom_id || null);
    if (data.imda !== undefined) push('imda', normalizeImda(data.imda));
    if (data.tipe !== undefined) {
        const tipeFinal = toUpper(data.tipe);
        if (!TIPE_SOAL.includes(tipeFinal)) throw new Error(`Tipe soal tidak valid! Pilih: ${TIPE_SOAL.join(', ')}`);
        push('tipe', tipeFinal);
        if (tipeFinal === 'ESAI') push('kunci', null);
    }
    if (data.pertanyaan !== undefined) {
        const pertanyaan = String(data.pertanyaan || '').trim();
        if (!pertanyaan) throw new Error('Pertanyaan wajib diisi');
        push('pertanyaan', pertanyaan);
    }
    ['opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e'].forEach((o) => {
        if (data[o] !== undefined) push(o, data[o] || null);
    });
    if (data.kunci !== undefined) {
        const kunciFinal = toUpper(data.kunci);
        if (kunciFinal && !KUNCI_OPSI.includes(kunciFinal)) throw new Error(`Kunci jawaban tidak valid! Pilih: ${KUNCI_OPSI.join(', ')}`);
        push('kunci', kunciFinal);
    }
    if (data.pembahasan !== undefined) push('pembahasan', data.pembahasan || null);
    if (data.gambar !== undefined) push('gambar', data.gambar || null);
    if (data.bobot !== undefined) {
        const bobot = (data.bobot !== null && data.bobot !== '') ? Number(data.bobot) : 1;
        if (!Number.isFinite(bobot) || bobot <= 0) throw new Error('Bobot soal harus angka > 0');
        push('bobot', bobot);
    }

    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const scope = scopeClause(ctx, 'b');
    args.push(Number(id));
    if (scope) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `UPDATE bank_soal b SET ${updates.join(', ')} WHERE b.id = ?${scope}`,
        args
    });
    return result.rowsAffected > 0;
};

export const deleteBankSoalService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const scope = scopeClause(ctx, 'b');
    const args = [Number(id)];
    if (scope) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `DELETE FROM bank_soal b WHERE b.id = ?${scope}`,
        args
    });
    return result.rowsAffected > 0;
};

// ============ UJIAN ============

export const getUjianService = async (filters = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (filters.status) {
        const statusFinal = toUpper(filters.status);
        if (!STATUS_UJIAN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_UJIAN.join(', ')}`);
        conditions.push('u.status = ?');
        args.push(statusFinal);
    }
    if (filters.jenis) {
        const jenisFinal = toUpper(filters.jenis);
        if (!JENIS_UJIAN.includes(jenisFinal)) throw new Error(`Jenis tidak valid! Pilih: ${JENIS_UJIAN.join(', ')}`);
        conditions.push('u.jenis = ?');
        args.push(jenisFinal);
    }
    if (filters.subject_id) {
        conditions.push('u.subject_id = ?');
        args.push(Number(filters.subject_id));
    }
    if (filters.search && String(filters.search).trim()) {
        conditions.push('u.judul LIKE ?');
        args.push(`%${String(filters.search).trim()}%`);
    }
    const scope = scopeClause(ctx, 'u');
    if (scope) args.push(ctx.lembaga);

    const query = `
        SELECT u.id, u.judul, u.subject_id, s.subject_name, u.classroom_id, c.class_name,
               u.jenjang_id, j.nama_jenjang, u.imda, u.jenis, u.mode, u.waktu_mulai, u.waktu_selesai,
               u.durasi, u.petunjuk, u.acak_soal, u.acak_opsi, u.tampilkan_hasil, u.status, u.kode_akses,
               u.lembaga, u.dibuat_oleh, u.created_at, u.updated_at,
               (SELECT COUNT(*) FROM ujian_soal us WHERE us.ujian_id = u.id) AS jumlah_soal,
               (SELECT COUNT(*) FROM ujian_peserta up WHERE up.ujian_id = u.id) AS jumlah_peserta,
               (SELECT COUNT(*) FROM ujian_peserta up2 WHERE up2.ujian_id = u.id AND up2.status = 'SELESAI') AS jumlah_selesai
        FROM ujian u
        LEFT JOIN subjects s ON u.subject_id = s.id
        LEFT JOIN classes c ON u.classroom_id = c.id
        LEFT JOIN jenjang j ON u.jenjang_id = j.id
        WHERE 1=1 ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}${scope}
        ORDER BY u.created_at DESC, u.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

export const getUjianDetailService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const scope = scopeClause(ctx, 'u');
    const args = [Number(id)];
    if (scope) args.push(ctx.lembaga);

    const ujianRes = await db.execute({
        sql: `
            SELECT u.*, s.subject_name, c.class_name, j.nama_jenjang,
                   (SELECT COUNT(*) FROM ujian_soal us WHERE us.ujian_id = u.id) AS jumlah_soal,
                   (SELECT COUNT(*) FROM ujian_peserta up WHERE up.ujian_id = u.id) AS jumlah_peserta
            FROM ujian u
            LEFT JOIN subjects s ON u.subject_id = s.id
            LEFT JOIN classes c ON u.classroom_id = c.id
            LEFT JOIN jenjang j ON u.jenjang_id = j.id
            WHERE u.id = ?${scope}
        `,
        args
    });
    const ujian = ujianRes.rows[0];
    if (!ujian) return null;

    const soalRes = await db.execute({
        sql: `
            SELECT bs.id, bs.subject_id, s.subject_name, bs.jenjang_id, bs.tipe, bs.pertanyaan,
                   bs.opsi_a, bs.opsi_b, bs.opsi_c, bs.opsi_d, bs.opsi_e, bs.kunci,
                   bs.pembahasan, bs.gambar, bs.bobot, us.urutan
            FROM ujian_soal us
            JOIN bank_soal bs ON us.soal_id = bs.id
            LEFT JOIN subjects s ON bs.subject_id = s.id
            WHERE us.ujian_id = ?
            ORDER BY us.urutan ASC, us.id ASC
        `,
        args: [Number(id)]
    });
    ujian.soal = soalRes.rows;
    return ujian;
};

export const createUjianService = async (data, lembaga = 'ALL', actorName = '') => {
    const ctx = getContext(lembaga);

    const judul = String(data.judul || '').trim();
    if (!judul) throw new Error('Judul ujian wajib diisi');

    const jenisFinal = toUpper(data.jenis || 'ULANGAN');
    if (!JENIS_UJIAN.includes(jenisFinal)) throw new Error(`Jenis tidak valid! Pilih: ${JENIS_UJIAN.join(', ')}`);

    const modeFinal = toUpper(data.mode || 'ONLINE');
    if (!MODE_UJIAN.includes(modeFinal)) throw new Error(`Mode tidak valid! Pilih: ${MODE_UJIAN.join(', ')}`);

    const durasi = (data.durasi !== undefined && data.durasi !== null && data.durasi !== '') ? Number(data.durasi) : 0;
    if (!Number.isFinite(durasi) || durasi < 0) throw new Error('Durasi harus angka menit >= 0');

    const statusFinal = toUpper(data.status || 'DRAFT');
    if (!STATUS_UJIAN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_UJIAN.join(', ')}`);

    const kodeAkses = modeFinal === 'ONLINE' ? (data.kode_akses && String(data.kode_akses).trim() ? String(data.kode_akses).trim().toUpperCase() : randomKode()) : null;

    const result = await db.execute({
        sql: `
            INSERT INTO ujian (judul, subject_id, classroom_id, jenjang_id, imda, jenis, mode, waktu_mulai, waktu_selesai,
                               durasi, petunjuk, acak_soal, acak_opsi, tampilkan_hasil, status, kode_akses, lembaga, dibuat_oleh)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            judul,
            data.subject_id || null,
            data.classroom_id || null,
            data.jenjang_id || null,
            normalizeImda(data.imda),
            jenisFinal,
            modeFinal,
            data.waktu_mulai || null,
            data.waktu_selesai || null,
            durasi,
            data.petunjuk || null,
            data.acak_soal ? 1 : 0,
            data.acak_opsi ? 1 : 0,
            data.tampilkan_hasil ? 1 : 0,
            statusFinal,
            kodeAkses,
            ctx.lembaga,
            actorName || null
        ]
    });
    const id = Number(result.lastInsertRowid);

    // Soal awal (opsional) — preserve order
    if (Array.isArray(data.soal_ids) && data.soal_ids.length) {
        await setUjianSoalService(id, data.soal_ids, lembaga);
    }
    return { id, kode_akses: kodeAkses };
};

export const updateUjianService = async (id, data, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];
    const push = (field, value) => { updates.push(`${field} = ?`); args.push(value); };

    if (data.judul !== undefined) {
        const judul = String(data.judul || '').trim();
        if (!judul) throw new Error('Judul ujian wajib diisi');
        push('judul', judul);
    }
    if (data.subject_id !== undefined) push('subject_id', data.subject_id || null);
    if (data.classroom_id !== undefined) push('classroom_id', data.classroom_id || null);
    if (data.jenjang_id !== undefined) push('jenjang_id', data.jenjang_id || null);
    if (data.imda !== undefined) push('imda', normalizeImda(data.imda));
    if (data.jenis !== undefined) {
        const jenisFinal = toUpper(data.jenis);
        if (!JENIS_UJIAN.includes(jenisFinal)) throw new Error(`Jenis tidak valid! Pilih: ${JENIS_UJIAN.join(', ')}`);
        push('jenis', jenisFinal);
    }
    if (data.mode !== undefined) {
        const modeFinal = toUpper(data.mode);
        if (!MODE_UJIAN.includes(modeFinal)) throw new Error(`Mode tidak valid! Pilih: ${MODE_UJIAN.join(', ')}`);
        push('mode', modeFinal);
        if (modeFinal === 'ONLINE') push('kode_akses', (data.kode_akses && String(data.kode_akses).trim()) ? String(data.kode_akses).trim().toUpperCase() : randomKode());
    }
    if (data.waktu_mulai !== undefined) push('waktu_mulai', data.waktu_mulai || null);
    if (data.waktu_selesai !== undefined) push('waktu_selesai', data.waktu_selesai || null);
    if (data.durasi !== undefined) {
        const durasi = (data.durasi !== null && data.durasi !== '') ? Number(data.durasi) : 0;
        if (!Number.isFinite(durasi) || durasi < 0) throw new Error('Durasi harus angka menit >= 0');
        push('durasi', durasi);
    }
    if (data.petunjuk !== undefined) push('petunjuk', data.petunjuk || null);
    if (data.acak_soal !== undefined) push('acak_soal', data.acak_soal ? 1 : 0);
    if (data.acak_opsi !== undefined) push('acak_opsi', data.acak_opsi ? 1 : 0);
    if (data.tampilkan_hasil !== undefined) push('tampilkan_hasil', data.tampilkan_hasil ? 1 : 0);
    if (data.kode_akses !== undefined && data.mode === undefined) {
        push('kode_akses', data.kode_akses ? String(data.kode_akses).trim().toUpperCase() : randomKode());
    }
    if (data.status !== undefined) {
        const statusFinal = toUpper(data.status);
        if (!STATUS_UJIAN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_UJIAN.join(', ')}`);
        push('status', statusFinal);
    }

    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const scope = scopeClause(ctx, 'u');
    args.push(Number(id));
    if (scope) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `UPDATE ujian u SET ${updates.join(', ')} WHERE u.id = ?${scope}`,
        args
    });
    return result.rowsAffected > 0;
};

export const deleteUjianService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const scope = scopeClause(ctx, 'u');
    const args = [Number(id)];
    if (scope) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `DELETE FROM ujian u WHERE u.id = ?${scope}`,
        args
    });
    return result.rowsAffected > 0;
};

// Simpan daftar soal utk sebuah ujian (ganti total, sesuaikan urutan)
export const setUjianSoalService = async (ujianId, soalIds, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);

const ujianRes = await db.execute({
        sql: `SELECT id, lembaga FROM ujian u WHERE id = ?${scopeClause(ctx, 'u')}`,
        args: ctx.isAll ? [Number(ujianId)] : [Number(ujianId), ctx.lembaga]
    });
    if (!ujianRes.rows[0]) throw new Error('Ujian tidak ditemukan');

    if (!Array.isArray(soalIds)) throw new Error('soal_ids harus berupa array');

    const ids = soalIds.map((i) => Number(i)).filter((n) => Number.isInteger(n));
    const statements = [
        { sql: 'DELETE FROM ujian_soal WHERE ujian_id = ?', args: [Number(ujianId)] }
    ];
    ids.forEach((soalId, idx) => {
        statements.push({
            sql: 'INSERT INTO ujian_soal (ujian_id, soal_id, urutan) VALUES (?, ?, ?)',
            args: [Number(ujianId), soalId, idx + 1]
        });
    });
    await db.batch(statements);
    return { jumlah: ids.length };
};

export const getUjianPesertaService = async (ujianId, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const scope = scopeClause(ctx, 'up');
    const args = [Number(ujianId)];
    if (scope) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `
            SELECT up.*, c.class_name
            FROM ujian_peserta up
            LEFT JOIN classes c ON up.classroom_id = c.id
            WHERE up.ujian_id = ?${scope}
            ORDER BY up.name ASC
        `,
        args
    });
    return result.rows;
};

// Tambah peserta dari satu kelas aktif (atau tunggal via nim)
export const addUjianPesertaService = async (ujianId, data, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);

const ujianRes = await db.execute({
        sql: `SELECT id, classroom_id, mode, lembaga FROM ujian u WHERE id = ?${scopeClause(ctx, 'u')}`,
        args: ctx.isAll ? [Number(ujianId)] : [Number(ujianId), ctx.lembaga]
    });
    const ujian = ujianRes.rows[0];
    if (!ujian) throw new Error('Ujian tidak ditemukan');

    const ujLembaga = ujian.lembaga || 'ALL';
    const sourceScope = getSumber(ujLembaga);

    const statements = [];

    if (data.classroom_id) {
        // Tarik seluruh santri aktif dari kelas tsb (scope lembaga ujian)
        const rosterQuery = `
            SELECT m.id AS murid_id, m.sumber, m.nim, m.name, m.classroom_id
            FROM ${sourceScope.santriTable} m
            WHERE m.classroom_id = ? AND m.status = 1${sourceScope.isAll ? '' : ' AND LOWER(m.sumber) = LOWER(?)'}
        `;
        const rosterArgs = sourceScope.isAll ? [Number(data.classroom_id)] : [Number(data.classroom_id), sourceScope.sumber];
        const roster = (await db.execute({ sql: rosterQuery, args: rosterArgs })).rows;

        if (!roster.length) throw new Error('Tidak ada santri aktif di kelas tersebut');

        const existing = (await db.execute({
            sql: 'SELECT nim FROM ujian_peserta WHERE ujian_id = ?',
            args: [Number(ujianId)]
        })).rows.map((r) => r.nim);

        const added = [];
        for (const s of roster) {
            if (existing.includes(s.nim)) continue;
            statements.push({
                sql: 'INSERT INTO ujian_peserta (ujian_id, murid_id, sumber, nim, name, classroom_id, lembaga) VALUES (?, ?, ?, ?, ?, ?, ?)',
                args: [Number(ujianId), s.murid_id, s.sumber, s.nim, s.name, s.classroom_id, ctx.lembaga]
            });
            added.push(s.nim);
        }
        await db.batch(statements);
        return { ditambahkan: added.length, nim: added };
    }

    if (data.nim && data.name) {
        const nim = String(data.nim).trim();
        const name = String(data.name).trim();
        if (!nim || !name) throw new Error('nim & name wajib diisi utk peserta manual');

        const dup = await db.execute({
            sql: 'SELECT id FROM ujian_peserta WHERE ujian_id = ? AND nim = ?',
            args: [Number(ujianId), nim]
        });
        if (dup.rows[0]) throw new Error('NIM tersebut sudah menjadi peserta');

        await db.execute({
            sql: 'INSERT INTO ujian_peserta (ujian_id, sumber, nim, name, lembaga) VALUES (?, ?, ?, ?, ?)',
            args: [Number(ujianId), sourceScope.sumber, nim, name, ctx.lembaga]
        });
        return { ditambahkan: 1, nim: [nim] };
    }

    throw new Error('Kirim classroom_id (tambah dari kelas) atau nim & name (manual)');
};

export const removeUjianPesertaService = async (ujianId, pesertaId, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const scope = scopeClause(ctx, 'up');
    const args = [Number(ujianId), Number(pesertaId)];
    if (scope) args.push(ctx.lembaga);
    // Hanya boleh hapus peserta yang belum mulai mengerjakan
    const check = await db.execute({
        sql: `SELECT status FROM ujian_peserta up WHERE up.ujian_id = ? AND up.id = ?${scope}`,
        args
    });
    const peserta = check.rows[0];
    if (!peserta) throw new Error('Peserta tidak ditemukan');
    if (peserta.status !== 'BELUM') throw new Error('Peserta sudah/sedang mengerjakan — tidak bisa dihapus');

    const result = await db.execute({
        sql: `DELETE FROM ujian_peserta up WHERE up.ujian_id = ? AND up.id = ?${scope}`,
        args
    });
    return result.rowsAffected > 0;
};

// Penilaian manual (mis. utk ujian yang memuat soal ESAI)
export const gradeUjianPesertaService = async (ujianId, pesertaId, data, lembaga = 'ALL', actorName = '') => {
    const ctx = getContext(lembaga);
    if (data.nilai === undefined || data.nilai === null || data.nilai === '') throw new Error('Nilai wajib diisi');
    const nilai = Number(data.nilai);
    if (!Number.isFinite(nilai) || nilai < 0 || nilai > 100) throw new Error('Nilai harus 0 - 100');

    const scope = scopeClause(ctx, 'up');
    const args = [nilai, actorName || null, Number(ujianId), Number(pesertaId)];
    if (scope) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `UPDATE ujian_peserta up SET nilai = ?, dinilai_oleh = ?, status = 'SELESAI' WHERE up.ujian_id = ? AND up.id = ?${scope}`,
        args
    });
    return result.rowsAffected > 0;
};

// ============ CBT ONLINE (publik, digate oleh kode akses) ============

const getUjianPesertaPublic = async (ujianId, nim) => {
    const result = await db.execute({
        sql: 'SELECT * FROM ujian_peserta WHERE ujian_id = ? AND nim = ? LIMIT 1',
        args: [Number(ujianId), String(nim).trim()]
    });
    return result.rows[0];
};

const nowStr = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const inWindow = (ujian, now) => {
    const mulai = ujian.waktu_mulai ? new Date(ujian.waktu_mulai).getTime() : null;
    const selesai = ujian.waktu_selesai ? new Date(ujian.waktu_selesai).getTime() : null;
    const t = now.getTime();
    if (mulai && t < mulai) return { ok: false, message: 'Ujian belum dimulai' };
    if (selesai && t > selesai) return { ok: false, message: 'Waktu ujian telah berakhir' };
    return { ok: true };
};

const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

// Bersihkan jawaban dgn aturan tipe: PG → huruf besar, ESAI → trim & kosong dibuang
const cleanJawaban = (soal, jawaban) => {
    const cleaned = {};
    for (const q of soal) {
        if (q.tipe === 'PG') {
            const ans = jawaban[q.id];
            if (ans !== undefined) cleaned[q.id] = String(ans).toUpperCase();
        } else {
            const ans = jawaban[q.id];
            if (ans !== undefined && String(ans).trim() !== '') cleaned[q.id] = String(ans).trim();
        }
    }
    return cleaned;
};

const shuffleOptions = (soal) => {
    const keys = ['opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e'];
    const entries = keys.filter((k) => soal[k] !== null && String(soal[k]).trim() !== '').map((k) => ({ k, v: soal[k] }));
    if (entries.length < 3) return soal;
    const shuffled = shuffle(entries);
    const mapping = {};
    shuffled.forEach((e, i) => { mapping[e.k] = KUNCI_OPSI[i]; });
    const out = { ...soal };
    shuffled.forEach((e, i) => { out[KUNCI_OPSI[i]] = e.v; });
    // Huruf jawaban benar pada tata letak yang sudah diacak (dipakai utk koreksi & kartu hasil)
    out._kunci = out.kunci ? mapping[`opsi_${String(out.kunci).toLowerCase()}`] || out.kunci : out.kunci;
    return out;
};

// Mulai mengerjakan: validasi akses + ambil lembar soal (tanpa kunci)
export const startUjianService = async ({ ujian_id, kode, nim, name }) => {
    const ujianRes = await db.execute({
        sql: 'SELECT * FROM ujian WHERE id = ?',
        args: [Number(ujian_id)]
    });
    const ujian = ujianRes.rows[0];
    if (!ujian) throw new Error('Ujian tidak ditemukan');
    if (ujian.mode !== 'ONLINE') throw new Error('Ujian ini tidak berjenis online');
    if (ujian.status !== 'TERBIT') throw new Error('Ujian belum diterbitkan');

    const now = new Date();
    const windowCheck = inWindow(ujian, now);
    if (!windowCheck.ok) throw new Error(windowCheck.message);

    if (!kode || String(kode).trim().toUpperCase() !== String(ujian.kode_akses || '').toUpperCase()) {
        throw new Error('Kode akses salah');
    }
    if (!nim || !name) throw new Error('NIM & nama wajib diisi');

    let peserta = await getUjianPesertaPublic(ujian_id, nim);
    if (!peserta) throw new Error('NIM tidak terdaftar pada ujian ini');
    if (String(peserta.name).toLowerCase() !== String(name).trim().toLowerCase()) {
        throw new Error('Nama tidak cocok dengan NIM terdaftar');
    }

    // Mulai mengerjakan (first time)
    if (peserta.status === 'BELUM') {
        await db.execute({
            sql: "UPDATE ujian_peserta SET status = 'MENGERJAKAN', mulai = ? WHERE id = ?",
            args: [nowStr(), peserta.id]
        });
        peserta.status = 'MENGERJAKAN';
        peserta.mulai = nowStr();
    }
    if (peserta.status === 'SELESAI') throw new Error('Anda sudah menyelesaikan ujian ini');

    // Ambil soal
    const soalRes = await db.execute({
        sql: `
            SELECT bs.id, bs.tipe, bs.pertanyaan, bs.opsi_a, bs.opsi_b, bs.opsi_c, bs.opsi_d, bs.opsi_e,
                   bs.bobot, bs.kunci, us.urutan
            FROM ujian_soal us
            JOIN bank_soal bs ON us.soal_id = bs.id
            WHERE us.ujian_id = ?
            ORDER BY us.urutan ASC, us.id ASC
        `,
        args: [Number(ujian_id)]
    });

    let soal = soalRes.rows;

    // Sulih pulih jawaban yang sudah disimpan (belum submit)
    let jawabanSebelum = {};
    if (peserta.jawaban) {
        try { jawabanSebelum = JSON.parse(peserta.jawaban) || {}; } catch (_) {}
    }
    soal = soal.map((q) => {
        let s = { ...q };
        if (s.tipe === 'PG' && ujian.acak_opsi) {
            s = shuffleOptions(s);
        }
        // Simpan huruf jawaban benar berdasarkan tata letak yg dikirim siswa (utk koreksi).
        if (s.tipe === 'PG') s._kunci = s._kunci || s.kunci;
        delete s.kunci;
        if (ujian.acak_soal) s.randomOrder = false;
        return s;
    });
    if (ujian.acak_soal) soal = shuffle(soal).map((q, idx) => ({ ...q, urutan: idx + 1 }));

    // Simpan tata letak soal yg dikirim ke siswa agar grading & kartu hasil konsisten
    // (huruf opsi ter-acak). Sesi MENGERJAKAN yg di-refresh memakai tata letak yg sama
    // supaya huruf jawaban yg sudah terekam tidak berubah hurufnya di tengah jalan.
    let arrangement = null;
    if (peserta.tampilan_soal) {
        try { arrangement = JSON.parse(peserta.tampilan_soal); } catch (_) {}
    }
    if (Array.isArray(arrangement) && arrangement.length === soal.length) {
        const byId = new Map(arrangement.map((q) => [Number(q.id), q]));
        soal = soal.map((q) => {
            const f = byId.get(Number(q.id));
            if (!f) return q;
            return {
                ...q,
                opsi_a: f.opsi_a ?? q.opsi_a, opsi_b: f.opsi_b ?? q.opsi_b,
                opsi_c: f.opsi_c ?? q.opsi_c, opsi_d: f.opsi_d ?? q.opsi_d, opsi_e: f.opsi_e ?? q.opsi_e,
                _kunci: f._kunci ?? q._kunci
            };
        });
    } else {
        const toStore = soal.map((q) => ({
            id: Number(q.id), tipe: q.tipe, pertanyaan: q.pertanyaan,
            opsi_a: q.opsi_a, opsi_b: q.opsi_b, opsi_c: q.opsi_c, opsi_d: q.opsi_d, opsi_e: q.opsi_e,
            pembahasan: q.pembahasan || null, bobot: Number(q.bobot || 1),
            urutan: q.urutan || 0, _kunci: q._kunci || null
        }));
        await db.execute({
            sql: 'UPDATE ujian_peserta SET tampilan_soal = ? WHERE id = ?',
            args: [JSON.stringify(toStore), peserta.id]
        });
    }

    // Kunci & _kunci TIDAK dikirim ke client
    soal = soal.map((q) => { const s = { ...q }; delete s.kunci; delete s._kunci; return s; });

    // Pagination timer info
    return {
        ujian: {
            id: ujian.id,
            judul: ujian.judul,
            subject_id: ujian.subject_id,
            jenis: ujian.jenis,
            durasi: ujian.durasi,
            waktu_mulai: ujian.waktu_mulai,
            waktu_selesai: ujian.waktu_selesai,
            petunjuk: ujian.petunjuk,
            acak_soal: ujian.acak_soal,
            acak_opsi: ujian.acak_opsi,
            tampilkan_hasil: Number(ujian.tampilkan_hasil) === 1,
            jumlah_soal: soal.length,
            sisa_waktu: ujian.durasi > 0 ? ujian.durasi * 60 : null
        },
        peserta: { id: peserta.id, nim: peserta.nim, name: peserta.name, mulai: peserta.mulai },
        soal,
        jawaban_sebelum: jawabanSebelum
    };
};

// Kumpulkan & hitung nilai otomatis
export const submitUjianService = async ({ ujian_id, kode, nim, jawaban }) => {
    const ujianRes = await db.execute({
        sql: 'SELECT * FROM ujian WHERE id = ?',
        args: [Number(ujian_id)]
    });
    const ujian = ujianRes.rows[0];
    if (!ujian) throw new Error('Ujian tidak ditemukan');
    if (ujian.mode !== 'ONLINE') throw new Error('Ujian ini tidak berjenis online');
    if (ujian.status !== 'TERBIT') throw new Error('Ujian belum diterbitkan');

    const now = new Date();
    const windowCheck = inWindow(ujian, now);
    if (!windowCheck.ok) throw new Error(windowCheck.message);

    if (!kode || String(kode).trim().toUpperCase() !== String(ujian.kode_akses || '').toUpperCase()) {
        throw new Error('Kode akses salah');
    }
    if (!nim) throw new Error('NIM wajib diisi');
    if (!jawaban || typeof jawaban !== 'object') throw new Error('jawaban wajib dikirim (objek)');

    const peserta = await getUjianPesertaPublic(ujian_id, nim);
    if (!peserta) throw new Error('NIM tidak terdaftar pada ujian ini');
    if (peserta.status === 'SELESAI') throw new Error('Anda sudah menyelesaikan ujian ini');

    const soalRes = await db.execute({
        sql: `
            SELECT bs.id, bs.tipe, bs.pertanyaan, bs.opsi_a, bs.opsi_b, bs.opsi_c, bs.opsi_d, bs.opsi_e,
                   bs.kunci, bs.bobot, bs.pembahasan, us.urutan
            FROM ujian_soal us
            JOIN bank_soal bs ON us.soal_id = bs.id
            WHERE us.ujian_id = ?
        `,
        args: [Number(ujian_id)]
    });
    const soal = soalRes.rows;
    const adaEsai = soal.some((q) => q.tipe === 'ESAI');

    // Tata letak opsi yg benar-benar dikirim ke siswa saat start (termasuk huruf setelah acak opsi).
    // Dipakai sebagai basis koreksi & kartu hasil agar huruf jawaban siswa dibandingkan dengan
    // huruf yg siswa lihat, bukan huruf asli di DB.
    let arrangement = null;
    if (peserta.tampilan_soal) {
        try { arrangement = JSON.parse(peserta.tampilan_soal); } catch (_) {}
    }
    const arrangementById = new Map(
        Array.isArray(arrangement) ? arrangement.map((q) => [Number(q.id), q]) : []
    );

    const cleaned = cleanJawaban(soal, jawaban);

    const kunciOf = (q) => {
        const f = arrangementById.get(Number(q.id));
        return f && f._kunci ? String(f._kunci) : String(q.kunci || '');
    };

    let nilai = null;
    if (!adaEsai) {
        let totalBobot = 0;
        let benarBobot = 0;
        for (const q of soal) {
            const bobot = Number(q.bobot || 1);
            totalBobot += bobot;
            if (q.tipe === 'PG') {
                const kunci = kunciOf(q).toUpperCase();
                if (cleaned[q.id] && cleaned[q.id] === kunci) benarBobot += bobot;
            }
        }
        nilai = totalBobot > 0 ? (benarBobot / totalBobot) * 100 : 0;
        nilai = Math.round(nilai * 100) / 100;
    }

    await db.execute({
        sql: "UPDATE ujian_peserta SET status = 'SELESAI', selesai = ?, jawaban = ?, nilai = ? WHERE id = ?",
        args: [nowStr(), JSON.stringify(cleaned), nilai, peserta.id]
    });

    // Ringkasan benar/salah/kosong + rincian per soal (detail kembalikan ke client bila ujian
    // mengaktifkan "tampilkan hasil").
    const ringkas = { benar: 0, salah: 0, kosong: 0, esai: 0 };
    const detail = [];
    for (const q of soal) {
        const kunci = kunciOf(q).toUpperCase();
        const inJawab = cleaned[q.id] !== undefined && String(cleaned[q.id]).trim() !== '';
        const benar = q.tipe !== 'ESAI' && inJawab && cleaned[q.id] === kunci;
        if (q.tipe === 'ESAI') {
            if (inJawab) ringkas.esai += 1; else ringkas.kosong += 1;
        } else if (!inJawab) ringkas.kosong += 1;
        else if (benar) ringkas.benar += 1;
        else ringkas.salah += 1;

        const f = arrangementById.get(Number(q.id));
        const opsi = (key) => (f && f[key] !== undefined ? f[key] : q[key]);
        detail.push({
            id: q.id,
            tipe: q.tipe,
            pertanyaan: q.pertanyaan,
            opsi_a: opsi('opsi_a'), opsi_b: opsi('opsi_b'), opsi_c: opsi('opsi_c'),
            opsi_d: opsi('opsi_d'), opsi_e: opsi('opsi_e'),
            kunci: q.tipe === 'PG' ? kunci : null,
            pembahasan: q.pembahasan || null,
            jawaban_siswa: inJawab ? cleaned[q.id] : null,
            benar: q.tipe === 'ESAI' ? null : benar
        });
    }

    const tampilkanHasil = Number(ujian.tampilkan_hasil) === 1;
    return {
        status: 'SELESAI',
        nilai,
        ada_esai: adaEsai,
        total_soal: soal.length,
        dijawab: Object.keys(cleaned).length,
        benar: ringkas.benar,
        salah: ringkas.salah,
        kosong: ringkas.kosong,
        tampilkan_hasil: tampilkanHasil,
        detail: tampilkanHasil ? detail : undefined
    };
};

// Simpan progres jawaban secara berkala (belum finalisasi): hanya menulis ujian_peserta.jawaban
// agar resume/refresh bisa memuat jawaban_sebelum. Validasi akses sama seperti start/submit,
// tetapi TIDAK mengubah status (tetap MENGERJAKAN) & TIDAK menghitung nilai.
export const saveUjianService = async ({ ujian_id, kode, nim, jawaban }) => {
    const ujianRes = await db.execute({
        sql: 'SELECT * FROM ujian WHERE id = ?',
        args: [Number(ujian_id)]
    });
    const ujian = ujianRes.rows[0];
    if (!ujian) throw new Error('Ujian tidak ditemukan');
    if (ujian.mode !== 'ONLINE') throw new Error('Ujian ini tidak berjenis online');
    if (ujian.status !== 'TERBIT') throw new Error('Ujian belum diterbitkan');

    const now = new Date();
    const windowCheck = inWindow(ujian, now);
    if (!windowCheck.ok) throw new Error(windowCheck.message);

    if (!kode || String(kode).trim().toUpperCase() !== String(ujian.kode_akses || '').toUpperCase()) {
        throw new Error('Kode akses salah');
    }
    if (!nim) throw new Error('NIM wajib diisi');
    if (!jawaban || typeof jawaban !== 'object') throw new Error('jawaban wajib dikirim (objek)');

    const peserta = await getUjianPesertaPublic(ujian_id, nim);
    if (!peserta) throw new Error('NIM tidak terdaftar pada ujian ini');
    if (peserta.status === 'SELESAI') throw new Error('Anda sudah menyelesaikan ujian ini');

    const soalRes = await db.execute({
        sql: `
            SELECT bs.id, bs.tipe
            FROM ujian_soal us
            JOIN bank_soal bs ON us.soal_id = bs.id
            WHERE us.ujian_id = ?
        `,
        args: [Number(ujian_id)]
    });

    const cleaned = cleanJawaban(soalRes.rows, jawaban);
    await db.execute({
        sql: 'UPDATE ujian_peserta SET jawaban = ?, selesai = NULL, nilai = NULL WHERE id = ?',
        args: [JSON.stringify(cleaned), peserta.id]
    });

    return {
        status: peserta.status,
        tersimpan: Object.keys(cleaned).length,
        total_soal: soalRes.rows.length
    };
};

// ============================================================
// IMPORT BANK SOAL DARI EXCEL (.xlsx/.xls/.csv)
// Alur: GET /bank-soal/template → POST /bank-soal/import/preview
//       → POST /bank-soal/import/commit (atomik db.batch)
// ============================================================

export const BANK_SOAL_TEMPLATE_COLUMNS = [
    { key: 'tipe', label: 'Tipe', required: true, desc: 'PG atau ESAI' },
    { key: 'pertanyaan', label: 'Pertanyaan', required: true },
    { key: 'opsi_a', label: 'Opsi A', required: false },
    { key: 'opsi_b', label: 'Opsi B', required: false },
    { key: 'opsi_c', label: 'Opsi C', required: false },
    { key: 'opsi_d', label: 'Opsi D', required: false },
    { key: 'opsi_e', label: 'Opsi E', required: false },
    { key: 'kunci', label: 'Kunci', required: false, desc: 'A-E (wajib utk tipe PG)' },
    { key: 'bobot', label: 'Bobot', required: false, desc: 'Angka > 0, default 1' },
    { key: 'mapel', label: 'Mapel', required: false, desc: 'Nama mata pelajaran (sesuai Data Mapel)' },
    { key: 'jenjang', label: 'Jenjang', required: false, desc: 'Nama jenjang (mis. MTs / MDT)' },
    { key: 'kelas', label: 'Kelas', required: false, desc: 'Kosong = semua kelas' },
    { key: 'imda', label: 'IMDA', required: false, desc: 'IMDA 1 / IMDA 2 / IMDA 3 (kosong = semua)' },
    { key: 'pembahasan', label: 'Pembahasan', required: false }
];

const BANK_SOAL_HEADER_ALIASES = {
    tipe: ['tipe', 'tipe soal', 'jenis soal', 'type', 'tipe_soal'],
    pertanyaan: ['pertanyaan', 'soal', 'pernyataan', 'pertanyaan soal'],
    opsi_a: ['opsi a', 'opsi_a', 'pilihan a', 'jawaban a', 'opsi1', 'a'],
    opsi_b: ['opsi b', 'opsi_b', 'pilihan b', 'jawaban b', 'opsi2', 'b'],
    opsi_c: ['opsi c', 'opsi_c', 'pilihan c', 'jawaban c', 'opsi3', 'c'],
    opsi_d: ['opsi d', 'opsi_d', 'pilihan d', 'jawaban d', 'opsi4', 'd'],
    opsi_e: ['opsi e', 'opsi_e', 'pilihan e', 'jawaban e', 'opsi5', 'e'],
    kunci: ['kunci', 'kunci jawaban', 'jawaban benar', 'jawaban', 'kunci jwb', 'kunci_jawaban'],
    bobot: ['bobot', 'bobot soal', 'skor', 'poin', 'nilai'],
    mapel: ['mapel', 'mata pelajaran', 'subjek', 'subject', 'pelajaran'],
    jenjang: ['jenjang', 'tingkat', 'jenjang soal'],
    kelas: ['kelas', 'nama kelas', 'ruang kelas', 'kelas sasaran'],
    imda: ['imda', 'tingkat imda', 'level imda', 'imda sasaran', 'imda 1', 'imda 2', 'imda 3'],
    pembahasan: ['pembahasan', 'penjelasan', 'solusi']
};

const bankSoalNorm = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).trim();
    return String(v).trim();
};

const normTipe = (v) => {
    const s = bankSoalNorm(v).toUpperCase();
    if (['PG', 'PILIHAN GANDA', 'PILGAN', 'OBJEKTIF', 'MULTIPLE CHOICE'].includes(s)) return 'PG';
    if (['ESAI', 'ESSAY', 'URAIAN', 'ISIAN', 'SUBJEKTIF'].includes(s)) return 'ESAI';
    return s;
};

const findBankSoalHeader = (rows) => {
    for (let i = 0; i < rows.length; i++) {
        const joined = (rows[i] || []).map(bankSoalNorm).join('|').toLowerCase();
        if (/pertanyaan|tipe|poin|bobot/.test(joined)) return i;
    }
    return -1;
};

const mapBankSoalColumns = (headerCells) => {
    const map = {};
    const entries = Object.entries(BANK_SOAL_HEADER_ALIASES);
    const mappedIdx = new Set();
    headerCells.forEach((cell, idx) => {
        const key = bankSoalNorm(cell).toLowerCase();
        if (!key) return;
        for (const [field, aliases] of entries) {
            if (aliases.includes(key)) {
                if (!(field in map)) map[field] = idx;
                mappedIdx.add(idx);
                break;
            }
        }
    });
    headerCells.forEach((cell, idx) => {
        const key = bankSoalNorm(cell).toLowerCase();
        if (!key || mappedIdx.has(idx)) return;
        for (const [field, aliases] of entries) {
            if (aliases.some((a) => key.includes(a) || a.includes(key))) {
                if (!(field in map)) map[field] = idx;
                mappedIdx.add(idx);
                break;
            }
        }
    });
    return map;
};

const parseBankSoalWorkbook = (buffer) => {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('File tidak berisi sheet data.');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) throw new Error('File Excel/CSV kosong.');
    const headerIdx = findBankSoalHeader(rows);
    if (headerIdx === -1) throw new Error('Header tidak ditemukan. Pastikan kolom Tipe/Pertanyaan ada.');
    const map = mapBankSoalColumns(rows[headerIdx]);
    if (!('tipe' in map) || !('pertanyaan' in map)) {
        throw new Error('Kolom wajib Tipe dan Pertanyaan tidak ditemukan. Gunakan template bank soal.');
    }
    const records = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const cells = rows[i] || [];
        const rec = {};
        for (const [field, idx] of Object.entries(map)) rec[field] = bankSoalNorm(cells[idx]);
        records.push(rec);
    }
    return records.filter((r) => r.tipe !== '' || r.pertanyaan !== '');
};

const loadBankSoalLookups = async (ctx) => {
    const s = getSumber(ctx.lembaga);
    const scopeCtx = ctx.isAll ? '' : ' WHERE lembaga IN (?, \'ALL\')';
    const scopeCtxArgs = ctx.isAll ? [] : [ctx.lembaga];
    const kelasScope = s.kelasFilter ? ` WHERE ${s.kelasFilter}` : '';
    const [jenjangs, subjeks, kelas] = await Promise.all([
        db.execute({ sql: `SELECT id, nama_jenjang FROM jenjang${scopeCtx}`, args: scopeCtxArgs }),
        db.execute({ sql: `SELECT id, subject_code, subject_name FROM subjects${scopeCtx}`, args: scopeCtxArgs }),
        db.execute(`SELECT id, class_name FROM classes${kelasScope}`)
    ]);

    const matcher = (rows, key) => (name) => {
        const target = bankSoalNorm(name).toLowerCase();
        if (!target) return null;
        return rows.find((r) => String(r[key]).toLowerCase() === target)
            || rows.find((r) => String(r[key]).toLowerCase().includes(target) || target.includes(String(r[key]).toLowerCase()))
            || null;
    };

    return { lookupMapel: matcher(subjeks.rows, 'subject_name'), lookupJenjang: matcher(jenjangs.rows, 'nama_jenjang'), lookupKelas: matcher(kelas.rows, 'class_name') };
};

const validateBankSoalRecord = (rec, lookups) => {
    const errors = [];
    const tipe = normTipe(rec.tipe);
    const pertanyaan = bankSoalNorm(rec.pertanyaan);

    if (!tipe || !['PG', 'ESAI'].includes(tipe)) {
        errors.push(`Tipe wajib PG/ESAI${rec.tipe ? `: ${bankSoalNorm(rec.tipe)}` : ' (kosong)'}`);
    }
    if (!pertanyaan) errors.push('Pertanyaan wajib diisi');

    const kunciRaw = bankSoalNorm(rec.kunci);
    const kunci = tipe === 'PG' && kunciRaw ? kunciRaw.toUpperCase() : null;
    if (tipe === 'PG' && !kunci) {
        errors.push('Kunci wajib diisi utk soal PG (A s/d E)');
    } else if (kunci && !['A', 'B', 'C', 'D', 'E'].includes(kunci)) {
        errors.push(`Kunci tidak valid: ${kunciRaw}`);
    }

    const opsiKeys = ['opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e'];
    const opsiValues = opsiKeys.map((o) => bankSoalNorm(rec[o]));
    if (tipe === 'PG' && !opsiValues.some((v) => v)) {
        errors.push('Soal PG butuh minimal 1 opsi jawaban (Opsi A s/d E)');
    }

    let bobot = 1;
    if (bankSoalNorm(rec.bobot) !== '') {
        bobot = Number(rec.bobot);
        if (!Number.isFinite(bobot) || bobot <= 0) errors.push(`Bobot harus angka > 0: ${bankSoalNorm(rec.bobot)}`);
    }

    let subject_id = null;
    let subject_name = '';
    if (bankSoalNorm(rec.mapel)) {
        const m = lookups.lookupMapel(rec.mapel);
        if (m) { subject_id = m.id; subject_name = m.subject_name; }
        else errors.push(`Mapel tidak dikenal: ${bankSoalNorm(rec.mapel)}`);
    }
    let jenjang_id = null;
    let jenjang_name = '';
    if (bankSoalNorm(rec.jenjang)) {
        const j = lookups.lookupJenjang(rec.jenjang);
        if (j) { jenjang_id = j.id; jenjang_name = j.nama_jenjang; }
        else errors.push(`Jenjang tidak dikenal: ${bankSoalNorm(rec.jenjang)}`);
    }
    let classroom_id = null;
    let class_name = '';
    if (bankSoalNorm(rec.kelas)) {
        const c = lookups.lookupKelas(rec.kelas);
        if (c) { classroom_id = c.id; class_name = c.class_name; }
        else errors.push(`Kelas tidak dikenal: ${bankSoalNorm(rec.kelas)}`);
    }

    let imda = null;
    const imdaRaw = bankSoalNorm(rec.imda);
    if (imdaRaw) {
        imda = toUpper(imdaRaw);
        if (!IMDA_LIST.includes(imda)) {
            errors.push(`IMDA tidak dikenal: ${imdaRaw} (pilih ${IMDA_LIST.join(' / ')})`);
            imda = null;
        }
    }

    const opsi = {};
    opsiKeys.forEach((o, i) => { opsi[o] = opsiValues[i] || null; });

    return {
        tipe: tipe || rec.tipe,
        pertanyaan,
        ...opsi,
        kunci,
        bobot,
        subject_id,
        subject_name,
        jenjang_id,
        jenjang_name,
        classroom_id,
        class_name,
        imda,
        pembahasan: bankSoalNorm(rec.pembahasan) || null,
        status: errors.length ? 'ERROR' : 'VALID',
        errors
    };
};

export const buildBankSoalTemplateService = () => {
    const header = BANK_SOAL_TEMPLATE_COLUMNS.map((c) => c.label);
    const aoa = [
        header,
        ['PG', 'Siapa proklamator kemerdekaan Indonesia?', 'Ir. Soekarno', 'Moh. Hatta', 'Sukarni', 'Ahmad Soebardjo', 'Bung Tomo', 'A', '1', 'IPS', 'Madrasah Tsanawiyah', 'Kelas 7A', 'IMDA 1', 'Tokoh Pahlawan Nasional'],
        ['ESAI', 'Jelaskan makna Pancasila sila pertama!', '', '', '', '', '', '', '1', 'PKn', 'Madrasah Tsanawiyah', '', '', 'Pembahasan singkat']
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bank Soal');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

export const previewImportBankSoalService = async (buffer, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const records = parseBankSoalWorkbook(buffer);
    const lookups = await loadBankSoalLookups(ctx);
    const rows = records.map((rec) => validateBankSoalRecord(rec, lookups));
    return {
        lembaga: ctx.lembaga,
        total: rows.length,
        valid: rows.filter((r) => r.status === 'VALID').length,
        error: rows.filter((r) => r.status === 'ERROR').length,
        rows
    };
};

export const commitImportBankSoalService = async (buffer, lembaga = 'ALL', selectedIndices = null) => {
    const ctx = getContext(lembaga);
    const records = parseBankSoalWorkbook(buffer);
    const lookups = await loadBankSoalLookups(ctx);
    const validated = records.map((rec) => validateBankSoalRecord(rec, lookups));
    const validRows = validated.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 'VALID');
    const indices = selectedIndices && selectedIndices.length ? new Set(selectedIndices.map((n) => Number(n))) : null;
    const toImport = indices ? validRows.filter(({ i }) => indices.has(i)) : validRows;

    if (!toImport.length) {
        return {
            lembaga: ctx.lembaga,
            imported: 0,
            skipped: validated.length,
            errors: validated.filter((r) => r.status === 'ERROR').map((r) => ({ pertanyaan: r.pertanyaan || '-', message: r.errors.join('; ') }))
        };
    }

    const ops = toImport.map(({ r }) => ({
        sql: `INSERT INTO bank_soal (subject_id, jenjang_id, classroom_id, imda, tipe, pertanyaan, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, kunci, pembahasan, bobot, lembaga)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            r.subject_id, r.jenjang_id, r.classroom_id, r.imda, r.tipe, r.pertanyaan,
            r.opsi_a, r.opsi_b, r.opsi_c, r.opsi_d, r.opsi_e,
            r.kunci, r.pembahasan, r.bobot, ctx.lembaga
        ]
    }));
    await db.batch(ops, 'write');

    return {
        lembaga: ctx.lembaga,
        imported: toImport.length,
        skipped: validated.length - toImport.length,
        errors: validated.filter((r) => r.status === 'ERROR').map((r) => ({ pertanyaan: r.pertanyaan || '-', message: r.errors.join('; ') }))
    };
};