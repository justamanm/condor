const MICRODUCK_DASHBOARD_URL = "http://127.0.0.1:29463/";

export function Microduck() {
  return (
    <iframe
      title="MICRODUCK 策略价格"
      src={MICRODUCK_DASHBOARD_URL}
      className="h-full w-full border-0 bg-[var(--color-background)]"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
