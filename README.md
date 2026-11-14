# TMN-Exam – Hệ thống kiểm tra nội bộ Tân Minh Nhân

Node.js (Express) + React (Vite, Tailwind) + Postgres, có giám sát webcam bằng MediaPipe. Đặc tả chi tiết: [SPEC.md](SPEC.md).

- Trang thí sinh: `/#/`
- Trang quản trị: `/#/admin` – tài khoản quản trị chính: để trống tên đăng nhập (hoặc `admin`) + `ADMIN_PASSWORD`;
  thêm tài khoản Quản trị / Giám khảo trong tab **Tài khoản**

## Cấu trúc

| Thư mục / tệp | Vai trò |
|---|---|
| `server/index.js` | Máy chủ Express: API `/api/exam/*`, `/api/admin/*`, phục vụ `dist/` |
| `server/db.js` | Kết nối Postgres, tạo bảng khi khởi động, cấu hình mặc định |
| `server/attempts.js` | Chấm điểm, nộp bài, chốt bài quá hạn |
| `server/importer.js` | Đọc câu hỏi Excel/Word, danh sách email, tệp mẫu |
| `server/pdf.js`, `server/export.js` | PDF bài làm, ZIP hồ sơ kết quả |
| `server/accounts.js` | Mật khẩu tài khoản, nhật ký thao tác, gửi email (Resend / SMTP) |
| `client/` | Giao diện React (thí sinh, admin, giám sát webcam) |
| `public/` | Tệp tĩnh: `logo.png` (logo mặc định Tân Minh Nhân), `favicon.png` |

## Biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | Có | Chuỗi kết nối Postgres |
| `ADMIN_PASSWORD` | Có | Mật khẩu tài khoản quản trị chính (`admin`) |
| `SESSION_SECRET` | Có | Chuỗi ngẫu nhiên dài để ký cookie |
| `EMAIL_DOMAIN` | Không | Mặc định `tanminhnhan.com.vn` |
| `TEST_MODE` | Không | `true` = chế độ thử (chuyển tab không tự nộp, được thoát toàn màn hình, có nút làm lại) |
| `MAX_PARTICIPANTS` | Không | Số email tối đa trong danh sách, mặc định 1000 |
| `PG_POOL_MAX` | Không | Số kết nối Postgres tối đa, mặc định 10 |
| `PGSSL` | Không | `true` nếu Postgres yêu cầu SSL mà chuỗi kết nối không có `sslmode=require` |
| `PORT` | Không | Railway tự cấp |
| `RESEND_API_KEY` | Không | Gửi email kết quả qua Resend (HTTPS) – khuyên dùng trên Railway |
| `MAIL_FROM` | Khi gửi email | Người gửi, vd `Tân Minh Nhân <thongbao@ten-mien.vn>` (tên miền phải được xác minh ở Resend) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Không | Gửi email qua SMTP thay cho Resend (gói Hobby của Railway chặn cổng SMTP) |

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

`railway.json` đã đặt lệnh build (`npm run build`; Railway tự chạy `npm ci` trước), lệnh chạy (`npm start`) và kiểm tra sống `/healthz`.
Bảng dữ liệu tự tạo khi khởi động. Logo tải lên trong tab **Cấu hình**.

## Quy trình một kỳ thi

1. **Cấu hình**: tiêu đề, giờ mở/đóng, số câu, điểm, điểm đạt, công trình, logo, webcam.
2. **Danh sách email**: nhập Excel theo mẫu hoặc dán email.
3. **Câu hỏi**: tải mẫu Excel/Word → điền → *Kiểm tra tệp* → *Lưu vào hệ thống*.
4. Bật **Mở kỳ thi**. Thí sinh vào `/#/`.
5. Theo dõi ở **Tổng quan** và **Đang thi** (tự cập nhật, thu bài, bài nghi vấn).
6. **Chấm tự luận** (Quản trị hoặc Giám khảo), xem kết quả ở **Bài làm & thống kê**.
7. **Hồ sơ kết quả**: chốt bài hết hạn → tải ZIP → gửi email kết quả → **Kết thúc đợt & lưu trữ** (bài làm chuyển sang
   **Lịch sử đợt thi**, xem lại / tải ZIP bất cứ lúc nào) để bắt đầu đợt mới.
8. **Nhật ký** ghi lại mọi thao tác quan trọng: ai, lúc nào, làm gì.

## Ngân hàng câu hỏi

- Mỗi câu có **chủ đề** và **độ khó** (dễ / trung bình / khó) – cột *Chủ đề*, *Độ khó* trong mẫu Excel, dòng `Chủ đề:`, `Độ khó:` trong mẫu Word.
- Cấu hình → *Rút câu trắc nghiệm theo tỷ lệ độ khó*: mọi thí sinh nhận cùng cơ cấu; thiếu câu ở mức nào hệ thống bù bằng câu khác.
- Thêm / sửa / xóa câu ngay trên web. Khi đã có bài làm chỉ sửa được đáp án đúng, tham khảo, chủ đề, độ khó – sửa đáp án đúng sẽ tự chấm lại.
- Cột *Tỷ lệ đúng* tính từ bài đã nộp: < 30% có thể quá khó / sai đáp án, > 90% có thể quá dễ.

## Giám sát webcam

- Chạy hoàn toàn trên trình duyệt thí sinh (MediaPipe FaceLandmarker); chỉ ảnh nhỏ ~160px tại thời điểm cảnh báo được gửi về
  (tối đa 20 ảnh/bài).
- WASM do máy chủ phục vụ tại `/mediapipe/wasm`; mô hình `face_landmarker.task` tải từ `storage.googleapis.com` – mạng của
  thí sinh cần truy cập được địa chỉ này.
- Camera chỉ hoạt động trên HTTPS hoặc `localhost` (Railway có HTTPS sẵn).
- Ngưỡng mặc định (quay đầu 0,12, liếc mắt 0,18, giữ 2 giây) nên chạy thử với vài người trước kỳ thi thật rồi chỉnh trong tab Cấu hình.
