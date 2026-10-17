/**
 * Copies text for the person (T3 Code's `useCopyToClipboard` at 2577baf,
 * trimmed to plain text): the Clipboard API, or the older `execCommand`
 * copy where the API is missing, as in a page not served securely.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("The clipboard is unavailable.");
  } finally {
    textarea.remove();
  }
}
