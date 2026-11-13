# TMN-Exam – Đặc tả dựng lại hệ thống kiểm tra nội bộ Tân Minh Nhân

Dựng lại web thi `exam-tan-minh-nhan.vercel.app` (bản cũ: React/Vite + API serverless trên Vercel, không có mã nguồn) thành ứng dụng **Node.js (Express) + React (Vite, Tailwind) + Postgres**, deploy trên **Railway** (1 service web + 1 Postgres), có thêm **giám sát webcam**.

## Trạng thái hiện tại của repo
- `package.json`: đã khai báo thư viện (express, pg, exceljs, mammoth, docx, pdfkit, archiver, dejavu-fonts-ttf, react, vite, tailwind, @mediapipe/tasks-vision). Build deps để ở `dependencies` để Railway build được.
- `server/db.js`: schema Postgres (app_settings, projects, participants, questions, exam_attempts, exam_events) + DEFAULT_SETTINGS.
- `server/util.js`: giờ VN, cookie ký HMAC, kiểm tra email domain, tính điểm, các mốc phân bố điểm.
- `server/index.js`: toàn bộ API thí sinh + admin (mục API bên dưới), thêm `admin/questions`, `admin/attempt`, `admin/attempt-pdf`, `admin/logo`, `admin/me|logout`, `GET /api/logo`, `/mediapipe/wasm` (phục vụ WASM MediaPipe từ node_modules).
- `server/attempts.js` (chấm điểm, nộp bài, chốt bài quá hạn), `server/importer.js` (đọc/mẫu Excel–Word câu hỏi, danh sách email), `server/pdf.js` (PDF đối chiếu / hồ sơ, font DejaVu), `server/export.js` (ZIP Excel tổng hợp + PDF).
- Upload tệp (import) gửi thân request là nội dung tệp nhị phân, ví dụ `POST /api/admin/import?format=xlsx&mode=replace&dryRun=1`.
- `PG_POOL_MAX` (tùy chọn) giới hạn số kết nối Postgres.
- `client/`: React – `candidate/` (Landing, ExamView, ResultView, WebcamMonitor + `webcam.js`), `admin/` (6 tab + AttemptDetail), `lib/` (api, format, ui). `vite.config.js` (root `client`, build ra `dist/`), `railway.json`, `README.md`.
- **Còn phải làm:** chạy thử giám sát webcam với camera thật và chỉnh ngưỡng mặc định.

## Biến môi trường
| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Postgres (Railway tự cấp) |
| `ADMIN_PASSWORD` | Mật khẩu trang admin |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên ký cookie |
| `EMAIL_DOMAIN` | Mặc định `tanminhnhan.com.vn` |
| `TEST_MODE` | `true` = chế độ thử: chuyển tab không tự nộp, được thoát toàn màn hình, hiện banner cảnh báo |
| `PORT` | Railway tự cấp |

## Định tuyến (hash router)
- `#/` – trang thí sinh. `#/admin` – quản trị (đăng nhập bằng mật khẩu).

## Cấu hình kỳ thi (settings, lưu JSON)
`title, openingAt, closingAt` (chuỗi `YYYY-MM-DDTHH:mm` giờ Việt Nam), `durationMinutes, multipleChoiceCount, mcPointsPerQuestion, essayCount, essayPointsPerQuestion, passingScore` (UI ghi "Tối đa X điểm cho đề này" = mc×điểm + tl×điểm), `displayMode: paged | all`, `active` (Mở kỳ thi – tắt là đóng ngay), `showScore` (Hiện tổng điểm sau khi chấm xong tự luận).
Thêm mới: `shuffleQuestions`, `webcamEnabled, webcamRequired, webcamHoldSeconds (2), webcamYawThreshold, webcamGazeThreshold, webcamMaxWarnings (0 = chỉ ghi nhận)`.
Trạng thái kỳ thi: Chưa kích hoạt / Sắp mở thi / Đang mở thi / Đã kết thúc.

## Trang thí sinh
1. Hiển thị logo, tiêu đề, thời gian mở–đóng (giờ VN), số câu, thời lượng, "X câu trắc nghiệm × Y điểm", "Z câu tự luận × W điểm", "Đạt từ N", trạng thái.
2. Nội quy: bật toàn màn hình khi bắt đầu; không chuyển tab/cửa sổ — nếu trang bị ẩn sẽ **tự động nộp bài** và **tự động không đạt**.
3. Form: Họ và tên, Email công ty (phải đuôi `@tanminhnhan.com.vn` và có trong danh sách được duyệt), Chức danh / vị trí, Cấp bậc (nhập tự do), Địa điểm kiểm tra (chọn công trình đang active), checkbox "Tôi đã đọc, hiểu rõ và cam kết tuân thủ toàn bộ nội quy". Nút BẮT ĐẦU KIỂM TRA / CHƯA ĐẾN GIỜ KIỂM TRA.
4. Mỗi email chỉ một lượt thi; tải lại trang thì tiếp tục lượt cũ (cookie token). Đề lấy ngẫu nhiên đúng số câu TN + TL từ ngân hàng câu đang hoạt động.
5. Làm bài: đồng hồ "Thời gian còn lại", bảng số câu (đánh dấu chưa trả lời), Câu trước/Câu sau (paged) hoặc cuộn cả trang (all). single: "Chọn một đáp án", multiple: "Chọn tất cả đáp án phù hợp", essay: textarea. Tự lưu (Đang lưu… / Đã lưu / Lỗi lưu, đáp án đang chờ đồng bộ) + nháp localStorage. Hết giờ tự nộp. Thoát toàn màn hình → khóa màn hình "Cần bật toàn màn hình". `visibilitychange` ẩn → nộp tự động lý do tab_switch. Nút "Xuất PDF đối chiếu" (`/api/exam/review-pdf`). Nộp bài có hộp xác nhận "Bạn đã trả lời X câu. Sau khi nộp không thể sửa."
6. Kết quả: ĐẠT / KHÔNG ĐẠT, tổng điểm, đúng/sai; nếu có tự luận chưa chấm → "ĐANG CHỜ CHẤM TỰ LUẬN", trang tự kiểm tra lại mỗi 15 giây. Nếu showScore=false thì chỉ báo đã nộp.
7. Chấm TN: multiple phải đúng trọn bộ mới được điểm. Điểm thang 10 = tổng/tối đa×10.

