// Helper parsing tanggal lahir dari berbagai format yang ditemukan di data_murid/data_santri.
// Contoh format: '26 Agustus 2016', '16/09/2017', '16-09-2017', '2016-08-26', "03 Oktober 2017"

const BULAN = {
    januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
    juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12
};

export const parseTanggalLahir = (str) => {
    if (!str || typeof str !== 'string') return null;
    // Bersihkan kutip ganjil/spasi berlebih (ada data dengan leading apostrophe)
    const s = str.trim().replace(/^['"]+/, '').replace(/['"]+$/, '').trim();
    if (!s) return null;

    // Format: 'D Bulan YYYY' (misal '26 Agustus 2016')
    let m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (m) {
        const month = BULAN[m[2].toLowerCase()];
        if (month) return { day: Number(m[1]), month, year: Number(m[3]) };
    }

    // Format numerik: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD, YYYY/MM/DD
    m = s.match(/^(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})$/);
    if (m) {
        const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
        let day, month, year;
        if (a > 1000) { // YYYY-MM-DD
            year = a; month = b; day = c;
        } else { // DD-MM-YYYY
            day = a; month = b; year = c > 1000 ? c : (c + 2000);
        }
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return { day, month, year };
        }
    }
    return null;
};

export const tanggalSama = (a, b) =>
    !!a && !!b && a.day === b.day && a.month === b.month && a.year === b.year;
