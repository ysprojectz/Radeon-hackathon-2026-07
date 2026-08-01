import { toast } from "@/components/ui/toast";

/**
 * Custom hook for toast notifications
 * Provides a consistent API for showing toast notifications
 */
export function useToast() {
  return {
    success: (title: string, description?: string) => {
      toast.success(title, { description });
    },
    error: (title: string, description?: string) => {
      toast.error(title, { description });
    },
    warning: (title: string, description?: string) => {
      toast.warning(title, { description });
    },
    info: (title: string, description?: string) => {
      toast.info(title, { description });
    },
    // Generic toast for custom variants
    toast: (title: string, options?: { variant?: string; description?: string }) => {
      toast(title, options);
    }
  };
}