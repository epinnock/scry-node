/**
 * ledger F43: `adb shell` always re-joins everything after `shell` into ONE command line that
 * the device's `adbd` runs through `sh -c` — a local argv array to the local `adb` binary gives
 * no protection by itself. `--app-id` / app.json's `android.package` / `--open-url` must be
 * validated before they ever reach a device shell command, AND every argument that does reach
 * one must be single-quote-escaped regardless (defense in depth if a call site ever forgets to
 * validate).
 */
const { AndroidDevice, validateAppId, validateOpenUrl, quoteShellArg } = require('../lib/capture/android.js');

const SHELL_PAYLOADS = [
    'com.example.app; rm -rf /',
    'com.example.app$(rm -rf /)',
    'com.example.app`rm -rf /`',
    'com.example.app"; rm -rf /"',
    "com.example.app'; rm -rf /'",
    'com.example.app\n rm -rf /',
];

function quietLogger() {
    return { info: () => {}, warn: () => {}, error: () => {}, success: () => {}, debug: () => {} };
}

function deviceWithRun(run) {
    const device = new AndroidDevice({ deviceName: 'Pixel_6', logger: quietLogger(), run });
    device.serial = 'emulator-5554';
    return device;
}

describe('validateAppId (--app-id / app.json android.package)', () => {
    test('accepts a plausible reverse-DNS package name', () => {
        expect(validateAppId('com.example.app')).toBe('com.example.app');
        expect(validateAppId('host.exp.Exponent')).toBe('host.exp.Exponent');
    });

    test.each(SHELL_PAYLOADS)('rejects %j before any adb call', (payload) => {
        expect(() => validateAppId(payload)).toThrow(/Invalid Android app id/);
    });

    test('rejects a bare package name with no dot, and non-strings', () => {
        expect(() => validateAppId('com')).toThrow(/Invalid Android app id/);
        expect(() => validateAppId('')).toThrow(/Invalid Android app id/);
        expect(() => validateAppId(undefined)).toThrow(/Invalid Android app id/);
    });
});

describe('validateOpenUrl (--open-url)', () => {
    test('accepts known-good schemes, including a custom dev-client scheme', () => {
        expect(validateOpenUrl('exp://127.0.0.1:8081')).toBe('exp://127.0.0.1:8081');
        expect(validateOpenUrl('exps://127.0.0.1:8081')).toBe('exps://127.0.0.1:8081');
        expect(validateOpenUrl('https://example.com/app')).toBe('https://example.com/app');
        expect(validateOpenUrl('myapp://open')).toBe('myapp://open');
    });

    test.each([
        'exp://x; rm -rf /',
        'exp://x$(rm -rf /)',
        'exp://x`rm -rf /`',
        'exp://x"; rm -rf /"',
        "exp://x'; rm -rf /'",
        'exp://x\n rm -rf /',
        'exp://x rm -rf /', // whitespace alone
    ])('rejects %j before any adb call', (payload) => {
        expect(() => validateOpenUrl(payload)).toThrow(/--open-url/);
    });

    test('rejects a non-URL and an empty string', () => {
        expect(() => validateOpenUrl('not a url')).toThrow(/--open-url/);
        expect(() => validateOpenUrl('')).toThrow(/--open-url/);
    });
});

describe('quoteShellArg', () => {
    test('wraps a plain value in single quotes', () => {
        expect(quoteShellArg('com.example.app')).toBe("'com.example.app'");
    });

    test('escapes an embedded single quote so the shell sees it as one literal token', () => {
        // 'a'\''b' == the shell string a'b
        expect(quoteShellArg("a'b")).toBe("'a'\\''b'");
    });
});

describe('AndroidDevice: no adb call is ever made with an unvalidated appId/url', () => {
    test.each(SHELL_PAYLOADS)('isInstalled() rejects %j without calling run()', (payload) => {
        const run = jest.fn();
        const device = deviceWithRun(run);
        expect(() => device.isInstalled(payload)).toThrow(/Invalid Android app id/);
        expect(run).not.toHaveBeenCalled();
    });

    test.each(SHELL_PAYLOADS)('launch() rejects %j without calling run()', (payload) => {
        const run = jest.fn();
        const device = deviceWithRun(run);
        expect(() => device.launch(payload)).toThrow(/Invalid Android app id/);
        expect(run).not.toHaveBeenCalled();
    });

    test.each([
        'exp://x; rm -rf /',
        'exp://x$(rm -rf /)',
        'exp://x`rm -rf /`',
        'exp://x"; touch /tmp/pwned"',
        "exp://x'; touch /tmp/pwned'",
        'exp://x\n touch /tmp/pwned',
    ])('openUrl() rejects %j without calling run()', (payload) => {
        const run = jest.fn();
        const device = deviceWithRun(run);
        expect(() => device.openUrl(payload)).toThrow(/--open-url/);
        expect(run).not.toHaveBeenCalled();
    });

    test('a valid appId reaches adb as one single-quoted token per argument (isInstalled)', () => {
        const run = jest.fn(() => ({ stdout: 'package:com.example.app\n' }));
        const device = deviceWithRun(run);
        expect(device.isInstalled('com.example.app')).toBe(true);
        expect(run).toHaveBeenCalledWith(
            device.adb,
            ['-s', 'emulator-5554', 'shell', "'pm' 'list' 'packages' 'com.example.app'"],
            { allowFail: true }
        );
    });

    test('a valid appId reaches adb as one single-quoted token per argument (launch)', () => {
        const run = jest.fn(() => ({ stdout: '' }));
        const device = deviceWithRun(run);
        device.launch('com.example.app');
        expect(run).toHaveBeenNthCalledWith(
            1,
            device.adb,
            ['-s', 'emulator-5554', 'shell', "'am' 'force-stop' 'com.example.app'"],
            { allowFail: true }
        );
        expect(run).toHaveBeenNthCalledWith(
            2,
            device.adb,
            ['-s', 'emulator-5554', 'shell', "'monkey' '-p' 'com.example.app' '-c' 'android.intent.category.LAUNCHER' '1'"],
            {}
        );
    });

    test('a valid --open-url reaches adb as one single-quoted token per argument, including the url', () => {
        const run = jest.fn(() => ({ stdout: '' }));
        const device = deviceWithRun(run);
        device.openUrl('exp://127.0.0.1:8081');
        expect(run).toHaveBeenCalledWith(
            device.adb,
            ['-s', 'emulator-5554', 'shell', "'am' 'start' '-a' 'android.intent.action.VIEW' '-d' 'exp://127.0.0.1:8081'"],
            {}
        );
    });
});
