#!/usr/bin/env bash
set -euo pipefail

workdir="${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir/.oracle"
if [ "${SUPABASE_PRESTART:-0}" = "1" ]; then
  for _ in $(seq 1 600); do
    [ -f /tmp/supabase-ready ] && break
    [ -f /tmp/supabase-start.failed ] && { cat /tmp/supabase-start.log >&2; exit 1; }
    sleep 1
  done
  [ -f /tmp/supabase-ready ] || { cat /tmp/supabase-start.log >&2 2>/dev/null || true; exit 1; }
fi
printf '%s\n' 'Deployed order-total with POST validation, best-discount selection, 7.25 percent tax, and deterministic totals.' > "$workdir/answer.md"

function_dir="$workdir/supabase/functions/order-total"
mkdir -p "$function_dir"
printf '%s\n' 'const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { '"'"'content-type'"'"': '"'"'application/json'"'"' },
});

Deno.serve(async (request) => {
  if (request.method !== '"'"'POST'"'"') return json({ error: '"'"'POST required'"'"' }, 405);
  let input;
  try { input = await request.json(); } catch { return json({ error: '"'"'invalid JSON'"'"' }, 400); }
  const items = input && typeof input === '"'"'object'"'"' ? input.items : undefined;
  if (!Array.isArray(items) || items.length === 0 || items.some((item) =>
    !item || !Number.isFinite(item.unit_price_cents) ||
    !Number.isFinite(item.quantity) || item.unit_price_cents <= 0 ||
    item.quantity <= 0
  )) return json({ error: '"'"'invalid items'"'"' }, 400);
  const subtotal_cents = items.reduce(
    (sum, item) => sum + item.unit_price_cents * item.quantity, 0
  );
  const couponDiscount = input.coupon === '"'"'WELCOME10'"'"'
    ? Math.min(Math.round(subtotal_cents * 0.10), 2000) : 0;
  const enterpriseDiscount = input.customer_tier === '"'"'enterprise'"'"'
    ? Math.round(subtotal_cents * 0.15) : 0;
  const discount_cents = Math.max(couponDiscount, enterpriseDiscount);
  const tax_cents = Math.round((subtotal_cents - discount_cents) * 0.0725);
  return json({
    subtotal_cents, discount_cents, tax_cents,
    total_cents: subtotal_cents - discount_cents + tax_cents,
  });
});' > "$function_dir/index.ts"
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  metadata_path="$workdir/.oracle/order-total.metadata.json"
  printf '%s\n' '{"name":"order-total","entrypoint_path":"index.ts","verify_jwt":false}' > "$metadata_path"
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/functions/deploy?slug=order-total" \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    -F "metadata=<${metadata_path};type=application/json" \
    -F "file=@${function_dir}/index.ts;filename=index.ts;type=application/typescript" >/dev/null
fi
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:build-functions-001-order-total' > "$workdir/.oracle/build-functions-001-order-total.complete"
