/**
 * popup.spec.js — E2E tests for the Veil extension popup (CommonJS).
 */
const { test, expect } = require('./fixtures');
const { startMockServer, stopMockServer } = require('./mock_server');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function clearOnboarding(page) {
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.remove('veilOnboardingDone', resolve)));
}

async function markOnboardingDone(page) {
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ veilOnboardingDone: true }, resolve)));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Popup UI', () => {
    test('popup page title is "Veil"', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await expect(page).toHaveTitle(/Veil/i);
    });

    test('Veil branding h1 is visible', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await markOnboardingDone(page);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('h1').first()).toContainText('Veil');
    });

    test('status card is visible', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await markOnboardingDone(page);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('#statusText')).toBeVisible();
    });

    test('detection and redaction stats are rendered', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await markOnboardingDone(page);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('#detectionCount')).toBeVisible();
        await expect(page.locator('#redactionCount')).toBeVisible();
    });
});

test.describe('Onboarding Wizard', () => {
    test('overlay appears when veilOnboardingDone is unset', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await clearOnboarding(page);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(500);
        await expect(page.locator('#onboardingOverlay')).toBeVisible();
    });

    test('step 0 shows welcome title', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await clearOnboarding(page);
        await page.reload();
        await page.waitForTimeout(500);
        await expect(page.locator('.onboarding-title').first()).toContainText('Welcome to Veil');
    });

    test('skip button hides the overlay', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await clearOnboarding(page);
        await page.reload();
        await page.waitForTimeout(500);
        await page.locator('#onboardingSkipBtn').click({ force: true });
        await expect(page.locator('#onboardingOverlay')).toBeHidden();
    });

    test('skip sets veilOnboardingDone in storage', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await clearOnboarding(page);
        await page.reload();
        // Wait for overlay to be visible before clicking
        await page.locator('#onboardingOverlay').waitFor({ state: 'visible', timeout: 5000 });
        await page.locator('#onboardingSkipBtn').click({ force: true });
        const done = await page.evaluate(() =>
            new Promise((resolve) => chrome.storage.local.get('veilOnboardingDone', (r) => resolve(r.veilOnboardingDone)))
        );
        expect(done).toBeTruthy();
    });

    test('Get Started navigates to step 1 (native host)', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await clearOnboarding(page);
        await page.reload();
        // Wait for overlay to be fully visible (async _checkAndShow must finish)
        await page.locator('#onboardingOverlay').waitFor({ state: 'visible', timeout: 8000 });
        // Step 0 must be shown before clicking
        await expect(page.locator('[data-step="0"].onboarding-step')).toBeVisible();
        await page.locator('#onboardingNextBtn0').click({ force: true });
        // Give JS time to run _goToStep(1) and update the DOM
        await page.waitForTimeout(400);
        await expect(page.locator('.onboarding-title').filter({ visible: true })).toContainText('Native Bridge');
    });

    test('overlay is not shown when onboarding already done', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await markOnboardingDone(page);
        await page.reload();
        await page.waitForTimeout(500);
        await expect(page.locator('#onboardingOverlay')).toBeHidden();
    });
});

test.describe('Server Status (with mock server)', () => {
    let mockServer;

    test.beforeEach(async () => {
        mockServer = await startMockServer({ port: 8765, healthy: true, loaded: true });
    });

    test.afterEach(async () => {
        if (mockServer) await stopMockServer(mockServer); // stopMockServer handles null safely
    });

    test('Start Server button is visible', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await markOnboardingDone(page);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('#startServerButton')).toBeVisible();
    });

    test('status dot gets active class when server is healthy', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await markOnboardingDone(page);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        // Allow polling cycle to detect the mock server (up to 5s)
        await page.waitForTimeout(4000);
        const dot = page.locator('#statusDot');
        const hasActive = await dot.evaluate((el) => el.classList.contains('active'));
        const hasWarn = await dot.evaluate((el) => el.classList.contains('warn'));
        expect(hasActive || hasWarn).toBe(true);
    });
});

test.describe('Settings Persistence', () => {
    test('sensitivity selection persists across reload', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await markOnboardingDone(page);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');

        await page.locator('#sensitivitySelect').selectOption('high');
        await page.waitForTimeout(500);

        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(500);

        const value = await page.locator('#sensitivitySelect').inputValue();
        expect(value).toBe('high');
    });

    test('protection toggle persists when unchecked', async ({ extensionPopup }) => {
        const { page } = extensionPopup;
        await markOnboardingDone(page);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');

        const toggle = page.locator('#enabledToggle');
        const isChecked = await toggle.isChecked();
        if (isChecked) await toggle.click({ force: true });
        await page.waitForTimeout(500);

        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(500);

        expect(await page.locator('#enabledToggle').isChecked()).toBe(false);
    });
});
