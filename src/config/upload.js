import multer from 'multer';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = 'public/uploads/';

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Ekstensi berbahaya yang ditolak (defense in depth, walau filter utama sudah membatasi)
const DANGEROUS_EXT = /\.(php|php3|php4|php5|php7|phar|phtml|pl|py|cgi|sh|asp|aspx|jsp|exe|bat|cmd|js|html|htm|svg)$/;

// Filter tipe file yang boleh diunggah
const fileFilter = (req, file, cb) => {
    const originalExt = path.extname(file.originalname).toLowerCase();
    const allowedTypes = /\.(jpeg|jpg|png|pdf)$/;
    const extnameOk = allowedTypes.test(originalExt);
    const mimetypeOk = /image\/(jpeg|jpg|png)|application\/pdf/.test(file.mimetype);

    if (extnameOk && mimetypeOk) {
        return cb(null, true);
    }
    cb(new Error('Hanya diperbolehkan mengunggah file gambar (JPG/PNG) atau PDF!'));
};

// Multer MEMORY storage untuk upload bukti/gambar. File tidak langsung ditulis ke disk;
// buffer dikirim ke Cloudinary (primary) atau disimpan lokal (fallback) di service.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }, // Batas maksimal: 2 MegaBytes
    fileFilter: fileFilter
});

// Fallback lokal (saat Cloudinary belum dikonfigurasi): tulis buffer ke public/uploads/
// dan kembalikan path relatif seperti '/uploads/transfer_proof-xxxxx.png'.
export const saveLocalUpload = (buffer, originalname, fieldname = 'file') => {
    return new Promise((resolve, reject) => {
        const ext = path.extname(originalname || '').toLowerCase() || '.png';
        const filename = `${fieldname}-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
        const fullPath = path.join(UPLOAD_DIR, filename);
        const dest = path.resolve(UPLOAD_DIR);

        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        fs.writeFile(fullPath, buffer, (err) => {
            if (err) return reject(err);
            resolve(`/uploads/${filename}`);
        });
    });
};

// Upload file Excel/CSV (import data massal) — diproses di memory, tidak disimpan ke disk
// (aman untuk Vercel yang filesystem-nya read-only/ephemeral).
const excelFileFilter = (req, file, cb) => {
    const originalExt = path.extname(file.originalname).toLowerCase();
    const allowedTypes = /\.(xlsx|xls|csv)$/;
    if (allowedTypes.test(originalExt) && /(spreadsheetml.sheet|excel|csv)/.test(file.mimetype)) {
        return cb(null, true);
    }
    // Beberapa browser mengirim application/octet-stream untuk .xlsx — izinkan berbasis ekstensi
    if (allowedTypes.test(originalExt)) {
        return cb(null, true);
    }
    cb(new Error('Hanya diperbolehkan mengunggah file Excel (.xlsx/.xls) atau CSV!'));
};

const uploadExcel = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // Batas maksimal: 5 MegaBytes
});

// Upload backup restore (.db / .sql) — memory storage, validasi ekstensi ketat
const backupFileFilter = (req, file, cb) => {
    const originalExt = path.extname(file.originalname).toLowerCase();
    const allowedTypes = /\.(db|sqlite|sql)$/;
    if (allowedTypes.test(originalExt)) {
        return cb(null, true);
    }
    cb(new Error('Hanya diperbolehkan mengunggah file backup .db / .sqlite / .sql!'));
};

const uploadBackup = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB — database bisa membesar
    fileFilter: backupFileFilter
});

// Upload file iCalendar (.ics) untuk impor agenda kalender — memory storage
const icsFileFilter = (req, file, cb) => {
    const originalExt = path.extname(file.originalname || '').toLowerCase();
    if (originalExt === '.ics' || /(text\/calendar|ical(endar)?)/.test(file.mimetype)) {
        return cb(null, true);
    }
    cb(new Error('Hanya diperbolehkan mengunggah file .ics!'));
};

const uploadIcs = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: icsFileFilter
});

// Upload PDF arsip soal — memory storage, hanya PDF, batas 20 MB (soal+scan bisa besar)
const pdfFileFilter = (req, file, cb) => {
    const originalExt = path.extname(file.originalname || '').toLowerCase();
    if (originalExt === '.pdf' || /application\/pdf/.test(file.mimetype)) {
        return cb(null, true);
    }
    cb(new Error('Hanya diperbolehkan mengunggah file PDF!'));
};

const uploadPdf = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: pdfFileFilter
});

export default upload;
export { uploadExcel, excelFileFilter, uploadBackup, backupFileFilter, uploadIcs, icsFileFilter, uploadPdf, pdfFileFilter };