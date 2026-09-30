# MMU Express MySQL — Backend

Backend API untuk sistem manajemen sekolah/madrasah MMU A-44.
**Node.js 22 + Express 5 + MySQL 8**, dibungkus Docker image multi-arch
(`linux/amd64` & `linux/arm64`) dan otomatis dibangun lewat GitHub Actions.

---

## Deploy di ZimaOS (paling mudah)

1. **Docker → App → Custom App**, tempel isi `docker-compose.yml` dari repo ini.
2. Isi environment minimal:

   | Key | Keterangan |
   |---|---|
   | `MYSQL_ROOT_PASSWORD` | Password root MySQL (wajib) |
   | `JWT_SECRET` | Kunci token access (wajib) |
   | `JWT_REFRESH_SECRET` | Kunci token refresh (wajib, berbeda dari `JWT_SECRET`) |
   | `HTTP_PORT` | Port host, default `5000` |

   Buat secret acak dengan:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

3. Klik **Install**. ZimaOS akan pull image dari Docker Hub lalu start container.
4. Cek: `http://<IP-NAS>:5000/api/health` → `{"status":"online",...}`

Tabel database dibuat otomatis saat container pertama kali start
(`CREATE TABLE IF NOT EXISTS` di `src/config/db.js`), dan akun admin
default dibuat otomatis. **Ganti password admin setelah login.**

---

## Deploy manual (Docker Compose)

```bash
git clone https://github.com/awikfuad/mmu-express-mysql.git
cd mmu-express-mysql
cp .env.example .env
# edit .env, isi JWT_SECRET & JWT_REFRESH_SECRET
docker compose up -d
docker compose logs -f backend
```

Perintah lain:

```bash
docker compose pull      # ambil image terbaru
docker compose restart   # restart setelah update .env
docker compose down      # stop (data di named volume aman)
```

---

## Deploy dengan image yang baru di-build sendiri

```bash
docker compose build backend
docker compose up -d
```

---

## Environment variables

| Variable | Default | Keterangan |
|---|---|---|
| `PORT` | `5000` | Port internal API |
| `NODE_ENV` | `production` | Mode aplikasi |
| `MYSQL_HOST` | `db` | Host MySQL (nama service di compose) |
| `MYSQL_PORT` | `3306` | Port MySQL |
| `MYSQL_USER` / `MYSQL_PASSWORD` | `root` / — | Kredensial MySQL |
| `MYSQL_DATABASE` | `mmu_a44` | Nama database |
| `JWT_SECRET` | — | **Wajib.** Kunci token access |
| `JWT_REFRESH_SECRET` | — | **Wajib.** Kunci token refresh |
| `DEFAULT_RESET_PASSWORD` | `santri123` | Password awal akun santri |
| `CORS_ORIGIN` | `*` | `*` atau daftar origin dipisah koma |
| `TRUST_PROXY` | `true` | `true` bila di belakang reverse proxy |
| `GOOGLE_CLIENT_ID` | — | Aktifkan login Google (opsional) |
| `CLOUDINARY_*` | — | Cloudinary (opsional, fallback ke volume lokal) |

Aplikasi menolak start bila `JWT_SECRET` / `JWT_REFRESH_SECRET` kosong
atau masih memakai nilai default lemah.

---

## Volumes

| Volume | Isi |
|---|---|
| `mmu_mysql_data` | Data MySQL (jangan dihapus) |
| `mmu_uploads` | Bukti transfer & lampiran bila Cloudinary tidak dipakai |

---

## Image Docker

```
awikfuad/mmu-express-mysql:latest    # tag utama (branch main)
awikfuad/mmu-express-mysql:<sha>    # commit pendek
awikfuad/mmu-express-mysql:v1.0.0   # dari git tag
```

---

## GitHub Actions

| Workflow | Trigger | Fungsi |
|---|---|---|
| `.github/workflows/docker-publish.yml` | push ke `main`, tag `v*`, manual | Build multi-arch & push ke Docker Hub |
| `.github/workflows/ci.yml` | pull request, manual | Validasi compose & build image tanpa push |

### Setup secrets di GitHub

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Wajib | Isi |
|---|---|---|
| `DOCKERHUB_TOKEN` | ya | Access token Docker Hub (Account Settings → Security → Personal access tokens) |

**Settings → Secrets and variables → Actions → Variables** (opsional)

| Variable | Default | Isi |
|---|---|---|
| `DOCKERHUB_USERNAME` | `awikfuad` | Username Docker Hub |

> Push hanya berjalan bila token tersedia. Bila `DOCKERHUB_TOKEN` kosong,
> workflow tetap build tapi tidak push.

---

## Endpoint penting

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/api/health` | Health check (tanpa auth) |
| `GET` | `/api-docs.html` | Dokumentasi API |
| `POST` | `/api/auth/login` | Login terpadu (admin/guru/santri) |

---

## Lisensi

MIT
