import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

const NativeSelect = React.forwardRef(({ className, ...props }, ref) => (
  <div className="relative w-full">
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 pr-9 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
    <ChevronDown
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
