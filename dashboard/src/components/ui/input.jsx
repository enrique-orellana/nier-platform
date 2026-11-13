import React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      type === "checkbox" || type === "radio"
        ? "size-4 shrink-0 accent-primary"
        : type === "range"
          ? "w-full cursor-pointer accent-primary"
          : type === "file"
            ? "block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
            : type === "hidden"
              ? "hidden"
              : "flex h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
