"use client";
import { useState, useEffect } from "react";

export type DeviceType = "mobile" | "tablet" | "desktop" | "large-desktop";

export interface DeviceInfo {
  type: DeviceType;
  isTouch: boolean;
  isHighRefresh: boolean;
  orientation: "portrait" | "landscape";
  width: number;
  height: number;
}

export function useDevice(): DeviceInfo {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>({
    type: "desktop",
    isTouch: false,
    isHighRefresh: false,
    orientation: "landscape",
    width: 1280,
    height: 800,
  });

  useEffect(() => {
    function getDeviceInfo(): DeviceInfo {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      let type: DeviceType = "desktop";
      if (width < 768) type = "mobile";
      else if (width < 1280) type = "tablet";
      else if (width < 1920) type = "desktop";
      else type = "large-desktop";

      // Detect ProMotion / 120Hz (heuristic based on requestAnimationFrame)
      // Note: This is an estimation; actual detection is complex in JS
      const isHighRefresh = false; // Placeholder for future refined detection

      return {
        type,
        isTouch: "ontouchstart" in window || navigator.maxTouchPoints > 0,
        isHighRefresh,
        orientation: width > height ? "landscape" : "portrait",
        width,
        height,
      };
    }

    function handleResize() {
      setDeviceInfo(getDeviceInfo());
    }

    handleResize(); // Initial check
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return deviceInfo;
}
