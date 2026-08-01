"use client";
import { useCallback } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Upload, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface UploadZoneProps {
  onFile: (file: File) => void;
  file?: File | null;
  onClear?: () => void;
  maxSizeMB?: number;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function UploadZone({
  onFile,
  file,
  onClear,
  maxSizeMB = 20,
  label = "Drag & drop claim document here, or click to browse",
  disabled,
  className,
}: UploadZoneProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) onFile(accepted[0]);
    },
    [onFile]
  );

  const onDropRejected = useCallback(
    (rejections: FileRejection[]) => {
      for (const rejection of rejections) {
        for (const err of rejection.errors) {
          if (err.code === "file-too-large") {
            toast.error(`File too large: ${(rejection.file.size / 1024 / 1024).toFixed(1)} MB`, {
              description: `Maximum allowed size is ${maxSizeMB} MB`,
            });
          } else if (err.code === "file-invalid-type") {
            toast.error("Invalid file type", {
              description: "Accepted formats: PDF, JPG, PNG, TIFF",
            });
          } else {
            toast.error(err.message);
          }
        }
      }
    },
    [maxSizeMB]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/tiff": [".tiff", ".tif"],
    },
    maxSize: maxSizeMB * 1024 * 1024,
    multiple: false,
    disabled,
  });

  if (file) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border-2 dark:border-cyan-400/40 border-cyan-500/40 dark:bg-cyan-400/5 bg-cyan-50 px-4 py-4",
          className
        )}
      >
        <FileText className="h-8 w-8 dark:text-cyan-400 text-cyan-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium dark:text-white text-slate-900">{file.name}</p>
          <p className="text-xs dark:text-slate-400 text-slate-500">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
        {onClear && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8"
            onClick={onClear}
            type="button"
            aria-label="Clear uploaded file"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors",
        isDragActive
          ? "dark:border-cyan-400 border-cyan-500 dark:bg-cyan-400/5 bg-cyan-50"
          : "dark:border-white/10 border-slate-200 dark:hover:border-cyan-400/50 hover:border-cyan-500/50 dark:hover:bg-white/[0.02] hover:bg-slate-50",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <input {...getInputProps()} />
      <Upload className="h-10 w-10 dark:text-slate-600 text-slate-300" />
      <div className="text-center">
        <p className="text-sm font-medium dark:text-white text-slate-900">{label}</p>
      </div>
    </div>
  );
}
