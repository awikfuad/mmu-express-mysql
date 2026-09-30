import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { getActiveAcademicYearIdService } from './paymentSettingService.js';
import { getAllLembagaService } from './lembagaService.js';

const getContext = (lembaga) => {
    const s = getSumber(lembaga);
    return {
        lembaga: s.lembaga,
        isAll: s.isAll,
        isTpq: s.isTpq,
        sumber: s.sumber,
        santriTable: s.santriTable
    };
};

export const BULAN_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// Alias nama bulan hijriyah: canonical (BULAN_HIJRIYAH) + varian pendek yang dipakai kasir
// (payment_transactions.month terisi dari PaymentManagement, mis. 'Rb. Ula' / 'Shafar').
export const HIJRI_BULAN_ALIASES = {
    Muharram: ['Muharram'],
    Safar: ['Safar', 'Shafar'],
    'Rabiul Awal': ['Rabiul Awal', 'Rb. Ula'],
    'Rabiul Akhir': ['Rabiul Akhir', 'Rb. Tsani'],
    'Jumadil Awal': ['Jumadil Awal', 'Jmd. Ula'],
    'Jumadil Akhir': ['Jumadil Akhir', 'Jmd. Tsani'],
    Rajab: ['Rajab'],
    "Sya'ban": ["Sya'ban"],
    Ramadhan: ['Ramadhan', 'Ramadan'],
    Syawal: ['Syawal'],
    "Dzulqa'dah": ["Dzulqa'dah", "Dz. Qo'dah"],
    Dzulhijjah: ['Dzulhijjah', 'Dz. Hijjah']
};

