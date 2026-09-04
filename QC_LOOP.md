# QC_LOOP.md — Vòng lặp kiểm chuẩn tự động (Builder ↔ QC Tester)

> Hệ thống đã chốt với user (2026-09-04): agent chính (Builder) code từng phase,
> subagent độc lập (QC Tester) chạy gate kiểm chuẩn. FAIL → Builder sửa → QC chạy
> lại tới khi PASS. PASS → Builder tự sang phase tiếp theo, **không hỏi user**.
> Xong mọi gate mới bàn giao user. File này + `state.json:qc_loop` là nguồn chuẩn
> của loop — mọi session đều tuân theo.

## 1. Vai trò

- **Builder (agent chính)**: đọc spec, viết code/migration, tự verify, rồi tạo/yêu
  cầu QC. Là **người duy nhất lái loop** (subagent Task chỉ trả 1 kết quả rồi kết
  thúc — "QC gọi lại agent chính" thực chất là Builder đọc verdict rồi đi tiếp).
- **QC Tester (subagent qua Task tool, `subagent_type: general`)**: kiểm độc lập,
  không tin lời Builder. verdict chỉ dựa trên **lệnh do chính nó chạy**.

## 2. Gate chuẩn từng phase (nguồn DoD: Plan.md §9)

| Gate | DoD | Gate script (Builder phải tạo trước khi gọi QC) |
|------|-----|--------------------------------------------------|
| phase1 | Migration chạy OK + test insert/select | `backend/supabase/tests/qc_phase1.sh` ✅ đã có |
| phase2 | Import đúng số dòng dữ liệu thật (**đếm động**, không hardcode 2721) | `backend/supabase/tests/qc_phase2.sh` |
| phase3 | `scan-submit` đối chiếu + khóa đúng; race test 2 request cùng `batch_id` không mất dữ liệu | `backend/supabase/tests/qc_phase3.sh` |
| phase4 | Quét Bin→Tag gọi API thật, không localStorage nghiệp vụ | `frontend/tests/qc_phase4.sh` |
| phase5 | Đủ 3 cảnh báo qty/bin/duplicate + 2 lựa chọn xử lý trùng | `frontend/tests/qc_phase5.sh` |
| phase6 | Bảng 2 read-only + lọc kho/bin + export text giữ số 0 đầu | `frontend/tests/qc_phase6.sh` |
| phase7 | Pipeline main-branch: backend push + frontend build/deploy, test trước deploy | kiểm file workflow + chạy dry-run/lint tương ứng |
| phase8 | Đối chiếu tập mẫu thật, ghi lệch (nếu có) vào Learning.md | `tests/qc_phase8.sh` |

Quy tắc gate script: 1 lệnh duy nhất, in `RESULT: QC_PHASEn PASS/FAIL`, exit 0
chỉ khi PASS. Output phải đủ để người đọc kết luận mà không cần chạy lại.

## 3. Giao thức 1 vòng loop (lặp cho tới PASS)

1. Builder xong phase N + tự verify có evidence → cập nhật
   `state.json:qc_loop.gates.phaseN = {status: pending_qc, attempts+0}`.
2. Builder gọi Task/QC với prompt gồm: vai trò QC độc lập, file spec phải đọc
   (Plan.md § tương ứng + Rules.md §4), **lệnh gate chính xác**, yêu cầu verdict
   `PASS`/`FAIL` + evidence (log/output) + check nào fail (nếu có). Cấm QC kết
   luận bằng "logic có vẻ ổn".
3. Verdict **FAIL** → Builder: tra Learning.md → cô lập lỗi → sửa → tự chạy lại
   gate → gọi QC lại (`attempts+1`). Ghi fix vào Learning.md theo template.
4. Verdict **PASS** → Builder: `phase_status.N = completed`, gate `passed`,
   sang phase N+1 ngay, không hỏi user.
5. **Circuit breaker**: cùng 1 gate FAIL tới `max_attempts_per_gate` (mặc định 5)
   → dừng loop, bàn giao user kèm toàn bộ evidence (tránh đốt tài nguyên vô hạn).

## 4. Bàn giao cuối (chỉ khi mọi gate passed)

Báo user: trạng thái từng gate + evidence (log test, row-count, lệnh đã chạy) +
việc còn cần user (vd: secrets cloud, Supabase project ID). Không báo Done thiếu
bằng chứng (Rules.md §1, §4).
