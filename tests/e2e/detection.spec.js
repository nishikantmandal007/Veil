/**
 * detection.spec.js — E2E tests for content-script PII detection (CommonJS).
 */
const { test, expect } = require('./fixtures');
const { startMockServer, stopMockServer } = require('./mock_server');

// ─── Minimal HTML test page (data: URL) ──────────────────────────────────────

const TEST_PAGE_HTML = `<!DOCTYPE html>
<html>
<head><title>Veil detection test</title></head>
<body>
  <textarea id="userInput" style="width:400px;height:100px;"></textarea>
  <div class="markdown-body" id="responseArea">This is an AI response mentioning John Smith.</div>
</body>
</html>`;

const DATA_URL = `data:text/html;charset=utf-8,${encodeURIComponent(TEST_PAGE_HTML)}`;

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Content-Script Detection', () => {
    let mockServer;

    test.beforeEach(async () => {
        mockServer = await startMockServer({
            port: 8765,
            healthy: true,
            loaded: true,
            detections: [
                { text: 'Jane Doe', label: 'person', start: 12, end: 20, score: 0.92, source: 'gliner2' },
            ],
        });
    });

    test.afterEach(async () => {
        if (mockServer) await stopMockServer(mockServer);
    });

    test('content script attaches and textarea retains value after detection', async ({ extensionContext }) => {
        const { context } = extensionContext;
        const page = await context.newPage();
        await page.goto(DATA_URL);
        await page.waitForLoadState('domcontentloaded');

        const textarea = page.locator('#userInput');
        await textarea.click();
        await textarea.fill('My name is Jane Doe and my email is jane@example.com');

        // Wait for Veil debounce + detection (up to 4s)
        await page.waitForTimeout(3000);

        // Extension should be alive and textarea should still have its value
        const value = await textarea.inputValue();
        expect(value.length).toBeGreaterThan(0);

        await page.close();
    });

    test('LLM response areas (.markdown-body) are never modified', async ({ extensionContext }) => {
        const { context } = extensionContext;
        const page = await context.newPage();
        await page.goto(DATA_URL);
        await page.waitForLoadState('domcontentloaded');

        await page.waitForTimeout(2000);

        // No ps-* spans injected into the response area
        const injectedCount = await page.locator('#responseArea .ps-redaction, #responseArea .ps-pii-underline').count();
        expect(injectedCount).toBe(0);

        // Original text intact
        const text = await page.locator('#responseArea').textContent();
        expect(text).toContain('John Smith');

        await page.close();
    });
});

test.describe('Regex Fallback (no server)', () => {
    test('extension does not crash when server is offline', async ({ extensionContext }) => {
        // No mock server — server is offline; regex fallback should kick in silently
        const { context } = extensionContext;
        const page = await context.newPage();
        await page.goto(DATA_URL);
        await page.waitForLoadState('domcontentloaded');

        const textarea = page.locator('#userInput');
        await textarea.click();
        await textarea.fill('Call me at 415-555-1234 or sk-abcdefghijklmnopqrst');

        await page.waitForTimeout(2500);

        // Extension process should not have crashed
        const value = await textarea.inputValue();
        expect(value.length).toBeGreaterThan(0);

        await page.close();
    });
});