const capitalize = (v) => {
    const s = String(v || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
};

const resolveNominal = (map, type, lembaga) => {
    const m = map[type] || {};
    return m[lembaga] ?? m['ALL'] ?? null;
};

const hitungStatus = (paid, nominal) => {
    if (!nominal || nominal <= 0) return 'BELUM DISETTING';
    if (paid >= nominal) return 'LUNAS';
    if (paid > 0) return 'TUNGGAK';
    return 'BELUM BAYAR';
};

// Atribusi pembayaran per sumber: id transaksi (pt.student_id) mengacu id tabel penempatan
// santri_penempatan. Id madrasah & tpq kini satu tabel, dibedakan lewat kolom sumber.
const attributionClause = (sumber) => `
    EXISTS (SELECT 1 FROM santri_penempatan t WHERE t.id = pt.student_id AND t.sumber = '${sumber}')
`;

// Bangun laporan untuk satu sumber roster (madrasah atau tpq)
const buildTableReport = async ({ sumber, lembagaLabel, yearId, months, bulanLabel, classroom_id, jenjang_id, nominalMap }) => {
    const extra = [];
    const args = [sumber, yearId];
    if (classroom_id) {
        extra.push(`s.classroom_id = ?`);
        args.push(Number(classroom_id));
    }
    if (jenjang_id) {
        extra.push(`s.jenjang_id = ?`);
        args.push(Number(jenjang_id));
    }
    const extraSql = extra.length ? ` AND ${extra.join(' AND ')}` : '';

    const roster = await db.execute({
        sql: `
            SELECT s.id AS student_id, s.nim, s.name, c.class_name
            FROM santri_penempatan s LEFT JOIN classes c ON c.id = s.classroom_id AND c.sumber = s.sumber
            WHERE s.sumber = ? AND s.status = 1 AND s.academic_year_id = ? ${extraSql}
            ORDER BY c.class_name ASC, s.nim ASC
        `,
        args
    });
    const students = roster.rows;

    const attrSql = attributionClause(sumber);
    const monthInSql = months.map(() => '?').join(', ');
    const yaumiyahRes = await db.execute({
        sql: `
            SELECT pt.student_id, SUM(pt.amount) AS total
            FROM payment_transactions pt
            WHERE pt.academic_year_id = ? AND pt.payment_type = 'YAUMIYAH' AND pt.month IN (${monthInSql})
              AND ${attrSql}
            GROUP BY pt.student_id
        `,
        args: [yearId, ...months]
    });
    const duRes = await db.execute({
        sql: `
            SELECT pt.student_id, SUM(pt.amount) AS total
            FROM payment_transactions pt
            WHERE pt.academic_year_id = ? AND pt.payment_type = 'DAFTAR_ULANG'
              AND ${attrSql}
            GROUP BY pt.student_id
        `,
        args: [yearId]
    });

    const yaumiyahPaidMap = {};
    for (const r of yaumiyahRes.rows) yaumiyahPaidMap[Number(r.student_id)] = Number(r.total) || 0;
    const duPaidMap = {};
    for (const r of duRes.rows) duPaidMap[Number(r.student_id)] = Number(r.total) || 0;

    return students.map((s) => {
        const sid = Number(s.student_id);
        const yaumiyahNominal = resolveNominal(nominalMap, 'YAUMIYAH', lembagaLabel);
        const duNominal = resolveNominal(nominalMap, 'DAFTAR_ULANG', lembagaLabel);
        const yaumiyahPaid = yaumiyahPaidMap[sid] || 0;
        const duPaid = duPaidMap[sid] || 0;

        return {
            student_id: sid,
            nim: s.nim,
            name: s.name,
            class_name: s.class_name || null,
            lembaga: lembagaLabel,
            bulan: bulanLabel,
            yaumiyah_nominal: yaumiyahNominal,
            yaumiyah_paid: yaumiyahPaid,
            yaumiyah_due: yaumiyahNominal ? Math.max(0, yaumiyahNominal - yaumiyahPaid) : null,
            yaumiyah_status: hitungStatus(yaumiyahPaid, yaumiyahNominal),
            du_nominal: duNominal,
            du_paid: duPaid,
            du_due: duNominal ? Math.max(0, duNominal - duPaid) : null,
            du_status: hitungStatus(duPaid, duNominal),
            total_due: (yaumiyahNominal ? Math.max(0, yaumiyahNominal - yaumiyahPaid) : 0) + (duNominal ? Math.max(0, duNominal - duPaid) : 0)
        };
    });
};

// Laporan tunggakan iuran per siswa (YAUMIYAH per bulan + DAFTAR_ULANG per tahun)
export const getTunggakanIuranService = async ({ academic_year_id, bulan, bulan_hijriyah, classroom_id, jenjang_id }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);

    let yearId = academic_year_id ? Number(academic_year_id) : null;
    if (!yearId) yearId = await getActiveAcademicYearIdService();
    if (!yearId) throw new Error('Tahun ajaran tidak ditemukan. Pilih tahun ajaran atau aktifkan tahun ajaran terlebih dahulu.');

    let bulanFinal;
    let months;
    if (bulan_hijriyah) {
        // Bulan hijriyah (canonical atau varian pendek kasir, mis. 'Rb. Ula') — cocokkan via alias.
        const input = String(bulan_hijriyah).trim().toLowerCase();
        const key = Object.keys(HIJRI_BULAN_ALIASES)
            .find((k) => HIJRI_BULAN_ALIASES[k].some((a) => a.toLowerCase() === input));
        if (!key) {
            throw new Error('Bulan hijriyah tidak valid! Gunakan nama bulan hijriyah, mis. Syawal');
        }
        bulanFinal = key;
        months = HIJRI_BULAN_ALIASES[key];
    } else {
        const b = capitalize(bulan) || BULAN_NAMES[new Date().getMonth()];
        if (!BULAN_NAMES.includes(b)) {
            throw new Error(`Bulan tidak valid! Gunakan nama bulan, mis. ${BULAN_NAMES[new Date().getMonth()]}`);
        }
        bulanFinal = b;
        months = [b];
    }

    const settings = await db.execute({
        sql: `SELECT payment_type, lembaga, nominal FROM payment_settings WHERE academic_year_id = ?`,
        args: [yearId]
    });
    const nominalMap = {};
    for (const r of settings.rows) {
        nominalMap[r.payment_type] = nominalMap[r.payment_type] || {};
        nominalMap[r.payment_type][r.lembaga] = Number(r.nominal);
    }

    const common = { yearId, months, bulanLabel: bulanFinal, classroom_id, jenjang_id, nominalMap };

    let data;
    if (ctx.isAll) {
        // Super Admin: roster dibangun per sumber dari master lembaga (ALL → seluruh sumber yang ada),
        // diferensiasi per lembaga lewat groupBy nanti. Fallback: madrasah + tpq klasik.
        const sources = [];
        for (const lem of (await getAllLembagaService())) {
            const src = String(lem.sumber || '').toLowerCase();
            if (src && !sources.some((x) => x.src === src)) {
                sources.push({ src, label: String(lem.kode).toUpperCase() });
            }
        }
        if (!sources.length) sources.push({ src: 'madrasah', label: 'MADRASAH' }, { src: 'tpq', label: 'TPQ' });
        const built = [];
        for (const { src, label } of sources) {
            built.push(...(await buildTableReport({ ...common, sumber: src, lembagaLabel: label })));
        }
        data = built;
    } else {
        data = await buildTableReport({ ...common, sumber: ctx.sumber, lembagaLabel: ctx.lembaga });
    }

    data.sort((a, b) => (a.class_name || '').localeCompare(b.class_name || '') || a.nim.localeCompare(b.nim));

    const summary = {
        academic_year_id: yearId,
        bulan: bulanFinal,
        total_students: data.length,
        total_tagihan_yaumiyah: data.reduce((s, d) => s + (d.yaumiyah_nominal || 0), 0),
        total_bayar_yaumiyah: data.reduce((s, d) => s + d.yaumiyah_paid, 0),
        total_tunggakan_yaumiyah: data.reduce((s, d) => s + (d.yaumiyah_due || 0), 0),
        total_lunas: data.filter((d) => d.yaumiyah_status === 'LUNAS').length,
        total_belum_bayar: data.filter((d) => d.yaumiyah_status === 'BELUM BAYAR').length,
        total_tunggak: data.filter((d) => d.yaumiyah_status === 'TUNGGAK').length,
        total_du_lunas: data.filter((d) => d.du_status === 'LUNAS').length,
        total_du_belum: data.filter((d) => d.du_status === 'BELUM BAYAR').length,
        total_du_tunggak: data.filter((d) => d.du_status === 'TUNGGAK').length
    };

    return { data, summary };
};
