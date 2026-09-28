/**
 * iOS Simulator driver for `capture rn` (macOS only): find (or boot) the simulator by name,
 * override the status bar (9:41, full battery), install/launch the app and screenshot with
 * `xcrun simctl io <udid> screenshot`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const exec = require('./exec.js');

const EXPO_GO = 'host.exp.Exponent';

/** "com.apple.CoreSimulator.SimRuntime.iOS-18-2" -> "iOS 18.2" */
function runtimeLabel(runtimeId) {
    const m = /SimRuntime\.([A-Za-z]+)-([\d-]+)$/.exec(runtimeId || '');
    return m ? `${m[1]} ${m[2].replace(/-/g, '.')}` : runtimeId || 'iOS';
}

function pickSimulator(listJson, name) {
    const candidates = [];
    for (const [runtime, devices] of Object.entries(listJson.devices || {})) {
        for (const d of devices) {
            if (d.isAvailable === false) continue;
            if (!name || d.name === name || d.udid === name) candidates.push({ ...d, runtime });
        }
    }
    // Prefer a booted one, then the newest runtime.
    candidates.sort((a, b) => (b.state === 'Booted') - (a.state === 'Booted') || b.runtime.localeCompare(a.runtime, undefined, { numeric: true }));
    return candidates[0] || null;
}

class IosSimulator {
    constructor({ deviceName, logger, run = exec.run }) {
        this.deviceName = deviceName;
        this.logger = logger;
        this.run = run;
        this.udid = null;
        this.bootedByUs = false;
        this.method = 'simulator';
    }

    simctl(args, opts) {
        return this.run('xcrun', ['simctl', ...args], opts);
    }

    async connect() {
        if (process.platform !== 'darwin') throw new Error('capture rn --platform ios needs macOS with Xcode (xcrun simctl).');
        const list = JSON.parse(String(this.simctl(['list', 'devices', '-j']).stdout));
        const sim = pickSimulator(list, this.deviceName);
        if (!sim) throw new Error(`No available simulator named ${JSON.stringify(this.deviceName)} (xcrun simctl list devices).`);
        this.udid = sim.udid;
        if (sim.state !== 'Booted') {
            this.logger.info(`Booting ${sim.name} ...`);
            this.simctl(['boot', this.udid]);
            this.bootedByUs = true;
        }
        this.simctl(['bootstatus', this.udid, '-b'], { timeoutMs: 600000 });
        this.name = sim.name;
        this.os = runtimeLabel(sim.runtime);
        // Every current iPhone is @3x, iPads and the SE-class phones @2x; the app's probe
        // reports the exact PixelRatio when present and overrides this.
        this.scale = /iPad|SE/.test(sim.name) ? 2 : 3;
        this.logger.info(`Device: ${this.name} (${this.udid}, ${this.os}).`);
    }

    makeDeterministic() {
        this.simctl(['status_bar', this.udid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100',
            '--cellularMode', 'active', '--cellularBars', '4', '--wifiBars', '3', '--dataNetwork', 'wifi'], { allowFail: true });
        this.simctl(['ui', this.udid, 'appearance', 'light'], { allowFail: true });
        this.statusBarOverridden = true;
    }

    reversePorts() { /* the simulator shares the host's localhost */ }

    isInstalled(appId) {
        return this.simctl(['get_app_container', this.udid, appId], { allowFail: true }).status === 0;
    }

    install(appPath) {
        this.logger.info(`Installing ${appPath} ...`);
        this.simctl(['install', this.udid, appPath], { timeoutMs: 300000 });
    }

    launch(appId) {
        this.simctl(['terminate', this.udid, appId], { allowFail: true });
        if (appId === EXPO_GO) {
            // Expo Go draws its dev-menu onboarding sheet and a floating gear over the app;
            // neither belongs in a capture.
            for (const [key, value] of [['EXDevMenuIsOnboardingFinished', 'YES'], ['EXDevMenuShowFloatingActionButton', 'NO']]) {
                this.simctl(['spawn', this.udid, 'defaults', 'write', EXPO_GO, key, '-bool', value], { allowFail: true });
            }
        }
        this.simctl(['launch', this.udid, appId]);
    }

    openUrl(url) {
        this.simctl(['openurl', this.udid, url]);
    }

    screenshot() {
        const file = path.join(os.tmpdir(), `scry-sim-${process.pid}-${Date.now()}.png`);
        try {
            this.simctl(['io', this.udid, 'screenshot', '--type=png', file], { timeoutMs: 30000 });
            return fs.readFileSync(file);
        } finally {
            fs.rmSync(file, { force: true });
        }
    }

    /** No uiautomator on iOS: the crop comes from the app's probe (rootBounds × scale). */
    findRootBounds() {
        return null;
    }

    cleanup() {
        if (!this.udid) return;
        if (this.statusBarOverridden) this.simctl(['status_bar', this.udid, 'clear'], { allowFail: true });
        if (this.bootedByUs) this.simctl(['shutdown', this.udid], { allowFail: true });
    }
}

module.exports = { IosSimulator, pickSimulator, runtimeLabel };
