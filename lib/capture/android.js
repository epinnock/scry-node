/**
 * Android emulator driver for `capture rn`: find (or boot) the AVD, make the screen
 * deterministic (System UI demo mode: 09:41, full battery, no notifications; animations off),
 * install/launch the app, screenshot with `adb exec-out screencap -p`, and find the
 * `scry-root` testID bounds with uiautomator (React Native exposes testID as resource-id).
 */
const fs = require('fs');
const path = require('path');
const exec = require('./exec.js');

const ANIMATION_KEYS = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'];

function adbBinary() {
    const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    const candidate = home ? path.join(home, 'platform-tools', 'adb') : null;
    return candidate && fs.existsSync(candidate) ? candidate : 'adb';
}

function emulatorBinary() {
    const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    const candidate = home ? path.join(home, 'emulator', 'emulator') : null;
    return candidate && fs.existsSync(candidate) ? candidate : 'emulator';
}

/** Parse `bounds="[x1,y1][x2,y2]"` of the node whose resource-id is the root testID. */
function findTestIdBounds(xml, testId) {
    const re = /<node\b[^>]*>/g;
    let m;
    while ((m = re.exec(xml))) {
        const tag = m[0];
        const rid = /resource-id="([^"]*)"/.exec(tag);
        if (!rid || (rid[1] !== testId && !rid[1].endsWith(`:id/${testId}`))) continue;
        const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
        if (!b) continue;
        const [x1, y1, x2, y2] = b.slice(1).map(Number);
        return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }
    return null;
}

class AndroidDevice {
    constructor({ deviceName, logger, run = exec.run, bootTimeoutMs = 300000 }) {
        this.deviceName = deviceName;
        this.logger = logger;
        this.run = run;
        this.adb = adbBinary();
        this.serial = null;
        this.bootTimeoutMs = bootTimeoutMs;
        this.emulatorProcess = null;
        this.savedAnimation = {};
        this.method = 'emulator';
    }

    adbArgs(...args) {
        return this.serial ? ['-s', this.serial, ...args] : args;
    }

    shell(cmd, opts = {}) {
        return String(this.run(this.adb, this.adbArgs('shell', cmd), opts).stdout || '').trim();
    }

