// Screen geometry: pixels <-> millimetres <-> degrees of visual angle.
// The eye is modelled as a point on the screen normal through the screen
// centre at the measured viewing distance. Angles are true ray angles, so
// eccentric targets are not distorted by a small-angle approximation.

export class ScreenGeometry {
  /**
   * @param screen {widthPx, heightPx, widthMm, heightMm}
   * @param distanceMm eye-to-screen distance
   */
  constructor(screen, distanceMm) {
    this.s = screen;
    this.d = distanceMm;
    this.mmPerPxX = screen.widthMm / screen.widthPx;
    this.mmPerPxY = screen.heightMm / screen.heightPx;
  }

  _ray(p) {
    return [
      (p[0] - this.s.widthPx / 2) * this.mmPerPxX,
      (p[1] - this.s.heightPx / 2) * this.mmPerPxY,
      this.d,
    ];
  }

  /** Angle (degrees) between the gaze rays towards two screen points (px). */
  angleBetween(p, q) {
    const a = this._ray(p), b = this._ray(q);
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cx = a[1] * b[2] - a[2] * b[1];
    const cy = a[2] * b[0] - a[0] * b[2];
    const cz = a[0] * b[1] - a[1] * b[0];
    return Math.atan2(Math.hypot(cx, cy, cz), dot) * 180 / Math.PI;
  }

  /** Approximate px per degree at the screen centre (for reporting only). */
  pixelsPerDegreeAtCentre() {
    const half = this.d * Math.tan(Math.PI / 360);  // mm per 1 degree (half-angle)
    return 2 * half / this.mmPerPxX;
  }
}

/**
 * Viewing distance (mm) implied by the apparent iris size, a robustness check
 * for the measured distance. irisPx is the iris diameter in image pixels.
 */
export function distanceFromIris(irisPx, imageWidthPx, hfovDeg, irisMm = 11.7) {
  const focalPx = (imageWidthPx / 2) / Math.tan(hfovDeg * Math.PI / 360);
  return focalPx * irisMm / irisPx;
}
