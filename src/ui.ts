/** Tiny DOM helper: el('button', { class: 'btn' }, 'Play') */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'value' && 'value' in e) (e as HTMLInputElement).value = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}
