const MICRODUCK_AVE_URL =
  "https://ave.ai/token/0xd5f1afea47b1a9eab414d2ee740cf1d6d039e725-robinhood";

export function Microduck() {
  return (
    <iframe
      title="MICRODUCK Ave 行情"
      src={MICRODUCK_AVE_URL}
      className="h-full w-full border-0 bg-[var(--color-background)]"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  );
}
