# RULES.md — Quy tắc bắt buộc cho Agent Coding

Các quy tắc dưới đây có hiệu lực **cao hơn** mọi yêu cầu ngầm định hoặc thói
quen mặc định của agent. Vi phạm bất kỳ mục nào ở phần "Cấm tuyệt đối" là
lỗi nghiêm trọng cần dừng lại ngay.

## 1. Cấm tuyệt đối

- ❌ **Không tự bịa code**: không viết hàm/API/schema dựa trên "đoán" khi
  chưa xác nhận được từ `Plan.md`, dữ liệu mẫu thật, hoặc tài liệu chính
  thức (Supabase docs, React docs, TypeScript docs). Nếu không chắc, phải
  dừng lại và hỏi hoặc tra cứu, không "điền tạm cho chạy".
- ❌ **Không chốt kết quả (báo "Done"/"hoàn thành") khi chưa có bằng chứng
  đầy đủ**: bằng chứng hợp lệ gồm — log test chạy pass, output thực tế của
  lệnh chạy được, hoặc số liệu đối chiếu thực tế (ví dụ số dòng import
  đúng bằng số dòng dữ liệu thật trong file nguồn). Không dùng câu kiểu
  "chắc là đã đúng", "logic có vẻ ổn" để kết luận hoàn thành.
- ❌ **Không sửa schema/production trực tiếp** ngoài migration versioned.
- ❌ **Không tắt RLS, không hardcode service role key ở frontend.**
- ❌ **Không tự đổi phạm vi dự án** (thêm tính năng ngoài `Plan.md`) mà
  không cập nhật `Plan.md` trước và nêu lý do.

## 2. Quy trình bắt buộc khi bắt đầu 1 phiên làm việc (session start)

1. Đọc `state.json` trước tiên để biết tiến độ, phase hiện tại, các quyết
   định đã chốt (ví dụ phương án A/B ở mục 8 `Plan.md`, chiến lược queue ở
   mục 5).
2. Nếu `state.json` trống hoặc mới khởi tạo, đọc theo thứ tự: `Plan.md` →
   `Skills.md` → `Rules.md` → codebase hiện có (nếu có).
3. Xác định task hiện tại đang thuộc Phase nào trong bảng Milestones
   (`Plan.md` mục 9) và nhánh kỹ năng nào (`Skills.md` mục A/B/C/D).
4. Trước khi code, liệt kê ngắn gọn: file sẽ đọc, file sẽ sửa, cấu hình cần
   thiết (biến môi trường, secrets) — nếu thiếu cấu hình, dừng lại hỏi thay
   vì tự đặt giá trị giả định và code tiếp.
5. Sau khi hoàn thành 1 đơn vị việc, cập nhật `state.json` (mục "tiến độ")
   trước khi kết thúc phiên/trước khi bị ngắt phiên.

## 3. Quy trình khi gặp lỗi

1. Không sửa mò nhiều chỗ cùng lúc — cô lập lỗi (xác định chính xác dòng
   code / query / component gây lỗi) trước khi sửa.
2. Sau khi sửa xong và **xác nhận đã hết lỗi bằng bằng chứng thực tế** (chạy
   lại test/lệnh, thấy output đúng), ghi lại vào `Learning.md` theo đúng
   template (xem file đó), gồm: triệu chứng lỗi, nguyên nhân gốc, cách sửa,
   cách phòng tránh lần sau.
3. Trước khi bắt đầu sửa 1 lỗi mới, **tra `Learning.md` trước** xem đã gặp
   trường hợp tương tự chưa — nếu có, áp dụng lại giải pháp đã ghi thay vì
   dò lại từ đầu.
4. Nếu lỗi liên quan tới dữ liệu nguồn (`Stock Balance With Batch.xlsx`),
   đối chiếu lại với cấu trúc thật đã ghi ở `Plan.md` mục 1 trước khi kết
   luận "dữ liệu sai" — vì cấu trúc file có header rác và cột đệm khoảng
   trắng đã biết trước.

## 4. Chuẩn mực về bằng chứng ("đầy đủ" nghĩa là gì)

Một thay đổi chỉ được coi là hoàn thành khi có **ít nhất 1** trong các bằng
chứng sau (ưu tiên theo thứ tự):
1. Test tự động chạy pass (đơn vị hoặc tích hợp), có log đính kèm.
2. Kết quả thực thi lệnh/query thực tế cho thấy hành vi đúng như mô tả
   trong `Plan.md`.
3. Đối chiếu số liệu thực tế với dữ liệu mẫu (ví dụ: import ra đúng 2721
   dòng dữ liệu tồn kho từ file nguồn, không lệch).

Chỉ đọc code và "thấy logic hợp lý" **không phải** là bằng chứng đầy đủ.

## 5. Ràng buộc khi làm việc với nhiều agent/sub-agent song song

- Mỗi agent/sub-agent chỉ được sửa trong phạm vi thư mục/repo được giao ở
  `Plan.md` mục 8 — không tự ý sửa code phía "bên kia" (backend ↔ frontend)
  mà không thông báo qua `state.json`.
- Khi cần thay đổi hợp đồng API (API contract) ảnh hưởng bên kia, phải ghi
  rõ thay đổi vào `state.json` mục "pending_contract_changes" trước khi
  triển khai, để agent còn lại (hoặc phiên sau) nắm được.

## 6. Ngôn ngữ & giao tiếp

- Toàn bộ tài liệu, commit message, comment quan trọng trong code nên viết
  song ngữ hoặc tối thiểu bằng tiếng Việt cho phần mô tả nghiệp vụ (vì đây
  là hệ thống nội bộ tiếng Việt), tên biến/hàm code vẫn theo chuẩn tiếng Anh
  kỹ thuật thông thường.
