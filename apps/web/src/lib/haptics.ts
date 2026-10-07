/** A small vibration on phones, only after the visitor has touched the page (else browsers block it and warn). */
export function buzz(pattern: number | number[]): void {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  navigator.vibrate?.(pattern);
}
