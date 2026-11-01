/**
 * Simple finite-capacity check: can a machine finish `quantity` units by the
 * deadline, given work already booked on it?
 *
 * Assumes the machine is available `hoursPerDay` hours each calendar day.
 * This is deliberately simple; real shift calendars come later.
 */
export interface CapacityInput {
  quantity: number;
  ratedUnitsPerHour: number;
  bookedHours: number;
  now: Date;
  deadline: Date;
  hoursPerDay?: number;
}

export interface CapacityResult {
  feasible: boolean;
  requiredHours: number;
  availableHours: number;
}

export function checkCapacity(input: CapacityInput): CapacityResult {
  const { quantity, ratedUnitsPerHour, bookedHours, now, deadline, hoursPerDay = 16 } = input;
  if (!(quantity > 0)) throw new RangeError("quantity must be positive");
  if (!(ratedUnitsPerHour > 0)) throw new RangeError("ratedUnitsPerHour must be positive");
  if (bookedHours < 0) throw new RangeError("bookedHours cannot be negative");

  const msLeft = deadline.getTime() - now.getTime();
  const daysLeft = Math.max(0, msLeft) / 86_400_000;
  const availableHours = Math.max(0, daysLeft * hoursPerDay - bookedHours);
  const requiredHours = quantity / ratedUnitsPerHour;
  return { feasible: requiredHours <= availableHours, requiredHours, availableHours };
}
