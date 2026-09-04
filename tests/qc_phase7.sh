#!/usr/bin/env bash
# QC gate Phase 7 runner — CI/CD (Plan.md §9, Skills D).
# Checks: 2 workflow YAML hợp lệ; trigger đúng (push/PR main + paths);
# backend: test trước deploy (3 gates), deploy chỉ main, secrets đúng tên;
# frontend: lint+test+build trước deploy, deploy Pages chỉ main, VITE_* từ
# secrets; không hardcode secret/key nào; vite base Pages-safe;
# chạy lại pipeline frontend tại local để chứng minh các bước CI xanh.
# Exit 0 = PASS (in RESULT: QC_PHASE7 PASS), != 0 = FAIL.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "FAIL: $1"; echo 'RESULT: QC_PHASE7 FAIL'; exit 1; }
pass() { echo "PASS: $1"; }

echo "--- CHECK 1/5: YAML hợp lệ + trigger ---"
python3 -c "
import yaml, sys
for f in ['.github/workflows/backend-deploy.yml', '.github/workflows/frontend-deploy.yml']:
    d = yaml.safe_load(open('$REPO_ROOT/' + f))
    assert d is not False and 'jobs' in d, f
    trg = d.get('on', d.get(True, {}))  # YAML 1.1 parse key 'on' thành boolean True
    assert 'main' in str(trg), f
    print(f, 'OK')
" || fail "yaml invalid"
pass "yaml + trigger"

echo "--- CHECK 2/5: backend test-trước-deploy + chỉ main ---"
B="$REPO_ROOT/.github/workflows/backend-deploy.yml"
grep -q "qc_phase1.sh" "$B" || fail "backend missing gate1"
grep -q "qc_phase2.sh" "$B" || fail "backend missing gate2"
grep -q "qc_phase3.sh" "$B" || fail "backend missing gate3"
grep -q "supabase db push" "$B" || fail "backend missing db push"
grep -q "supabase functions deploy" "$B" || fail "backend missing functions deploy"
grep -q "secrets.SUPABASE_ACCESS_TOKEN" "$B" || fail "backend missing access token secret"
grep -q "secrets.SUPABASE_PROJECT_ID" "$B" || fail "backend missing project id secret"
grep -q "github.ref == 'refs/heads/main'" "$B" || fail "backend deploy not gated to main"
pass "backend workflow"

echo "--- CHECK 3/5: frontend pipeline + Pages + secrets ---"
F="$REPO_ROOT/.github/workflows/frontend-deploy.yml"
grep -q "npm run lint" "$F" || fail "frontend missing lint"
grep -q "npm test" "$F" || fail "frontend missing test"
grep -q "npm run build" "$F" || fail "frontend missing build"
grep -q "deploy-pages" "$F" || fail "frontend missing pages deploy"
grep -q "github.ref == 'refs/heads/main'" "$F" || fail "frontend deploy not gated to main"
grep -q "secrets.VITE_SUPABASE_URL" "$F" || fail "frontend missing url secret"
grep -q "secrets.VITE_SUPABASE_ANON_KEY" "$F" || fail "frontend missing anon secret"
grep -qi "service_role\|SERVICE_ROLE" "$F" && fail "service role in frontend workflow"
grep -q "base: './'" "$REPO_ROOT/frontend/vite.config.ts" || fail "vite base not Pages-safe"
pass "frontend workflow"

echo "--- CHECK 4/5: không hardcode secret/key ---"
grep -rEn "eyJhbGciOiJIUzI1NiIs|sb_secret_|sb_publishable_" "$REPO_ROOT/.github" && fail "hardcoded key in workflows"
grep -rEn "eyJhbGciOiJIUzI1NiIs|sb_secret_" "$REPO_ROOT/frontend/src" "$REPO_ROOT/backend/supabase/functions" && fail "hardcoded key in code"
pass "no hardcoded secrets"

echo "--- CHECK 5/5: chạy lại pipeline frontend tại local ---"
cd "$REPO_ROOT/frontend" || fail "no frontend"
npm run lint --silent || fail "local lint"
npx vitest run > /tmp/qc7_test.log 2>&1 || fail "local vitest"
grep -qE "Tests +[1-9][0-9]* passed" /tmp/qc7_test.log || fail "no passing tests"
npm run build --silent > /tmp/qc7_build.log 2>&1 || fail "local build"
[ -f dist/index.html ] || fail "dist missing"
pass "local pipeline"

echo 'RESULT: QC_PHASE7 PASS'
