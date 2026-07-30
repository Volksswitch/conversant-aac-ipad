/* Reusable "danger" confirmation modal.
 *
 * Destructive actions (clearing answers, deleting people, overwriting a saved
 * profile) must NOT use the native window.confirm() — its dialog is visually
 * identical to routine browser/OS prompts (notably the File System Access
 * folder-permission popup), so the user dismisses it on autopilot and a
 * wipe-everything action doesn't read as dangerous (Ken, June 15 2026).
 *
 * This renders a deliberately distinct modal — red danger styling, a warning
 * mark, an explicit consequence line, and a red confirm button — that cannot be
 * mistaken for a permission prompt. Cancel is focused by default, so a stray
 * Enter/Space cancels rather than confirms. Returns Promise<boolean>.
 *
 * Use via: if (!(await confirmDanger({ title, body, confirmLabel }))) return;
 */

export function confirmDanger({
    title = 'Are you sure?',
    body = 'This cannot be undone.',
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel'
} = {}) {
    return new Promise((resolve) => {
        const dlg = document.createElement('dialog');
        dlg.className = 'danger-dialog';

        const head = document.createElement('div');
        head.className = 'danger-head';
        const mark = document.createElement('span');
        mark.className = 'danger-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '⚠';
        const h = document.createElement('h2');
        h.className = 'danger-title';
        h.textContent = title;
        head.append(mark, h);

        const p = document.createElement('p');
        p.className = 'danger-body';
        p.textContent = body;

        const actions = document.createElement('div');
        actions.className = 'danger-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'danger-cancel';
        cancelBtn.textContent = cancelLabel;
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'danger-confirm';
        confirmBtn.textContent = confirmLabel;
        actions.append(cancelBtn, confirmBtn);

        dlg.append(head, p, actions);

        let settled = false;
        const done = (val) => {
            if (settled) return;
            settled = true;
            try { dlg.close(); } catch { /* already closing */ }
            dlg.remove();
            resolve(val);
        };

        cancelBtn.addEventListener('click', () => done(false));
        confirmBtn.addEventListener('click', () => done(true));
        // Escape -> cancel (the safe default).
        dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
        // Click on the backdrop (outside the card) -> cancel.
        dlg.addEventListener('click', (e) => { if (e.target === dlg) done(false); });

        document.body.append(dlg);
        dlg.showModal();   // top layer — sits above the full-screen overlays
        cancelBtn.focus();
    });
}
