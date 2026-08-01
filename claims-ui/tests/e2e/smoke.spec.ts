/**
 * Account Module — Enterprise E2E Smoke Tests
 *
 * Tests the full account lifecycle against a real running stack:
 *   - Next.js dev server  : http://localhost:3000
 *   - API Gateway (Python): http://localhost:8000
 *
 * Role matrix exercised:
 *   ADJUSTER         — create, list, view, search/filter (WRITE_ROLES)
 *   COMPLIANCE_OFFICER — verify, block, gateway-sync, delete (_account_admin)
 *
 * No mock data, no route stubs — every request hits the real API.
 */

import { test, expect, type Browser, type Page } from '@playwright/test';

// ── Credentials ──────────────────────────────────────────────────────────────

const ADJUSTER = {
  email:    'adjuster@claims-engine.local',
  password: 'Adjuster@2024!',
  role:     'ADJUSTER',
};

const COMPLIANCE = {
  email:    'compliance@claims-engine.local',
  password: 'Compliance@2024!',
  role:     'COMPLIANCE_OFFICER',
};

// ── Login helper ──────────────────────────────────────────────────────────────

async function loginAs(page: Page, user: typeof ADJUSTER) {
  await page.goto('http://localhost:3000/login');
  await expect(page.getByRole('heading', { name: /Login Portal/i })).toBeVisible({ timeout: 10_000 });
  await page.fill('input[type="email"]',    user.email);
  await page.fill('input[type="password"]', user.password);
  await page.getByRole('button', { name: /Sign In/i }).click();
  await expect(page).toHaveURL('http://localhost:3000/', { timeout: 12_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Serial mode: tests share the in-memory account store on the API gateway.
// Running in parallel would create cross-test data interference.
test.describe.configure({ mode: 'serial' });

test.describe('Account Module — Enterprise Workflow', () => {

  // ── 1. Full lifecycle: two roles, real data ─────────────────────────────────
  test('full lifecycle — adjuster creates, compliance verifies and syncs', async ({ browser }: { browser: Browser }) => {
    const suffix     = Date.now().toString().slice(-6);
    const memberNum  = `MEM-UAE-E2E-${suffix}`;
    const patientName = `Fatima Al Rashid E2E-${suffix}`;

    // ── Session A: Claims Adjuster ──────────────────────────────────────────
    const adjCtx  = await browser.newContext();
    const adjPage = await adjCtx.newPage();

    await loginAs(adjPage, ADJUSTER);
    await adjPage.goto('http://localhost:3000/accounts');
    await expect(adjPage.getByRole('heading', { name: /Customer account operations/i }))
      .toBeVisible({ timeout: 8_000 });

    // ── 1a. Open create dialog and fill UAE GCC form ──────────────────────────
    await adjPage.getByRole('button', { name: /New Account/i }).click();
    await expect(adjPage.getByRole('heading', { name: /Create payout account/i })).toBeVisible();

    // UAE form shows IBAN field, not IFSC
    await expect(adjPage.getByPlaceholder('AE070331234567890123456')).toBeVisible();
    await expect(adjPage.getByPlaceholder('HDFC0001234')).not.toBeVisible();

    await adjPage.getByPlaceholder('MEM-UAE-001').fill(memberNum);
    await adjPage.getByPlaceholder('Patient legal name').fill(patientName);
    await adjPage.getByPlaceholder('Name on account').fill(patientName);
    await adjPage.getByPlaceholder('Bank or wallet provider').fill('Emirates NBD');
    await adjPage.getByPlaceholder('AE070331234567890123456').fill('AE070331234567890123456');
    await adjPage.getByPlaceholder('Verification notes or source context')
      .fill('Enterprise E2E — UAE GCC payout account');

    await adjPage.getByRole('button', { name: /Save Account/i }).click();

    // ── 1b. Verify row appears with masked IBAN and UNVERIFIED status ─────────
    const adjRow = adjPage.locator('tr').filter({ hasText: memberNum });
    await expect(adjRow).toBeVisible({ timeout: 10_000 });
    await expect(adjRow.getByText('AE07***************3456')).toBeVisible();
    await expect(adjRow.locator('span').filter({ hasText: 'UNVERIFIED' })).toBeVisible();
    await expect(adjRow.locator('[title="Emirates NBD"]')).not.toBeVisible(); // bank in sub-row
    // Stripe and PayTM sync should be NOT_SYNCED
    await expect(adjRow.getByText('NOT_SYNCED').first()).toBeVisible();

    // ── 1c. ADJUSTER does NOT see verify / block action buttons ───────────────
    await expect(adjRow.getByTitle('Verify')).not.toBeVisible();
    await expect(adjRow.getByTitle('Block')).not.toBeVisible();

    // ── 1d. Open detail modal and confirm fields ──────────────────────────────
    await adjRow.getByText(patientName).first().click();
    const modal = adjPage.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByText(memberNum)).toBeVisible();
    // Market cell — filter by the label to avoid strict-mode on memberNum (also has "UAE")
    await expect(modal.locator('.ui-surface').filter({ hasText: 'Market' }).getByText('UAE', { exact: true })).toBeVisible();
    await expect(modal.getByText('MANUAL', { exact: true })).toBeVisible(); // Capture source
    await expect(modal.getByText('Not verified')).toBeVisible();            // Verified By
    // Gateway-sync buttons NOT shown to adjuster
    await expect(modal.getByRole('button', { name: /Mark Stripe Synced/i })).not.toBeVisible();
    await adjPage.keyboard.press('Escape');

    // ── Session B: Compliance Officer ───────────────────────────────────────
    const compCtx  = await browser.newContext();
    const compPage = await compCtx.newPage();

    await loginAs(compPage, COMPLIANCE);
    await compPage.goto('http://localhost:3000/accounts');
    await expect(compPage.getByRole('heading', { name: /Customer account operations/i }))
      .toBeVisible({ timeout: 8_000 });

    // Scope view to this test's member so summary counts are deterministic
    await compPage.fill('input[placeholder*="Search"]', memberNum);

    // ── 2a. Compliance SEES verify / block buttons ────────────────────────────
    const compRow = compPage.locator('tr').filter({ hasText: memberNum });
    await expect(compRow).toBeVisible({ timeout: 10_000 });
    await expect(compRow.getByTitle('Verify')).toBeVisible();
    await expect(compRow.getByTitle('Block')).toBeVisible();

    // ── 2b. Verify the account ────────────────────────────────────────────────
    await compRow.getByTitle('Verify').click();
    await expect(compRow.locator('span').filter({ hasText: 'VERIFIED' }))
      .toBeVisible({ timeout: 8_000 });

    // ── 2c. Summary card Verified count = 1 (scoped to this member) ─────────────
    // The summary cards render as: <p class="ui-eyebrow">Verified</p>
    //                               <p class="text-2xl">1</p>  ← sibling
    // await refresh() in runAction ensures SWR has fully settled.
    await expect(async () => {
      const eyebrow = compPage.locator('p.ui-eyebrow').filter({ hasText: 'Verified' }).first();
      const count = Number(await eyebrow.locator('xpath=following-sibling::p[1]').textContent());
      expect(count).toBe(1);
    }).toPass({ timeout: 6_000 });

    // ── 2d. Open detail modal — gateway sync buttons visible to compliance ────
    await compRow.getByText(patientName).first().click();
    const compModal = compPage.getByRole('dialog');
    await expect(compModal).toBeVisible();
    await expect(compModal.getByText('compliance@claims-engine.local')).toBeVisible(); // verified_by
    await expect(compModal.getByRole('button', { name: /Mark Stripe Synced/i })).toBeVisible();
    await expect(compModal.getByRole('button', { name: /Mark PayTM Synced/i })).toBeVisible();

    // ── 2e. Trigger Stripe sync ────────────────────────────────────────────────
    await compModal.getByRole('button', { name: /Mark Stripe Synced/i }).click();
    await compPage.keyboard.press('Escape');

    // Row should now reflect SYNCED for Stripe
    await expect(compRow.getByText('SYNCED').first()).toBeVisible({ timeout: 8_000 });

    // ── 3. Adjuster refreshes — sees VERIFIED + Stripe SYNCED status ────────────
    // The adjuster page is already scoped by the search field (memberNum was used to
    // find the row). Clicking Refresh re-fetches with the current params.
    await adjPage.getByRole('button', { name: /Refresh/i }).click();
    await expect(adjPage.locator('tr').filter({ hasText: memberNum })
      .locator('span').filter({ hasText: 'VERIFIED' }))
      .toBeVisible({ timeout: 10_000 });

    // ── Cleanup: Compliance deletes the test account ──────────────────────────
    // (Use API directly to avoid blocking on UI confirmation dialogs)
    const tokenResp = await compPage.request.post('http://localhost:8000/api/v1/auth/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `username=${encodeURIComponent(COMPLIANCE.email)}&password=${encodeURIComponent(COMPLIANCE.password)}`,
    });
    const { access_token } = await tokenResp.json();

    // Find account ID
    const listResp = await compPage.request.get(
      `http://localhost:8000/api/v1/accounts?member_number=${memberNum}`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    const list = await listResp.json();
    for (const acct of list.accounts) {
      await compPage.request.delete(
        `http://localhost:8000/api/v1/accounts/${acct.id}`,
        { headers: { Authorization: `Bearer ${access_token}` } },
      );
    }

    await adjCtx.close();
    await compCtx.close();
  });

  // ── 2. Market-conditional form fields ───────────────────────────────────────
  test('India market form — shows account number + IFSC, hides IBAN', async ({ page }) => {
    await loginAs(page, ADJUSTER);
    await page.goto('http://localhost:3000/accounts');
    await page.getByRole('button', { name: /New Account/i }).click();

    // Default: UAE — IBAN required, no IFSC
    await expect(page.getByPlaceholder('AE070331234567890123456')).toBeVisible();
    await expect(page.getByPlaceholder('HDFC0001234')).not.toBeVisible();

    // Switch market to INDIA
    await page.locator('form select').first().selectOption('INDIA');

    // INDIA — IFSC + account number visible, IBAN gone
    await expect(page.getByPlaceholder('HDFC0001234')).toBeVisible();
    await expect(page.getByPlaceholder('Stored masked/encrypted')).toBeVisible();
    await expect(page.getByPlaceholder('AE070331234567890123456')).not.toBeVisible();

    // Switch back to UAE — IBAN returns
    await page.locator('form select').first().selectOption('UAE');
    await expect(page.getByPlaceholder('AE070331234567890123456')).toBeVisible();
  });

  // ── 3. INDIA account — full create + data integrity ──────────────────────────
  // India accounts are created by a UAE adjuster (cross-border claim) but are only
  // visible in the INDIA-filtered or global view.  After creation we verify the
  // masked data via the compliance API (global role) and confirm the row appears
  // in the compliance UI where market_region is "INDIA".
  test('India account — account number masked, IFSC stored, compliance sees it', async ({ browser }: { browser: Browser }) => {
    const suffix    = Date.now().toString().slice(-6);
    const memberNum = `MEM-IND-E2E-${suffix}`;

    // ── Adjuster creates the India account via UI ─────────────────────────────
    const adjCtx  = await browser.newContext();
    const adjPage = await adjCtx.newPage();
    await loginAs(adjPage, ADJUSTER);

    await adjPage.goto('http://localhost:3000/accounts');
    await adjPage.getByRole('button', { name: /New Account/i }).click();

    await adjPage.locator('form select').first().selectOption('INDIA');
    await adjPage.getByPlaceholder('MEM-UAE-001').fill(memberNum);
    await adjPage.getByPlaceholder('Patient legal name').fill(`Asha Menon E2E-${suffix}`);
    await adjPage.getByPlaceholder('Name on account').fill(`Asha Menon E2E-${suffix}`);
    await adjPage.getByPlaceholder('Bank or wallet provider').fill('HDFC Bank');
    await adjPage.getByPlaceholder('Stored masked/encrypted').fill('123456789012');
    await adjPage.getByPlaceholder('HDFC0001234').fill('HDFC0001234');
    await adjPage.getByRole('button', { name: /Save Account/i }).click();

    // Toast confirms creation even though the row won't appear in the UAE list
    await expect(adjPage.getByText('Payout account created')).toBeVisible({ timeout: 8_000 });

    // Adjuster's UAE-locked view does NOT show the India account
    await expect(adjPage.locator('tr').filter({ hasText: memberNum })).not.toBeVisible();

    // ── Verify via API: account was stored with correct masked data ───────────
    // (still using adjPage.request before closing the context)
    const compTokenResp = await adjPage.request.post('http://localhost:8000/api/v1/auth/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `username=${encodeURIComponent(COMPLIANCE.email)}&password=${encodeURIComponent(COMPLIANCE.password)}`,
    });
    const { access_token: compToken } = await compTokenResp.json();

    const listResp = await adjPage.request.get(
      `http://localhost:8000/api/v1/accounts?member_number=${memberNum}`,
      { headers: { Authorization: `Bearer ${compToken}` } },
    );
    const apiList = await listResp.json();
    expect(apiList.total).toBe(1);
    const acct = apiList.accounts[0];
    expect(acct.market_region).toBe('INDIA');
    expect(acct.account_number_last4).toBe('9012');       // masked correctly
    expect(acct.ifsc_code).toBe('HDFC0001234');           // IFSC stored
    expect(acct.iban).toBeNull();                          // no IBAN for India
    await adjCtx.close();

    // ── Compliance UI: India account visible in global list ────────────────────
    const compCtx  = await browser.newContext();
    const compPage = await compCtx.newPage();
    await loginAs(compPage, COMPLIANCE);
    await compPage.goto('http://localhost:3000/accounts');
    await compPage.fill('input[placeholder*="Search"]', memberNum);

    const compRow = compPage.locator('tr').filter({ hasText: memberNum });
    await expect(compRow).toBeVisible({ timeout: 10_000 });
    await expect(compRow.getByText('•••• 9012')).toBeVisible();
    await expect(compRow.getByText('Bank')).toBeVisible();
    await expect(compRow.getByText('INDIA')).toBeVisible();

    // Cleanup
    await compPage.request.delete(`http://localhost:8000/api/v1/accounts/${acct.id}`, {
      headers: { Authorization: `Bearer ${compToken}` },
    });
    await compCtx.close();
  });

  // ── 4. Search and verification-status filter ─────────────────────────────────
  test('search and filter — results narrow correctly', async ({ page }) => {
    await loginAs(page, ADJUSTER);
    await page.goto('http://localhost:3000/accounts');
    await expect(page.getByRole('heading', { name: /Customer account operations/i }))
      .toBeVisible({ timeout: 8_000 });

    // Search for a string that won't match anything — table should show empty state
    await page.fill('input[placeholder*="Search"]', 'zzz-no-match-xyz-e2e');
    await expect(page.getByText('No payout accounts found')).toBeVisible({ timeout: 6_000 });

    // Clear search — adjuster (UAE) has no market-filter dropdown because they are
    // locked to their region by the backend; only global roles see the "ALL" option.
    await page.fill('input[placeholder*="Search"]', '');

    // Filter by VERIFIED status
    const statusSelect = page.locator('section').filter({ hasText: 'Search' }).locator('select').nth(1);
    await statusSelect.selectOption('VERIFIED');
    await expect(page.locator('.ui-eyebrow').filter({ hasText: /Accounts/ })).toBeVisible();

    // Reset
    await statusSelect.selectOption('ALL');
  });

  // ── 5. Primary account uniqueness enforcement ─────────────────────────────────
  test('primary uniqueness — second primary demotes the first', async ({ page }) => {
    await loginAs(page, ADJUSTER);
    const suffix  = Date.now().toString().slice(-6);
    const member  = `MEM-UAE-PRI-${suffix}`;

    // Helper: create account via API for speed
    const tokenResp = await page.request.post('http://localhost:8000/api/v1/auth/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `username=${encodeURIComponent(ADJUSTER.email)}&password=${encodeURIComponent(ADJUSTER.password)}`,
    });
    const { access_token } = await tokenResp.json();

    const a1 = await page.request.post('http://localhost:8000/api/v1/accounts', {
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        member_number: member, patient_name: 'Primary Test',
        market_region: 'UAE', account_holder_name: 'Primary Test',
        account_type: 'SAVINGS', bank_name: 'ENBD',
        iban: 'AE070331234567890123456', capture_source: 'MANUAL', is_primary: true,
      }),
    });
    const acct1 = await a1.json();

    const a2 = await page.request.post('http://localhost:8000/api/v1/accounts', {
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        member_number: member, patient_name: 'Primary Test',
        market_region: 'UAE', account_holder_name: 'Primary Test',
        account_type: 'CURRENT', bank_name: 'ADCB',
        iban: 'AE070331234567890123457', capture_source: 'MANUAL', is_primary: true,
      }),
    });
    const acct2 = await a2.json();

    // Navigate to accounts and filter by this member
    await page.goto('http://localhost:3000/accounts');
    await page.fill('input[placeholder*="Search"]', member);

    // Exactly one star (primary) should be visible
    await expect(page.locator('tr').filter({ hasText: member })).toHaveCount(2, { timeout: 8_000 });
    const starIcons = page.locator('tr').filter({ hasText: member }).locator('svg.fill-amber-300');
    await expect(starIcons).toHaveCount(1);

    // Cleanup
    const compTokenResp = await page.request.post('http://localhost:8000/api/v1/auth/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `username=${encodeURIComponent(COMPLIANCE.email)}&password=${encodeURIComponent(COMPLIANCE.password)}`,
    });
    const { access_token: compToken } = await compTokenResp.json();
    for (const id of [acct1.id, acct2.id]) {
      await page.request.delete(`http://localhost:8000/api/v1/accounts/${id}`, {
        headers: { Authorization: `Bearer ${compToken}` },
      });
    }
  });

});
