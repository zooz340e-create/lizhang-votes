// 友善商家地圖的共用介面零件（ShopApp / ShopLetters / ShopSupply 共用）
import type { ReactNode } from 'react';

export const inputCls =
  'mt-1 w-full rounded-lg border border-paper-line bg-white px-3 py-2 outline-none focus:border-ink-soft';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-soft/80">{label}</span>
      {children}
    </label>
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink/40" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-paper p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg font-black">{title}</h2>
          <button onClick={onClose} className="rounded-lg border border-paper-line px-3 py-1.5 text-sm">
            關閉
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// 複製到剪貼簿。LINE 內建瀏覽器與非 https 情境下 clipboard API 會失敗，
// 所以一定要有退路訊息，不能靜靜失敗。
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// 列印：開新視窗印純文字。紙本版的信要能直接遞出去。
export function printText(title: string, text: string) {
  const w = window.open('', '_blank', 'width=600,height=800');
  if (!w) return false;
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  w.document.write(
    `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${title}</title>` +
      `<style>body{font-family:"Noto Serif TC",serif;font-size:15px;line-height:2;padding:48px 40px;white-space:pre-wrap}</style>` +
      `</head><body>${esc}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
  return true;
}
