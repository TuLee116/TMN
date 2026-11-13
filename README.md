# TMN-Exam – Hệ thống kiểm tra nội bộ Tân Minh Nhân

Node.js (Express) + React (Vite, Tailwind) + Postgres, có giám sát webcam bằng MediaPipe. Đặc tả chi tiết: [SPEC.md](SPEC.md).

- Trang thí sinh: `/#/`
- Trang quản trị: `/#/admin` (đăng nhập bằng `ADMIN_PASSWORD`)

## Cấu trúc

| Thư mục / tệp | Vai trò |
|---|---|
| `server/index.js` | Máy chủ Express: API `/api/exam/*`, `/api/admin/*`, phục vụ `dist/` |
| `server/db.js` | Kết nối Postgres, tạo bảng khi khởi động, cấu hình mặc định |
| `server/attempts.js` | Chấm điểm, nộp bài, chốt bài quá hạn |
| `server/importer.js` | Đọc câu hỏi Excel/Word, danh sách email, tệp mẫu |
| `server/pdf.js`, `server/export.js` | PDF bài làm, ZIP hồ sơ kết quả |
| `client/` | Giao diện React (thí sinh, admin, giám sát webcam) |
| `public/` | Tệp tĩnh (có thể đặt `logo.png` mặc định ở đây) |

## Biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | Có | Chuỗi kết nối Postgres |
| `ADMIN_PASSWORD` | Có | Mật khẩu trang quản trị |
| `SESSION_SECRET` | Có | Chuỗi ngẫu nhiên dài để ký cookie |
| `EMAIL_DOMAIN` | Không | Mặc định `tanminhnhan.com.vn` |
| `TEST_MODE` | Không | `true` = chế độ thử (chuyển tab không tự nộp, được thoát toàn màn hình, có nút làm lại) |
| `MAX_PARTICIPANTS` | Không | Số email tối đa trong danh sách, mặc định 1000 |
| `PG_POOL_MAX` | Không | Số kết nối Postgres tối đa, mặc định 10 |
| `PGSSL` | Không | `true` nếu Postgres yêu cầu SSL mà chuỗi kết nối không có `sslmode=require` |
| `PORT` | Không | Railway tự cấp |

## Chạy trên máy

Cần Node.js ≥ 20 và một Postgres.

```bash
npm install
npm run build
```

PowerShell:

```powershell
$env:DATABASE_URL="postgres://user:pass@localhost:5432/tmn_exam"
$env:ADMIN_PASSWORD="..."; $env:SESSION_SECRET="..."; $env:TEST_MODE="true"
npm start
# mở http://localhost:3000
```

Phát triển giao diện (tự nạp lại khi sửa): chạy `npm start` ở một cửa sổ, `npm run dev` ở cửa sổ khác rồi mở
http://localhost:5173 (Vite chuyển `/api` và `/mediapipe` sang cổng 3000).

## Triển khai trên Railway

1. **New Project → Deploy from GitHub repo** → chọn repo này.
2. **+ New → Database → PostgreSQL**.
3. Service web → **Variables**: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `ADMIN_PASSWORD`, `SESSION_SECRET`.
4. **Settings → Networking → Generate Domain**.

`railway.json` đã đặt lệnh build (`npm ci && npm run build`), lệnh chạy (`npm start`) và kiểm tra sống `/healthz`.
Bảng dữ liệu tự tạo khi khởi động. Logo tải lên trong tab **Cấu hình**.

## Quy trình một kỳ thi

1. **Cấu hình**: tiêu đề, giờ mở/đóng, số câu, điểm, điểm đạt, công trình, logo, webcam.
2. **Danh sách email**: nhập Excel theo mẫu hoặc dán email.
3. **Câu hỏi**: tải mẫu Excel/Word → điền → *Kiểm tra tệp* → *Lưu vào hệ thống*.
4. Bật **Mở kỳ thi**. Thí sinh vào `/#/`.
5. **Chấm tự luận**, theo dõi ở **Quản lý bài làm / Thống kê**.
6. **Hồ sơ kết quả**: chốt bài hết hạn, tải ZIP; sau kỳ thi có thể *Tải ZIP và xóa dữ liệu* để chuẩn bị kỳ mới.

## Giám sát webcam

- Chạy hoàn toàn trên trình duyệt thí sinh (MediaPipe FaceLandmarker); chỉ ảnh nhỏ ~160px tại thời điểm cảnh báo được gửi về
  (tối đa 20 ảnh/bài).
- WASM do máy chủ phục vụ tại `/mediapipe/wasm`; mô hình `face_landmarker.task` tải từ `storage.googleapis.com` – mạng của
  thí sinh cần truy cập được địa chỉ này.
- Camera chỉ hoạt động trên HTTPS hoặc `localhost` (Railway có HTTPS sẵn).
- Ngưỡng mặc định (quay đầu 0,12, liếc mắt 0,18, giữ 2 giây) nên chạy thử với vài người trước kỳ thi thật rồi chỉnh trong tab Cấu hình.
