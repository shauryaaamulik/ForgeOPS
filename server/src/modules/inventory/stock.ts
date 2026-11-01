/** Pure stock arithmetic, kept free of database code so it is trivially testable. */
export function availableQty(onHand: number, reserved: number): number {
  return Math.max(0, onHand - reserved);
}

export function canReserve(onHand: number, reserved: number, requested: number): boolean {
  return Number.isFinite(requested) && requested > 0 && availableQty(onHand, reserved) >= requested;
}
