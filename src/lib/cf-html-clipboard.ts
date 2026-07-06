/** Clean HTML clipboard helpers for Outlook / OneNote / Word paste. */

function mountClipboardFragment(fragmentHtml: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = fragmentHtml;
  // Mirror <font color> onto inline styles so Office keeps colors on native copy.
  container.querySelectorAll("font[color]").forEach((node) => {
    const color = node.getAttribute("color");
    if (!color) return;
    const el = node as HTMLElement;
    el.style.color = color;
  });
  container.querySelectorAll("b").forEach((node) => {
    (node as HTMLElement).style.fontWeight = "bold";
  });
  return container;
}

/** Wrap table fragment in a minimal HTML document (no CF_HTML Version header). */
export function buildClipboardHtmlDocument(fragmentHtml: string): string {
  return (
    `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word">` +
    `<head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>` +
    `<body>${fragmentHtml}</body></html>`
  );
}

export async function writeRichHtmlToClipboard(
  cleanHtml: string,
  plain: string,
  fragmentHtml: string,
): Promise<boolean> {
  // 1) Native copy from a rendered selection — best color fidelity in Office apps.
  try {
    const container = mountClipboardFragment(fragmentHtml);
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.setAttribute("aria-hidden", "true");
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const ok = document.execCommand("copy");
    selection?.removeAllRanges();
    document.body.removeChild(container);
    if (ok) return true;
  } catch {
    /* continue */
  }

  // 2) Explicit clean HTML (no Version:/StartHTML header) via copy event.
  try {
    const container = mountClipboardFragment(fragmentHtml);
    container.contentEditable = "true";
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    document.body.appendChild(container);

    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      e.clipboardData?.setData("text/html", cleanHtml);
      e.clipboardData?.setData("text/plain", plain);
    };
    document.addEventListener("copy", onCopy);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    let ok = false;
    try {
      ok = document.execCommand("copy");
    } finally {
      document.removeEventListener("copy", onCopy);
      selection?.removeAllRanges();
      document.body.removeChild(container);
    }
    if (ok) return true;
  } catch {
    /* continue */
  }

  // 3) Async Clipboard API with clean HTML only.
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([cleanHtml], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    /* continue */
  }

  try {
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    return false;
  }
}
