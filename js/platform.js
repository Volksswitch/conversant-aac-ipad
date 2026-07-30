/*
 * platform.js — what this browser can actually be relied on to do.
 *
 * Every fact encoded here was MEASURED on an iPad 10th generation (iPadOS 26,
 * Safari 26.6) on July 30 2026, across six runs: Safari, Chrome and Edge, each as
 * a browser tab and as a Home Screen app. Nothing here is inferred from published
 * documentation, which was wrong about iOS four times out of eight when tested.
 *
 * THE MEASURED RESULT, in one table:
 *
 *                        speech recognition        persistent storage
 *   Safari, tab          WORKS                     denied
 *   Safari, Home Screen  starts, delivers nothing  GRANTED
 *   Chrome, tab          starts, delivers nothing  denied
 *   Edge, tab            starts, delivers nothing  denied
 *   any Home Screen app  starts, delivers nothing  GRANTED
 *
 * The failure mode is the dangerous kind: recognition STARTS, feature detection
 * passes, and then no interim and no final results ever arrive. An app that trusts
 * feature detection will sit with its microphone icon lit, believing it is
 * listening, forever. For an AAC user that is worse than an honest refusal, so the
 * app asks this module first and says plainly when partner capture cannot work.
 *
 * ON USER-AGENT SNIFFING. Detecting the platform is normally a smell, and it is
 * used sparingly here, because these behaviors are NOT feature-detectable — the
 * APIs are all present in the environments where they silently do nothing. Where a
 * capability check exists (storage), it is used instead; see storage.js.
 *
 * The one genuine trap: iPadOS Safari requests desktop sites by default and its
 * user-agent says "Macintosh; Intel Mac OS X" with no "iPad" anywhere in it
 * (measured). A naive /iPad/ test therefore MISSES Safari — the only browser the
 * app works in — while matching Chrome and Edge, which do say "iPad" and are the
 * two that do not work. The maxTouchPoints check below is what avoids getting this
 * exactly backwards.
 */

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

// A Mac never reports multiple touch points; an iPad always does. This is the
// documented way to tell an iPadOS Safari (which claims to be a Mac) from an
// actual Mac, and it is why we do not simply match /iPad/.
function isTouchApple() {
    if (typeof navigator === 'undefined') return false;
    const applish = /Macintosh|iPad|iPhone|iPod/.test(ua);
    return applish && (navigator.maxTouchPoints || 0) > 1;
}

export function isIOS() {
    return isTouchApple();
}

// Running as a Home Screen app rather than in a browser tab. Both signals are
// checked because navigator.standalone is the older iOS-specific one and
// display-mode is the standard.
export function isStandalone() {
    if (typeof window === 'undefined') return false;
    if (window.navigator && window.navigator.standalone === true) return true;
    try {
        return window.matchMedia('(display-mode: standalone)').matches;
    } catch {
        return false;
    }
}

// Chrome and Edge on iOS are WebKit in a different wrapper. They identify
// themselves with their own tokens AND do say "iPad", so unlike Safari they are
// straightforward to detect.
export function iosBrowserShell() {
    if (!isTouchApple()) return null;
    if (/CriOS/.test(ua)) return 'Chrome';
    if (/EdgiOS/.test(ua)) return 'Edge';
    if (/FxiOS/.test(ua)) return 'Firefox';
    return null;    // Safari proper
}

/*
 * Can built-in speech recognition be relied on here?
 *
 * Returns { usable, reason, remedy } — reason and remedy are user-facing, because
 * the whole point is to replace a silent failure with an explanation the user can
 * act on.
 */
export function speechRecognitionSupport() {
    const present = typeof window !== 'undefined' &&
        ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

    if (!present) {
        return {
            usable: false,
            reason: 'This browser has no speech recognition.',
            remedy: isIOS()
                ? 'Use Safari on this iPad.'
                : 'Use Microsoft Edge or Google Chrome.',
        };
    }

    if (isIOS()) {
        // Measured: recognition starts and then delivers nothing at all in a Home
        // Screen app, in every browser.
        if (isStandalone()) {
            return {
                usable: false,
                reason: 'Listening does not work when the app is opened from the Home Screen.',
                remedy: 'Open Conversant in Safari instead. You can still type and use the Express Panel here.',
            };
        }
        // Measured: same silent failure in the Chrome and Edge wrappers, which
        // share Safari's engine but not its access to speech.
        const shell = iosBrowserShell();
        if (shell) {
            return {
                usable: false,
                reason: `Listening does not work in ${shell} on iPad.`,
                remedy: 'Open Conversant in Safari instead. You can still type and use the Express Panel here.',
            };
        }
        return { usable: true, reason: '', remedy: '' };
    }

    return { usable: true, reason: '', remedy: '' };
}

/*
 * Recognition tuning for this platform.
 *
 *  continuous — iOS is NOT given continuous mode. Not because it fails: measured,
 *    it works. But it took 4,274 ms to a first result against 1,851 ms without,
 *    and this app exists to beat the four-second awkward-silence threshold, so
 *    2.4 seconds of avoidable latency on every partner turn is not affordable.
 *    stt.js already restarts recognition on 'end' while the user intends to
 *    listen, so non-continuous costs nothing structurally.
 *
 *  restartDelayMs — a beat before restarting, so a session that ends immediately
 *    cannot spin into a tight restart loop.
 *
 *  guardVisibility — iOS stops recognition when the page is backgrounded without
 *    telling the app, which would leave it believing it is still listening.
 */
export function speechConfig() {
    if (isIOS()) {
        return { continuous: false, restartDelayMs: 200, guardVisibility: true };
    }
    return { continuous: true, restartDelayMs: 0, guardVisibility: false };
}

// One-line description for diagnostics and bug reports.
export function describe() {
    const bits = [];
    bits.push(isIOS() ? 'iPadOS/iOS' : 'desktop');
    const shell = iosBrowserShell();
    if (shell) bits.push(shell + ' (WebKit wrapper)');
    else if (isIOS()) bits.push('Safari');
    bits.push(isStandalone() ? 'Home Screen app' : 'browser tab');
    const sr = speechRecognitionSupport();
    bits.push(sr.usable ? 'listening available' : 'listening unavailable');
    return bits.join(' · ');
}
