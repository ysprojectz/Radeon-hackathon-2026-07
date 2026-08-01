/**
 * Shared Motion Configurations
 * ────────────────────────────
 * Optimized for high-frequency touch screens (iPad Pro) 
 * and large-format monitors.
 */

export const SPRING_PHYSICS = {
  // Snappy response for buttons and toggles
  snappy: {
    type: "spring" as const,
    stiffness: 400,
    damping: 30,
    mass: 1,
  },
  // Fluid response for large layout shifts (Sidebar, Panels)
  fluid: {
    type: "spring" as const,
    stiffness: 300,
    damping: 35,
    mass: 1,
  },
  // Smooth entry for page transitions
  gentle: {
    type: "spring" as const,
    stiffness: 100,
    damping: 20,
    mass: 1,
  }
};

export const TOUCH_GESTURE_CONFIG = {
  dragElastic: 0.1,
  dragConstraints: { left: 0, right: 0 },
  dragTransition: { bounceStiffness: 600, bounceDamping: 20 },
};

export const UNIVERSAL_ANIMATION = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
  transition: SPRING_PHYSICS.snappy,
};
