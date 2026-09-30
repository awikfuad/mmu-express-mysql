import cloudinary from 'cloudinary';
import 'dotenv/config';

// Konfigurasi Cloudinary dari environment (fail-safe bila belum diisi).
cloudinary.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

// Cloudinary hanya dipakai bila ketiga credential tersedia.
// Bila belum di-setting, sistem kembali ke penyimpanan lokal (fallback).
export const isCloudinaryConfigured = () => {
    return !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
};

// Upload buffer file (dari multer memory-storage) ke Cloudinary.
// resource_type 'auto' menangani gambar (JPG/PNG) maupun PDF.
export const uploadBufferToCloudinary = (buffer, { folder = 'mmu44-app', public_id, resource_type = 'auto' } = {}) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.v2.uploader.upload_stream(
            { folder, public_id, resource_type },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(buffer);
    });
};

// Hapus aset dari Cloudinary (berguna saat bukti diganti/dihapus).
export const deleteFromCloudinary = (publicId) => {
    return new Promise((resolve) => {
        cloudinary.v2.api.delete_resources([publicId], (error, result) => {
            if (error) return resolve(null);
            resolve(result);
        });
    });
};