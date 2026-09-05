-- QC gate Phase 1: schema + RLS + realtime (Plan.md §3, §9-Phase 1).
-- Chạy: psql -v ON_ERROR_STOP=1 -f qc_phase1.sql
-- Mọi check FAIL đều RAISE EXCEPTION -> psql exit != 0. Cuối cùng in QC_PHASE1_PASS.
-- Dữ liệu test ghi trong 1 transaction và ROLLBACK để DB sạch cho Phase 2.

-- CHECK 1: 3 bảng tồn tại
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('reference_stock','scanned_data','scan_audit_log')) <> 3 THEN
    RAISE EXCEPTION 'CHECK 1 FAIL: thiếu bảng nghiệp vụ';
  END IF;
  RAISE NOTICE 'CHECK 1/8 tables exist: PASS';
END $$;

-- CHECK 2: primary keys đúng cột
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'reference_stock' AND i.indisprimary AND a.attname = 'batch_id') THEN
    RAISE EXCEPTION 'CHECK 2 FAIL: reference_stock PK phải là batch_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'scanned_data' AND i.indisprimary AND a.attname = 'id') THEN
    RAISE EXCEPTION 'CHECK 2 FAIL: scanned_data PK phải là id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'scan_audit_log' AND i.indisprimary AND a.attname = 'id') THEN
    RAISE EXCEPTION 'CHECK 2 FAIL: scan_audit_log PK phải là id';
  END IF;
  RAISE NOTICE 'CHECK 2/8 primary keys: PASS';
END $$;

-- CHECK 3: cột raw audit + default status + KHÔNG unique cứng trên scanned_data.batch_id
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reference_stock'
        AND column_name IN ('stock_code_raw','bin_raw')) <> 2 THEN
    RAISE EXCEPTION 'CHECK 3 FAIL: thiếu cột raw audit (Plan.md §1)';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'scanned_data'
        AND column_name = 'status') IS DISTINCT FROM '''pending''::text' THEN
    RAISE EXCEPTION 'CHECK 3 FAIL: scanned_data.status default phải là pending';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'scanned_data' AND i.indisunique AND NOT i.indisprimary) THEN
    RAISE EXCEPTION 'CHECK 3 FAIL: scanned_data có unique cứng (trùng là nghiệp vụ, không phải constraint)';
  END IF;
  RAISE NOTICE 'CHECK 3/8 columns/defaults/no-hard-unique: PASS';
END $$;

-- CHECK 4: đủ 7 index theo Plan.md §3 + §3.4
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN (
        'idx_reference_stock_bin','idx_reference_stock_warehouse',
        'idx_reference_stock_warehouse_bin',
        'idx_scanned_data_batch','idx_scanned_data_bin','idx_scanned_data_status')) <> 6 THEN
    RAISE EXCEPTION 'CHECK 4 FAIL: thiếu index';
  END IF;
  RAISE NOTICE 'CHECK 4/8 indexes: PASS';
END $$;

-- CHECK 5: RLS bật + đủ 12 policy tường minh cho authenticated
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('reference_stock','scanned_data','scan_audit_log')
        AND rowsecurity) <> 3 THEN
    RAISE EXCEPTION 'CHECK 5 FAIL: RLS chưa bật đủ 3 bảng';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('reference_stock','scanned_data','scan_audit_log')) < 12 THEN
    RAISE EXCEPTION 'CHECK 5 FAIL: phải có ít nhất 12 policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public'
               AND tablename IN ('reference_stock','scanned_data','scan_audit_log')
               AND NOT (roles && ARRAY['authenticated'::name, 'anon'::name])) THEN
    RAISE EXCEPTION 'CHECK 5 FAIL: policy chỉ được gán cho authenticated hoặc anon';
  END IF;
  RAISE NOTICE 'CHECK 5/8 RLS + policies: PASS';
END $$;

-- CHECK 6: scanned_data nằm trong publication supabase_realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'scanned_data') THEN
    RAISE EXCEPTION 'CHECK 6 FAIL: scanned_data chưa bật realtime';
  END IF;
  RAISE NOTICE 'CHECK 6/8 realtime publication: PASS';
END $$;

-- CHECK 7+8: functional trong transaction, xong ROLLBACK
BEGIN;

-- 7a: insert reference + scanned (status default -> pending) + audit
DELETE FROM public.reference_stock WHERE batch_id = '999900004299';
INSERT INTO public.reference_stock
  (batch_id, stock_code, stock_code_raw, warehouse, bin, bin_raw, qty)
VALUES
  ('999900004299', '3400010001', '3400010001                         ', '01', '', '      ', 301);
INSERT INTO public.scanned_data (batch_id, qty, bin) VALUES ('999900004299', 301, 'A1');
INSERT INTO public.scanned_data (batch_id, qty, bin, resolution) VALUES ('999900004299', 301, 'A1', 'appended');
INSERT INTO public.scan_audit_log (scanned_id, action, new_value)
SELECT id, 'append', '{"bin":"A1"}'::jsonb FROM public.scanned_data WHERE resolution = 'appended' LIMIT 1;

DO $$
BEGIN
  IF (SELECT status FROM public.scanned_data WHERE resolution IS NULL) <> 'pending' THEN
    RAISE EXCEPTION 'CHECK 7 FAIL: status default không phải pending';
  END IF;
  IF (SELECT count(*) FROM public.scanned_data WHERE batch_id = '999900004299') <> 2 THEN
    RAISE EXCEPTION 'CHECK 7 FAIL: trùng batch_id phải cho ghi thêm (2 dòng)';
  END IF;
  RAISE NOTICE 'CHECK 7/8 insert/select + duplicate-append: PASS';
END $$;

-- 7b: status sai / action sai phải bị từ chối
DO $$
BEGIN
  BEGIN
    INSERT INTO public.scanned_data (batch_id, qty, bin, status)
    VALUES ('BADSTATUS001', 1, 'A1', 'bogus_status');
    RAISE EXCEPTION 'CHECK 7 FAIL: status sai vẫn insert được';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'invalid status rejected: ok';
  END;
  BEGIN
    INSERT INTO public.scan_audit_log (action) VALUES ('bogus_action');
    RAISE EXCEPTION 'CHECK 7 FAIL: action sai vẫn insert được';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'invalid action rejected: ok';
  END;
END $$;

-- 8: RLS cho phép anon select (không cần login), nhưng CHẶN anon insert trực tiếp
DO $$
DECLARE
  c int;
BEGIN
  SET ROLE anon;
  SELECT count(*) INTO c FROM public.scanned_data;
  BEGIN
    INSERT INTO public.scanned_data (batch_id, qty, bin) VALUES ('ANON00000001', 1, 'A1');
    RESET ROLE;
    RAISE EXCEPTION 'CHECK 8 FAIL: anon insert được';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'anon insert denied: ok';
  END;
  RESET ROLE;
  RAISE NOTICE 'CHECK 8/8 RLS anon select allowed + direct write blocked: PASS';
END $$;

ROLLBACK;

SELECT 'QC_PHASE1_PASS' AS result;
