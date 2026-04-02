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

async function sendDetectRequest(context, extensionId, text, options = {}) {
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await extensionPage.waitForLoadState('domcontentloaded');
    const response = await extensionPage.evaluate(
        ({ payloadText, payloadOptions }) => new Promise((resolve) => chrome.runtime.sendMessage({
            action: 'detectPII',
            text: payloadText,
            options: payloadOptions,
        }, resolve)),
        { payloadText: text, payloadOptions: options }
    );
    await extensionPage.close();
    return response;
}

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

    test('regex token detectors stay off while the model is online when the toggle is disabled', async ({ extensionContext }) => {
        const { context, extensionId } = extensionContext;
        const response = await sendDetectRequest(
            context,
            extensionId,
            'My name is Jane Doe and my key is sk-abcdefghijklmnopqrst',
            {
                enabledTypes: ['person'],
                includeRegexWhenModelOnline: false,
                customPatterns: [
                    {
                        id: 'openai_key',
                        label: 'api_key',
                        pattern: '\\b(?:sk-[A-Za-z0-9]{20,}|sk_(?:test|live)_[A-Za-z0-9]{16,}|sk-proj-[A-Za-z0-9_-]{20,})\\b',
                        flags: 'g',
                        score: 0.99,
                        replacement: '[API KEY REDACTED]',
                        enabled: true,
                    },
                ],
            }
        );

        expect(response.success).toBeTruthy();
        expect(response.mode).toBe('gliner2-local');
        expect(response.detections.map((item) => item.label)).not.toContain('api_key');
    });

    test('regex token detectors run alongside the model when the toggle is enabled', async ({ extensionContext }) => {
        const { context, extensionId } = extensionContext;
        const response = await sendDetectRequest(
            context,
            extensionId,
            'My name is Jane Doe and my key is sk-abcdefghijklmnopqrst',
            {
                enabledTypes: ['person'],
                includeRegexWhenModelOnline: true,
                customPatterns: [
                    {
                        id: 'openai_key',
                        label: 'api_key',
                        pattern: '\\b(?:sk-[A-Za-z0-9]{20,}|sk_(?:test|live)_[A-Za-z0-9]{16,}|sk-proj-[A-Za-z0-9_-]{20,})\\b',
                        flags: 'g',
                        score: 0.99,
                        replacement: '[API KEY REDACTED]',
                        enabled: true,
                    },
                ],
            }
        );

        expect(response.success).toBeTruthy();
        expect(response.mode).toBe('gliner2-local');
        expect(response.detections.map((item) => item.label)).toContain('api_key');
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
    test('regex fallback detects built-in token patterns when server is offline', async ({ extensionContext }) => {
        // No mock server — server is offline; regex fallback should kick in silently
        const { context, extensionId } = extensionContext;
        const response = await sendDetectRequest(
            context,
            extensionId,
            'Call me at 415-555-1234 or sk-abcdefghijklmnopqrst',
            {
                enabledTypes: ['phone'],
                includeRegexWhenModelOnline: false,
                customPatterns: [
                    {
                        id: 'openai_key',
                        label: 'api_key',
                        pattern: '\\b(?:sk-[A-Za-z0-9]{20,}|sk_(?:test|live)_[A-Za-z0-9]{16,}|sk-proj-[A-Za-z0-9_-]{20,})\\b',
                        flags: 'g',
                        score: 0.99,
                        replacement: '[API KEY REDACTED]',
                        enabled: true,
                    },
                ],
            }
        );

        expect(response.success).toBeTruthy();
        expect(response.mode).toBe('regex-fallback');
        expect(response.detections.map((item) => item.label).sort()).toEqual(['api_key', 'phone']);
    });
});