    listSerials() {
        const out = String(this.run(this.adb, ['devices'], { allowFail: true }).stdout || '');
        return out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === 'device').map((p) => p[0]);
    }

    avdName(serial) {
        // The system property needs no emulator-console auth token (the console does, and an
        // emulator started by another user, e.g. root in a container, keeps it unreadable).
        for (const prop of ['ro.boot.qemu.avd_name', 'ro.kernel.qemu.avd_name']) {
            const res = this.run(this.adb, ['-s', serial, 'shell', 'getprop', prop], { allowFail: true, timeoutMs: 10000 });
            const name = String(res.stdout || '').trim();
            if (name) return name;
        }
        const res = this.run(this.adb, ['-s', serial, 'emu', 'avd', 'name'], { allowFail: true, timeoutMs: 10000 });
        return String(res.stdout || '').split('\n')[0].trim();
    }

    async connect() {
        const pick = () => {
            const serials = this.listSerials();
            if (!this.deviceName) return serials[0] || null;
            if (serials.includes(this.deviceName)) return this.deviceName;
            return serials.find((s) => s.startsWith('emulator-') && this.avdName(s) === this.deviceName) || null;
        };
        this.serial = pick();
        if (!this.serial) {
            if (!this.deviceName) throw new Error('No Android device is connected and no --device (AVD name) was given.');
            this.logger.info(`Booting AVD ${this.deviceName} ...`);
            this.emulatorProcess = exec.startBackground(emulatorBinary(), ['-avd', this.deviceName, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save']);
            const deadline = Date.now() + this.bootTimeoutMs;
            while (!this.serial && Date.now() < deadline) {
                await exec.sleep(3000);
                this.serial = pick();
            }
            if (!this.serial) throw new Error(`AVD ${this.deviceName} did not come up within ${this.bootTimeoutMs / 1000} s.`);
        }
        const deadline = Date.now() + this.bootTimeoutMs;
        while (this.shell('getprop sys.boot_completed', { allowFail: true }) !== '1') {
            if (Date.now() > deadline) throw new Error(`${this.serial} did not finish booting.`);
            await exec.sleep(2000);
        }
        this.os = `Android ${this.shell('getprop ro.build.version.release')}`;
        this.name = this.deviceName || this.shell('getprop ro.product.model');
        this.scale = this.readScale();
        this.logger.info(`Device: ${this.name} (${this.serial}, ${this.os}, scale ${this.scale}).`);
    }

    readScale() {
        const out = this.shell('wm density', { allowFail: true });
        const override = /Override density:\s*(\d+)/.exec(out);
        const physical = /Physical density:\s*(\d+)/.exec(out);
        const dpi = Number((override || physical || [])[1]);
        return dpi > 0 ? dpi / 160 : 1;
    }

    /** Status bar 09:41, full battery, no notifications; animations off. Undone by cleanup(). */
    makeDeterministic() {
        for (const key of ANIMATION_KEYS) {
            this.savedAnimation[key] = this.shell(`settings get global ${key}`, { allowFail: true });
            this.shell(`settings put global ${key} 0`, { allowFail: true });
        }
        const demo = (args) => this.shell(`am broadcast -a com.android.systemui.demo ${args}`, { allowFail: true });
        this.shell('settings put global sysui_demo_allowed 1', { allowFail: true });
        demo('-e command enter');
        demo('-e command clock -e hhmm 0941');
        demo('-e command battery -e level 100 -e plugged false');
        demo('-e command network -e wifi show -e level 4 -e mobile show -e datatype none -e level 4');
        demo('-e command notifications -e visible false');
        this.demoMode = true;
    }

    reversePorts(ports) {
        for (const p of ports) this.run(this.adb, this.adbArgs('reverse', `tcp:${p}`, `tcp:${p}`));
        this.reversed = ports;
    }

    isInstalled(appId) {
        return this.shell(`pm list packages ${appId}`, { allowFail: true }).split('\n').some((l) => l.trim() === `package:${appId}`);
    }

    install(appPath) {
        this.logger.info(`Installing ${appPath} ...`);
        this.run(this.adb, this.adbArgs('install', '-r', appPath), { timeoutMs: 300000 });
    }

    launch(appId) {
        this.shell(`am force-stop ${appId}`, { allowFail: true });
        this.shell(`monkey -p ${appId} -c android.intent.category.LAUNCHER 1`);
    }

    openUrl(url) {
        this.run(this.adb, this.adbArgs('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url));
    }

    screenshot() {
        const res = this.run(this.adb, this.adbArgs('exec-out', 'screencap', '-p'), { binary: true, timeoutMs: 30000 });
        return res.stdout;
    }

    /** Pixel bounds of the root testID on screen, or null. */
    findRootBounds(testId) {
        const dump = this.shell('uiautomator dump /sdcard/scry-ui.xml', { allowFail: true, timeoutMs: 30000 });
        if (!/dumped to/i.test(dump)) return null;
        const xml = this.shell('cat /sdcard/scry-ui.xml', { allowFail: true });
        return findTestIdBounds(xml, testId);
    }

    cleanup() {
        if (!this.serial) return;
        if (this.demoMode) {
            this.shell('am broadcast -a com.android.systemui.demo -e command exit', { allowFail: true });
        }
        for (const [key, value] of Object.entries(this.savedAnimation)) {
            const v = value && value !== 'null' ? value : '1';
            this.shell(`settings put global ${key} ${v}`, { allowFail: true });
        }
        for (const p of this.reversed || []) this.run(this.adb, this.adbArgs('reverse', '--remove', `tcp:${p}`), { allowFail: true });
        if (this.emulatorProcess) {
            this.run(this.adb, this.adbArgs('emu', 'kill'), { allowFail: true });
            this.emulatorProcess.kill();
        }
    }
}

module.exports = { AndroidDevice, findTestIdBounds };