## Admin – 6 tab
1. **Cấu hình**: form settings ở trên + Danh sách công trình (thêm; Ẩn/Kích hoạt; Xóa chỉ khi chưa có bài thi, nếu có thì chỉ được ẩn). Thêm: upload logo, cấu hình webcam.
2. **Danh sách email**: import Excel (thay toàn bộ, ≤256KB; mẫu cột `Số thứ tự | Họ và tên | Email công ty`), hoặc dán email để bổ sung (báo trùng/sai miền), xóa danh sách. Bảng theo dõi tham gia: lọc Tất cả / Chưa bắt đầu / Đang làm / Quá hạn·chưa chốt / Đã nộp / Đã nộp tự động; cột STT/Họ tên, email, bắt đầu, nộp, lý do. Nút Làm mới.
3. **Câu hỏi**: nhập từ Excel hoặc Word, chế độ Thay thế toàn bộ / Thêm vào; "Kiểm tra tệp" (xem trước, báo lỗi từng dòng) rồi "Lưu vào hệ thống". Chặn sửa khi đã có thí sinh bắt đầu. Mẫu Excel cột: `Câu hỏi | A | B | C | D | E | F | Đáp án đúng (A,C) | Loại (single/multiple/essay) | Điểm (đặt trong cấu hình – chỉ để tham khảo) | Đáp án tham khảo`. Ví dụ: "Thủ đô của Việt Nam là?" Hà Nội/Huế/Đà Nẵng/Cần Thơ, A, single; "Chọn các số nguyên tố" 2/4/5, A,C, multiple; "Trình bày một giải pháp bảo vệ môi trường", essay, đáp án tham khảo.
4. **Chấm tự luận**: danh sách bài (Cần chấm / Đã chấm đủ / Tất cả, tìm theo STT/họ tên/email), xem câu trả lời + đáp án tham khảo, nhập điểm 0..max (2 chữ số thập phân) cho từng câu, "Lưu kết quả cả bài". Bài trượt do chuyển tab ghi "Trượt: chuyển tab".
5. **Quản lý bài làm / Thống kê**: lọc theo công trình, cấp bậc, khoảng điểm; Tổng lượt đã nộp, Đạt, Không đạt, Điểm TB, Lượt vi phạm/tổng nộp; phân bố điểm (Dưới 5; 5–6,9; 7–7,9; 8–8,9; ≥9); so sánh tỷ lệ đạt theo công trình và cấp bậc.
6. **Hồ sơ kết quả**: Tải ZIP (Excel tổng hợp + PDF từng bài, sheet "Hồ sơ phúc khảo" có hyperlink tới PDF; tên PDF theo STT + họ tên); "Tải ZIP và xóa dữ liệu" (chỉ khi kỳ thi đã đóng và không còn bài đang làm; giữ câu hỏi, cấu hình, danh sách email); "Chốt bài hết hạn" (tự nộp các bài quá hạn).

## API (giữ tên như bản cũ)
`exam/info, exam/start, exam/state, exam/answers, exam/submit, exam/reset, exam/review-pdf, exam/event (mới – webcam)`;
`admin/login, admin/settings, admin/projects, admin/participants, admin/participation, admin/participant-template, admin/template?format=xlsx|docx, admin/import, admin/dashboard, admin/grading, admin/grade-essay-attempt, admin/export, admin/clear-results, admin/reconcile`.

## Giám sát webcam (mới)
- MediaPipe FaceLandmarker (`@mediapipe/tasks-vision`, chạy trên trình duyệt, không gửi video).
- Hiệu chỉnh 3 giây đầu (tư thế nhìn thẳng). Quay đầu: tỉ lệ vị trí mũi giữa 2 má lệch > ngưỡng. Liếc mắt: vị trí con ngươi (iris 468/473) giữa 2 khóe mắt lệch > ngưỡng. Không thấy mặt / ≥2 khuôn mặt.
- Lệch liên tục ≥ `webcamHoldSeconds` → cảnh báo trên màn hình + gửi `exam/event` kèm ảnh chụp nhỏ (JPEG ~160px, tối đa 20 ảnh/bài).
- `webcamMaxWarnings > 0` → vượt ngưỡng thì tự nộp, lý do `webcam`.
- Admin xem số lần cảnh báo + ảnh trong tab Chấm/Thống kê và trong PDF/Excel xuất.

## Deploy Railway
- Build: `npm install && npm run build`; Start: `npm start` (Express phục vụ `dist/` + `/api`).
- Thêm Postgres plugin, gán `DATABASE_URL=${{Postgres.DATABASE_URL}}`, đặt `ADMIN_PASSWORD`, `SESSION_SECRET`.
- Bảng tự tạo khi khởi động (`initSchema`).
- Logo: tải lên trong admin (bản cũ dùng `/logo.png`, có thể đặt file vào `public/logo.png`).
